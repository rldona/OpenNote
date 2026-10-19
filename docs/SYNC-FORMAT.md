# Sync format, version 1 (normative)

This is the contract every OpenNote implementation follows when it reads or writes a sync location: the TypeScript one
(`server/src/sync.ts`, used by the desktop app, the command line and the browser build) and the Kotlin one for Android and
iOS (`mobile/shared`). [SYNC.md](SYNC.md) explains the design and the merge rules for users; this file pins down the bytes.

**TypeScript is the reference.** When this text and `sync.ts` disagree, `sync.ts` wins and this file is fixed. A change to
the format lands in one pull request with both implementations, this file and new fixtures
(`server/test/fixtures/sync-v1/`, see the end).

Key words: MUST, MUST NOT, SHOULD as in RFC 2119.

## 1. Layout

A sync location is a set of files addressed by relative paths with `/` separators. On a folder they live under
`<folder>/opennote-sync/`; on Google Drive each file is one object in `appDataFolder` whose name is the full relative path.

```
format.json                       written once, never encrypted
devices/<deviceId>.json           one per device, rewritten on every run
notes/<noteId>/<deviceId>.json    the latest version of that note as written by that device
attachments/<blobName>            attachment bytes, one per distinct content
```

- `noteId` matches `^[0-9a-f-]{36}$` (a lowercase UUID). `deviceId` matches `^[\w-]{8,64}$`. A plain `blobName` is the
  attachment's SHA-256 in lowercase hex (`^[0-9a-f]{64}$`); in an encrypted location it is the HMAC described in 4.3.
- A device MUST only write `devices/<its id>.json`, `notes/*/<its id>.json`, attachments, and `format.json` (only if absent).
- Readers MUST ignore names that do not match the patterns above (temporary files, `.sync-conflict` copies…) and MUST NOT
  build paths outside the location from names they read.

## 2. `format.json`

UTF-8 JSON, never encrypted:

```json
{ "version": 1, "app": "opennote", "encrypted": true, "salt": "<base64, 16 bytes>", "verifier": "<base64>" }
```

- `salt` and `verifier` are present only when `encrypted` is true. `verifier` is the encryption (4.2) of the 8 ASCII bytes
  `opennote`.
- Created with "write if absent". If another device created it first, that one wins and is read back.
- A reader MUST refuse a `version` greater than it supports, MUST refuse an encrypted location without a passphrase, and
  MUST refuse a passphrase whose verifier does not decrypt to `opennote` (compared in constant time). A device with a
  passphrase MUST refuse an unencrypted location. A remote such as Google Drive MUST NOT be written unencrypted.

## 3. Records

### 3.1 Note record (`notes/<noteId>/<deviceId>.json`)

UTF-8 JSON (then encrypted when the location is). Members, in the order the TypeScript writer emits them:

| Member | Type | Meaning |
| --- | --- | --- |
| `v` | number | `1` |
| `id` | string | note id; MUST equal the folder name |
| `deviceId` | string | writer; MUST equal the file name without `.json` |
| `deviceName` | string | writer's display name (used in conflict titles) |
| `vv` | object | version vector: device id → positive integer counter |
| `writtenAt` | number | ms since the epoch |
| `deleted` | `true` | only on a deletion (tombstone); then `note` is absent |
| `note` | object | the note (3.2); absent on a tombstone |
| `chk` | string | checksum (3.4); always last |

A record is valid only if `v` is 1, `id` and `deviceId` match the patterns and the path, `vv` is an object, `chk` matches,
and it is either `deleted: true` or has a `note` whose `id` equals `id` and whose `content` is a string. Readers MUST skip
invalid records silently (they are read again on the next run).

### 3.2 Note (`SyncNote`)

```json
{
  "id": "…", "notebook": { "name": "Trips", "stack": "Life" },
  "title": "Rome", "content": "<p>…</p>", "pinned": false, "trashedAt": null, "reminderAt": null, "sourceUrl": null,
  "createdAt": 1760000000000, "updatedAt": 1760000000000, "isTemplate": false,
  "tags": ["travel/italy"],
  "attachments": [{ "id": "…", "filename": "map.png", "mime": "image/png", "size": 4, "md5": "…", "sha256": "…", "createdAt": 1760000000000 }]
}
```

- Times are integer milliseconds since the epoch, or `null` where shown.
- `stack` is a string or `null`. Notebooks are identified by name (and stack) across devices, not by id.
- `tags` are full hierarchical names (`a/b/c`), sorted. `attachments` are sorted by `id`.
- `content` is the note's HTML (the ProseMirror schema of the web editor). Attachments are referenced from it as
  `/api/attachments/<attachmentId>`. Readers MUST sanitize it with the same allow-list as `server/src/html.ts` before use.
- An encrypted note (password-protected in the app) is an ordinary note whose `content` is the app's encrypted envelope; sync
  does not look inside it.

### 3.3 Device record (`devices/<deviceId>.json`)

`{ "id": "<deviceId>", "name": "<display name>", "lastSeenAt": <ms> }`, encrypted when the location is. Informational only.

### 3.4 JSON text and the checksum

