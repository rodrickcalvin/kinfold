import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Exercises the /api/vault route handlers directly — no HTTP server, but the
 * real store writing to a temp directory. Auth is stubbed so we can act as
 * different accounts.
 */

let currentUid = "owner-uid-aaaaaaaa";
vi.mock("@/auth", () => ({
  currentUid: () => Promise.resolve(currentUid),
  auth: () => Promise.resolve({ uid: currentUid }),
}));

const dir = path.join(os.tmpdir(), `kinfold-api-${Date.now()}`);
process.env.KINFOLD_DATA_DIR = dir;
process.env.KINFOLD_PEPPER = "test-pepper-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type RouteMod = { GET?: Fn; PUT?: Fn; POST?: Fn };
type Fn = (req: Request, ctx: { params: Promise<{ treeId: string }> }) => Promise<Response>;

const ctx = (treeId: string) => ({ params: Promise.resolve({ treeId }) });
const req = (body?: unknown) =>
  new Request("http://t/", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let root: RouteMod;
let invites: RouteMod;
let join: RouteMod;
let pending: RouteMod;
let resolve: RouteMod;
let hashInvite: (c: string) => string;

const sealedFixture = (id: string) => ({
  id,
  version: 1 as const,
  records: [{ id: "rec1", sealed: { iv: "AAAA", ct: "BBBB" } }],
  keyring: [],
  updatedAt: new Date().toISOString(),
});

beforeAll(async () => {
  root = await import("@/app/api/vault/[treeId]/route");
  invites = await import("@/app/api/vault/[treeId]/invites/route");
  join = await import("@/app/api/vault/[treeId]/join/route");
  pending = await import("@/app/api/vault/[treeId]/pending/route");
  resolve = await import("@/app/api/vault/[treeId]/pending/resolve/route");
  ({ hashInvite } = await import("@/lib/ids"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("PUT then GET an encrypted tree", () => {
  it("first PUT creates it and claims ownership", async () => {
    currentUid = "owner-uid-aaaaaaaa";
    const res = await root.PUT!(
      req({ sealedTree: sealedFixture("fam1") }),
      ctx("fam1"),
    );
    expect(res.status).toBe(200);

    const got = await root.GET!(new Request("http://t/"), ctx("fam1"));
    expect(got.status).toBe(200);
    expect((await got.json()).sealedTree.id).toBe("fam1");
  });

  it("a different account cannot overwrite it (404, not 403)", async () => {
    currentUid = "intruder-uid-bbbb";
    const res = await root.PUT!(
      req({ sealedTree: sealedFixture("fam1") }),
      ctx("fam1"),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a body whose id does not match the URL", async () => {
    currentUid = "owner-uid-aaaaaaaa";
    const res = await root.PUT!(
      req({ sealedTree: sealedFixture("other") }),
      ctx("fam1"),
    );
    expect(res.status).toBe(400);
  });

  it("401 when signed out", async () => {
    // @ts-expect-error deliberately simulating no session
    currentUid = null;
    const res = await root.GET!(new Request("http://t/"), ctx("fam1"));
    expect(res.status).toBe(401);
    currentUid = "owner-uid-aaaaaaaa";
  });
});

describe("invite → join → approve queue", () => {
  it("owner registers an invite, member redeems it into the pending queue", async () => {
    currentUid = "owner-uid-aaaaaaaa";
    const add = await invites.POST!(
      req({ code: "invite-code-123456", slices: ["structure", "history"], label: "Cousin" }),
      ctx("fam1"),
    );
    expect(add.status).toBe(200);

    currentUid = "joiner-uid-cccccc";
    const j = await join.POST!(
      req({
        code: "invite-code-123456",
        publicKey: { kty: "EC", crv: "P-256", x: "xx", y: "yy" },
        label: "Tunde",
      }),
      ctx("fam1"),
    );
    expect(j.status).toBe(200);
    expect((await j.json()).pending).toBe(true);

    currentUid = "owner-uid-aaaaaaaa";
    const q = await pending.GET!(new Request("http://t/"), ctx("fam1"));
    const list = (await q.json()).pending;
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("Tunde");
    expect(list[0].slices).toEqual(["structure", "history"]);
  });

  it("rejects a bad invite code", async () => {
    currentUid = "joiner-uid-dddddd";
    const j = await join.POST!(
      req({ code: "wrong-code-000000", publicKey: { kty: "EC" } }),
      ctx("fam1"),
    );
    expect(j.status).toBe(403);
  });

  it("non-owner cannot read the pending queue", async () => {
    currentUid = "joiner-uid-cccccc";
    const q = await pending.GET!(new Request("http://t/"), ctx("fam1"));
    expect(q.status).toBe(404);
  });

  it("owner resolves a pending request, clearing it", async () => {
    currentUid = "owner-uid-aaaaaaaa";
    const fp = JSON.stringify({ kty: "EC", crv: "P-256", x: "xx", y: "yy" });
    const r = await resolve.POST!(req({ fingerprints: [fp] }), ctx("fam1"));
    expect(r.status).toBe(200);
    expect((await r.json()).remaining).toBe(0);
  });

  it("stores only the HMAC of an invite code, never the code", async () => {
    const metaRaw = await fs.readFile(
      path.join(dir, "vault-meta", "fam1.json"),
      "utf8",
    );
    expect(metaRaw).not.toContain("invite-code-123456");
    expect(metaRaw).toContain(hashInvite("invite-code-123456"));
  });
});
