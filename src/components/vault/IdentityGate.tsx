"use client";

import { useState } from "react";
import Link from "next/link";
import { useKeys } from "@/components/KeyProvider";
import { Button, Field, Note, inputClass } from "@/components/vault/ui";

/**
 * Wrap any screen that needs an unlocked private key. It renders the right
 * prompt for every state — signed out, no identity yet, locked — and only shows
 * `children` once a key is in memory.
 */
export function IdentityGate({ children }: { children: React.ReactNode }) {
  const { status, unlock } = useKeys();
  const [secret, setSecret] = useState("");
  const [via, setVia] = useState<"passphrase" | "recovery">("passphrase");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return <p className="text-sm text-muted">Checking your keys…</p>;
  }

  if (status === "signed-out") {
    return (
      <Note>
        You need to{" "}
        <Link href="/signin" className="underline">
          sign in
        </Link>{" "}
        before you can unlock a tree.
      </Note>
    );
  }

  if (status === "no-identity") {
    return (
      <Note tone="warn">
        This browser has no key yet.{" "}
        <Link href="/identity" className="underline">
          Set one up
        </Link>{" "}
        — it takes a moment and gives you a recovery phrase to write down.
      </Note>
    );
  }

  if (status === "locked") {
    return (
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const ok = await unlock(secret, via);
          setBusy(false);
          if (!ok) setError("That did not unlock the key. Try again.");
          else setSecret("");
        }}
      >
        <Field
          label={via === "passphrase" ? "Passphrase" : "Recovery phrase"}
          hint={
            via === "passphrase"
              ? "The one you chose when you set this browser up."
              : "The 24-group phrase from setup. Spaces or dashes, either is fine."
          }
        >
          <input
            className={inputClass}
            type={via === "passphrase" ? "password" : "text"}
            autoComplete={via === "passphrase" ? "current-password" : "off"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
          />
        </Field>
        {error && <Note tone="error">{error}</Note>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !secret}>
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
          <button
            type="button"
            className="text-sm text-muted hover:text-ink"
            onClick={() => {
              setVia((v) => (v === "passphrase" ? "recovery" : "passphrase"));
              setError(null);
              setSecret("");
            }}
          >
            {via === "passphrase"
              ? "Use recovery phrase instead"
              : "Use passphrase instead"}
          </button>
        </div>
      </form>
    );
  }

  return <>{children}</>;
}