Implementations MUST serialise JSON exactly like ECMAScript `JSON.stringify` with no indentation (except `format.json`,
which is never hashed):

- No whitespace between tokens. Members in the order they are held (for a record read from a file: the order in the file).
- Strings: `"` → `\"`, `\` → `\\`, U+0008 → `\b`, U+000C → `\f`, U+000A → `\n`, U+000D → `\r`, U+0009 → `\t`, every other
  code unit below U+0020 → `\u00xx` (lowercase hex), lone surrogates (U+D800–U+DFFF not part of a pair) → `\udxxx`
  (lowercase hex). Everything else verbatim, including `/`, non-ASCII, U+2028 and U+2029. The result is encoded as UTF-8.
- Numbers: the integers used here (counters, sizes, timestamps) in plain decimal with no exponent, sign only when negative.
  `true`, `false`, `null` as literals.

`chk` = lowercase hex SHA-256 of the UTF-8 bytes of that serialisation of the record **without** the `chk` member. Writers
compute it over the members they are about to write, add `chk` last and write the same serialisation plus `chk`. Readers
compute it over the record as parsed, members in file order, and compare.

### 3.5 Content hash (`noteHash`)

Used to tell "same content" from "changed" and to name conflict copies. Lowercase hex SHA-256 of the 3.4 serialisation of
this array, in this order:

```
[ id, notebook.name, notebook.stack, title, content, pinned, trashedAt, reminderAt, sourceUrl,
  createdAt, updatedAt, isTemplate, sorted(tags), [ [att.id, att.filename, att.mime, att.sha256], … ] ]
```

`sorted(tags)` sorts by UTF-16 code units (ECMAScript default sort). Attachments keep their order in the note.

### 3.6 Derived ids

`derivedId(text)`: `h` = lowercase hex SHA-256 of the UTF-8 text;
`h[0..8] + "-" + h[8..12] + "-4" + h[13..16] + "-a" + h[17..20] + "-" + h[20..32]` (half-open ranges; note that `h[12]` and
`h[16]` are skipped).

A conflict copy of a losing record `r` (note `n`) has:

- id `derivedId("conflict:" + r.id + ":" + r.deviceId + ":" + noteHash(n))`;
- title `(n.title or "Untitled") + " (conflict " + r.deviceName + " " + YYYY-MM-DD + ")"`, the date being `n.updatedAt` in UTC;
- `pinned: false`, `reminderAt: null`, everything else from `n`;
- each attachment `a` re-identified as `derivedId(copyId + ":" + a.id)`, with every `/api/attachments/<a.id>` in `content`
  replaced by the new id. Attachments whose bytes are not available yet are left out.

If a note with the copy's id already exists, nothing is created.

## 4. Encryption

### 4.1 Key

`key = scrypt(passphrase as UTF-8, salt, N = 32768, r = 8, p = 1, dkLen = 32)`, salt from `format.json`. Implementations
SHOULD keep the derived key (it takes about a second) rather than the passphrase where the platform allows it.

### 4.2 Files

Every file except `format.json` is, when the location is encrypted:

```
"ONS1" (4 ASCII bytes) · IV (12 random bytes, new for every write) · GCM tag (16 bytes) · ciphertext
```

AES-256-GCM, no additional authenticated data. Readers MUST reject files shorter than 32 bytes or without the prefix, and
treat a failed tag check as "wrong passphrase or damaged file". Unencrypted locations store the plain bytes.

### 4.3 Attachment names

In an encrypted location `blobName = lowercase hex HMAC-SHA256(key, sha256 as lowercase hex ASCII)`, so the location does
not reveal which files are attached. Readers MUST check that decrypted bytes hash to the expected SHA-256.

## 5. Merge rules

As in [SYNC.md](SYNC.md) and `SyncEngine.syncNote`:

- Version vectors are compared member-wise (missing = 0): equal, before, after or concurrent.
- A device first pulls, then pushes. When it writes its record, its own counter becomes `max(base[me], ownRecord.vv[me]) + 1`
  where `base` merges every vector it has applied.
- Among concurrent live records the winner is the greatest `note.updatedAt`, ties broken by the greater `deviceId`
  (code-unit order); every other live record whose `noteHash` differs becomes a conflict copy.
- Local edits against a newer remote: the newer `updatedAt` wins (ties: greater device id), the other becomes a conflict copy.
- Edit beats delete. Deleting a note writes a tombstone with a higher vector; a device removes its own tombstone files 90
  days after the deletion.
- Attachment bytes are written before the record that references them; a record is applied only once all its attachment
  bytes are present and verified.
- Not synced: built-in templates, sync settings, the passphrase, the device name.

## 6. Fixtures

`server/test/fixtures/sync-v1/` holds sync locations written by the TypeScript implementation (`npm run fixtures:sync -w
server` regenerates them) and `expected.json` with what a reader must derive from them: the converged notes, every record's
checksum and content hash, JSON-serialisation cases, scrypt keys, derived ids and attachment names. Every implementation runs
its tests against these files, and the TypeScript tests also read a location written by the Kotlin implementation.
