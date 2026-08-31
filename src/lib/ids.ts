import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Everything in here exists to answer one question:
 * "how do we know who you are without ever keeping anything about you?"
 *
 * The answer: we never store your identity. We store a keyed hash of it.
 * Same person, same hash, every time — so permissions keep working.
 * But the hash cannot be turned back into an email, and it is worthless
 * in any other deployment because the pepper differs.
 */

function pepper(): string {
  const p = process.env.KINFOLD_PEPPER;
  if (!p || p.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "KINFOLD_PEPPER must be set to a random string of 32+ chars in production. " +
          "Generate one with: openssl rand -base64 32",
      );
    }
    // Dev only, and fixed so uids stay stable across restarts while you build.
    return "dev-only-insecure-pepper-do-not-ship-me!!";
  }
  return p;
}

function hmac(input: string): string {
  return createHmac("sha256", pepper()).update(input).digest("base64url");
}

/**
 * Turn an OIDC identity into our pseudonymous account id.
 *
 * `issuer` is the provider ("google", "github"), `subject` is that provider's
 * stable opaque id for the user — NOT their email. Emails get reassigned and
 * changed; `sub` does not.
 *
 * Rotating the pepper invalidates every uid, which is a deliberate feature:
 * it is the emergency "log everyone out of everything" lever.
 */
export function deriveUid(issuer: string, subject: string): string {
  if (!issuer || !subject) throw new Error("deriveUid needs issuer and subject");
  return hmac(`v1|${issuer}|${subject}`).slice(0, 32);
}

/** Invite codes: we hand out the code, we store only the hash. */
export function newInviteCode(): string {
  return randomBytes(12).toString("base64url");
}

export function hashInvite(code: string): string {
  return hmac(`invite|${code}`);
}

/** Constant-time compare so we do not leak hash contents through timing. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
