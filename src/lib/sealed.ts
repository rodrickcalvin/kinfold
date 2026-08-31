import {
  Sealed,
  WrappedKey,
  generateSliceKey,
  newRecordId,
  seal,
  unseal,
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

/**
 * Encrypt every person and union of a tree under the supplied slice keys.
 * Shared by first-time sealing and by re-sealing after an edit, so the two can
 * never drift in what they put in which slice.
 */
async function buildRecords(
  tree: Tree,
  keys: SliceKeys,
): Promise<Array<{ id: string; sealed: Sealed }>> {
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
  return records;
}

export async function sealTree(
  tree: Tree,
): Promise<{ sealedTree: SealedTree; keys: SliceKeys }> {
  const keys: SliceKeys = new Map();
  for (const s of ALL_SLICES) keys.set(s, await generateSliceKey());

  return {
    sealedTree: {
      id: tree.id,
      version: 1,
      records: await buildRecords(tree, keys),
      keyring: [],
      updatedAt: new Date().toISOString(),
    },
    keys,
  };
}

/**
 * Re-seal an edited tree without minting new slice keys or disturbing the
 * keyring. Every member keeps the access they had; only the ciphertext is
 * rewritten. Use this to save an edit; use `resealSlices` when the point is to
 * lock someone out.
 */
export async function reseal(
  tree: Tree,
  keys: SliceKeys,
  previous: SealedTree,
): Promise<SealedTree> {
  if (ALL_SLICES.some((s) => !keys.has(s))) {
    throw new Error("reseal needs every slice key — only the owner can edit");
  }
  return {
    id: tree.id,
    version: 1,
    records: await buildRecords(tree, keys),
    keyring: previous.keyring,
    updatedAt: new Date().toISOString(),
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

/**
 * Rotate the keys for one or more slices: mint fresh slice keys, re-encrypt
 * every record that belonged to those slices, and re-wrap the new keys to
 * everyone still in the keyring. This is what makes revocation real — call
 * `revokeAccess` to drop the departing member, then `resealSlices` so the key
 * they kept a copy of no longer opens anything new.
 *
 * Records deliberately do not carry their slice id, so a record's slice is
 * discovered the only way it can be: by trying the old key against it.
 *
 * Returns the rewritten document and the complete new SliceKeys map, so the
 * owner's browser keeps working without re-deriving anything.
 */
export async function resealSlices(
  sealedTree: SealedTree,
  slices: SliceId[],
  oldKeys: SliceKeys,
): Promise<{ sealedTree: SealedTree; keys: SliceKeys }> {
  const rotating = new Set(slices);

  // A replacement key for each rotating slice; every other key is carried over.
  const newKeys: SliceKeys = new Map(oldKeys);
  for (const slice of rotating) {
    if (!oldKeys.has(slice)) {
      throw new Error(`resealSlices: no current key held for slice "${slice}"`);
    }
    newKeys.set(slice, await generateSliceKey());
  }

  // Re-encrypt every record whose old key is being retired. A record that none
  // of the rotating keys opens is passed through untouched.
  const records: Array<{ id: string; sealed: Sealed }> = [];
  for (const rec of sealedTree.records) {
    let rotated = false;
    for (const slice of rotating) {
      const payload = await unseal<Payload>(oldKeys.get(slice)!, rec.sealed);
      if (payload === null) continue;
      records.push({
        id: newRecordId(), // fresh id, so the operator cannot diff versions
        sealed: await seal(newKeys.get(slice)!, payload),
      });
      rotated = true;
      break;
    }
    if (!rotated) records.push({ id: rec.id, sealed: rec.sealed });
  }
  shuffle(records);

  // Re-wrap: a grant for a rotating slice now carries the new key. Grants for
  // untouched slices are left exactly as they were.
  const keyring: KeyringEntry[] = [];
  for (const entry of sealedTree.keyring) {
    const grants: KeyringEntry["grants"] = [];
    for (const grant of entry.grants) {
      grants.push(
        rotating.has(grant.slice)
          ? {
              slice: grant.slice,
              wrapped: await wrapSliceKey(
                newKeys.get(grant.slice)!,
                entry.publicKey,
              ),
            }
          : grant,
      );
    }
    keyring.push({ ...entry, grants });
  }

  return {
    sealedTree: {
      ...sealedTree,
      records,
      keyring,
      updatedAt: new Date().toISOString(),
    },
    keys: newKeys,
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

/**
 * Reconstruct the full plaintext `Tree` from ciphertext. Only useful to a
 * holder of every slice key — i.e. the owner, opening the editor. Anyone else
 * gets null, because a partial tree is not a thing you can safely re-seal.
 *
 * Note: marriage/partnership dates are not carried by the sealed format (see
 * `buildRecords`), so a round-trip through here and back drops `union.start`
 * and `union.end`.
 */
export async function decryptToTree(
  sealedTree: SealedTree,
  keys: SliceKeys,
): Promise<Tree | null> {
  if (ALL_SLICES.some((s) => !keys.has(s))) return null;
  const held = [...keys.values()];

  let meta: { name: string; description?: string } | null = null;
  let roster: string[] = [];
  const unions: Union[] = [];
  const people = new Map<string, Person>();

  for (const rec of sealedTree.records) {
    const payload = await unsealAny<Payload>(held, rec.sealed);
    if (!payload) continue;
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
        people.set(payload.person.id, payload.person);
        break;
      case "person-name":
        people.set(payload.id, {
          ...(people.get(payload.id) ?? { id: payload.id }),
          id: payload.id,
          given: payload.given,
          surname: payload.surname,
          sex: payload.sex,
          living: true,
        } as Person);
        break;
      case "person-detail": {
        const d = payload.detail;
        people.set(payload.id, {
          ...(people.get(payload.id) ?? { id: payload.id, sex: "X" }),
          id: payload.id,
          given: d.given,
          surname: d.surname,
          birthSurname: d.birthSurname,
          birth: d.birth,
          death: d.death,
          note: d.note,
          photo: d.photo,
          living: true,
        } as Person);
        break;
      }
    }
  }

  if (!meta) return null;

  const order = roster.length ? roster : [...people.keys()];
  return {
    id: sealedTree.id,
    name: meta.name,
    description: meta.description,
    people: order.map((id) => people.get(id)).filter((p): p is Person => !!p),
    unions,
    updatedAt: sealedTree.updatedAt,
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
