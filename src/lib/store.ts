import { promises as fs } from "node:fs";
import path from "node:path";
import { Access, SealedTreeSchema, Tree, VaultMeta } from "./schema";
import type { SealedTree } from "./sealed";

/**
 * Storage lives behind this interface on purpose.
 *
 * Today it is JSON files on disk, which costs nothing and is easy to read,
 * diff and back up with git. When you outgrow that, write a second class that
 * implements the same six methods against Turso / Neon / Supabase and swap the
 * export at the bottom. Nothing else in the app should ever know the difference.
 */
export interface TreeStore {
  listTreeIds(): Promise<string[]>;
  getTree(id: string): Promise<Tree | null>;
  putTree(tree: Tree): Promise<void>;
  getAccess(treeId: string): Promise<Access | null>;
  putAccess(access: Access): Promise<void>;

  /* End-to-end encrypted trees. The server stores and returns these blobs
   * without ever being able to read them. `VaultMeta` is the plaintext-safe
   * sidecar (owner uid, invite hashes, pending public keys). */
  listSealedIds(): Promise<string[]>;
  getSealed(id: string): Promise<SealedTree | null>;
  putSealed(tree: SealedTree): Promise<void>;
  getVaultMeta(id: string): Promise<VaultMeta | null>;
  putVaultMeta(meta: VaultMeta): Promise<void>;
}

const DATA_DIR = process.env.KINFOLD_DATA_DIR ?? path.join(process.cwd(), "data");

export class FileTreeStore implements TreeStore {
  constructor(private root: string = DATA_DIR) {}

  private treePath(id: string) {
    return path.join(this.root, "trees", `${safeId(id)}.json`);
  }
  private accessPath(id: string) {
    return path.join(this.root, "access", `${safeId(id)}.json`);
  }
  private sealedPath(id: string) {
    return path.join(this.root, "sealed", `${safeId(id)}.json`);
  }
  private vaultMetaPath(id: string) {
    return path.join(this.root, "vault-meta", `${safeId(id)}.json`);
  }

  async listTreeIds(): Promise<string[]> {
    try {
      const files = await fs.readdir(path.join(this.root, "trees"));
      return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  async getTree(id: string): Promise<Tree | null> {
    const raw = await readJson(this.treePath(id));
    if (!raw) return null;
    const parsed = Tree.safeParse(raw);
    if (!parsed.success) {
      console.error(`Tree "${id}" failed validation:`, parsed.error.issues);
      return null;
    }
    return parsed.data;
  }

  async putTree(tree: Tree): Promise<void> {
    const validated = Tree.parse({ ...tree, updatedAt: new Date().toISOString() });
    await writeJson(this.treePath(tree.id), validated);
  }

  async getAccess(treeId: string): Promise<Access | null> {
    const raw = await readJson(this.accessPath(treeId));
    if (!raw) return null;
    const parsed = Access.safeParse(raw);
    if (!parsed.success) {
      // Fail closed. A malformed access file must never mean "let everyone in".
      console.error(`Access for "${treeId}" failed validation:`, parsed.error.issues);
      return null;
    }
    return parsed.data;
  }

  async putAccess(access: Access): Promise<void> {
    await writeJson(this.accessPath(access.treeId), Access.parse(access));
  }

  /* ---- encrypted trees ---- */

  async listSealedIds(): Promise<string[]> {
    try {
      const files = await fs.readdir(path.join(this.root, "sealed"));
      return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  async getSealed(id: string): Promise<SealedTree | null> {
    const raw = await readJson(this.sealedPath(id));
    if (!raw) return null;
    const parsed = SealedTreeSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`Sealed tree "${id}" failed validation:`, parsed.error.issues);
      return null;
    }
    // The schema is structurally identical to the SealedTree interface; the
    // cast is the one seam between "validated shape" and "typed value".
    return parsed.data as unknown as SealedTree;
  }

  async putSealed(tree: SealedTree): Promise<void> {
    const validated = SealedTreeSchema.parse({
      ...tree,
      updatedAt: new Date().toISOString(),
    });
    await writeJson(this.sealedPath(tree.id), validated);
  }

  async getVaultMeta(id: string): Promise<VaultMeta | null> {
    const raw = await readJson(this.vaultMetaPath(id));
    if (!raw) return null;
    const parsed = VaultMeta.safeParse(raw);
    if (!parsed.success) {
      // Fail closed: a broken sidecar must not read as "no owner, open season".
      console.error(`Vault meta for "${id}" failed validation:`, parsed.error.issues);
      return null;
    }
    return parsed.data;
  }

  async putVaultMeta(meta: VaultMeta): Promise<void> {
    await writeJson(this.vaultMetaPath(meta.treeId), VaultMeta.parse(meta));
  }
}

/** Block path traversal: an id is only ever a flat slug. */
function safeId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id)) {
    throw new Error(`Unsafe id: ${JSON.stringify(id)}`);
  }
  return id;
}

async function readJson(p: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  // Write to a temp file then rename, so a crash mid-write cannot corrupt data.
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

export const store: TreeStore = new FileTreeStore();
