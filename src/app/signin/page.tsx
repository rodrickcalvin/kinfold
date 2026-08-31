import Link from "next/link";
import { signIn } from "@/auth";

const DEV_PERSONAS = [
  {
    id: "elizabeth",
    title: "Elizabeth — owner",
    blurb: "Sees everyone, living and dead, in full.",
  },
  {
    id: "naomi",
    title: "Naomi — scoped viewer",
    blurb:
      "Sees all the ancestors, but living people only within two hops of herself.",
  },
  {
    id: "stranger",
    title: "Someone with no access",
    blurb: "Signed in, but on nobody's list. Should see no trees at all.",
  },
];

export default function SignIn() {
  const hasGoogle = Boolean(
    process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
  );
  const hasGitHub = Boolean(
    process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
  );
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <main className="mx-auto w-full max-w-md px-5 py-16">
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← Back
      </Link>

      <h1 className="mt-6 font-serif text-3xl tracking-tight">Sign in</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        We use your existing account only to prove you are the same person as
        last time. The name and email that come back are discarded before
        anything is written down.
      </p>

      {(hasGoogle || hasGitHub) && (
        <div className="mt-8 space-y-3">
          {hasGoogle && <ProviderButton id="google" label="Continue with Google" />}
          {hasGitHub && <ProviderButton id="github" label="Continue with GitHub" />}
        </div>
      )}

      {!hasGoogle && !hasGitHub && (
        <p className="mt-8 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          No OAuth provider is configured yet. Add{" "}
          <code className="font-mono text-xs">AUTH_GOOGLE_ID</code> and{" "}
          <code className="font-mono text-xs">AUTH_GOOGLE_SECRET</code> to{" "}
          <code className="font-mono text-xs">.env.local</code> to switch real
          sign-in on.
        </p>
      )}

      {isDev && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Development sign-in
          </h2>
          <p className="mt-2 text-sm text-muted">
            Switch between these to watch the permission rules actually fire.
            This block does not exist in a production build.
          </p>
          <div className="mt-4 space-y-3">
            {DEV_PERSONAS.map((p) => (
              <form
                key={p.id}
                action={async () => {
                  "use server";
                  await signIn("dev", { persona: p.id, redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="w-full rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent/40"
                >
                  <span className="block font-medium">{p.title}</span>
                  <span className="mt-1 block text-sm text-muted">{p.blurb}</span>
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function ProviderButton({ id, label }: { id: string; label: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn(id, { redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="w-full rounded-xl bg-accent px-5 py-3 font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        {label}
      </button>
    </form>
  );
}
