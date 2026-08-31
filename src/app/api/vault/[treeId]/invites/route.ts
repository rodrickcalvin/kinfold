import { z } from "zod";
import { hashInvite } from "@/lib/ids";
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
  // The owner's browser hashes the code before it is sent, so the plaintext
  // invite never touches the server. `hashInvite` here is belt-and-braces for
  // callers that send the raw code.
  code: z.string().min(8).optional(),
  hash: z.string().min(1).optional(),
  slices: z.array(z.string().min(1)).min(1),
  label: z.string().max(80).optional(),
  ttlHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});

/** Owner registers an invite: a hash, the slices it grants, and an expiry. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const uid = await requireUid();
    const { treeId } = await ctx.params;

    const meta = await store.getVaultMeta(treeId).catch(() => null);
    if (!meta) return notFound();
    if (!isOwner(meta, uid)) return notFound();

    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Bad invite payload");
    const hash = body.data.hash ?? (body.data.code && hashInvite(body.data.code));
    if (!hash) throw new HttpError(400, "Provide code or hash");

    const expiresAt = new Date(
      Date.now() + body.data.ttlHours * 3600_000,
    ).toISOString();

    meta.invites.push({
      hash,
      slices: body.data.slices,
      label: body.data.label,
      expiresAt,
    });
    await store.putVaultMeta(meta);
    return json({ ok: true, expiresAt });
  } catch (e) {
    return toResponse(e);
  }
}
