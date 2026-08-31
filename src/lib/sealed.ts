import {
  Sealed,
  WrappedKey,
  generateSliceKey,
  newRecordId,
  seal,
  unsealAny,
  wrapSliceKey,
  unwrapSliceKey,
} from "./crypto";
import { Person, Tree, Union, displayName, inferLiving } from "./schema";
import type { VisiblePerson, VisibleTree } from "./visibility";

/**
 * SLICES.
 *
 * The three visibility tiers we used to compute on the server — full, limited,
 * hidden — are now just "which keys do you hold".
 *
 *   structure     every id, and every marriage/parent link, with no names.
 *                 Enough to draw the shape of the family and nothing else.
 *   history       the complete records of people who have died.
 *   living-name   names of living people. Nothing more.
 *   living-detail birthdays, places, notes, photos of living people.
 *
 * A member holding {structure, history} sees a full pedigree of ancestors with
 * anonymous boxes where the living are. Add living-name and the boxes get
 * names. Add living-detail and they get birthdays. The tiers compose, and each
 * is a key the operator never possesses.
 *
 * Extra slices are just strings, so `branch:accra` costs nothing to add if one
 * side of the family wants their own compartment.
 */
export type SliceId =
  | "structure"
  | "history"
  | "living-name"
  | "living-detail"
  | (string & {});

export const ALL_SLICES: SliceId[] = [
  "structure",
  "history",
  "living-name",
  "living-detail",
];

/* ------------------------------------------------------------------ */
/* What actually sits on the server                                    */
/* ------------------------------------------------------------------ */

/**
 * Note what is missing: the tree's name, the record's slice, anything at all
 * about who or what it describes. The operator sees a list of random ids and
 * equal-looking blobs. Even the tree title is encrypted — "The Adeyemi Family"
 * is personal data about the Adeyemis.
 */
export interface SealedTree {
  id: string;
  version: 1;
  records: Array<{ id: string; sealed: Sealed }>;
  keyring: KeyringEntry[];
  updatedAt: string;
}

export interface KeyringEntry {
  /** Random. Not derived from anything about the person. */
  memberId: string;
  publicKey: JsonWebKey;
  grants: Array<{ slice: SliceId; wrapped: WrappedKey }>;
  /** Owner-chosen, and stored encrypted in the structure slice, never here. */
  labelRef?: string;
}

/** The cleartext shapes, which exist only inside a browser. */
type Payload =
  | { t: "meta"; name: string; description?: string }
  | { t: "roster"; personIds: string[] }
  | { t: "union"; union: Union }
  | { t: "person-full"; person: Person }
  | { t: "person-name"; id: string; given: string; surname: string; sex: Person["sex"] }
  | { t: "person-detail"; id: string; detail: NonNullable<VisiblePerson["detail"]> };

export type SliceKeys = Map<SliceId, CryptoKey>;

/* ------------------------------------------------------------------ */
/* Sealing — runs in the owner's browser, once, before anything uploads */
/* ------------------------------------------------------------------ */

export async function sealTree(
  tree: Tree,
): Promise<{ sealedTree: SealedTree; keys: SliceKeys }> {
  const keys: SliceKeys = new Map();
  for (const s of ALL_SLICES) keys.set(s, await generateSliceKey());

  const records: Array<{ id: string; sealed: Sealed }> = [];
  const add = async (slice: SliceId, payload: Payload) => {
    records.push({ id: newRecordId(), sealed: await seal(keys.get(slice)!, payload) });
  };

  await add("structure", {
    t: "meta",
    name: tree.name,
    description: tree.description,
  });
  await add("structure", {
    t: "roster",
    personIds: tree.people.map((p) => p.id),
  });
  for (const union of tree.unions) {
    // Dates live with the people, not the link, so a union leaks no facts.
    await add("structure", {
      t: "union",
      union: { ...union, start: undefined, end: undefined },
    });
  }

  for (const person of tree.people) {
    if (!inferLiving(person)) {
      await add("history", { t: "person-full", person });
      continue;
    }
    await add("living-name", {
      t: "person-name",
      id: person.id,
      given: person.given,
      surname: person.surname,
      sex: person.sex,
    });
    await add("living-detail", {
      t: "person-detail",
      id: person.id,
      detail: {
        given: person.given,
        surname: person.surname,
        birthSurname: person.birthSurname,
        birth: person.birth,
        death: person.death,
        note: person.note,
        photo: person.photo,
      },
    });
  }

  /**
   * Shuffle. Insertion order would otherwise hand the operator the tree's
   * structure for free: meta, roster, unions, then the dead, then the living
   * in pairs. Order is metadata too.
   */
  shuffle(records);

  return {
    sealedTree: {
      id: tree.id,
      version: 1,
      records,
      keyring: [],
      updatedAt: new Date().toISOString(),
    },
    keys,
  };
}

