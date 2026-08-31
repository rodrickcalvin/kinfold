import { z } from "zod";
import { PendingJoin } from "@/lib/schema";
import {
  HttpError,
  json,
  matchInvite,
  notFound,
  requireUid,
  store,
  toResponse,
} from "@/lib/vault";

type Ctx = { params: Promise<{ treeId: string }> };

const Body = z.object({
  code: z.string().min(8),
  publicKey: z.record(z.string(), z.unknown()),
  label: z.string().max(80).optional(),
});

/**
 * A prospective member submits their public key with an invite code. If the
 * code matches an unexpired invite, the key lands in `pending` for the owner to
 * approve from their browser (only the owner can wrap slice keys). The server
 * cannot grant anything itself — that is the whole point.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireUid(); // must be signed in, but any account may ask to join
    const { treeId } = await ctx.params;

    const meta = await store.getVaultMeta(treeId).catch(() => null);
    if (!meta) return notFound();

    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Bad join payload");

    const invite = matchInvite(meta, body.data.code);
    if (!invite) throw new HttpError(403, "Invite is invalid or expired");

    const fingerprint = JSON.stringify(body.data.publicKey);
    const already = meta.pending.some(
      (p) => JSON.stringify(p.publicKey) === fingerprint,
    );
    if (!already) {
      meta.pending.push(
        PendingJoin.parse({
          publicKey: body.data.publicKey,
          label: body.data.label ?? invite.label,
          slices: invite.slices,
          requestedAt: new Date().toISOString(),
        }),
      );
      await store.putVaultMeta(meta);
    }
    return json({ ok: true, pending: true });
  } catch (e) {
    return toResponse(e);
  }
}
