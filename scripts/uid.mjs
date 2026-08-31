#!/usr/bin/env node
/**
 * Print the pseudonymous uid for an identity, so an owner can add a member to
 * an access file without ever writing that person's email down.
 *
 *   node scripts/uid.mjs dev owner
 *   KINFOLD_PEPPER="$(cat .pepper)" node scripts/uid.mjs google 109876543210987654321
 *
 * The second argument is the provider's stable subject id, NOT an email
 * address. For Google that is the numeric `sub` claim; for GitHub it is the
 * numeric account id.
 */
import { DEV_PEPPER, deriveUidWith } from "../src/lib/uid-core.mjs";

const pepper = process.env.KINFOLD_PEPPER ?? DEV_PEPPER;

const [issuer, subject] = process.argv.slice(2);
if (!issuer || !subject) {
  console.error("usage: node scripts/uid.mjs <issuer> <subject>");
  process.exit(1);
}

if (pepper === DEV_PEPPER) {
  console.error("! using the development pepper — these uids are not for production\n");
}

console.log(deriveUidWith(pepper, issuer, subject));
