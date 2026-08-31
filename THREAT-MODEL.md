# What we hold, and what we don't

Most privacy policies are written to sound reassuring. This one is written so
you can check it. Run `npm run demo` and you will see the actual bytes.

## The two piles of data

A genealogy site holds two very different things, and they need different
answers:

1. **Account data** — who logged in. Names, emails, avatars.
2. **Family data** — the tree itself. Birthdays, places, notes, adoptions,
   maiden names, and who is related to whom.

The second pile is far more sensitive than the first, and it is data about
people who never signed up and cannot object. A tree of 200 relatives is 200
people's personal data held by someone none of them chose.

## Pile 1: we store a hash, not a person

Sign-in is delegated to Google or GitHub. What comes back includes a name, an
email and a picture. All three are discarded in `src/auth.ts` before anything is
written. What survives is:

```
uid = HMAC-SHA256(server_pepper, "v1|google|109876543210987654321")
```

That string is the entire account record. There is no users table — Auth.js only
creates one when given a database adapter, and this project never gives it one.
The session lives in a signed cookie in your own browser.

It is a **pseudonym, not anonymity**. If you already knew someone's Google
subject id and had the pepper, you could confirm a match. It is a one-way
function, not a magic trick.

## Pile 2: the server cannot read the tree

Records are encrypted in the browser before upload (`src/lib/crypto.ts`) and
decrypted in the browser after download. The server stores random ids and
equal-looking blobs.

A tree is cut into four **slices**, each with its own key:

| Slice | Contains |
| --- | --- |
| `structure` | Ids and family links. The shape, no names. |
| `history` | Full records of people who have died. |
| `living-name` | Names of living people, nothing else. |
| `living-detail` | Birthdays, places, notes, photos of the living. |

Members hold an ECDH keypair. The owner wraps each slice key to each member's
public key, in their own browser. The server stores wrapped keys it cannot open.

**This is the important consequence:** a viewer without the `living-detail` key
does not see birthdays because the bytes are meaningless to them — not because a
function we wrote chose to omit them. Authorization stopped being our code and
became arithmetic. No bug in our filtering can leak what our servers never had.

## What an attacker with the whole database gets

Ciphertext, public keys, and wrapped keys. `npm test` asserts that no name,
place or note appears anywhere in the stored document, including the tree's own
title.

## What we still leak — read this part

Encryption is not invisibility. Even with everything above, the operator can
observe:

- **How many records a tree has**, and roughly how big each is. A tree with 400
  records is a big family.
- **When records change**, and how often.
- **Which public key asked for which tree, from which IP address, and when.**
  This is the big one. Traffic analysis can reveal that two accounts belong to
  the same family, and roughly when they are active.
- **The existence of a tree at a given id.**

We do not currently pad record sizes or batch requests. If your threat model
includes the operator, use a self-hosted instance you control.

## What breaks, honestly

- **There is no password reset.** Lose your key and passphrase and your access
  is gone. Every member gets a recovery phrase at signup; the owner can re-grant
  to a new key. An owner who loses both is locked out permanently, and no
  support ticket can help.
- **No server-side search.** Search happens in your browser, over what you can
  decrypt.
- **Revocation requires a re-key.** Removing someone from the keyring stops
  future access, but they may have kept a copy of what they already downloaded.
  Real revocation means rotating the slice key and re-encrypting. A server-side
  ACL has exactly the same hole; it is just quieter about it.
- **Adding a member is a manual owner action.** The owner's browser must be open
  to wrap keys. There is no way around this: a server that could grant access on
  their behalf would be a server that could read the tree.

## The part that is not a technical problem

The people in a family tree cannot consent, and the person who enters their data
is not usually the person it is about. Encryption controls who reads a record.
It does not decide whether the record should exist.

Defaults in this project reflect that: living people are redacted unless
explicitly shared, unknown life status is treated as living, and there is no
"make my tree public" button. If someone asks to be removed from a tree, the
owner should be able to do it in one action. That is a product requirement, not
a nice-to-have.
