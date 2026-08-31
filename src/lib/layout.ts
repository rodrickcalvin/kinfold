import type { Union } from "./schema";
import type { VisiblePerson, VisibleTree } from "./visibility";

/**
 * Turning a family graph into a picture.
 *
 * Genealogy layout is a genuinely hard graph-drawing problem (cousins marry,
 * people remarry, lines cross). This is an honest, readable approximation:
 * assign generations, group families together, then relax positions so parents
 * sit over their children. It draws a normal family beautifully and a very
 * tangled one merely acceptably. Swapping in ELK or d3-dag later is a
 * self-contained change, because everything downstream only reads `nodes`
 * and `edges`.
 */

export const CARD_W = 148;
export const CARD_H = 76;
export const GAP_X = 26;
export const GAP_Y = 78;
const PADDING = 40;

export interface LaidOutPerson {
  person: VisiblePerson;
  x: number;
  y: number;
  gen: number;
}

export interface LayoutEdge {
  id: string;
  d: string;
}

export interface Layout {
  nodes: LaidOutPerson[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  generations: number;
}

export function layoutTree(tree: VisibleTree): Layout {
  const people = tree.people;
  const byId = new Map(people.map((p) => [p.id, p]));
  const unions = tree.unions.filter((u) =>
    [...u.partners, ...u.children].some((id) => byId.has(id)),
  );

  const gen = assignGenerations(people, unions);
  const order = orderPeople(people, unions, gen);

  // Seed x from the traversal order, then relax.
  const x = new Map<string, number>();
  const byGen = groupByGeneration(people, gen);
  for (const [, ids] of byGen) {
    ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    ids.forEach((id, i) => x.set(id, i * (CARD_W + GAP_X)));
  }

  relax(byGen, unions, x, gen);
  normalize(x);

  const nodes: LaidOutPerson[] = people.map((p) => ({
    person: p,
    x: (x.get(p.id) ?? 0) + PADDING,
    y: (gen.get(p.id) ?? 0) * (CARD_H + GAP_Y) + PADDING,
    gen: gen.get(p.id) ?? 0,
  }));

  const pos = new Map(nodes.map((n) => [n.person.id, n]));
  const edges = buildEdges(unions, pos);

  const width = Math.max(...nodes.map((n) => n.x + CARD_W), 0) + PADDING;
  const height = Math.max(...nodes.map((n) => n.y + CARD_H), 0) + PADDING;

  return { nodes, edges, width, height, generations: byGen.size };
}

/* ------------------------------------------------------------------ */

/**
 * Every child sits exactly one row below its lowest parent, and partners share
 * a row. Solved by relaxation rather than a topological sort because real trees
 * contain cycles (cousin marriages), which would make a strict sort throw.
 */
function assignGenerations(
  people: VisiblePerson[],
  unions: Union[],
): Map<string, number> {
  const gen = new Map<string, number>(people.map((p) => [p.id, 0]));
  const MAX_PASSES = people.length + 8;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    for (const u of unions) {
      const partnerGens = u.partners
        .map((id) => gen.get(id))
        .filter((g): g is number => g !== undefined);
      if (partnerGens.length) {
        const top = Math.max(...partnerGens);
        for (const id of u.partners) {
          if (gen.has(id) && gen.get(id)! !== top) {
            gen.set(id, top);
            changed = true;
          }
        }
        for (const c of u.children) {
          if (gen.has(c) && gen.get(c)! < top + 1) {
            gen.set(c, top + 1);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  return gen;
}

/**
 * Depth-first walk from the oldest generation downward, so that a family's
 * children end up adjacent to each other rather than scattered across the row.
 */
function orderPeople(
  people: VisiblePerson[],
  unions: Union[],
  gen: Map<string, number>,
): Map<string, number> {
  const childUnions = new Map<string, Union[]>();
  for (const u of unions) {
    for (const p of u.partners) {
      if (!childUnions.has(p)) childUnions.set(p, []);
      childUnions.get(p)!.push(u);
    }
  }

  const order = new Map<string, number>();
  let counter = 0;
  const seen = new Set<string>();

  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.set(id, counter++);
    for (const u of childUnions.get(id) ?? []) {
      for (const partner of u.partners) {
        if (partner !== id && !seen.has(partner)) {
          seen.add(partner);
          order.set(partner, counter++);
        }
      }
      for (const c of u.children) visit(c);
    }
  };

  const minGen = Math.min(...gen.values(), 0);
  for (const p of people) if ((gen.get(p.id) ?? 0) === minGen) visit(p.id);
  for (const p of people) visit(p.id); // anything disconnected

  return order;
}

function groupByGeneration(
  people: VisiblePerson[],
  gen: Map<string, number>,
): Map<number, string[]> {
  const byGen = new Map<number, string[]>();
  for (const p of people) {
    const g = gen.get(p.id) ?? 0;
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g)!.push(p.id);
  }
  return new Map([...byGen.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * Alternate sweeps: pull parents toward the centre of their children, then
 * children toward the centre of their parents, de-overlapping after each move.
 * Four rounds is enough to look deliberate and cheap enough to run on a phone.
 */
function relax(
  byGen: Map<number, string[]>,
  unions: Union[],
  x: Map<string, number>,
  gen: Map<string, number>,
) {
  const gens = [...byGen.keys()].sort((a, b) => a - b);

  const mean = (ids: string[]) => {
    const vals = ids.map((id) => x.get(id)).filter((v): v is number => v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  for (let round = 0; round < 4; round++) {
    // Parents follow children.
    for (const g of [...gens].reverse()) {
      const desired = new Map<string, number>();
      for (const u of unions) {
        const partners = u.partners.filter((p) => gen.get(p) === g);
        if (!partners.length || !u.children.length) continue;
        const c = mean(u.children);
        if (c === null) continue;
        const spread = (partners.length - 1) * (CARD_W + GAP_X);
        partners.forEach((p, i) => desired.set(p, c - spread / 2 + i * (CARD_W + GAP_X)));
      }
      applyDesired(byGen.get(g)!, x, desired);
    }

    // Children follow parents.
    for (const g of gens) {
      const desired = new Map<string, number>();
      for (const u of unions) {
        const kids = u.children.filter((c) => gen.get(c) === g);
        if (!kids.length) continue;
        const p = mean(u.partners);
        if (p === null) continue;
        const spread = (kids.length - 1) * (CARD_W + GAP_X);
        kids.forEach((c, i) => desired.set(c, p - spread / 2 + i * (CARD_W + GAP_X)));
      }
      applyDesired(byGen.get(g)!, x, desired);
    }
  }
}

/** Move nodes toward their targets, then push right to remove any overlap. */
function applyDesired(
  ids: string[],
  x: Map<string, number>,
  desired: Map<string, number>,
) {
  for (const id of ids) {
    const d = desired.get(id);
    if (d !== undefined) x.set(id, (x.get(id)! + d) / 2);
  }
  const sorted = [...ids].sort((a, b) => x.get(a)! - x.get(b)!);
  const step = CARD_W + GAP_X;
  for (let i = 1; i < sorted.length; i++) {
    const prev = x.get(sorted[i - 1])!;
    if (x.get(sorted[i])! < prev + step) x.set(sorted[i], prev + step);
  }
}

function normalize(x: Map<string, number>) {
  const min = Math.min(...x.values());
  if (!Number.isFinite(min)) return;
  for (const [k, v] of x) x.set(k, v - min);
}

/* ------------------------------------------------------------------ */

/**
 * The classic pedigree connector: a bar between the couple, one drop line to a
 * horizontal bus, and a riser up to each child. Elbows, not curves — a family
 * tree should read like a diagram, not a subway map.
 */
function buildEdges(
  unions: Union[],
  pos: Map<string, LaidOutPerson>,
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];

  for (const u of unions) {
    const partners = u.partners.map((id) => pos.get(id)).filter(Boolean) as LaidOutPerson[];
    const children = u.children.map((id) => pos.get(id)).filter(Boolean) as LaidOutPerson[];
    if (!partners.length) continue;

    let dropX: number;
    let dropY: number;

    if (partners.length === 2) {
      const [a, b] = [...partners].sort((p, q) => p.x - q.x);
      const barY = a.y + CARD_H / 2;
      edges.push({
        id: `${u.id}-bar`,
        d: `M ${a.x + CARD_W} ${barY} L ${b.x} ${barY}`,
      });
      dropX = (a.x + CARD_W + b.x) / 2;
      dropY = barY;
    } else {
      dropX = partners[0].x + CARD_W / 2;
      dropY = partners[0].y + CARD_H;
    }

    if (!children.length) continue;

    const busY = partners[0].y + CARD_H + GAP_Y / 2;
    const xs = children.map((c) => c.x + CARD_W / 2);
    const left = Math.min(...xs, dropX);
    const right = Math.max(...xs, dropX);

    edges.push({ id: `${u.id}-drop`, d: `M ${dropX} ${dropY} L ${dropX} ${busY}` });
    edges.push({ id: `${u.id}-bus`, d: `M ${left} ${busY} L ${right} ${busY}` });
    for (const c of children) {
      edges.push({
        id: `${u.id}-${c.person.id}`,
        d: `M ${c.x + CARD_W / 2} ${busY} L ${c.x + CARD_W / 2} ${c.y}`,
      });
    }
  }
  return edges;
}