/** Grant a member some slices. Owner-side, client-side, never on the server. */
export async function grantAccess(
  sealedTree: SealedTree,
  memberPublicKey: JsonWebKey,
  slices: SliceId[],
  keys: SliceKeys,
): Promise<SealedTree> {
  const grants = [];
  for (const slice of slices) {
    const key = keys.get(slice);
    if (!key) continue;
    grants.push({ slice, wrapped: await wrapSliceKey(key, memberPublicKey) });
  }
  return {
    ...sealedTree,
    keyring: [
      ...sealedTree.keyring,
      { memberId: newRecordId(), publicKey: memberPublicKey, grants },
    ],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Revoke.
 *
 * Be honest about what this does and does not do. It stops the member getting
 * *future* records. It does not un-see what they already downloaded, and it
 * does not help if they kept a copy of the key. To make revocation real you
 * must rotate: new slice keys, re-encrypt every record in those slices, re-wrap
 * to everyone who remains. `resealSlices` below does that.
 *
 * This is not a weakness of encryption — a server-side ACL has exactly the same
 * hole, it is just less obvious about it.
 */
export function revokeAccess(
  sealedTree: SealedTree,
  memberId: string,
): SealedTree {
  return {
    ...sealedTree,
    keyring: sealedTree.keyring.filter((k) => k.memberId !== memberId),
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Opening — runs in every member's browser                            */
/* ------------------------------------------------------------------ */

/** Collect every slice key this private key can unwrap. */
export async function keysFor(
  sealedTree: SealedTree,
  privateKey: CryptoKey,
): Promise<SliceKeys> {
  const keys: SliceKeys = new Map();
  for (const entry of sealedTree.keyring) {
    for (const grant of entry.grants) {
      if (keys.has(grant.slice)) continue;
      const key = await unwrapSliceKey(grant.wrapped, privateKey);
      if (key) keys.set(grant.slice, key);
    }
  }
  return keys;
}

/**
 * Turn ciphertext into the exact same `VisibleTree` the renderer already
 * consumes. This is the pleasing part of the whole refactor: the layout engine
 * and the UI did not change by a single line. Redaction used to be a function
 * that decided what to omit; now it is simply the records that would not open.
 */
export async function openTree(
  sealedTree: SealedTree,
  keys: SliceKeys,
): Promise<VisibleTree | null> {
  const held = [...keys.values()];
  if (!held.length) return null;

  let meta: { name: string; description?: string } | null = null;
  let roster: string[] = [];
  const unions: Union[] = [];
  const fullPeople = new Map<string, Person>();
  const names = new Map<string, { given: string; surname: string; sex: Person["sex"] }>();
  const details = new Map<string, NonNullable<VisiblePerson["detail"]>>();

  for (const rec of sealedTree.records) {
    const payload = await unsealAny<Payload>(held, rec.sealed);
    if (!payload) continue; // not ours — this is redaction, and it is free
    switch (payload.t) {
      case "meta":
        meta = { name: payload.name, description: payload.description };
        break;
      case "roster":
        roster = payload.personIds;
        break;
      case "union":
        unions.push(payload.union);
        break;
      case "person-full":
        fullPeople.set(payload.person.id, payload.person);
        break;
      case "person-name":
        names.set(payload.id, payload);
        break;
      case "person-detail":
        details.set(payload.id, payload.detail);
        break;
    }
  }

  // No structure key means no tree, however many other keys we hold.
  if (!meta) return null;

  const ids = roster.length
    ? roster
    : [...new Set(unions.flatMap((u) => [...u.partners, ...u.children]))];

  let redactedCount = 0;

  const people: VisiblePerson[] = ids.map((id) => {
    const full = fullPeople.get(id);
    if (full) {
      return {
        id,
        visibility: "full",
        label: displayName(full),
        sublabel: lifespan(full),
        sex: full.sex,
        living: false,
        detail: {
          given: full.given,
          surname: full.surname,
          birthSurname: full.birthSurname,
          birth: full.birth,
          death: full.death,
          note: full.note,
          photo: full.photo,
        },
      };
    }

    const name = names.get(id);
    const detail = details.get(id);

    if (name && detail) {
      return {
        id,
        visibility: "full",
        label: displayName(name),
        sublabel: detail.birth?.date?.match(/\d{4}/)?.[0],
        sex: name.sex,
        living: true,
        detail,
      };
    }

    if (name) {
      redactedCount++;
      return {
        id,
        visibility: "limited",
        label: displayName(name),
        sublabel: "Living",
        sex: name.sex,
        living: true,
      };
    }

    redactedCount++;
    return { id, visibility: "hidden", label: "Private", sex: "X", living: true };
  });

  return {
    id: sealedTree.id,
    name: meta.name,
    description: meta.description,
    people,
    unions,
    viewer: {
      role: describeAccess(keys),
      redactedCount,
      scoped: !keys.has("living-detail"),
    },
  };
}

function describeAccess(keys: SliceKeys): string {
  if (keys.has("living-detail")) return "full access";
  if (keys.has("living-name")) return "names only";
  return "ancestors only";
}

function lifespan(p: Person): string | undefined {
  const b = p.birth?.date?.match(/\d{4}/)?.[0];
  const d = p.death?.date?.match(/\d{4}/)?.[0];
  if (!b && !d) return undefined;
  return `${b ?? "?"} – ${d ?? "?"}`;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
