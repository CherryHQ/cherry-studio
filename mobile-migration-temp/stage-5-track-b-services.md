# Stage 5 / Track B — `src/main/services` Decomposition (Ports-and-Adapters)

## Objective

Split the business logic out of desktop's `src/main/services` where a mobile counterpart proves
demand, using the measured Electron **and Node-builtin** imports as the port inventory. Governing rule:
**decompose a service only when unifying it** — no speculative pre-splitting.

## Preconditions

Stage 1. Independent of Stages 3–4 (oauth and webSearch can start immediately after landing).

## Classification (measured: 40 top-level files + 20 subdirectories; per-file platform-import extraction)

### Bucket A — platform-intrinsic; never split; desktop-permanent

Electron *is* the service; removing it leaves no residue:
`TrayService` (Tray/Menu/nativeImage), `AppMenuService`, `ContextMenu`, `nativePopupMenu`,
`ShortcutService` (globalShortcut), `MainWindowService`, `SubWindowService`,
`QuickAssistantService` (BrowserWindow/screen), `PrintService`, `WebviewService`, `ThemeService`
(nativeTheme), `NotificationService` (23-line shim), `screenshot/`, `selection/` (selection-hook
native), `protocol/`, `mediaProtocol/`, `menu/`.

### Bucket B — business skeleton with a thin Electron shell; the decomposition targets

Priority-ordered by proven mobile demand:

| # | Service | Size | Platform surface (= port inventory) | Mobile counterpart (evidence) |
|---|---|---|---|---|
| 1 | `oauth/` | 1,670 lines / 5 Electron files | Electron `net`; Node `crypto`, `http` (+ `safeStorage` via Copilot) | **Delegated sync map exists** (`apps/mobile/src/backend/services/oauth/desktop-sync-map.json`) — manual synchronization is ongoing; decomposition stops active bleeding |
| 2 | `webSearch/` | 2,739 lines / 9 electron files | predominantly `net` | Mobile rewrite: 37 files (`apps/mobile/src/backend/services/webSearch/`) |
| 3 | `CopilotService.ts` | 328 lines | Electron `net`, `safeStorage`; Node `fs`, `path` | Ported (`CopilotOAuthAdapter`: "adapted to Expo fetch and SQLite-backed auth config") |
| 4 | `FileStorage.ts` | 1,119 lines | Electron `dialog`, `net`, `shell`; Node `crypto`, `fs`, `path` | Mobile `services/file/` (549 lines) |
| 5 | `ExportService.ts` | 403 lines | Electron `dialog`; Node `fs` | — |
| 6 | `TopicNamingService.ts` | 460 lines | none | Equivalent logic in mobile streamManager |
| 7+ | `translate/` (183), `readableContent/` (290), `S3Storage` (201), `WebDav` (157), `ObsidianVaultService` (224), `VertexAiService` (173), `RegionService` (93), `CitationPreviewService` (255), `codeCli/` (1,214) | Electron usage is low, but Node surfaces remain: `net`/`stream` (S3), `https`/`path`/`stream` (WebDAV), `fs`/`path` (Obsidian), `fs`/`path`/`child_process`/`util` (codeCli) | partial mobile counterparts |

### Bucket C — desktop-only business; untouched

`BinaryManager` (2,030), `LegacyBackupManager` (2,125), `OvmsManager`, `PythonService`,
`localModel/`, `cacheCleanup/`, `diagnostics/`, `userDataRelocation/`, `proxy/`, `nutstore/`,
`mainNetworkDevtools/`, `deepSeekHarness/`, `AutoBackupService`, `AppUpdaterService`,
`VersionService`, `AnalyticsService`, `dataReset`.
Note: `lanTransfer/` (1,492 lines) is the **desktop half of phone-to-desktop transfer**; its
protocol layer becomes a sharing candidate if that feature is reworked — ledger entry, unscheduled.

An Electron-only histogram is therefore a lower bound, not a portability estimate. Re-run both the
Electron import scan and the Stage 0d Node-builtin scan before sizing each service.

## Decomposition Rule: Platform API → Port Mapping

| Platform API | Disposition | Desktop adapter | Mobile adapter |
|---|---|---|---|
| `net` (fetch) | Port: injected `fetch` | `net.fetch` (proxy-wired) | Expo fetch |
| `safeStorage` | Port: `SecretStore` | safeStorage | expo SecureStore |
| `app.getPath` | Injected paths (desktop already centralizes via `application.getPath`) | paths subsystem | expo-file-system directories |
| `shell.openExternal` | Port: `openUrl` | shell | RN Linking |
| `dialog` | **Not a port — stays in the shell.** The core returns data; asking the user where to put it is shell responsibility | dialog | RN share sheet / picker |
| `fs`, `path` | File operations stay behind a narrow file/path port; do not pass Node path semantics into the core | Node fs + paths subsystem | expo-file-system |
| `crypto` | Prefer platform Web Crypto where the required primitive exists; otherwise inject the exact random/hash operation | Node crypto | Expo/Web Crypto adapter |
| `http`, `https`, `net`, `stream` | Use the injected fetch/transport contract when semantically HTTP; raw sockets and Node streams stay in a platform shell | Node/Electron transport | fetch/native transport when supported |
| `child_process`, `os` | Process execution stays desktop-only; expose only a capability-specific port when mobile has a real counterpart | Node process/OS adapter | no adapter unless the capability exists |

Decomposition artifact shape: core logic → `packages/<domain>/` (content-domain name per Stage 0e,
e.g. `packages/oauth-flows/`); desktop shell remains in `src/main/services/` (IpcApi binding,
dialogs, lifecycle registration); mobile shell remains in `apps/mobile/src/backend/services/`.

## First Cut: oauth (execution template; subsequent services replicate)

1. Read `apps/mobile/src/backend/services/oauth/desktop-sync-map.json`; its per-file
   classifications are the cut list (the mobile team already performed the analysis:
   `PkceSessionOAuthAdapter`, `CopilotOAuthAdapter`, `PpioOAuthAdapter`,
   `WebviewApiKeyOAuthAdapter`, `BlockedOAuthAdapter`).
2. Inventory every Electron and Node-builtin import in desktop `src/main/services/oauth/` (starting
   with the 5 Electron-importing files plus the `crypto`/`http` users), then apply the platform-port
   mapping to separate shell from core.
3. Core into `packages/oauth-flows/src/`: device-code flow, PKCE session management, token
   exchange, account lookup — pure protocol logic over two ports (`fetch`, `SecretStore`).
4. Each application's shell injects its adapters. Decommission mobile's
   `oauth:desktop-sync:check` script and the oauth `desktop-sync-map.json`.
5. End-to-end smoke: complete the GitHub Copilot device-code flow on both applications.

## Verification (per-service PR)

```
pnpm test:main && pnpm build:check
pnpm --filter cherry-studio-app test && pnpm --filter cherry-studio-app typecheck
```
Plus a functional smoke of the decomposed capability on both applications (one OAuth login / one
web search / one export, as applicable).
