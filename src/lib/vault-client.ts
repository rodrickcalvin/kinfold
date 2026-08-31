"use client";

import type { SealedTree, SliceId } from "@/lib/sealed";
import type { PendingJoin } from "@/lib/schema";

/**
 * Thin browser-side wrappers over the /api/vault endpoints. Every one of these
 * sends or receives ciphertext and public keys only; the decryption happens in
 * the components that call them.
 */

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error((await res.text().catch(() => "")) || `${res.status} ${url}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** url-safe base64 of random bytes, filtered to a slug the store will accept. */
export function newTreeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newDomainId(prefix: "p" | "u"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A shareable invite code. The server stores only its HMAC, never this string. */
export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Stable fingerprint of a public JWK, for de-duping and "is this me" checks. */
export function fingerprintJwk(jwk: JsonWebKey): string {
  return JSON.stringify(jwk, Object.keys(jwk).sort());
}

export const vaultApi = {
  get: (id: string) =>
    req<{ sealedTree: SealedTree }>(`/api/vault/${id}`).then((r) => r.sealedTree),

  put: (sealedTree: SealedTree) =>
    req<{ ok: true }>(`/api/vault/${sealedTree.id}`, {
      method: "PUT",
      body: JSON.stringify({ sealedTree }),
    }),

  addInvite: (
    id: string,
    body: {
      code?: string;
      hash?: string;
      slices: SliceId[];
      label?: string;
      ttlHours?: number;
    },
  ) =>
    req<{ ok: true; expiresAt: string }>(`/api/vault/${id}/invites`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  join: (
    id: string,
    body: { code: string; publicKey: JsonWebKey; label?: string },
  ) =>
    req<{ ok: true; pending: boolean }>(`/api/vault/${id}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  pending: (id: string) =>
    req<{ pending: PendingJoin[] }>(`/api/vault/${id}/pending`).then(
      (r) => r.pending,
    ),

  resolvePending: (id: string, fingerprints: string[]) =>
    req<{ ok: true; remaining: number }>(`/api/vault/${id}/pending/resolve`, {
      method: "POST",
      body: JSON.stringify({ fingerprints }),
    }),
};

/* A browser-local note of which encrypted trees this device holds keys for.
 * Not authoritative and not sensitive — just so the home page has something to
 * list. The real test of access is whether the keys unwrap.
 *
 * Exposed as a `useSyncExternalStore` source so components can read it without
 * a mount effect and without a hydration mismatch (server snapshot is empty). */
const SEEN_KEY = "kinfold:vault:trees";
const EMPTY: readonly string[] = Object.freeze([]);
const listeners = new Set<() => void>();
let cache: { raw: string; list: string[] } = { raw: "[]", list: [] };

function notify() {
  for (const l of listeners) l();
}

export function rememberTree(id: string): void {
  try {
    const set = new Set(seenTrees());
    set.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
    notify();
  } catch {
    /* private mode, storage disabled — the list is a convenience, skip it */
  }
}

export function forgetTree(id: string): void {
  try {
    localStorage.setItem(
      SEEN_KEY,
      JSON.stringify(seenTrees().filter((t) => t !== id)),
    );
    notify();
  } catch {
    /* ignore */
  }
}

/** Cached so `useSyncExternalStore` sees a stable reference between changes. */
export function seenTrees(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY) ?? "[]";
    if (raw !== cache.raw) {
      const parsed = JSON.parse(raw);
      cache = {
        raw,
        list: Array.isArray(parsed)
          ? parsed.filter((x) => typeof x === "string")
          : [],
      };
    }
    return cache.list;
  } catch {
    return cache.list;
  }
}

export const seenTreesStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SEEN_KEY) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot: (): string[] => seenTrees(),
  getServerSnapshot: (): string[] => EMPTY as string[],
};
