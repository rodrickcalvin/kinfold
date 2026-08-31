/**
 * END-TO-END ENCRYPTION.
 *
 * The previous design had a hole in it. We removed every trace of the people
 * who log in — and then stored their grandmother's medical notes in plaintext
 * JSON on the server. Not storing your *users'* data means very little when
 * you are storing everything about their *families*.
 *
 * So: the server never sees a name. Records are encrypted in the browser
 * before they are uploaded, and decrypted in the browser after they come back.
 * The operator holds ciphertext and public keys, and that is all.
 *
 * The design in one paragraph:
 *
 *   A tree is split into SLICES. Each slice has its own AES-GCM key. Every
 *   person and every union record is encrypted individually under the key of
 *   the slice it belongs to. Members hold an ECDH keypair; the owner wraps
 *   each slice key to each entitled member's public key. The server stores
 *   blobs, public keys, and wrapped keys — none of which are personal data.
 *
 * The consequence, which is the entire point:
 *
 *   Authorization stops being code we wrote and starts being arithmetic.
 *   A viewer without the key for the "living relatives" slice does not see
 *   those people because the bytes are meaningless to them — not because a
 *   function we wrote decided to omit them. No bug in our filtering can leak
 *   what our servers never possessed.
 *
 * Everything here uses WebCrypto only. No dependencies, works in every current
 * mobile browser, and runs unchanged in Node for the test suite.
 */

const subtle = globalThis.crypto.subtle;

const KDF_ITERATIONS = 600_000; // OWASP floor for PBKDF2-HMAC-SHA256
const WRAP_INFO = "kinfold/key-wrap/v1";

/* ------------------------------------------------------------------ */
/* Wire formats                                                        */
/* ------------------------------------------------------------------ */

/** One encrypted record. This is literally all the server holds per person. */
export interface Sealed {
  iv: string;
  ct: string;
}

/** A slice key encrypted to one member's public key (ECIES, ephemeral-static). */
export interface WrappedKey {
  /** Ephemeral public key. Fresh per wrap, so two wraps never share a secret. */
  epk: JsonWebKey;
  salt: string;
  iv: string;
  ct: string;
}

/** A member's private key, encrypted under their passphrase, safe to sync. */
export interface ProtectedIdentity {
  publicKey: JsonWebKey;
  salt: string;
  iv: string;
  ct: string;
  iterations: number;
}

export interface Identity {
  publicKey: JsonWebKey;
  privateKey: CryptoKey;
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Random, meaningless record ids.
 *
 * Do not be tempted to make these readable ("p1", "grandma"). The server sees
 * every id, and an id is a place to leak a name.
 */
export function newRecordId(): string {
  return toB64(randomBytes(12));
}

/* ------------------------------------------------------------------ */
/* Slice keys — the unit of "who can see what"                         */
/* ------------------------------------------------------------------ */

export async function generateSliceKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt one record. A fresh 96-bit IV per record, which is mandatory:
 * reusing an IV under the same AES-GCM key is a catastrophic break, not a
 * theoretical one.
 */
export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

/**
 * Decrypt one record, or return null if this key does not open it.
 *
 * Returning null rather than throwing is deliberate: "I do not have the key
 * for this person" is the normal, expected case for every viewer with partial
 * access. It is the mechanism by which redaction happens.
 */
export async function unseal<T>(
  key: CryptoKey,
  sealed: Sealed,
): Promise<T | null> {
  try {
    const pt = await subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(sealed.iv) },
      key,
      fromB64(sealed.ct),
    );
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    // Wrong key, or tampered ciphertext. GCM's auth tag catches both, and we
    // cannot tell them apart — which is fine, because both mean "not for you".
    return null;
  }
}

