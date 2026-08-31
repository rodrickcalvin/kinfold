import { createHmac } from "node:crypto";

/**
 * The uid derivation, with no environment or framework around it, so that both
 * the app (`src/lib/ids.ts`) and the standalone CLI (`scripts/uid.mjs`) compute
 * exactly the same value. If these two ever disagree, every access file breaks
 * silently — hence one shared implementation.
 */

/** Fixed, obviously-insecure pepper used only for local development. */
export const DEV_PEPPER = "dev-only-insecure-pepper-do-not-ship-me!!";

/** Bump this if the input framing below ever changes. */
export const UID_VERSION = "v1";

export function deriveUidWith(pepper, issuer, subject) {
  if (!issuer || !subject) {
    throw new Error("deriveUid needs issuer and subject");
  }
  return createHmac("sha256", pepper)
    .update(`${UID_VERSION}|${issuer}|${subject}`)
    .digest("base64url")
    .slice(0, 32);
}

export function hmacWith(pepper, input) {
  return createHmac("sha256", pepper).update(input).digest("base64url");
}
