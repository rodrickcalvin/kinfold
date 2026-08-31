"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useKeys } from "@/components/KeyProvider";
import { seenTreesStore } from "@/lib/vault-client";

/**
 * The encrypted-tree entry point on the home page. Everything here is decided
 * in the browser: the server has no idea which encrypted trees this account can
 * open, because membership is a key, not a row.
 */
export function VaultHomeSection() {
  const { status, uid } = useKeys();
  const trees = useSyncExternalStore(
    seenTreesStore.subscribe,
    seenTreesStore.getSnapshot,
    seenTreesStore.getServerSnapshot,
  );

  if (!uid) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        Encrypted trees
      </h2>

      {status === "no-identity" && (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          This browser has no encryption key yet.{" "}
          <Link href="/identity" className="underline">
            Set one up
          </Link>{" "}
          to create or open an encrypted tree.
        </p>
      )}

      {status !== "no-identity" && (
        <>
          {trees.length > 0 ? (
            <ul className="space-y-2">
              {trees.map((id) => (
                <li key={id}>
                  <Link
                    href={`/vault/${id}`}
                    className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent/40 card-shadow"
                  >
                    <span className="font-mono text-sm">{id}</span>
                    <span className="text-xs text-muted">
                      {status === "locked" ? "locked" : "open"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
              No encrypted trees on this device yet.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link
              href="/vault/new"
              className="rounded-xl bg-accent px-4 py-2 font-medium text-accent-ink hover:opacity-90"
            >
              New encrypted tree
            </Link>
            <Link
              href="/identity"
              className="rounded-xl border border-line px-4 py-2 hover:bg-surface"
            >
              Manage your key
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
