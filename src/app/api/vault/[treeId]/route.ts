import { z } from "zod";
import { SealedTreeSchema, VaultMeta } from "@/lib/schema";
import type { SealedTree } from "@/lib/sealed";
import {
  HttpError,
  canWrite,
  json,
  notFound,
  requireUid,
  store,
  toResponse,
} from "@/lib/vault";

type Ctx = { params: Promise<{ treeId: string }> };

/**
 * Fetch an encrypted tree. Any signed-in visitor may pull the blob — it is
 * meaningless without slice keys, and members are identified only by the keys
 * in their browser, never by a uid the server could check. Missing tree → 404,
 * same as "not allowed", so a stranger cannot confirm a family is here.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    await requireUid();
    const { treeId } = await ctx.params;
    const sealed = await store.getSealed(treeId).catch(() => null);
    if (!sealed) return notFound();
    return json({ sealedTree: sealed });
  } catch (e) {
    return toResponse(e);
  }
}

const PutBody = z.object({ sealedTree: SealedTreeSchema });

/**
 * Create or replace an encrypted tree.
 *
 * First write for an id claims ownership: the caller's uid is recorded as
 * `ownerUid` in the sidecar. After that, only the owner or a listed editor may
 * overwrite the blob. This gate never sees plaintext; it just stops a passer-by
 * scribbling over your family.
 */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const uid = await requireUid();
    const { treeId } = await ctx.params;

    const body = PutBody.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Expected { sealedTree }");
    if (body.data.sealedTree.id !== treeId) {
      throw new HttpError(400, "Body id does not match the URL");
    }

    const existing = await store.getVaultMeta(treeId).catch(() => null);
    if (existing) {
      if (!canWrite(existing, uid)) return notFound();
    } else {
      await store.putVaultMeta(
        VaultMeta.parse({ treeId, ownerUid: uid }),
      );
    }

    await store.putSealed(body.data.sealedTree as unknown as SealedTree);
    return json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