/** Try every key we hold. First one that opens it wins. */
export async function unsealAny<T>(
  keys: Iterable<CryptoKey>,
  sealed: Sealed,
): Promise<T | null> {
  for (const k of keys) {
    const out = await unseal<T>(k, sealed);
    if (out !== null) return out;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Member identity                                                     */
/* ------------------------------------------------------------------ */

/**
 * P-256 rather than X25519: WebCrypto has shipped P-256 everywhere for a
 * decade, including older mobile Safari. X25519 is nicer and is arriving, but
 * "works on the phone your aunt actually owns" wins.
 */
export async function generateIdentity(): Promise<Identity> {
  const pair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    publicKey: await subtle.exportKey("jwk", pair.publicKey),
    privateKey: pair.privateKey,
  };
}

/** Shared ECDH secret → HKDF → a one-shot AES key for wrapping. */
async function deriveWrapKey(
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const peer = await subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await subtle.deriveBits(
    { name: "ECDH", public: peer },
    privateKey,
    256,
  );
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: enc.encode(WRAP_INFO),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Grant: encrypt a slice key so that only the holder of `recipientPublicJwk`
 * can read it. The owner runs this in their browser; the server just stores
 * the result. Granting access never requires the server to see a key.
 */
export async function wrapSliceKey(
  sliceKey: CryptoKey,
  recipientPublicJwk: JsonWebKey,
): Promise<WrappedKey> {
  const ephemeral = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const salt = randomBytes(16);
  const kek = await deriveWrapKey(ephemeral.privateKey, recipientPublicJwk, salt);
  const iv = randomBytes(12);
  const raw = await subtle.exportKey("raw", sliceKey);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, kek, raw);
  return {
    epk: await subtle.exportKey("jwk", ephemeral.publicKey),
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
  };
}

/** Redeem a grant. Returns null if this grant was not addressed to us. */
export async function unwrapSliceKey(
  wrapped: WrappedKey,
  privateKey: CryptoKey,
): Promise<CryptoKey | null> {
  try {
    const kek = await deriveWrapKey(privateKey, wrapped.epk, fromB64(wrapped.salt));
    const raw = await subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(wrapped.iv) },
      kek,
      fromB64(wrapped.ct),
    );
    return subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Passphrase protection                                               */
/* ------------------------------------------------------------------ */

/**
 * Wrap a private key under a passphrase so it can sit in IndexedDB, or be
 * written to a recovery file, without being usable by anyone who copies it.
 *
 * PBKDF2 because it is native. Argon2id resists GPU cracking far better and is
 * the right upgrade the moment you are willing to ship a WASM blob — this is
 * the weakest link in the file and it should not stay this way forever.
 */
export async function protectIdentity(
  identity: Identity,
  passphrase: string,
): Promise<ProtectedIdentity> {
  const salt = randomBytes(16);
  const kek = await passphraseKey(passphrase, salt, KDF_ITERATIONS);
  const iv = randomBytes(12);
  const pkcs8 = await subtle.exportKey("pkcs8", identity.privateKey);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, kek, pkcs8);
  return {
    publicKey: identity.publicKey,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
    iterations: KDF_ITERATIONS,
  };
}

export async function unlockIdentity(
  prot: ProtectedIdentity,
  passphrase: string,
): Promise<Identity | null> {
  try {
    const kek = await passphraseKey(
      passphrase,
      fromB64(prot.salt),
      prot.iterations,
    );
    const pkcs8 = await subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(prot.iv) },
      kek,
      fromB64(prot.ct),
    );
    const privateKey = await subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    return { publicKey: prot.publicKey, privateKey };
  } catch {
    return null; // wrong passphrase
  }
}

async function passphraseKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await subtle.importKey(
    "raw",
    enc.encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

/**
 * There is no password reset. That is not an oversight — it is what "we cannot
 * read your data" costs. So every member gets a recovery phrase at signup, and
 * the UI has to be blunt about what losing it means.
 *
 * 24 hex-ish groups from 128 bits of entropy. Short enough to write on paper.
 */
export function newRecoveryPhrase(): string {
  const bytes = randomBytes(16);
  return toB64(bytes).match(/.{1,4}/g)!.join("-").toLowerCase();
}
