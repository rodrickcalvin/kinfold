import Link from "next/link";
import { currentUid, signOut } from "@/auth";
import { store } from "@/lib/store";
import { roleFor } from "@/lib/access";
import { atLeast } from "@/lib/schema";
import { inferLiving } from "@/lib/schema";
import { VaultHomeSection } from "@/components/vault/VaultHomeSection";

export const dynamic = "force-dynamic"; // the answer depends on who is asking

export default async function Home() {
  const uid = await currentUid();
  const ids = await store.listTreeIds();

  const trees = (
    await Promise.all(
      ids.map(async (id) => {
        const [tree, access] = await Promise.all([
          store.getTree(id),
          store.getAccess(id),
        ]);
        if (!tree) return null;
        const role = roleFor(access, uid);
        if (!atLeast(role, "viewer")) return null;
        return {
          id,
          name: tree.name,
          description: tree.description,
          role,
          people: tree.people.length,
          living: tree.people.filter(inferLiving).length,
        };
      }),
    )
  ).filter(Boolean) as Array<{
    id: string;
    name: string;
    description?: string;
    role: string;
    people: number;
    living: number;
  }>;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
      <header className="mb-10">
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Kinfold</h1>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">
          A family tree you can share without handing over your family&apos;s
          data. We never store your name, your email, or your face — only a
          one-way hash of your login, so we can tell whose tree is whose.
        </p>
      </header>

      {uid ? (
        <>
          <VaultHomeSection />

          <section className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Self-hosted trees
            </h2>

            {trees.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">
                No tree has added you yet. Ask whoever runs your family&apos;s
                tree for an invite.
              </p>
            ) : (
              <ul className="space-y-3">
                {trees.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/trees/${t.id}`}
                      className="block rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent/40 card-shadow"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">{t.name}</span>
                        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium capitalize text-accent">
                          {t.role}
                        </span>
                      </div>
                      {t.description && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-muted">
                          {t.description}
                        </p>
                      )}
                      <p className="mt-2.5 text-xs text-muted">
                        {t.people} people · {t.living} living
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface-2/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Your account
            </h2>
            <p className="mt-2 text-sm text-muted">
              Everything we know about you:
            </p>
            <code className="mt-2 block overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs">
              {uid}
            </code>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              That is the whole record. There is no row anywhere with your name
              on it — this string is a keyed hash of your provider account,
              and it cannot be turned back into an email address.
            </p>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface"
              >
                Sign out
              </button>
            </form>
          </section>
        </>
      ) : (
        <Link
          href="/signin"
          className="inline-flex items-center rounded-xl bg-accent px-5 py-3 font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Sign in to see your family
        </Link>
      )}
    </main>
  );
}
