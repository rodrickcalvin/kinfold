"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useKeys } from "@/components/KeyProvider";
import { IdentityGate } from "@/components/vault/IdentityGate";
import { Button, Field, Note, inputClass } from "@/components/vault/ui";
import { Person, Tree, Union, displayName } from "@/lib/schema";
import {
  ALL_SLICES,
  type SealedTree,
  type SliceKeys,
  decryptToTree,
  keysFor,
  reseal,
} from "@/lib/sealed";
import { newDomainId, rememberTree, vaultApi } from "@/lib/vault-client";

export function TreeEditor({ treeId }: { treeId: string }) {
  return (
    <main className="mx-auto w-full max-w-lg px-5 py-10">
      <Link href={`/vault/${treeId}`} className="text-sm text-muted hover:text-ink">
        ← Back to tree
      </Link>
      <IdentityGate>
        <Inner treeId={treeId} />
      </IdentityGate>
    </main>
  );
}

type Loaded = {
  sealed: SealedTree;
  keys: SliceKeys;
  tree: Tree;
};

function Inner({ treeId }: { treeId: string }) {
  const { identity } = useKeys();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "denied" | "error" | "saving" | "saved"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      try {
        const sealed = await vaultApi.get(treeId);
        const keys = await keysFor(sealed, identity.privateKey);
        if (!ALL_SLICES.every((s) => keys.has(s))) {
          if (!cancelled) setStatus("denied");
          return;
        }
        const t = await decryptToTree(sealed, keys);
        if (!t) {
          if (!cancelled) setStatus("denied");
          return;
        }
        if (cancelled) return;
        setLoaded({ sealed, keys, tree: t });
        setTree(structuredClone(t));
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the tree.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, treeId]);

  const dirty = useMemo(
    () => !!loaded && JSON.stringify(loaded.tree) !== JSON.stringify(tree),
    [loaded, tree],
  );

  const save = useCallback(async () => {
    if (!loaded || !tree) return;
    setStatus("saving");
    setError(null);
    try {
      const parsed = Tree.parse(tree);
      const next = await reseal(parsed, loaded.keys, loaded.sealed);
      await vaultApi.put(next);
      rememberTree(treeId);
      setLoaded({ ...loaded, sealed: next, tree: parsed });
      setTree(structuredClone(parsed));
      setStatus("saved");
      setTimeout(() => setStatus("ready"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
      setStatus("ready");
    }
  }, [loaded, tree, treeId]);

  if (status === "loading") {
    return <p className="mt-6 text-sm text-muted">Decrypting…</p>;
  }
  if (status === "denied") {
    return (
      <Note tone="warn">
        Editing needs every slice key for this tree. You are opening it as a
        viewer.
      </Note>
    );
  }
  if (status === "error" || !tree) {
    return <Note tone="error">{error ?? "Something went wrong."}</Note>;
  }

  const patchPerson = (id: string, patch: Partial<Person>) =>
    setTree((t) =>
      t
        ? { ...t, people: t.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
        : t,
    );
  const removePerson = (id: string) =>
    setTree((t) =>
      t
        ? {
            ...t,
            people: t.people.filter((p) => p.id !== id),
            unions: t.unions.map((u) => ({
              ...u,
              partners: u.partners.filter((x) => x !== id),
              children: u.children.filter((x) => x !== id),
            })),
          }
        : t,
    );
  const addPerson = () =>
    setTree((t) =>
      t
        ? {
            ...t,
            people: [
              ...t.people,
              Person.parse({ id: newDomainId("p"), given: "", surname: "", living: true }),
            ],
          }
        : t,
    );

  const patchUnion = (id: string, patch: Partial<Union>) =>
    setTree((t) =>
      t
        ? { ...t, unions: t.unions.map((u) => (u.id === id ? { ...u, ...patch } : u)) }
        : t,
    );
  const removeUnion = (id: string) =>
    setTree((t) => (t ? { ...t, unions: t.unions.filter((u) => u.id !== id) } : t));
  const addUnion = () =>
    setTree((t) =>
      t
        ? {
            ...t,
            unions: [
              ...t.unions,
              Union.parse({ id: newDomainId("u"), partners: [], children: [] }),
            ],
          }
        : t,
    );

  return (
    <div className="mt-6 space-y-8 pb-28">
      <section className="space-y-4">
        <Field label="Tree name">
          <input
            className={inputClass}
            value={tree.name}
            onChange={(e) => setTree({ ...tree, name: e.target.value })}
          />
        </Field>
        <Field label="Description" hint="Optional.">
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={tree.description ?? ""}
            onChange={(e) =>
              setTree({ ...tree, description: e.target.value || undefined })
            }
          />
        </Field>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            People ({tree.people.length})
          </h2>
          <Button variant="ghost" onClick={addPerson}>
            + Person
          </Button>
        </div>
        <div className="space-y-2">
          {tree.people.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              onPatch={(patch) => patchPerson(p.id, patch)}
              onRemove={() => removePerson(p.id)}
            />
          ))}
          {tree.people.length === 0 && (
            <p className="text-sm text-muted">No people yet.</p>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Families ({tree.unions.length})
          </h2>
          <Button variant="ghost" onClick={addUnion} disabled={tree.people.length < 1}>
            + Family
          </Button>
        </div>
        <div className="space-y-2">
          {tree.unions.map((u) => (
            <UnionRow
              key={u.id}
              union={u}
              people={tree.people}
              onPatch={(patch) => patchUnion(u.id, patch)}
              onRemove={() => removeUnion(u.id)}
            />
          ))}
          {tree.unions.length === 0 && (
            <p className="text-sm text-muted">
              No families linked yet. A family is one or two adults plus their
              children.
            </p>
          )}
        </div>
      </section>

      {error && <Note tone="error">{error}</Note>}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-5 py-3">
          <span className="text-xs text-muted">
            {status === "saving"
              ? "Encrypting and uploading…"
              : status === "saved"
                ? "Saved. Re-encrypted for every member."
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
          </span>
          <Button onClick={save} disabled={!dirty || status === "saving"}>
            {status === "saving" ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonRow({
  person,
  onPatch,
  onRemove,
}: {
  person: Person;
  onPatch: (patch: Partial<Person>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(!person.given && !person.surname);
  return (
    <div className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-sm font-medium">
          {displayName(person)}
          {person.living === false && (
            <span className="ml-2 text-xs font-normal text-muted">deceased</span>
          )}
        </span>
        <span className="text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputClass}
              placeholder="Given name"
              value={person.given}
              onChange={(e) => onPatch({ given: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Surname"
              value={person.surname}
              onChange={(e) => onPatch({ surname: e.target.value })}
            />
          </div>
          <input
            className={inputClass}
            placeholder="Surname at birth (if different)"
            value={person.birthSurname ?? ""}
            onChange={(e) =>
              onPatch({ birthSurname: e.target.value || undefined })
            }
          />
          <div className="flex items-center gap-3 text-sm">
            <select
              className={inputClass}
              value={person.sex}
              onChange={(e) =>
                onPatch({ sex: e.target.value as Person["sex"] })
              }
            >
              <option value="X">Unspecified</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
            </select>
            <label className="flex shrink-0 items-center gap-1.5">
              <input
                type="checkbox"
                checked={person.living !== false}
                onChange={(e) => onPatch({ living: e.target.checked })}
              />
              Living
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputClass}
              placeholder="Born (e.g. 1953 or 1953-06-01)"
              value={person.birth?.date ?? ""}
              onChange={(e) =>
                onPatch({
                  birth: { ...person.birth, date: e.target.value || undefined },
                })
              }
            />
            <input
              className={inputClass}
              placeholder="Birth place"
              value={person.birth?.place ?? ""}
              onChange={(e) =>
                onPatch({
                  birth: { ...person.birth, place: e.target.value || undefined },
                })
              }
            />
          </div>
          {person.living === false && (
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                placeholder="Died"
                value={person.death?.date ?? ""}
                onChange={(e) =>
                  onPatch({
                    death: {
                      ...person.death,
                      date: e.target.value || undefined,
                    },
                  })
                }
              />
              <input
                className={inputClass}
                placeholder="Death place"
                value={person.death?.place ?? ""}
                onChange={(e) =>
                  onPatch({
                    death: {
                      ...person.death,
                      place: e.target.value || undefined,
                    },
                  })
                }
              />
            </div>
          )}
          <textarea
            className={`${inputClass} min-h-14 resize-y`}
            placeholder="Note"
            value={person.note ?? ""}
            onChange={(e) => onPatch({ note: e.target.value || undefined })}
          />
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-private hover:underline"
          >
            Remove this person
          </button>
        </div>
      )}
    </div>
  );
}

function UnionRow({
  union,
  people,
  onPatch,
  onRemove,
}: {
  union: Union;
  people: Person[];
  onPatch: (patch: Partial<Union>) => void;
  onRemove: () => void;
}) {
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface px-3 py-3">
      <select
        className={inputClass}
        value={union.kind}
        onChange={(e) => onPatch({ kind: e.target.value as Union["kind"] })}
      >
        <option value="unknown">Relationship: unspecified</option>
        <option value="marriage">Marriage</option>
        <option value="partnership">Partnership</option>
      </select>

      <fieldset>
        <legend className="text-xs font-medium text-muted">
          Parents / partners (pick up to 2)
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {people.map((p) => {
            const on = union.partners.includes(p.id);
            const full = union.partners.length >= 2 && !on;
            return (
              <button
                key={p.id}
                type="button"
                disabled={full}
                onClick={() => onPatch({ partners: toggle(union.partners, p.id) })}
                className={chip(on, full)}
              >
                {displayName(p)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-medium text-muted">Children</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {people
            .filter((p) => !union.partners.includes(p.id))
            .map((p) => {
              const on = union.children.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onPatch({ children: toggle(union.children, p.id) })
                  }
                  className={chip(on, false)}
                >
                  {displayName(p)}
                </button>
              );
            })}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={onRemove}
        className="text-xs text-private hover:underline"
      >
        Remove this family
      </button>
    </div>
  );
}

function chip(on: boolean, disabled: boolean): string {
  return [
    "rounded-full border px-2.5 py-1 text-xs transition-colors",
    on
      ? "border-accent bg-accent-soft text-accent"
      : "border-line bg-surface text-muted hover:border-accent/40",
    disabled ? "cursor-not-allowed opacity-40" : "",
  ].join(" ");
}
