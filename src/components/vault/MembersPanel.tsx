"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useKeys } from "@/components/KeyProvider";
import { IdentityGate } from "@/components/vault/IdentityGate";
import { Button, Field, Note, inputClass } from "@/components/vault/ui";
import {
  ALL_SLICES,
  type SealedTree,
  type SliceId,
  type SliceKeys,
  grantAccess,
  keysFor,
  resealSlices,
  revokeAccess,
} from "@/lib/sealed";
import type { PendingJoin } from "@/lib/schema";
import {
  fingerprintJwk,
  newInviteCode,
  rememberTree,
  vaultApi,
} from "@/lib/vault-client";

const SLICE_LABEL: Record<string, string> = {
  structure: "Shape of the tree",
  history: "Deceased relatives, in full",
  "living-name": "Names of living relatives",
  "living-detail": "Details of living relatives",
};

export function MembersPanel({ treeId }: { treeId: string }) {
  return (
    <main className="mx-auto w-full max-w-lg px-5 py-10">
      <Link href={`/vault/${treeId}`} className="text-sm text-muted hover:text-ink">
        ← Back to tree
      </Link>
      <h1 className="mt-5 font-serif text-3xl tracking-tight">Members &amp; access</h1>
      <IdentityGate>
        <Inner treeId={treeId} />
      </IdentityGate>
    </main>
  );
}

function Inner({ treeId }: { treeId: string }) {
  const { identity } = useKeys();
  const [sealed, setSealed] = useState<SealedTree | null>(null);
  const [keys, setKeysState] = useState<SliceKeys | null>(null);
  const [pending, setPending] = useState<PendingJoin[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "denied" | "error">(
    "loading",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await vaultApi.get(treeId);
        const k = await keysFor(s, identity.privateKey);
        if (cancelled) return;
        if (!ALL_SLICES.every((x) => k.has(x))) {
          setStatus("denied");
          return;
        }
        setSealed(s);
        setKeysState(k);
        let queue: PendingJoin[] = [];
        try {
          queue = await vaultApi.pending(treeId);
        } catch {
          queue = []; // not the owner as far as the sidecar is concerned
        }
        if (cancelled) return;
        setPending(queue);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Could not load.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, treeId, nonce]);

  if (status === "loading") return <p className="mt-6 text-sm text-muted">Loading…</p>;
  if (status === "denied")
    return (
      <Note tone="warn">
        Only a member holding every key can manage access. You are opening this
        tree with partial keys.
      </Note>
    );
  if (status === "error" || !sealed || !keys)
    return <Note tone="error">{err ?? "Something went wrong."}</Note>;

  const mine = identity ? fingerprintJwk(identity.publicKey) : "";

  const grant = async (p: PendingJoin) => {
    setErr(null);
    setMsg(null);
    try {
      const slices = (p.slices.length ? p.slices : ["structure"]) as SliceId[];
      const next = await grantAccess(sealed, p.publicKey, slices, keys);
      await vaultApi.put(next);
      await vaultApi.resolvePending(treeId, [JSON.stringify(p.publicKey)]);
      setMsg("Access granted.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not grant access.");
    }
  };

  const reject = async (p: PendingJoin) => {
    await vaultApi.resolvePending(treeId, [JSON.stringify(p.publicKey)]);
    await reload();
  };

  const revoke = async (memberId: string, rotate: boolean) => {
    setErr(null);
    setMsg(null);
    try {
      let next = revokeAccess(sealed, memberId);
      if (rotate) {
        const rot = await resealSlices(next, ALL_SLICES, keys);
        next = rot.sealedTree;
      }
      await vaultApi.put(next);
      rememberTree(treeId);
      setMsg(
        rotate
          ? "Removed and keys rotated. Their old key opens nothing now."
          : "Removed. They keep whatever they already downloaded — rotate keys to change that.",
      );
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not revoke.");
    }
  };

  return (
    <div className="mt-6 space-y-8 pb-16">
      {msg && <Note tone="warn">{msg}</Note>}
      {err && <Note tone="error">{err}</Note>}

      <InviteCreator treeId={treeId} onDone={setMsg} onError={setErr} />

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Waiting for approval ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Nobody is waiting.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((p) => (
              <li
                key={JSON.stringify(p.publicKey)}
                className="rounded-xl border border-line bg-surface p-3"
              >
                <p className="text-sm font-medium">{p.label || "Someone"}</p>
                <p className="mt-0.5 text-xs text-muted">
                  asked {new Date(p.requestedAt).toLocaleString()} · wants{" "}
                  {p.slices.map((s) => SLICE_LABEL[s] ?? s).join(", ") || "structure"}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button onClick={() => grant(p)}>Grant</Button>
                  <Button variant="ghost" onClick={() => reject(p)}>
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Keyring ({sealed.keyring.length})
        </h2>
        <ul className="space-y-2">
          {sealed.keyring.map((entry) => {
            const isMe = fingerprintJwk(entry.publicKey) === mine;
            const held = entry.grants.map((g) => g.slice);
            return (
              <li
                key={entry.memberId}
                className="rounded-xl border border-line bg-surface p-3"
              >
                <p className="text-sm font-medium">
                  {entry.labelRef || "Member"}{" "}
                  {isMe && <span className="text-xs text-accent">(you)</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {held.map((s) => SLICE_LABEL[s] ?? s).join(", ")}
                </p>
                {!isMe && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => revoke(entry.memberId, false)}>
                      Remove
                    </Button>
                    <Button variant="danger" onClick={() => revoke(entry.memberId, true)}>
                      Remove &amp; rotate keys
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function InviteCreator({
  treeId,
  onDone,
  onError,
}: {
  treeId: string;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [slices, setSlices] = useState<SliceId[]>([
    "structure",
    "history",
    "living-name",
  ]);
  const [label, setLabel] = useState("");
  const [ttlDays, setTtlDays] = useState(7);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (s: SliceId) =>
    setSlices((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    );

  const create = async () => {
    setBusy(true);
    onError("");
    try {
      const fresh = newInviteCode();
      await vaultApi.addInvite(treeId, {
        code: fresh,
        slices,
        label: label.trim() || undefined,
        ttlHours: ttlDays * 24,
      });
      setCode(fresh);
      onDone("Invite created. Share the link below — it works once per person.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not create the invite.");
    } finally {
      setBusy(false);
    }
  };

  const link =
    code && typeof window !== "undefined"
      ? `${window.location.origin}/join/${treeId}#${code}`
      : null;

  return (
    <section className="rounded-2xl border border-line bg-surface-2/50 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        Invite someone
      </h2>
      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          {ALL_SLICES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={slices.includes(s)}
                onChange={() => toggle(s)}
              />
              {SLICE_LABEL[s]}
            </label>
          ))}
        </div>
        <Field label="Label" hint="A private hint so you can tell invites apart.">
          <input
            className={inputClass}
            value={label}
            placeholder="e.g. Mum's cousin"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Expires after">
          <select
            className={inputClass}
            value={ttlDays}
            onChange={(e) => setTtlDays(Number(e.target.value))}
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </Field>
        <Button onClick={create} disabled={busy || slices.length === 0}>
          {busy ? "Creating…" : "Create invite"}
        </Button>
        {link && (
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs text-muted">Send this link:</p>
            <p className="mt-1 select-all break-all font-mono text-xs">{link}</p>
          </div>
        )}
      </div>
    </section>
  );
}
