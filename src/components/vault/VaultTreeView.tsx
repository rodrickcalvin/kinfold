"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useKeys } from "@/components/KeyProvider";
import { IdentityGate } from "@/components/vault/IdentityGate";
import { Note } from "@/components/vault/ui";
import TreeExplorer from "@/components/TreeExplorer";
import { layoutTree } from "@/lib/layout";
import type { VisibleTree } from "@/lib/visibility";
import { ALL_SLICES, keysFor, openTree } from "@/lib/sealed";
import { rememberTree, seenTrees, vaultApi } from "@/lib/vault-client";

export function VaultTreeView({ treeId }: { treeId: string }) {
  return (
    <Inner treeId={treeId} />
  );
}

/** Centered card used for every state that is not the full-bleed tree canvas. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-12">
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← Home
      </Link>
      <div className="mt-6">{children}</div>
    </main>
  );
}

function Inner({ treeId }: { treeId: string }) {
  const { identity } = useKeys();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "no-access" }
    | { kind: "ok"; view: VisibleTree; canEdit: boolean }
  >({ kind: "loading" });

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      try {
        const sealed = await vaultApi.get(treeId);
        const keys = await keysFor(sealed, identity.privateKey);
        if (cancelled) return;
        if (keys.size === 0) return setState({ kind: "no-access" });
        const view = await openTree(sealed, keys);
        if (cancelled) return;
        if (!view) return setState({ kind: "no-access" });
        rememberTree(treeId);
        // Only a holder of every slice key can safely re-seal an edit.
        setState({
          kind: "ok",
          view,
          canEdit: ALL_SLICES.every((s) => keys.has(s)),
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err instanceof Error && /404/.test(err.message)
              ? "This tree does not exist, or nothing here can open it."
              : err instanceof Error
                ? err.message
                : "Could not load the tree.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, treeId]);

  if (state.kind === "loading") {
    return (
      <Frame>
        <IdentityGate>
          <p className="text-sm text-muted">Decrypting…</p>
        </IdentityGate>
      </Frame>
    );
  }

  if (state.kind === "error") {
    return (
      <Frame>
        <Note tone="error">{state.message}</Note>
      </Frame>
    );
  }

  if (state.kind === "no-access") {
    const known = seenTrees().includes(treeId);
    return (
      <Frame>
        <Note tone="warn">
          {known
            ? "Your key no longer opens this tree — the owner may have rotated the keys after a change to who has access."
            : "You do not hold a key for this tree yet."}{" "}
          <Link href={`/join/${treeId}`} className="underline">
            Redeem an invite
          </Link>
          .
        </Note>
      </Frame>
    );
  }

  const { view, canEdit } = state;

  if (view.people.length === 0) {
    return (
      <Frame>
        <Note>
          <p className="font-medium text-ink">{view.name}</p>
          <p className="mt-1">This tree has no people in it yet.</p>
          {canEdit && (
            <Link
              href={`/vault/${treeId}/edit`}
              className="mt-3 inline-block underline"
            >
              Start adding relatives
            </Link>
          )}
        </Note>
      </Frame>
    );
  }

  const layout = layoutTree(view);
  return (
    <div className="fixed inset-0">
      <TreeExplorer
        layout={layout}
        treeName={view.name}
        viewer={view.viewer}
      />
      {canEdit && (
        <Link
          href={`/vault/${treeId}/edit`}
          className="absolute left-4 top-20 z-20 rounded-xl border border-line bg-surface/90 px-3 py-1.5 text-sm backdrop-blur card-shadow hover:border-accent/40"
        >
          Edit
        </Link>
      )}
    </div>
  );
}
