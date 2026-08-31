import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { deriveUid } from "@/lib/ids";
import { stripIdentifyingClaims } from "@/lib/token";

const isProd = process.env.NODE_ENV === "production";

/**
 * The cookie-signing secret. In production it MUST come from the environment —
 * `KINFOLD_PEPPER`/`AUTH_SECRET` are checked at deploy time. In development we
 * fall back to a fixed throwaway so `npm run dev` needs no `.env.local` at all,
 * which is the promise the README makes. Same spirit as the dev pepper in
 * `src/lib/ids.ts`.
 */
const authSecret =
  process.env.AUTH_SECRET ??
  (isProd ? undefined : "dev-only-insecure-auth-secret-do-not-ship-me!!");

/**
 * A provider is only registered if its keys are present. That means you can
 * clone this repo and run it with zero configuration — you get the dev login
 * below — and light up Google or GitHub later by pasting two env vars.
 */
const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(GitHub);
}

/**
 * Development-only impersonation.
 *
 * This is not a backdoor you forgot to remove — it is hard-disabled in
 * production below, and it exists so you can flip between "the owner",
 * "a cousin" and "a stranger" and watch the redaction rules actually fire.
 * Seeing authorization work is the fastest way to trust it.
 */
if (!isProd) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Developer sign-in",
      credentials: { persona: { label: "Persona", type: "text" } },
      async authorize(creds) {
        const persona = String(creds?.persona ?? "").trim();
        if (!/^[a-z0-9-]{1,32}$/.test(persona)) return null;
        return { id: persona };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  trustHost: true,
  secret: authSecret,

  /**
   * THE LOAD-BEARING LINE.
   *
   * "jwt" means the session lives entirely in a signed cookie in the visitor's
   * browser. There is no sessions table, no users table, no accounts table —
   * no database at all. Auth.js only creates those when you give it an adapter,
   * and we never do. Adding one later would quietly undo the whole premise of
   * this project, so don't.
   */
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },

  pages: { signIn: "/signin" },

  callbacks: {
    /**
     * Runs on sign-in and on every session read. On sign-in we get a fat
     * profile from the provider — name, email, avatar, sometimes more. We take
     * the one field that is stable and opaque, hash it, and throw the rest on
     * the floor before it can be written to the cookie.
     */
    async jwt({ token, account }) {
      if (account) {
        token.uid = deriveUid(account.provider, account.providerAccountId);
      }

      // Belt and braces: Auth.js puts these on the token by default, and we
      // want them gone from the cookie whether or not a provider sent them.
      stripIdentifyingClaims(token);

      return token;
    },

    /**
     * `session.uid` is the only thing any part of this app ever reads.
     * `session.user` still exists because Auth.js types insist on it, but with
     * name/email/picture stripped above it is an empty shell — deliberately.
     */
    async session({ session, token }) {
      session.uid = token.uid ?? null;
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    uid: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
  }
}

/** Convenience: the current visitor's pseudonymous id, or null. */
export async function currentUid(): Promise<string | null> {
  const session = await auth();
  return session?.uid ?? null;
}
