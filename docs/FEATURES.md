# Feature scope and provenance

## How the feature set was defined

OpenNote's feature set comes from what Evernote documents and exposes publicly: its help center,
its published ENEX/ENML formats and its public developer documentation. No Evernote binary,
source code, asset or trademark was copied, and no application was decompiled.

[REA](https://github.com/morluto/rea) (reverse engineering for agents) was evaluated for this
purpose and deliberately **not** run against Evernote:

- Evernote is not installed on the development machine, and REA analyses a local target.
- Evernote's terms restrict reverse engineering, and REA's own
  [DISCLAIMER](https://github.com/morluto/rea/blob/main/DISCLAIMER.md) states that it does not support
  copying proprietary software or reproducing its protected code and assets.
- It isn't needed: note-taking behaviour (notebooks, tags, search syntax, checklists, import/export)
  is observable from the product's public documentation.

If you want REA-assisted analysis of an app you are licensed to inspect (for example, your own
exported data, or an open source note app), the project is happy to take that as a contribution
as long as it respects the target's license.

## Status

| Area | Feature | Status |
| --- | --- | --- |
| Organise | Notebooks, stacks | ✅ |
| | Tags | ✅ |
| | Pinned notes ("shortcuts") | ✅ |
| | Trash, restore, empty trash | ✅ |
| | Saved searches | ✅ |
| Edit | Rich text, checklists, tables, code, quotes | ✅ |
| | Images and file attachments (paste, drop, button) | ✅ |
| | Note history / versions | ✅ |
| | Templates | planned |
| | Web clipper (browser extension) | planned |
| | Markdown import | planned |
| Find | Full-text search (prefix, phrase, accents, ranking) | ✅ |
| | `tag:` `notebook:` `todo:` `resource:` `reminderTime:` | ✅ |
| | Search inside attachments (PDF/OCR) | planned |
| | Date operators (`created:`, `updated:`) | planned |
| Act | Reminders + notifications | ✅ |
| | Standalone tasks view | planned |
| Move | ENEX import / export | ✅ |
| | Markdown export (per note) | ✅ |
| | Folder export with attachments, zip backup | planned |
| Sync | Optional self-hosted sync | planned |
| | Desktop shell (Tauri/Electron) | planned |
| Security | Local-only server, Host/Origin checks, sanitized HTML, sandboxed attachments | ✅ |
| | Encryption at rest / encrypted notes | planned |
