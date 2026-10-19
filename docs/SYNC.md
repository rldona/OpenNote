# Sync without a cloud

> Roadmap for more destinations (Google Drive, other devices): [SYNC-BACKENDS.md](SYNC-BACKENDS.md).

OpenNote syncs between your devices through **a folder you choose**. Point every device at a folder that
Syncthing, iCloud Drive, Dropbox, OneDrive, a NAS mount or a USB drive keeps in sync. OpenNote never
contacts any server and there is nothing for us to host.

Set it up in the app: sidebar → **Sync** → folder path → *Sync now*. Optionally set a passphrase to
encrypt everything in the folder.

## Folder format (version 1)

```
<folder>/opennote-sync/
  format.json                        { version, encrypted, salt?, verifier? }   written once
  devices/<deviceId>.json            { id, name, lastSeenAt }
  notes/<noteId>/<deviceId>.json     the latest version of that note on that device
  attachments/<sha256 | hmac>        attachment bytes, one file per distinct content
```

**Every device only writes its own files.** A note has one file per device that touched it, so the file-sync
tool never has to merge two writers into the same file (which is what creates `.sync-conflict` copies).

A note record:

```json
{ "v": 1, "id": "…", "deviceId": "…", "deviceName": "laptop", "vv": { "<deviceId>": 3, "<other>": 1 },
  "writtenAt": 1760000000000, "deleted": false, "note": { …title, content, tags, notebook, attachments… },
  "chk": "<sha256 of the record>" }
```

- Writes are atomic (temp file + rename). Readers ignore `*.tmp-*` files, and any record that fails to parse or
  whose checksum does not match is skipped and read again on the next run, so a half-synced file is harmless.
- Attachment bytes are written before the note that references them, and a note is only applied once all its
  attachment bytes have arrived and match their SHA-256.
- Names read from the folder are validated (note ids, device ids, blob names) and never used to build paths
  outside it. Imported HTML goes through the same sanitizer as everything else.

## Merge rules

Each record carries a **version vector** (`vv`): a counter per device. Comparing two vectors tells whether one
version is newer or whether both were edited without seeing each other.

On every run, for each note, a device first **pulls** and then **pushes**:

| Situation | Result |
| --- | --- |
| Remote is newer, no local edits since last sync | Apply the remote version (the overwritten local version stays in the note history) |
| Same content on both sides | Only merge the vectors |
| Local edits only | Write our record with our counter incremented |
| Both sides edited | The most recent `updatedAt` wins (ties: higher device id). The other version is **kept as a new note** titled `Title (conflict <device> <date>)`, with its own copies of the attachments. Nothing is lost |
| Deleted on one side, edited on the other | **Edit wins**, the note comes back |
| Deleted on one side, untouched on the other | Deleted everywhere |
| Several devices' versions are concurrent | The newest wins; each of the others becomes a conflict copy |

The conflict copy's id, title and attachment ids are derived only from the losing version, so every device
builds the *same* copy and the copies do not conflict again. Pulling and pushing is idempotent: running sync
again changes nothing.

### Deletions (tombstones)

A permanent deletion is written as a record with `"deleted": true` and a higher vector. Moving a note to the
trash is not a deletion: it is a normal edit (`trashedAt`) that syncs like any other.

A device removes its **own** tombstone file after **90 days**. Any device that was offline longer than that and
still has the note would bring it back; that is the documented trade-off for not growing the folder forever.

### What is not synced

- Built-in starter templates (each device seeds its own, in its language). Templates you save yourself are synced.
- Sync settings, passphrase and device name (they are per device).

## Encryption (optional)

With a passphrase set, every file except `format.json` is encrypted with **AES-256-GCM**; the key is derived with
**scrypt** (N=2¹⁵) from the passphrase and a random salt stored in `format.json`, and each file uses a fresh IV.
Attachment file names are an HMAC of their hash, so the folder does not reveal which files you attach. The
provider of the shared folder still sees how many notes you have, their sizes and modification times.

- The passphrase is stored in your local OpenNote database so syncing can run unattended. Anyone with access to
  your account on this computer can read it.
- **If you lose the passphrase, the synced data cannot be recovered.** Your local database is not affected.
- All devices of one folder must use the same passphrase. A folder is either encrypted or not, decided by the first
  device that initialises it.

## Limits

- One file-sync tool must actually propagate the folder; OpenNote does not detect remote deletions of the whole folder.
- If two devices initialise an empty folder at exactly the same moment, the file-sync tool may keep two
  `format.json` versions; delete one and run sync again.
- Notebook renames travel with the notes of the notebook, so renaming a big notebook rewrites those records once.
