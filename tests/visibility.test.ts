import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Access, Tree } from "@/lib/schema";
import { redactTree } from "@/lib/visibility";
import { layoutTree } from "@/lib/layout";
import { FileTreeStore } from "@/lib/store";
import { deriveUid } from "@/lib/ids";

const root = path.resolve(__dirname, "..");
const tree = Tree.parse(
  JSON.parse(readFileSync(path.join(root, "data/trees/adeyemi.json"), "utf8")),
);
const access = Access.parse(
  JSON.parse(readFileSync(path.join(root, "data/access/adeyemi.json"), "utf8")),
);

const OWNER = deriveUid("dev", "elizabeth");
const SCOPED = deriveUid("dev", "naomi");
const OUTSIDER = deriveUid("dev", "stranger");

const byId = (t: NonNullable<ReturnType<typeof redactTree>>, id: string) =>
  t.people.find((p) => p.id === id)!;

/**
 * These fixtures are the point of the test: if someone later "simplifies" the
 * redaction logic, this suite is what stops a living child's birthday from
 * quietly appearing in a payload.
 */
describe("access", () => {
  it("keeps the demo uids in the access file in sync with the deriver", () => {
    // If this fails, the pepper changed and data/access/*.json needs regenerating.
    expect(access.members.map((m) => m.uid).sort()).toEqual(
      [OWNER, SCOPED, OUTSIDER].sort(),
    );
  });

  it("returns nothing at all for a signed-out visitor", () => {
    expect(redactTree(tree, access, null)).toBeNull();
  });

  it("returns nothing for a signed-in account that is not a member", () => {
    expect(redactTree(tree, access, deriveUid("dev", "nobody"))).toBeNull();
  });
});

describe("owner", () => {
  const view = redactTree(tree, access, OWNER)!;

  it("sees every person in full", () => {
    expect(view.people).toHaveLength(tree.people.length);
    expect(view.people.every((p) => p.visibility === "full")).toBe(true);
    expect(view.viewer.redactedCount).toBe(0);
  });

  it("gets the private notes", () => {
    expect(byId(view, "p1").detail?.note).toContain("Railway clerk");
  });
});

describe("scoped viewer", () => {
  const view = redactTree(tree, access, SCOPED)!;

  it("still sees the dead in full, because that part is history", () => {
    // Samuel, the great-grandfather, died in 1988.
    expect(byId(view, "p1").visibility).toBe("full");
    expect(byId(view, "p1").detail?.birth?.place).toBe("Lagos, Nigeria");
  });

  it("sees living relatives close to her, but without their details", () => {
    // Naomi herself (p10) and her mother Miriam (p4) are within 2 hops.
    expect(byId(view, "p10").visibility).toBe("limited");
    expect(byId(view, "p4").visibility).toBe("limited");
  });

  it("never receives a birth date for a living person", () => {
    for (const p of view.people) {
      if (p.living) expect(p.detail).toBeUndefined();
    }
  });

  it("cannot see living people on the far side of the tree", () => {
    // Zara (p15), born 2005, is a second cousin — four hops away.
    const zara = byId(view, "p15");
    expect(zara.visibility).toBe("hidden");
    expect(zara.label).toBe("Private");
    // Not even an initial: initial + position in a tree identifies a child.
    expect(JSON.stringify(zara)).not.toMatch(/Zara/i);
  });

  it("leaks no hidden name anywhere in the serialised payload", () => {
    const payload = JSON.stringify(view);
    for (const p of view.people.filter((x) => x.visibility === "hidden")) {
      const source = tree.people.find((t) => t.id === p.id)!;
      expect(payload).not.toContain(source.given);
    }
  });

  it("strips marriage dates from unions that touch a hidden person", () => {
    const u5 = view.unions.find((u) => u.id === "u5")!; // Peter & Amara, both living
    expect(u5.start).toBeUndefined();
  });

  it("reports that redaction happened, so the UI can say so", () => {
    expect(view.viewer.scoped).toBe(true);
    expect(view.viewer.redactedCount).toBeGreaterThan(0);
  });
});

describe("unscoped viewer", () => {
  const view = redactTree(tree, access, OUTSIDER)!;

  it("sees every living person by name but nothing more", () => {
    const living = view.people.filter((p) => p.living);
    expect(living.length).toBeGreaterThan(0);
    expect(living.every((p) => p.visibility === "limited")).toBe(true);
    expect(living.every((p) => p.detail === undefined)).toBe(true);
  });
});

describe("layout", () => {
  const view = redactTree(tree, access, OWNER)!;
  const laid = layoutTree(view);

  it("places every person exactly once", () => {
    expect(laid.nodes).toHaveLength(tree.people.length);
  });

  it("puts children strictly below their parents", () => {
    const y = new Map(laid.nodes.map((n) => [n.person.id, n.y]));
    for (const u of tree.unions) {
      for (const child of u.children) {
        for (const parent of u.partners) {
          expect(y.get(child)!).toBeGreaterThan(y.get(parent)!);
        }
      }
    }
  });

  it("never overlaps two cards", () => {
    for (const a of laid.nodes) {
      for (const b of laid.nodes) {
        if (a.person.id >= b.person.id) continue;
        const overlap =
          Math.abs(a.x - b.x) < 140 && Math.abs(a.y - b.y) < 70;
        expect(overlap, `${a.person.id} overlaps ${b.person.id}`).toBe(false);
      }
    }
  });
});

describe("store", () => {
  const store = new FileTreeStore(path.join(root, "data"));

  it("loads and validates the fixture", async () => {
    const t = await store.getTree("adeyemi");
    expect(t?.people).toHaveLength(15);
  });

  it("refuses ids that try to walk out of the data directory", async () => {
    await expect(store.getTree("../../etc/passwd")).rejects.toThrow(/Unsafe id/);
  });
});
