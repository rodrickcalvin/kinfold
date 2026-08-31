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
npm test         # 39 tests, most of them asserting that data does NOT leak
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
src/lib/crypto.ts      WebCrypto primitives. No dependencies.
src/lib/sealed.ts      Slices, sealing, granting, revoking, opening.
src/lib/schema.ts      Person / Union / Tree. Relationships live in unions.
src/lib/layout.ts      Generation assignment and the pedigree drawing.
src/auth.ts            OIDC in, pseudonymous hash out. No adapter, ever.
src/components/        The tree canvas: pan, pinch, tap.
tests/                 Where the privacy claims are enforced.
```

`src/lib/visibility.ts` and `src/lib/access.ts` are the older server-side
redaction path. They still work and are still tested, but they require the
server to read plaintext — they are kept for self-hosted deployments where the
family *is* the operator, and should not be used for a hosted instance.

## Status

Early. Working: the data model, the encryption, the layout engine, the tree
view, dev sign-in. Not yet built: editing a tree in the browser, the invite
flow, and the unlock layers (passkey → PIN → recovery phrase). The tree route
still renders server-side and needs moving into the browser now that the server
has no keys.

## Deploying

Pushes to Vercel's free tier as-is. Set `AUTH_SECRET` and `KINFOLD_PEPPER` to
random 32+ character strings (`openssl rand -base64 32`), and add
`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` to turn real sign-in on. See
[.env.example](./.env.example).

## Licence

MIT. Worth considering AGPL-3.0 before this goes public — it would require
anyone running a modified hosted version to publish their changes, which for a
project whose entire value is "you can verify we cannot read your data" is a
meaningful protection rather than a formality.
