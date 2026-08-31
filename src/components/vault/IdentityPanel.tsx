"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useKeys } from "@/components/KeyProvider";
import { toB64 } from "@/lib/crypto";
import { Button, Field, Note, inputClass } from "@/components/vault/ui";
import { IdentityGate } from "@/components/vault/IdentityGate";

export function IdentityPanel() {
  const { status } = useKeys();

  if (status === "no-identity") return <SetupForm />;
  if (status === "signed-out" || status === "loading" || status === "locked") {
    return <IdentityGate>{null}</IdentityGate>;
  }
  return <UnlockedView />;
}

function SetupForm() {
  const router = useRouter();
  const { createIdentity } = useKeys();
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phrase) {
    return (
      <div className="space-y-4">
        <Note tone="warn">
          Write this down and keep it somewhere safe and offline. It is the only
          way back into your trees if you lose this browser or forget your
          passphrase. We cannot show it again and we do not have a copy.
        </Note>
        <p className="select-all rounded-xl border border-line bg-surface px-3 py-3 font-mono text-[13px] leading-relaxed tracking-wide">
          {phrase}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span>I have written down my recovery phrase.</span>
        </label>
        <Button disabled={!ack} onClick={() => router.push("/")}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (pass.length < 8) return setError("Use at least 8 characters.");
        if (pass !== confirm) return setError("The two passphrases do not match.");
        setBusy(true);
        try {
          setPhrase(await createIdentity(pass));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Something went wrong.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Note>
        This creates an encryption key that stays in this browser. It never
        reaches the server. You will pick a passphrase to unlock it and get a
        recovery phrase to write down.
      </Note>
      <Field label="Passphrase" hint="At least 8 characters. A short sentence works well.">
        <input
          className={inputClass}
          type="password"
          autoComplete="new-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
      </Field>
      <Field label="Confirm passphrase">
        <input
          className={inputClass}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      {error && <Note tone="error">{error}</Note>}
      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create my key"}
      </Button>
    </form>
  );
}

function UnlockedView() {
  const router = useRouter();
  const { publicKey, lock, forget } = useKeys();
  const [confirming, setConfirming] = useState(false);

  const fingerprint = publicKey
    ? toB64(
        new TextEncoder().encode(
          `${publicKey.x ?? ""}.${publicKey.y ?? ""}`,
        ),
      ).slice(0, 16)
    : "—";

  return (
    <div className="space-y-5">
      <Note>Your key is unlocked in this tab. It locks again when you close or reload.</Note>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Public key fingerprint
        </span>
        <code className="mt-1 block overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs">
          {fingerprint}
        </code>
        <p className="mt-1.5 text-xs text-muted">
          Share this with a tree owner so they can confirm an invite came from
          you.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" onClick={lock}>
          Lock now
        </Button>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Forget this identity
        </Button>
      </div>
      {confirming && (
        <Note tone="error">
          <p>
            This deletes the key from this browser. Without your recovery phrase
            it cannot be recovered and you lose access to every tree it opened.
          </p>
          <div className="mt-3 flex gap-3">
            <Button
              variant="danger"
              onClick={async () => {
                await forget();
                router.push("/");
              }}
            >
              Delete it
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </Note>
      )}
    </div>
  );
}
