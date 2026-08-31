# Kinfold

A family tree you can share with your relatives without asking them to trust
whoever runs the server.

The tree is encrypted in the browser before it is uploaded. The operator holds
ciphertext, public keys, and wrapped keys — no names, no dates, not even the
name of the tree. Sign-in goes through Google or GitHub, and what comes back is
hashed on arrival: there is no users table anywhere in this project.

```bash
npm install
npm run demo     # see exactly what the server stores, and what three members see
npm run dev      # http://localhost:3000 — sign in as a dev persona, no config needed
npm test         # 63 tests, most of them asserting that data does NOT leak
```

## Why bother

Existing open-source genealogy software is good and mature —
[Gramps Web](https://www.grampsweb.org/) and [webtrees](https://webtrees.net/)
both do far more than this does. They also both assume a server administrator
and a desktop browser, and they both store the family in plaintext.

Kinfold makes three different bets:

1. **Mobile first, zero install.** A cousin opens a link on their phone.
2. **The operator is not trusted.** Not "promises not to look" — *cannot* look.
3. **Living people are the default concern**, not an afterthought toggled on.

## How the privacy actually works

Read [THREAT-MODEL.md](./THREAT-MODEL.md) — it is the honest version, including
the four things encryption does *not* hide.

The short form: a tree is cut into four **slices**, each with its own key.

| Slice | Contains |
| --- | --- |
| `structure` | Ids and family links. The shape, no names. |
| `history` | Full records of people who have died. |
| `living-name` | Names of living people, nothing else. |
| `living-detail` | Birthdays, places, notes, photos of the living. |

Members hold an ECDH keypair. The owner wraps slice keys to each member's public
key in their own browser. A viewer without the `living-detail` key does not see
birthdays because the bytes are meaningless to them — not because a function we
wrote chose to omit them.

That is the point of the whole design: **authorization is arithmetic, not code
we could get wrong.**

## Layout

```
src/lib/crypto.ts        WebCrypto primitives. No dependencies.
src/lib/sealed.ts        Slices: sealing, granting, revoking, re-keying, opening, editing.
src/lib/schema.ts        Person / Union / Tree, plus the encrypted wire format.
src/lib/layout.ts        Generation assignment and the pedigree drawing.
src/lib/store.ts         Disk storage. Plaintext trees and encrypted blobs, one interface.
src/lib/identity-store.ts A member's private key in IndexedDB, wrapped twice.
src/auth.ts              OIDC in, pseudonymous hash out. No adapter, ever.
src/app/api/vault/       Store and hand back ciphertext; never able to read it.
src/components/KeyProvider.tsx   The one place an unlocked key lives (in memory).
src/components/vault/    Setup, unlock, create, view, edit, invite, approve.
tests/                   Where the privacy claims are enforced.
```

`src/lib/visibility.ts` and `src/lib/access.ts` are the older server-side
redaction path. They still work and are still tested, but they require the
server to read plaintext — they are kept for self-hosted deployments where the
family *is* the operator, and should not be used for a hosted instance. The
home page lists these under "Self-hosted trees"; the encrypted flow is
everything under **Encrypted trees**.

## Status

Working end to end in the browser: create a key (with a recovery phrase),
unlock it by passphrase or recovery phrase, create an encrypted tree, edit
people and families, and view any tree you hold keys for. Invites work —
the owner registers a code, a relative submits their public key, the owner
approves it from their own browser. Removing a member can re-key the affected
slices in one step so the copy they kept stops opening new records.

Rough edges: the unlock ladder is passphrase / recovery phrase only — no
passkey or PIN tier yet (`design/unlock-options.html` is the sketch).
Marriage/partnership *dates* are not carried by the encrypted format. The
editor is functional rather than polished, and there is no photo upload.
The old server-rendered `/trees/[treeId]` route remains for self-hosting.

## Deploying

Pushes to Vercel's free tier as-is. Set `AUTH_SECRET` and `KINFOLD_PEPPER` to
random 32+ character strings (`openssl rand -base64 32`), and add
`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` to turn real sign-in on. See
[.env.example](./.env.example).

## Licence

**AGPL-3.0-or-later** ([LICENSE](./LICENSE)). Chosen deliberately: section 13
requires anyone running a *modified* hosted copy to offer its users the source
of that modified version. For a project whose whole value is "you can verify
we cannot read your data", that is the protection that makes the claim
checkable rather than a promise — a permissive licence would let a hosted fork
add a backdoor with no obligation to say so.

Copyright © 2026 the Kinfold contributors; started by Rodrick Calvin. See
[NOTICE](./NOTICE) for the reasoning and for a (non-binding) request about how
the family data an instance holds should and should not be used.
