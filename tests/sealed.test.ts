import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Tree } from "@/lib/schema";
import { layoutTree } from "@/lib/layout";
import {
  ALL_SLICES,
  type SealedTree,
  type SliceId,
  type SliceKeys,
  grantAccess,
  keysFor,
  openTree,
  revokeAccess,
  sealTree,
} from "@/lib/sealed";
import {
  generateIdentity,
  protectIdentity,
  unlockIdentity,
  seal,
  unseal,
  generateSliceKey,
  newRecoveryPhrase,
  type Identity,
} from "@/lib/crypto";

const root = path.resolve(__dirname, "..");
const plain = Tree.parse(
  JSON.parse(readFileSync(path.join(root, "data/trees/adeyemi.json"), "utf8")),
);

/** Every name in the fixture. None of these may ever appear on the wire. */
const ALL_NAMES = [
  ...plain.people.map((p) => p.given),
  ...plain.people.map((p) => p.surname),
  ...plain.people.map((p) => p.birthSurname ?? ""),
].filter(Boolean);

let sealed: SealedTree;
let keys: SliceKeys;
let owner: Identity;
let cousin: Identity;
let distant: Identity;
let outsider: Identity;

const openAs = async (tree: SealedTree, id: Identity) =>
  openTree(tree, await keysFor(tree, id.privateKey));

beforeAll(async () => {
  ({ sealedTree: sealed, keys } = await sealTree(plain));

  owner = await generateIdentity();
  cousin = await generateIdentity();
  distant = await generateIdentity();
  outsider = await generateIdentity();

  const grant = async (who: Identity, slices: SliceId[]) => {
    sealed = await grantAccess(sealed, who.publicKey, slices, keys);
  };

  await grant(owner, ALL_SLICES);
  await grant(cousin, ["structure", "history", "living-name"]);
  await grant(distant, ["structure", "history"]);
  // `outsider` is granted nothing at all.
});

/* ================================================================== */

describe("what the operator can see", () => {
  it("stores no name, place or note anywhere in the document", () => {
    const wire = JSON.stringify(sealed);
    for (const name of ALL_NAMES) {
      expect(wire, `leaked "${name}"`).not.toContain(name);
    }
    expect(wire).not.toContain("Lagos");
    expect(wire).not.toContain("Railway clerk");
  });

  it("does not even store the name of the tree", () => {
    expect(JSON.stringify(sealed)).not.toContain("Adeyemi");
  });

  it("cannot reconstruct the family from record ids", () => {
    for (const r of sealed.records) {
      expect(r.id).toMatch(/^[A-Za-z0-9_-]{16}$/); // random, carries nothing
    }
  });

  it("hands out nothing to a party holding the document but no key", async () => {
    expect(await openAs(sealed, outsider)).toBeNull();
    expect(await keysFor(sealed, outsider.privateKey)).toEqual(new Map());
  });

  it("pads nothing away: record sizes should not obviously classify records", () => {
    // Not a security guarantee, just a check that we did not accidentally make
    // one slice trivially identifiable by length. Documented, not enforced.
    const sizes = new Set(sealed.records.map((r) => r.sealed.ct.length));
    expect(sizes.size).toBeGreaterThan(1);
  });
});

describe("owner", () => {
  it("recovers the tree exactly", async () => {
    const view = (await openAs(sealed, owner))!;
    expect(view.name).toBe(plain.name);
    expect(view.people).toHaveLength(plain.people.length);
    expect(view.unions).toHaveLength(plain.unions.length);
    expect(view.people.every((p) => p.visibility === "full")).toBe(true);
  });

  it("gets the private note on a deceased ancestor", async () => {
    const view = (await openAs(sealed, owner))!;
    const samuel = view.people.find((p) => p.id === "p1")!;
    expect(samuel.detail?.note).toContain("Railway clerk");
  });

  it("gets birthdays of the living", async () => {
    const view = (await openAs(sealed, owner))!;
    const zara = view.people.find((p) => p.id === "p15")!;
    expect(zara.detail?.birth?.date).toBe("2005-12-25");
  });
});

