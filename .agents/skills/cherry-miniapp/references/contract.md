# Mini App contract

The authoritative sources live in the repository; this file is the authoring summary. When they disagree, the repository wins.

- Manifest schema: `src/shared/types/miniAppManifest.ts` (`MiniAppManifestSchema`), explained field by field in `docs/dev/references/mini-app/manifest.md`.
- Guest API: `docs/dev/references/mini-app/cherry.d.ts` (byte-identical copy at `assets/cherry.d.ts`), capabilities in `docs/dev/references/mini-app/capabilities.md`.
- Packaging rules and installer rejections: `docs/dev/references/mini-app/packaging.md`.

## manifest.json essentials

| Field | Rule |
|---|---|
| `id` | Reverse-DNS, lowercase, max 120 chars; first label must not be a Windows device name (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`). `com.cherrystudio.*` is reserved for official apps. |
| `name` / `description` / `releaseNotes` | A string, or a per-locale table with at least one of `en` / `zh` (max 20 locales). Caps: 64 / 200 / 500 chars. `description` is required — the consent card shows it. |
| `version` | Valid semver, max 32 chars. Updates are decided by semver, never by channel. |
| `entry` | Package-relative POSIX path to the entry HTML. No leading `/`, no `\`, no `..`, not under reserved `__cherry/`. |
| `icon` | Optional `{ path, sha256 }` — both or neither; the digest must match the file bytes. Max 5 MB. |
| `permissions` / `optionalPermissions` | Known leaves (`ai.chat`, `storage.get/set/delete/keys`, `file.save/load/list/delete/export`, `notification.show`, `clipboard.read/write`, `network.fetch`) or namespace wildcards (`storage.*`). Max 32 each; a leaf may not be both required and optional. |
| `network` | Bare hostnames (no scheme, path, or trailing numeric label), unique, max 20. Hosts and a `network.*` permission must be declared together — either alone is an authoring error. |
| `update` | Optional `{ url, urlCn? }` HTTPS endpoints serving the distribution manifest. Ignored for file installs. |

## Package limits

Archive ≤ 50 MB, extracted ≤ 100 MB, ≤ 2000 entries, manifest ≤ 256 KB. No symlinks, devices, FIFOs or sockets. No top-level `__cherry` directory. The template in `assets/template/` passes `scripts/validate.mjs`; keep it that way.

## Guest bridge in one paragraph

Everything is `async` except `cherry.on(event, handler)`, which returns an unsubscribe function. Events today: `app.localeChange`, `app.visibilityChange`. Every rejection is a plain `{ name, message }` with one of seven names: `PermissionDenied`, `QuotaExceeded`, `RateLimited`, `Unavailable`, `InvalidArgument`, `Cancelled`, `Internal`. Variable-length inputs are capped (storage key 256 chars, storage value 1 MB, file name 128 chars, file data 10 MB base64, chat 100 messages, fetch body 1 MB base64, url 2048 chars, ≤ 32 headers). Grants gate `ai.chat`, storage, file, notification, clipboard writes/reads and `network.fetch`; `app.getInfo`, `app.getPermissions`, `ai.cancel` and the `*.usage`/`getCapabilities` introspection calls are ungated.
