# OpenNote Web Clipper

Browser extension (Manifest V3, TypeScript) that saves what you are reading into your **local** OpenNote.
It only talks to `http://localhost` / `http://127.0.0.1`: nothing goes to any cloud.

## What it saves

| Mode | Result |
| --- | --- |
| **Article** | The main content, without menus, banners, sidebars, ads or scripts; links and lazy-loaded images resolved |
| **Full page** | The whole page body, cleaned of scripts and forms |
| **Selection** | Only the text you selected, with its formatting |
| **Bookmark** | A link to the page plus its description |
| **Screenshot** | A screenshot of the visible area, plus a link to the page |

Before saving you can edit the title, choose the notebook and add tags (`a/b` makes nested tags).
The note keeps the page URL (shown as a link in the note header), and images are **downloaded into the note** so it
keeps working offline. Right-click menu: *Clip selection / article / full page / bookmark* (uses the last notebook).
Shortcut: `Ctrl+Shift+E` (`⌘⇧E` on macOS) opens the popup.

## Install

OpenNote must be running (`npm start`, or the desktop app).

```bash
npm install
npm run build:extension      # writes extension/dist (Chrome, Edge, Brave) and extension/dist-firefox
```

**Chrome / Edge / Brave:** open `chrome://extensions`, enable *Developer mode*, *Load unpacked*, choose `extension/dist`.

**Firefox:** open `about:debugging#/runtime/this-firefox`, *Load Temporary Add-on…*, choose
`extension/dist-firefox/manifest.json`. In Firefox the extension needs the optional permission to access
`localhost`: *about:addons → OpenNote Web Clipper → Permissions*.

If OpenNote listens on another port, open the popup → *Settings* and set the address (localhost only).

## How it is protected

- The OpenNote API only accepts requests whose `Host` is local. Browser extensions are the only foreign origin it
  accepts, and **only on `POST /api/clip`**; web pages cannot forge an extension origin, and every other endpoint
  still refuses cross-origin writes.
- Page HTML is sanitized again on the server (no scripts, event handlers or `javascript:` links).
- Image downloads happen on your machine: only `http(s)`, at most 30 images of 10 MB each, 10 s timeout,
  and never to loopback, private or link-local addresses (including through redirects and DNS), so a page cannot
  use the clipper to reach other services on your computer.

## Develop

```bash
npm run typecheck -w extension
npm test                      # the extraction logic and /api/clip are covered in server/test/clip.test.ts
```

Sources are in `extension/src` (`extract.ts` is a pure function over a `Document`, so it is tested without a
browser). There are no icons yet: browsers show a default one.
