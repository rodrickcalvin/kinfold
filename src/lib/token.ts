/**
 * The session cookie is the one place personal data could leak back in after
 * `src/auth.ts` worked to keep it out. Auth.js populates the JWT with the
 * provider's `name`, `email`, `picture` and `sub` by default; none of them may
 * survive into the signed cookie we hand the browser.
 *
 * Kept as a standalone pure function so it can be unit-tested without booting
 * the whole Auth.js machinery.
 */
export const IDENTIFYING_CLAIMS = ["name", "email", "picture", "sub"] as const;

export function stripIdentifyingClaims<T extends Record<string, unknown>>(
  token: T,
): T {
  for (const claim of IDENTIFYING_CLAIMS) {
    delete token[claim];
  }
  return token;
}
