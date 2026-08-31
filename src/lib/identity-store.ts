import type { ProtectedIdentity } from "./crypto";

/**
 * Where a member's private key lives between visits: in IndexedDB, in this one
 * browser, wrapped twice over.
 *
 *   byPass   — encrypted under the passphrase or PIN typed on every unlock.
 *   byPhrase — encrypted under the 128-bit recovery phrase shown once at setup.
 *
 * The server never receives either blob. Clearing site data, or opening the app
 * in another browser, means starting from the recovery phrase — there is no
 * account to "log in" to that would bring the key back.
 */
export interface IdentityRecord {
  uid: string;
  publicKey: JsonWebKey;
  byPass: ProtectedIdentity;
  byPhrase: ProtectedIdentity;
  createdAt: string;
}

const DB_NAME = "kinfold";
const STORE = "identities";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "uid" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return idb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function getIdentityRecord(uid: string): Promise<IdentityRecord | null> {
  return tx<IdentityRecord | undefined>("readonly", (s) => s.get(uid)).then(
    (r) => r ?? null,
  );
}

export async function hasIdentity(uid: string): Promise<boolean> {
  return (await getIdentityRecord(uid)) !== null;
}

export function putIdentityRecord(rec: IdentityRecord): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(rec));
}

export function deleteIdentityRecord(uid: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(uid));
}
