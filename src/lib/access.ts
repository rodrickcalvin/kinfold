import { Access, Member, Role, Tree, Union, atLeast } from "./schema";

/**
 * Who are you, on this particular tree?
 *
 * Note what is NOT here: no database lookup of a user record, because there is
 * no user record. We take the uid from your signed session cookie and look for
 * it in the tree's own access list. That is the whole authorization system.
 */
export function roleFor(access: Access | null, uid: string | null): Role {
  if (!access) return "none";
  if (uid) {
    const member = access.members.find((m) => m.uid === uid);
    if (member) return member.role;
  }
  return access.publicRole;
}

export function memberFor(access: Access | null, uid: string | null): Member | null {
  if (!access || !uid) return null;
  return access.members.find((m) => m.uid === uid) ?? null;
}

export function canView(access: Access | null, uid: string | null): boolean {
  return atLeast(roleFor(access, uid), "viewer");
}

export function canEdit(access: Access | null, uid: string | null): boolean {
  return atLeast(roleFor(access, uid), "editor");
}

export function canAdmin(access: Access | null, uid: string | null): boolean {
  return atLeast(roleFor(access, uid), "owner");
}

/* ------------------------------------------------------------------ */
/* Relationship distance                                               */
/* ------------------------------------------------------------------ */

/**
 * Build an undirected adjacency map over the family graph.
 * Partners are 1 hop apart. Parent and child are 1 hop apart.
 * Siblings therefore land 2 hops apart (via the shared parent), which matches
 * how people actually reason about closeness.
 */
export function buildAdjacency(tree: Tree): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  for (const p of tree.people) if (!adj.has(p.id)) adj.set(p.id, new Set());

  for (const u of tree.unions) {
    const [a, b] = u.partners;
    if (a && b) link(a, b);
    for (const c of u.children) {
      for (const parent of u.partners) link(parent, c);
      // Siblings are already 2 hops apart through the parent; do not shortcut
      // them to 1, or "depth: 1" would leak an entire sibling set.
    }
  }
  return adj;
}

/** Breadth-first distance from `rootId`, capped at `maxDepth` for speed. */
export function distancesFrom(
  adj: Map<string, Set<string>>,
  rootId: string,
  maxDepth: number,
): Map<string, number> {
  const dist = new Map<string, number>();
  if (!adj.has(rootId)) return dist;
  dist.set(rootId, 0);
  let frontier = [rootId];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!dist.has(nb)) {
          dist.set(nb, d);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

export function unionsOf(tree: Tree, personId: string): Union[] {
  return tree.unions.filter(
    (u) => u.partners.includes(personId) || u.children.includes(personId),
  );
}
