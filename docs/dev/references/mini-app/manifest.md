---
description: Every manifest.json field, the appId rules, permission declarations and wildcard expansion, and the network host allowlist
sources:
  - src/shared/types/miniAppManifest.ts
---

# Manifest

`manifest.json` sits at the root of the package. It is validated when the package is previewed, again after extraction, and the two must match — a package whose manifest changes between consent and install is rejected.

## Fields

| Field | Required | Type | Rules |
|---|---|---|---|
| `id` | yes | string | Reverse-DNS app id, see [App id](#app-id). Becomes the origin `cherry-miniapp://<id>/` |
| `name` | yes | [localized text](#localized-text) | ≤ 64 characters per value |
| `description` | yes | localized text | ≤ 200 characters per value. Shown on the consent card — say what the app is for |
| `version` | yes | string | Valid [semver](https://semver.org), ≤ 32 characters. Updates require a strictly greater version |
| `entry` | yes | package-relative path | The document loaded on open. Must exist and be a regular file |
| `icon` | no | `{ path, sha256 }` | Both or neither. `sha256` is the lowercase hex digest of the icon bytes; verified at install and update. Icon entry ≤ 5 MB |
| `releaseNotes` | no | localized text | ≤ 500 characters per value. What changed in **this** version; plain text, rendered below the permission diff on update |
| `permissions` | no (default `[]`) | string[] | Required grants, ≤ 32 entries. Install is refused unless the user accepts all of them |
| `optionalPermissions` | no (default `[]`) | string[] | Offered on the same card **ticked by default** — the user unticks what they do not want — and revocable later. Must not overlap `permissions` after wildcard expansion |
| `network` | no (default `[]`) | string[] | Hosts `cherry.network.fetch` may reach. ≤ 20, unique, bare hostnames |
| `update` | no | `{ url, urlCn? }` | Where the host checks for updates. `urlCn` is an optional China accelerator serving the same bytes; ignored for packages installed from a local file |

Package-relative paths are POSIX (`/` separators), never absolute, never contain `..`, and never start with the reserved `__cherry` directory.

### Localized text

A string, or an object keyed by locale. At least one of `en` / `zh` must be present; any other locale key is optional; at most 20 keys.

```json
"name": "My Game"
"name": { "en": "My Game", "zh": "我的游戏", "ja": "マイゲーム" }
```

Resolution for the user's locale: exact locale (`zh-TW`) → language subtag (`zh`) → `en` → `zh`. Writing `zh` once covers `zh-CN`, `zh-TW` and `zh-HK`.

### App id

```
^(?:[a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])(?:\.(?:[a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9]))*$
```

| Rule | Why |
|---|---|
| Lowercase letters, digits, `.` and `-` only; no underscore, no leading or trailing `-` | The id is a URL host. Chromium lowercases hosts, so two ids differing in case would share one origin — and one storage |
| ≤ 120 characters | Also used as an install directory name and a journal file name |
| First label must not be a Windows device name (`con`, `prn`, `aux`, `nul`, `com0`–`com9`, `lpt0`–`lpt9`) | `con.example.app` cannot be created as a directory on Windows, even with an extension. `com.example.con` is fine — only the first label matters |
| `com.cherrystudio.*` is reserved | Official apps only; a package from any other source using it is refused |

## Permissions

Each entry is either a **leaf** (`file.save`) or a **namespace wildcard** (`file.*`). A wildcard is authoring shorthand: it is expanded to the leaves that exist at consent time and never stored, so a method Cherry adds later is not silently granted by an old wildcard.

Only methods gated `grant` are declarable. `sibling` methods become callable as soon as any leaf in their namespace is granted; `none` methods need nothing.

| Method | Gate | Declare as |
|---|---|---|
| `app.getInfo` | none | — |
| `app.getPermissions` | none | — |
| `ai.chat` | grant | `ai.chat` or `ai.*` |
| `ai.getCapabilities` | sibling | — (follows any `ai.*` grant) |
| `ai.cancel` | none | — |
| `storage.get` / `set` / `delete` / `keys` | grant | leaf or `storage.*` |
| `storage.usage` | sibling | — (follows any `storage.*` grant) |
| `file.save` / `load` / `list` / `delete` / `export` | grant | leaf or `file.*` |
| `file.usage` | sibling | — (follows any `file.*` grant) |
| `notification.show` | grant | `notification.show` or `notification.*` |
| `clipboard.read` / `write` | grant | leaf or `clipboard.*` |
| `network.fetch` | grant | `network.fetch` or `network.*` |

Users never see these names raw: the consent card and the detail panel show the copy under `miniApp.permission.*` in the renderer catalog (namespace title and description, one label per leaf). Adding a `grant` method means adding that copy — a contract test fails until both `en-us` and `zh-cn` have it.

Cross-field rules, all rejected at validation:

| Rule | Example that fails |
|---|---|
| A leaf cannot be both required and optional, **after expansion** | `permissions: ["storage.*"]`, `optionalPermissions: ["storage.get"]` |
| `network` hosts require a `network.*` permission somewhere | `network: ["api.example.com"]` with no `network.fetch` |
| A `network.*` permission requires at least one host | `permissions: ["network.fetch"]`, `network: []` |

Required permissions cannot be revoked after install; the only way to remove one is to uninstall. Optional permissions can be revoked and re-granted from the app's detail panel, and take effect on the next call. Query the current state with `cherry.app.getPermissions()`.

## Network hosts

`network` is the **scope** of `network.fetch`, not a permission of its own — a host cannot be individually revoked. Entries are bare hostnames matched exactly (no scheme, path, port or wildcard):

```json
"network": ["api.example.com", "cdn.example.com"]
```

`cherry.network.fetch` accepts `https://` URLs on the default port whose hostname is in this list. `api.example.com` does not cover `www.api.example.com` or `example.com`. Adding a host in an update is shown on the update card and requires consent.

## Example

```json
{
  "id": "com.example.mygame",
  "name": { "en": "My Game", "zh": "我的游戏" },
  "description": { "en": "A tiny sample game.", "zh": "一个小样例游戏。" },
  "version": "1.0.0",
  "entry": "index.html",
  "icon": { "path": "icon.png", "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" },
  "permissions": ["ai.chat", "storage.*", "file.save", "file.load"],
  "optionalPermissions": ["notification.show", "network.fetch"],
  "network": ["api.example.com"],
  "releaseNotes": { "en": "Fixes a save bug.", "zh": "修复了一个存档问题。" },
  "update": {
    "url": "https://example.com/mygame/manifest.json",
    "urlCn": "https://cdn.example.cn/mygame/manifest.json"
  }
}
```

The manifest served at `update.url` is this document plus a `package` block; see [Packaging](./packaging.md#distribution-manifest).

## Limits

| Constraint | Limit |
|---|---|
| `manifest.json` entry | 256 KB |
| Archive (before extraction) | 50 MB |
| Extracted total | 100 MB |
| Entries in the archive | 2000 |
| Icon entry | 5 MB |
