import { isOwner, json, notFound, requireUid, store, toResponse } from "@/lib/vault";

type Ctx = { params: Promise<{ treeId: string }> };

/** Owner lists the public keys waiting to be granted access. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const uid = await requireUid();
    const { treeId } = await ctx.params;
    const meta = await store.getVaultMeta(treeId).catch(() => null);
    if (!meta || !isOwner(meta, uid)) return notFound();
    return json({ pending: meta.pending });
  } catch (e) {
    return toResponse(e);
  }
}
