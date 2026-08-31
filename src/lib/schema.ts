import { z } from "zod";

/**
 * The domain model.
 *
 * Two deliberate choices worth understanding before you change anything:
 *
 * 1. Relationships live in `unions`, not on people. A person does not carry a
 *    `parents` field. Instead a union ("these adults, these children") is its
 *    own record. This is how GEDCOM has modelled families since 1984, and it
 *    handles remarriage, step-children, adoption and single parents without
 *    special cases.
 *
 * 2. A tree carries NO information about the accounts allowed to see it.
 *    That lives in a separate Access document. Keeping them apart is what lets
 *    you hand someone a tree file without also handing them a membership list.
 */

export const LifeEvent = z.object({
  date: z.string().optional(), // ISO-ish. "1815", "1815-12", "1815-12-10", "abt 1815"
  place: z.string().optional(),
});
export type LifeEvent = z.infer<typeof LifeEvent>;

export const Person = z.object({
  id: z.string().min(1),
  given: z.string().default(""),
  surname: z.string().default(""),
  /** Name at birth, if different. Genealogy cares about this a lot. */
  birthSurname: z.string().optional(),
  sex: z.enum(["F", "M", "X"]).default("X"),
  birth: LifeEvent.optional(),
  death: LifeEvent.optional(),
  /**
   * Explicit is better than inferred. If absent we guess from the death record
   * and birth year (see inferLiving), but a real deployment should set this.
   */
  living: z.boolean().optional(),
  note: z.string().optional(),
  photo: z.string().optional(),
});
export type Person = z.infer<typeof Person>;

export const Union = z.object({
  id: z.string().min(1),
  /** 1 or 2 partner ids. One is valid: a single parent is still a family. */
  partners: z.array(z.string()).max(2).default([]),
  children: z.array(z.string()).default([]),
  kind: z.enum(["marriage", "partnership", "unknown"]).default("unknown"),
  start: LifeEvent.optional(),
  end: LifeEvent.optional(),
});
export type Union = z.infer<typeof Union>;

export const Tree = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  people: z.array(Person).default([]),
  unions: z.array(Union).default([]),
  updatedAt: z.string().optional(),
});
export type Tree = z.infer<typeof Tree>;

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/** Ordered least to most powerful. Comparisons rely on this order. */
export const ROLES = ["none", "viewer", "editor", "owner"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export function atLeast(role: Role, floor: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(floor);
}

export const Member = z.object({
  /**
   * A pseudonymous account id: HMAC(pepper, "<issuer>|<subject>").
   * Not an email. Not reversible. Useless to anyone who steals this file.
   */
  uid: z.string().min(8),
  role: Role,
  /**
   * A human-readable hint so an owner can tell rows apart in the UI.
   * Keep it non-identifying ("Mum's cousin", not "jane@gmail.com").
   */
  label: z.string().optional(),
  /**
   * Optional narrowing. If set, this member only sees living people within
   * `depth` relationship hops of `rootId`. Deceased people stay visible
   * tree-wide, because that is the part that is actually history.
   */
  scope: z
    .object({ rootId: z.string(), depth: z.number().int().min(0).default(2) })
    .optional(),
});
export type Member = z.infer<typeof Member>;

export const Access = z.object({
  treeId: z.string().min(1),
  members: z.array(Member).default([]),
  /** What a signed-out visitor gets. Default: nothing at all. */
  publicRole: z.enum(["none", "viewer"]).default("none"),
  /**
   * Invite codes are stored as HMAC hashes, never in the clear, so this file
   * leaking does not hand anyone a working invite.
   */
  inviteHashes: z
    .array(
      z.object({
        hash: z.string(),
        role: Role,
        expiresAt: z.string(),
        label: z.string().optional(),
      }),
    )
    .default([]),
});
export type Access = z.infer<typeof Access>;

/* ------------------------------------------------------------------ */
/* Encrypted wire format                                               */
/*                                                                    */
/* These validate what the API accepts for an end-to-end encrypted     */
/* tree. The server never learns what any of it means — the schema     */
/* only checks shape and base64-ness, so a malformed upload cannot     */
/* wedge another member's browser. The authoritative TypeScript types  */
/* live in `src/lib/sealed.ts`; `sealed-schema.test.ts` keeps the two  */
/* from drifting.                                                      */
/* ------------------------------------------------------------------ */

const B64 = z.string().regex(/^[A-Za-z0-9_-]*$/, "expected url-safe base64");
const Jwk = z.record(z.string(), z.unknown());

export const SealedBox = z.object({ iv: B64, ct: B64 });

export const WrappedKeySchema = z.object({
  epk: Jwk,
  salt: B64,
  iv: B64,
  ct: B64,
});

export const SealedTreeSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  records: z.array(z.object({ id: z.string().min(1), sealed: SealedBox })),
  keyring: z.array(
    z.object({
      memberId: z.string().min(1),
      publicKey: Jwk,
      grants: z.array(
        z.object({ slice: z.string().min(1), wrapped: WrappedKeySchema }),
      ),
      labelRef: z.string().optional(),
    }),
  ),
  updatedAt: z.string(),
});
export type SealedTreeInput = z.infer<typeof SealedTreeSchema>;

/**
 * The server's plaintext-safe sidecar for an encrypted tree. No names, no
 * record contents — only public keys, HMAC'd invite hashes, and which uid is
 * allowed to *overwrite* the blob (orthogonal to who can decrypt it).
 */
export const PendingJoin = z.object({
  publicKey: Jwk,
  label: z.string().max(80).optional(),
  slices: z.array(z.string().min(1)).default([]),
  requestedAt: z.string(),
});
export type PendingJoin = z.infer<typeof PendingJoin>;

export const VaultMeta = z.object({
  treeId: z.string().min(1),
  ownerUid: z.string().min(8),
  editorUids: z.array(z.string().min(8)).default([]),
  invites: z
    .array(
      z.object({
        hash: z.string().min(1),
        slices: z.array(z.string().min(1)).default([]),
        label: z.string().max(80).optional(),
        expiresAt: z.string(),
      }),
    )
    .default([]),
  pending: z.array(PendingJoin).default([]),
});
export type VaultMeta = z.infer<typeof VaultMeta>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const PRESUMED_DEAD_AFTER_YEARS = 100;

export function inferLiving(p: Person): boolean {
  if (typeof p.living === "boolean") return p.living;
  if (p.death) return false;
  const year = Number(p.birth?.date?.match(/\d{4}/)?.[0]);
  if (Number.isFinite(year)) {
    return new Date().getFullYear() - year < PRESUMED_DEAD_AFTER_YEARS;
  }
  // No birth, no death, no flag. Assume living: fail closed, not open.
  return true;
}

export function displayName(p: Pick<Person, "given" | "surname">): string {
  return [p.given, p.surname].filter(Boolean).join(" ") || "Unknown";
}
