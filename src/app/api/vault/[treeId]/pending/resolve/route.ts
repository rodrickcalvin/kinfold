import { z } from "zod";
import {
  HttpError,
  isOwner,
  json,
  notFound,
  requireUid,
  store,
  toResponse,
} from "@/lib/vault";

type Ctx = { params: Promise<{ treeId: string }> };

const Body = z.object({
  // JSON.stringify(publicKey) of each request the owner has now handled
  // (granted or rejected — either way it leaves the queue).
  fingerprints: z.array(z.string()).min(1),
});

/**
 * Owner clears handled join requests. The actual granting happened in their
 * browser (`grantAccess` + PUT of the new sealed tree); this just drops the
 * processed public keys from the pending queue.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const uid = await requireUid();
    const { treeId } = await ctx.params;

    const meta = await store.getVaultMeta(treeId).catch(() => null);
    if (!meta || !isOwner(meta, uid)) return notFound();

    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Expected { fingerprints }");

    const drop = new Set(body.data.fingerprints);
    meta.pending = meta.pending.filter(
      (p) => !drop.has(JSON.stringify(p.publicKey)),
    );
    await store.putVaultMeta(meta);
    return json({ ok: true, remaining: meta.pending.length });
  } catch (e) {
    return toResponse(e);
  }
}
