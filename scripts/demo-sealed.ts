/**
 * Prints exactly what the operator stores, and what three different members
 * see from the same bytes. Run: npm run demo
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Tree } from "../src/lib/schema";
import {
  ALL_SLICES,
  grantAccess,
  keysFor,
  openTree,
  sealTree,
  type SliceId,
} from "../src/lib/sealed";
import { generateIdentity } from "../src/lib/crypto";

const plain = Tree.parse(
  JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../data/trees/adeyemi.json"), "utf8"),
  ),
);

const { sealedTree, keys } = await sealTree(plain);

const owner = await generateIdentity();
const cousin = await generateIdentity();
const distant = await generateIdentity();

let doc = sealedTree;
const grant = async (pk: JsonWebKey, slices: SliceId[]) => {
  doc = await grantAccess(doc, pk, slices, keys);
};
await grant(owner.publicKey, ALL_SLICES);
await grant(cousin.publicKey, ["structure", "history", "living-name"]);
await grant(distant.publicKey, ["structure", "history"]);

const rule = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m\n${"─".repeat(58)}`);

rule("WHAT THE SERVER STORES");
console.log(`tree id     ${doc.id}`);
console.log(`records     ${doc.records.length}`);
console.log(`keyring     ${doc.keyring.length} members\n`);
console.log("first three records, verbatim:\n");
for (const r of doc.records.slice(0, 3)) {
  console.log(`  ${r.id}  ${r.sealed.ct.slice(0, 46)}…`);
}
console.log(
  `\nplaintext "Adeyemi" present in document: ${JSON.stringify(doc).includes("Adeyemi")}`,
);

for (const [who, id] of [
  ["OWNER (all four keys)", owner],
  ["COUSIN (structure + history + living-name)", cousin],
  ["DISTANT RELATIVE (structure + history)", distant],
] as const) {
  const view = await openTree(doc, await keysFor(doc, id.privateKey));
  rule(`WHAT ${who} SEES`);
  if (!view) {
    console.log("  nothing at all");
    continue;
  }
  console.log(`  ${view.name} — ${view.viewer.role}\n`);
  for (const p of view.people) {
    const bar =
      p.visibility === "full" ? "\x1b[32m█\x1b[0m"
      : p.visibility === "limited" ? "\x1b[33m▓\x1b[0m"
      : "\x1b[90m░\x1b[0m";
    const extra = p.detail?.birth?.date ? `  b. ${p.detail.birth.date}` : "";
    console.log(`  ${bar} ${p.label.padEnd(20)}${(p.sublabel ?? "").padEnd(14)}${extra}`);
  }
}

rule("SOMEONE WHO STOLE THE DATABASE");
const thief = await generateIdentity();
console.log(`  ${(await openTree(doc, await keysFor(doc, thief.privateKey))) ?? "nothing at all"}`);
console.log();
