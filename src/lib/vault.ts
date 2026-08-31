import { currentUid } from "@/auth";
import { store } from "@/lib/store";
import { hashInvite, safeEqual } from "@/lib/ids";
import type { VaultMeta } from "@/lib/schema";

/**
 * Server-side helpers for the encrypted-tree API.
 *
 * None of this can read a tree. It decides only who may *overwrite the blob*
 * and *see the plaintext-safe sidecar* — vandalism and spam control, wholly
 * separate from the cryptographic question of who can decrypt a record. That
 * one is answered by whether `keysFor` returns anything, in the browser.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 404 for both "does not exist" and "not yours" — see the note in trees/[treeId]. */
export const notFound = () => new Response("Not found", { status: 404 });

/** Turn a thrown error into the right HTTP response. */
export function toResponse(e: unknown): Response {
  if (e instanceof HttpError) return new Response(e.message, { status: e.status });
  if (e instanceof Error && /Unsafe id/.test(e.message)) {
    return new Response("Bad tree id", { status: 400 });
  }
  console.error(e);
  return new Response("Server error", { status: 500 });
}

export async function requireUid(): Promise<string> {
  const uid = await currentUid();
  if (!uid) throw new HttpError(401, "Sign in first");
  return uid;
}

export function isOwner(meta: VaultMeta, uid: string): boolean {
  return meta.ownerUid === uid;
}

export function canWrite(meta: VaultMeta, uid: string): boolean {
  return meta.ownerUid === uid || meta.editorUids.includes(uid);
}

/**
 * Match a submitted invite code against the tree's stored hashes. Returns the
 * matching invite (so the caller knows which slices it is good for), or null.
 * Expired invites never match.
 */
export function matchInvite(meta: VaultMeta, code: string) {
  const submitted = hashInvite(code);
  const now = Date.now();
  return (
    meta.invites.find(
      (inv) =>
        safeEqual(inv.hash, submitted) && Date.parse(inv.expiresAt) > now,
    ) ?? null
  );
}

export { store };
