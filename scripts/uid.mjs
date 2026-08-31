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
import { createHmac } from "node:crypto";

const DEV_PEPPER = "dev-only-insecure-pepper-do-not-ship-me!!";
const pepper = process.env.KINFOLD_PEPPER ?? DEV_PEPPER;

const [issuer, subject] = process.argv.slice(2);
if (!issuer || !subject) {
  console.error("usage: node scripts/uid.mjs <issuer> <subject>");
  process.exit(1);
}

if (pepper === DEV_PEPPER) {
  console.error("! using the development pepper — these uids are not for production\n");
}

const uid = createHmac("sha256", pepper)
  .update(`v1|${issuer}|${subject}`)
  .digest("base64url")
  .slice(0, 32);

console.log(uid);
