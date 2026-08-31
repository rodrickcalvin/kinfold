"use client";

import Link from "next/link";
import { useState } from "react";
import { useKeys } from "@/components/KeyProvider";
import { IdentityGate } from "@/components/vault/IdentityGate";
import { Button, Field, Note, inputClass } from "@/components/vault/ui";
import { rememberTree, vaultApi } from "@/lib/vault-client";

export function JoinPanel({ treeId }: { treeId: string }) {
  return (
    <IdentityGate>
      <Inner treeId={treeId} />
    </IdentityGate>
  );
}

function Inner({ treeId }: { treeId: string }) {
  const { identity } = useKeys();
  // This component only mounts client-side (after the key unlocks), so reading
  // the invite code out of the URL fragment in the initialiser is safe.
  const [code, setCode] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.location.hash.replace(/^#/, "").trim(),
  );
  const [label, setLabel] = useState("");
  const [state, setState] = useState<"form" | "sending" | "sent">("form");
  const [error, setError] = useState<string | null>(null);

  if (state === "sent") {
    return (
      <Note tone="warn">
        <p>Your request has been sent.</p>
        <p className="mt-2">
          The owner has to approve it from their own browser — only they can wrap
          the keys to your public key. Check back here once they have; this tree
          will then open for you.
        </p>
        <Link href="/" className="mt-3 inline-block underline">
          Back home
        </Link>
      </Note>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!identity) return;
        setState("sending");
        setError(null);
        try {
          await vaultApi.join(treeId, {
            code: code.trim(),
            publicKey: identity.publicKey,
            label: label.trim() || undefined,
          });
          rememberTree(treeId);
          setState("sent");
        } catch (err) {
          setError(
            err instanceof Error && /403/.test(err.message)
              ? "That invite code is not valid, or it has expired."
              : err instanceof Error
                ? err.message
                : "Could not send the request.",
          );
          setState("form");
        }
      }}
    >
      <Note>
        This sends your <em>public</em> key to the tree owner along with the
        invite code. Your private key never leaves this browser.
      </Note>
      <Field label="Invite code" hint="Filled in from your invite link, if you used one.">
        <input
          className={inputClass}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </Field>
      <Field label="Your name for the owner" hint="Optional. Helps them recognise your request.">
        <input
          className={inputClass}
          value={label}
          placeholder="e.g. Tunde (Lagos)"
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      {error && <Note tone="error">{error}</Note>}
      <Button type="submit" disabled={state === "sending" || !code.trim()}>
        {state === "sending" ? "Sending…" : "Request access"}
      </Button>
    </form>
  );
}
