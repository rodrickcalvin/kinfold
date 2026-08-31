"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useKeys } from "@/components/KeyProvider";
import { IdentityGate } from "@/components/vault/IdentityGate";
import { Button, Field, Note, inputClass } from "@/components/vault/ui";
import { ALL_SLICES, grantAccess, sealTree } from "@/lib/sealed";
import { Tree } from "@/lib/schema";
import { newTreeId, rememberTree, vaultApi } from "@/lib/vault-client";

export function NewTreeForm() {
  return (
    <IdentityGate>
      <Inner />
    </IdentityGate>
  );
}

function Inner() {
  const router = useRouter();
  const { identity } = useKeys();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!identity) return;
        setError(null);
        setBusy(true);
        try {
          const tree = Tree.parse({
            id: newTreeId(),
            name: name.trim(),
            description: description.trim() || undefined,
            people: [],
            unions: [],
          });
          const { sealedTree, keys } = await sealTree(tree);
          // The owner grants themselves every slice, in their own browser.
          const withOwner = await grantAccess(
            sealedTree,
            identity.publicKey,
            ALL_SLICES,
            keys,
          );
          await vaultApi.put(withOwner);
          rememberTree(tree.id);
          router.push(`/vault/${tree.id}/edit`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not create the tree.");
          setBusy(false);
        }
      }}
    >
      <Note>
        The tree is encrypted here before it uploads. The server stores the
        ciphertext and your wrapped keys, and never the name you type below.
      </Note>
      <Field label="Tree name" hint="Only people you invite will ever see this.">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </Field>
      <Field label="Description" hint="Optional.">
        <textarea
          className={`${inputClass} min-h-20 resize-y`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {error && <Note tone="error">{error}</Note>}
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create tree"}
      </Button>
    </form>
  );
}
