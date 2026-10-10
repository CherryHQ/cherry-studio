---
description: Entry point for building a Cherry Studio mini app — what a package is, the host API, and where each rule lives
sources:
  - src/main/features/miniApp
  - src/preload/miniAppBridge.ts
  - src/shared/types/miniAppManifest.ts
---

# Mini App Reference

A **mini app** is a static web app shipped as a `.miniapp` package (a zip with a `manifest.json` at its root). Cherry Studio installs it locally, serves it from `cherry-miniapp://<appId>/` inside a sandboxed `<webview>`, and exposes host capabilities through one global: `window.cherry`.

This is the author-facing contract. It describes what you can call, what is enforced, and what will not work — not how the host implements it.

## Documents

| Document | Read it when |
|---|---|
| [Sandbox](./sandbox.md) | **First.** Your code works in a browser and fails here — `localStorage`, `fetch`, iframes, popups, navigation |
| [Manifest](./manifest.md) | Writing `manifest.json`: every field, id rules, permission declarations, network hosts |
| [Capabilities](./capabilities.md) | Calling `cherry.*`: signatures, return shapes, errors, quotas and rate limits per method |
| [Lifecycle](./lifecycle.md) | Saving state: the app can be killed at any moment; visibility and locale events; quiesce |
| [Theming](./theming.md) | Looking like Cherry: `/__cherry/theme.css`, the CSS variable contract, dark mode, Tailwind |
| [Packaging](./packaging.md) | Shipping: building the archive, install consent, updates, rollback, uninstall |
| [Activity log](./activity-log.md) | Knowing what the user sees: which of your calls are recorded, with what metadata, and for how long |
| [`cherry.d.ts`](./cherry.d.ts) | TypeScript declarations for `window.cherry` — copy into your project |
| [Runtime probes](./probes.md) | Maintaining the host: the measurements behind the sandbox layers and how to rebuild each probe when Electron moves |
| [`examples/capability-tests/`](./examples/capability-tests/manifest.json) | A runnable app that checks every `cherry.*` method against this reference, permission by permission — zip the directory to install it |

## Maintainer design proposals

These documents describe possible future capabilities. They are not part of the current Mini App runtime contract.

| Proposal | Status |
|---|---|
| [Private SQLite database API](./database-api-design.md) | Proposed and not implemented — `window.cherry.db` does not currently exist |

## Minimal app

```
mygame.miniapp (zip)
├── manifest.json
├── index.html
└── icon.png
```

```json
{
  "id": "com.example.mygame",
  "name": { "en": "My Game", "zh": "我的游戏" },
  "description": "A tiny sample game.",
  "version": "1.0.0",
  "entry": "index.html",
  "permissions": ["storage.*"]
}
```

```html
<!doctype html>
<link rel="stylesheet" href="/__cherry/theme.css" />
<body>
  <script>
    cherry.storage.get('save').then(({ value }) => {
      const state = value ? JSON.parse(value) : { score: 0 }
      state.score += 1
      return cherry.storage.set('save', JSON.stringify(state))
    })
  </script>
</body>
```

## Three things to know before writing code

| Rule | Consequence |
|---|---|
| The page is sandboxed with an opaque origin and no network | Web Storage, IndexedDB, cookies and every outbound request are blocked. Persist through `cherry.storage` / `cherry.file`; reach the network through `cherry.network.fetch` |
| Every capability that reaches your data, the network or the user is gated by a manifest declaration | Undeclared methods reject with `PermissionDenied`, and optional permissions can be revoked at any time. Environment reads (`app.*`) and `ai.cancel` are ungated and cannot be declared; `*.usage` and `ai.getCapabilities` ride on their namespace's grant. See [capabilities.md](./capabilities.md) |
| The host never warns before destroying the app | Write state as soon as it changes. `cherry.storage.set` and `cherry.file.save` are committed when they resolve |

## Where the truth lives

| Fact | Source |
|---|---|
| Method names and how each is gated | `MINI_APP_METHODS` in `src/shared/types/miniAppManifest.ts` — the manifest schema, the consent card and the runtime gate all read this table |
| The seven error names | `CherryErrorName` in `src/shared/ipc/schemas/miniAppBridge.ts` |
| `cherry.d.ts` does not drift from the bridge | `src/main/features/miniApp/runtime/__tests__/apiSurface.test.ts` asserts the `.d.ts`, `MINI_APP_METHODS` and the preload expose the same method set and the same error names |

Parameter and return **shapes** are hand-written in `cherry.d.ts` and `capabilities.md`; only the method set and error set are machine-checked.
