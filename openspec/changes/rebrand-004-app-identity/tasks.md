# Tasks — rebrand-004-app-identity

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## What changed

**`electron-builder.yml`** — 6 identity fields:

| Field | From | To |
|---|---|---|
| `appId` | `com.kangfenmao.CherryStudio` | `tools.know-me.the-boss` |
| `productName` | `Cherry Studio` | `The Boss` |
| `win.executableName` | `Cherry Studio` | `The Boss` |
| `linux.executableName` | `CherryStudio` | `TheBoss` |
| `linux.desktop.entry.Name` | `Cherry Studio` | `The Boss` |
| `linux.desktop.entry.StartupWMClass` | `CherryStudio` | `TheBoss` |

**`electron-builder.cn.config.cjs`** — `appId` → `tools.know-me.the-boss.cn`. It
extends the base config, so it inherits the new `productName`; leaving its `appId`
on the Cherry namespace would have been half-done.

**`package.json`** — `name`: `CherryStudio` → `TheBoss`. Feeds Electron's `app.name`
(so menus and window titles follow) and the Sentry release tag.

**`src/main/utils/appEdition.ts`** — `APPLICATION_IDS` now derives from `APP_ID` in
the branding module instead of duplicating both literals.

## Scope decision (user chose option 1)

The `cherrystudio://` **URL protocol scheme is deliberately unchanged**. It is
declared in `electron-builder.yml` (`protocols.schemes`, `mimeTypes`) and used in
17 source files, including `src/renderer/services/oauth.ts:71` as an **OAuth
redirect URI** — renaming it breaks providers already configured with the old
redirect, and collides with the in-flight `TODO(#15353)` paintings migration that
builds on `cherrystudio://file/internal/...`. Follow-on work, with its own testing.

Also unchanged, deliberately:
- `publish.url` (`https://releases.cherry-ai.com`) — D3 defers the updater until
  Boss infrastructure serves a release feed; `rebrand-008` owns it.
- `releaseInfo.releaseNotes` — upstream's historical 2.1.1 changelog, not our
  identity. Rewriting another project's release notes would be wrong.

## A real gap the tests caught

`appEdition.test.ts` reads **both** packaging configs and asserts the runtime
`APPLICATION_IDS` match them. Changing only the build configs failed it, exposing a
duplicated runtime source of app IDs. That test earned its keep — it is exactly the
kind that asserts a contract rather than pinning behavior.

`sentry.test.ts` pinned the literal `CherryStudio@<version>` release string; its
intent ("release uses the build name, not the packaged display name") is still
valid, so it now derives the expected value from the package name.

## Evidence

- `pnpm test:main` → **1031 files / 16383 tests passed**, 0 failed
- `pnpm lint` → exit 0 (4 typecheck projects, 76011 translations, format clean)
- Config resolution verified by parsing both files:
  global `tools.know-me.the-boss` / `The Boss`, cn `tools.know-me.the-boss.cn`,
  artifacts build as `The Boss-2.1.1-<arch>-setup.<ext>`
- `userDataLocation` rename-independence guard still passes (29/29) — the data
  directory did **not** move when the app name changed, which is what rebrand-003
  was for

## Not done here

A real packaged launch (`pnpm build:unpack`, open the app, confirm the menu reads
"The Boss" and data lands in `<appData>/TheBoss`) is still worth doing manually
before release. Unit tests cover config resolution and path pinning, not the
packaged artifact.