describe("member with names but not details", () => {
  it("sees living relatives by name and nothing else", async () => {
    const view = (await openAs(sealed, cousin))!;
    const zara = view.people.find((p) => p.id === "p15")!;
    expect(zara.visibility).toBe("limited");
    expect(zara.label).toBe("Zara Adeyemi");
    expect(zara.detail).toBeUndefined();
  });

  it("still sees the whole ancestral line in full", async () => {
    const view = (await openAs(sealed, cousin))!;
    expect(view.people.find((p) => p.id === "p1")!.visibility).toBe("full");
  });

  it("holds no key that could decrypt a detail record", async () => {
    const held = await keysFor(sealed, cousin.privateKey);
    expect(held.has("living-detail")).toBe(false);
    expect([...held.keys()].sort()).toEqual(["history", "living-name", "structure"]);
  });
});

describe("member with ancestors only", () => {
  it("sees living people as anonymous boxes", async () => {
    const view = (await openAs(sealed, distant))!;
    const living = view.people.filter((p) => p.living);
    expect(living.length).toBeGreaterThan(0);
    expect(living.every((p) => p.visibility === "hidden")).toBe(true);
    expect(living.every((p) => p.label === "Private")).toBe(true);
  });

  it("keeps the shape of the family intact so the tree still draws", async () => {
    const view = (await openAs(sealed, distant))!;
    expect(view.people).toHaveLength(plain.people.length);
    expect(view.unions).toHaveLength(plain.unions.length);
  });

  it("cannot see a living name even in the raw decrypted payload", async () => {
    const view = (await openAs(sealed, distant))!;
    const wire = JSON.stringify(view);
    for (const p of plain.people.filter((x) => x.living)) {
      expect(wire, `leaked "${p.given}"`).not.toContain(p.given);
    }
  });
});

describe("revocation", () => {
  it("removes the member's grants from the document", async () => {
    const entry = sealed.keyring.find((k) =>
      k.grants.length === ALL_SLICES.length,
    )!;
    const after = revokeAccess(sealed, entry.memberId);
    expect(after.keyring).toHaveLength(sealed.keyring.length - 1);
    expect(await keysFor(after, owner.privateKey)).toEqual(new Map());
  });

  it("does not pretend to reach a key the member already copied", async () => {
    // Honesty test. The old keys still open the old ciphertext; only a full
    // re-key changes that. If this ever starts failing, someone has added a
    // false promise to the docs.
    const held = await keysFor(sealed, owner.privateKey);
    const after = revokeAccess(sealed, sealed.keyring[0].memberId);
    expect(await openTree(after, held)).not.toBeNull();
  });
});

describe("crypto primitives", () => {
  it("rejects a tampered ciphertext instead of returning garbage", async () => {
    const key = await generateSliceKey();
    const box = await seal(key, { secret: "grandma" });
    const flipped = {
      ...box,
      ct: box.ct.slice(0, -2) + (box.ct.at(-2) === "A" ? "B" : "A") + box.ct.at(-1),
    };
    expect(await unseal(key, flipped)).toBeNull();
  });

  it("does not open a record with someone else's key", async () => {
    const box = await seal(await generateSliceKey(), { secret: "grandma" });
    expect(await unseal(await generateSliceKey(), box)).toBeNull();
  });

  it("protects a private key under a passphrase and gets it back", async () => {
    const id = await generateIdentity();
    const prot = await protectIdentity(id, "correct horse battery staple");
    expect(JSON.stringify(prot)).not.toContain("correct horse");

    expect(await unlockIdentity(prot, "wrong passphrase")).toBeNull();

    const unlocked = await unlockIdentity(prot, "correct horse battery staple");
    expect(unlocked).not.toBeNull();

    // And the recovered key really is the same one: it unwraps the same grants.
    const { sealedTree: t, keys: k } = await sealTree(plain);
    const withGrant = await grantAccess(t, id.publicKey, ALL_SLICES, k);
    expect(await openTree(withGrant, await keysFor(withGrant, unlocked!.privateKey)))
      .not.toBeNull();
  });

  it("mints distinct recovery phrases", () => {
    const phrases = new Set(Array.from({ length: 50 }, newRecoveryPhrase));
    expect(phrases.size).toBe(50);
  });
});

describe("the renderer did not have to change", () => {
  it("lays out a decrypted tree exactly as it laid out a redacted one", async () => {
    const view = (await openAs(sealed, distant))!;
    const laid = layoutTree(view);
    expect(laid.nodes).toHaveLength(plain.people.length);

    const y = new Map(laid.nodes.map((n) => [n.person.id, n.y]));
    for (const u of plain.unions) {
      for (const child of u.children) {
        for (const parent of u.partners) {
          expect(y.get(child)!).toBeGreaterThan(y.get(parent)!);
        }
      }
    }
  });
});
