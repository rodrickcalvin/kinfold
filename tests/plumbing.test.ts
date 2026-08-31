import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripIdentifyingClaims, IDENTIFYING_CLAIMS } from "@/lib/token";
import { deriveUid, hashInvite, newInviteCode, safeEqual } from "@/lib/ids";
import { deriveUidWith, DEV_PEPPER } from "@/lib/uid-core.mjs";
import { FileTreeStore } from "@/lib/store";
import { Access, Tree } from "@/lib/schema";

describe("session cookie carries no identity", () => {
  it("drops every default Auth.js claim that names a person", () => {
    const token = stripIdentifyingClaims({
      uid: "abc123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      picture: "https://example.com/ada.jpg",
      sub: "109876543210987654321",
      iat: 1,
    });
    for (const claim of IDENTIFYING_CLAIMS) {
      expect(token).not.toHaveProperty(claim);
    }
    // ...but keeps the pseudonym and the housekeeping fields.
    expect(token.uid).toBe("abc123");
    expect(token.iat).toBe(1);
  });
});

describe("uid derivation is defined in exactly one place", () => {
  it("ids.ts and uid-core.mjs agree in dev", () => {
    // ids.ts falls back to DEV_PEPPER when KINFOLD_PEPPER is unset.
    delete process.env.KINFOLD_PEPPER;
    expect(deriveUid("dev", "elizabeth")).toBe(
      deriveUidWith(DEV_PEPPER, "dev", "elizabeth"),
    );
  });

  it("is a stable 32-char token", () => {
    const uid = deriveUid("google", "109876543210987654321");
    expect(uid).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(deriveUid("google", "109876543210987654321")).toBe(uid);
  });
});

describe("invite codes", () => {
  it("mints distinct high-entropy codes", () => {
    const codes = new Set(Array.from({ length: 100 }, newInviteCode));
    expect(codes.size).toBe(100);
    expect(newInviteCode()).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("stores only a hash, and matches it in constant time", () => {
    const code = newInviteCode();
    const stored = hashInvite(code);
    expect(stored).not.toContain(code);
    expect(safeEqual(hashInvite(code), stored)).toBe(true);
    expect(safeEqual(hashInvite(newInviteCode()), stored)).toBe(false);
  });

  it("safeEqual is false for different-length inputs rather than throwing", () => {
    expect(safeEqual("short", "considerably-longer")).toBe(false);
  });
});

describe("FileTreeStore round-trips through disk", () => {
  it("writes a tree and an access file and reads them back validated", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kinfold-store-"));
    try {
      const store = new FileTreeStore(dir);

      const tree = Tree.parse({
        id: "smoke",
        name: "Smoke Test Family",
        people: [{ id: "a", given: "A", surname: "Test", living: true }],
        unions: [],
      });
      await store.putTree(tree);

      const back = await store.getTree("smoke");
      expect(back?.name).toBe("Smoke Test Family");
      expect(back?.people).toHaveLength(1);
      // putTree stamps updatedAt on write.
      expect(back?.updatedAt).toBeTypeOf("string");

      expect(await store.listTreeIds()).toEqual(["smoke"]);

      const access = Access.parse({
        treeId: "smoke",
        members: [{ uid: "abcdefgh", role: "owner" }],
      });
      await store.putAccess(access);
      const accessBack = await store.getAccess("smoke");
      expect(accessBack?.members[0].role).toBe("owner");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a missing tree instead of throwing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kinfold-store-"));
    try {
      expect(await new FileTreeStore(dir).getTree("nope")).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
