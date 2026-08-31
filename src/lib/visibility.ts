import { buildAdjacency, distancesFrom, memberFor, roleFor } from "./access";
import {
  Access,
  Person,
  Tree,
  Union,
  atLeast,
  displayName,
  inferLiving,
} from "./schema";

/**
 * REDACTION.
 *
 * This is the most important file in the project, so read it slowly.
 *
 * A family tree is not your data. It is data about dozens of living people who
 * never signed up, never agreed to anything, and in many cases do not know the
 * site exists. Children. Estranged relatives. People with a different name than
 * the one on their birth certificate. Somebody's biological father.
 *
 * So the rule is: redact on the SERVER, before the data is serialised. Never
 * ship the full tree to the browser and hide rows with CSS — that is not
 * privacy, that is a magic trick, and View Source ends it.
 */

export type Visibility = "full" | "limited" | "hidden";

/** What actually reaches the browser. Note there is no `note`, no exact date. */
export interface VisiblePerson {
  id: string;
  visibility: Visibility;
  label: string;
  sublabel?: string;
  sex: "F" | "M" | "X";
  living: boolean;
  /** Only ever populated at `full`. */
  detail?: {
    given: string;
    surname: string;
    birthSurname?: string;
    birth?: { date?: string; place?: string };
    death?: { date?: string; place?: string };
    note?: string;
    photo?: string;
  };
}

export interface VisibleTree {
  id: string;
  name: string;
  description?: string;
  people: VisiblePerson[];
  unions: Union[];
  viewer: {
    role: string;
    redactedCount: number;
    scoped: boolean;
  };
}

/**
 * Decide the visibility of one person for one viewer.
 *
 * The shape of the policy:
 *   - Dead people are history. Any viewer sees them in full.
 *   - Living people are subjects with rights. Editors and owners see them;
 *     plain viewers see a name and nothing else; out-of-scope viewers see
 *     a placeholder that preserves the shape of the tree but not the person.
 *
 * A placeholder rather than deletion is a deliberate trade-off: removing the
 * node entirely would silently break the lines between grandparent and
 * grandchild, and a tree with holes in it looks broken rather than private.
 * Accept that this reveals "somebody exists here" — that is the cost of a
 * connected graph, and it is the right cost.
 */
export function visibilityOf(
  person: Person,
  role: string,
  inScope: boolean,
): Visibility {
  const living = inferLiving(person);
  if (!living) return "full";
  if (atLeast(role as never, "editor")) return "full";
  if (!atLeast(role as never, "viewer")) return "hidden";
  return inScope ? "limited" : "hidden";
}

export function redactTree(
  tree: Tree,
  access: Access | null,
  uid: string | null,
): VisibleTree | null {
  const role = roleFor(access, uid);
  if (!atLeast(role, "viewer")) return null; // Not your tree. Nothing to see.

  const member = memberFor(access, uid);
  const scope = member?.scope;

  // If the member is scoped, precompute who is close enough to them.
  let inScopeIds: Set<string> | null = null;
  if (scope && !atLeast(role, "editor")) {
    const adj = buildAdjacency(tree);
    const dist = distancesFrom(adj, scope.rootId, scope.depth);
    inScopeIds = new Set(dist.keys());
  }

  let redactedCount = 0;

  const people: VisiblePerson[] = tree.people.map((p) => {
    const inScope = inScopeIds ? inScopeIds.has(p.id) : true;
    const visibility = visibilityOf(p, role, inScope);
    const living = inferLiving(p);

    if (visibility === "hidden") {
      redactedCount++;
      return {
        id: p.id,
        visibility,
        // Not even an initial. An initial plus a surname plus a position in the
        // tree identifies a person almost as well as their full name does.
        label: "Private",
        sex: "X",
        living: true,
      };
    }

    if (visibility === "limited") {
      redactedCount++;
      return {
        id: p.id,
        visibility,
        label: displayName(p),
        sublabel: "Living",
        sex: p.sex,
        living,
      };
    }

    return {
      id: p.id,
      visibility,
      label: displayName(p),
      sublabel: lifespan(p),
      sex: p.sex,
      living,
      detail: {
        given: p.given,
        surname: p.surname,
        birthSurname: p.birthSurname,
        birth: p.birth,
        death: p.death,
        note: p.note,
        photo: p.photo,
      },
    };
  });

  return {
    id: tree.id,
    name: tree.name,
    description: tree.description,
    people,
    // Unions carry only ids, so they are safe to pass through whole. The dates
    // on them are stripped anyway when either partner is hidden.
    unions: tree.unions.map((u) => sanitizeUnion(u, people)),
    viewer: { role, redactedCount, scoped: Boolean(inScopeIds) },
  };
}

function sanitizeUnion(u: Union, people: VisiblePerson[]): Union {
  const byId = new Map(people.map((p) => [p.id, p]));
  const touchesHidden = [...u.partners, ...u.children].some(
    (id) => byId.get(id)?.visibility !== "full",
  );
  if (!touchesHidden) return u;
  // A marriage date is a fact about living people too.
  return { ...u, start: undefined, end: undefined };
}

function lifespan(p: Person): string | undefined {
  const b = p.birth?.date?.match(/\d{4}/)?.[0];
  const d = p.death?.date?.match(/\d{4}/)?.[0];
  if (!b && !d) return undefined;
  return `${b ?? "?"} – ${d ?? (inferLiving(p) ? "" : "?")}`.trim();
}
