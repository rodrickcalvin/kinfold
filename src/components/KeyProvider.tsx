"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type Identity,
  generateIdentity,
  newRecoveryPhrase,
  protectIdentity,
  unlockIdentity,
} from "@/lib/crypto";
import {
  type IdentityRecord,
  deleteIdentityRecord,
  getIdentityRecord,
  putIdentityRecord,
} from "@/lib/identity-store";

/**
 * The one place an unlocked private key is held, and it is held in memory only:
 * never localStorage, never a cookie, gone on refresh. Components read the key
 * from here to unwrap slice keys; they never touch IndexedDB directly.
 */

type Status = "loading" | "signed-out" | "no-identity" | "locked" | "unlocked";

interface KeyState {
  uid: string | null;
  status: Status;
  identity: Identity | null;
  /** Public JWK, available whenever an identity exists (even while locked). */
  publicKey: JsonWebKey | null;
  refresh: () => Promise<void>;
  /** Returns the recovery phrase to show the user exactly once. */
  createIdentity: (passphrase: string) => Promise<string>;
  unlock: (secret: string, via: "passphrase" | "recovery") => Promise<boolean>;
  lock: () => void;
  forget: () => Promise<void>;
}

const Ctx = createContext<KeyState | null>(null);

export function KeyProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [record, setRecord] = useState<IdentityRecord | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [nonce, setNonce] = useState(0);

  /** Re-read who is signed in and whether this browser has a stored key. */
  const refresh = useCallback(async () => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let who: string | null = null;
      try {
        who = (await fetch("/api/me").then((r) => r.json())).uid ?? null;
      } catch {
        who = null;
      }
      if (cancelled) return;
      if (!who) {
        setUid(null);
        setRecord(null);
        setIdentity(null);
        setStatus("signed-out");
        return;
      }
      let rec: IdentityRecord | null = null;
      try {
        rec = await getIdentityRecord(who);
      } catch {
        rec = null;
      }
      if (cancelled) return;
      setUid(who);
      setRecord(rec);
      setIdentity((cur) => (rec ? cur : null));
      setStatus((cur) =>
        !rec ? "no-identity" : cur === "unlocked" ? "unlocked" : "locked",
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const createIdentity = useCallback(
    async (passphrase: string) => {
      if (!uid) throw new Error("Sign in before creating an identity");
      const id = await generateIdentity();
      const phrase = newRecoveryPhrase();
      const rec: IdentityRecord = {
        uid,
        publicKey: id.publicKey,
        byPass: await protectIdentity(id, passphrase),
        byPhrase: await protectIdentity(id, phrase),
        createdAt: new Date().toISOString(),
      };
      await putIdentityRecord(rec);
      setRecord(rec);
      setIdentity(id);
      setStatus("unlocked");
      return phrase;
    },
    [uid],
  );

  const unlock = useCallback(
    async (secret: string, via: "passphrase" | "recovery") => {
      if (!record) return false;
      const prot = via === "passphrase" ? record.byPass : record.byPhrase;
      const id = await unlockIdentity(prot, secret.trim());
      if (!id) return false;
      setIdentity(id);
      setStatus("unlocked");
      return true;
    },
    [record],
  );

  const lock = useCallback(() => {
    setIdentity(null);
    setStatus((s) => (s === "unlocked" ? "locked" : s));
  }, []);

  const forget = useCallback(async () => {
    if (uid) await deleteIdentityRecord(uid);
    setRecord(null);
    setIdentity(null);
    setStatus("no-identity");
  }, [uid]);

  const value = useMemo<KeyState>(
    () => ({
      uid,
      status,
      identity,
      publicKey: record?.publicKey ?? identity?.publicKey ?? null,
      refresh,
      createIdentity,
      unlock,
      lock,
      forget,
    }),
    [uid, status, identity, record, refresh, createIdentity, unlock, lock, forget],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeys(): KeyState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useKeys must be used inside <KeyProvider>");
  return ctx;
}
