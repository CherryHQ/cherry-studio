# Stage 5 / Track B — `src/main/services` Decomposition (Ports-and-Adapters)

## Objective

Split the business logic out of desktop's `src/main/services` where a mobile counterpart proves
demand, using the measured Electron symbol imports as the port inventory. Governing rule:
**decompose a service only when unifying it** — no speculative pre-splitting.

## Preconditions

Stage 1. Independent of Stages 3–4 (oauth and webSearch can start immediately after landing).

## Classification (measured: 40 top-level files + 20 subdirectories; per-file Electron symbol extraction)

### Bucket A — platform-intrinsic; never split; desktop-permanent

Electron *is* the service; removing it leaves no residue:
`TrayService` (Tray/Menu/nativeImage), `AppMenuService`, `ContextMenu`, `nativePopupMenu`,
`ShortcutService` (globalShortcut), `MainWindowService`, `SubWindowService`,
`QuickAssistantService` (BrowserWindow/screen), `PrintService`, `WebviewService`, `ThemeService`
(nativeTheme), `NotificationService` (23-line shim), `screenshot/`, `selection/` (selection-hook
native), `protocol/`, `mediaProtocol/`, `menu/`.

### Bucket B — business skeleton with a thin Electron shell; the decomposition targets

Priority-ordered by proven mobile demand:

| # | Service | Size | Electron surface (= port inventory) | Mobile counterpart (evidence) |
|---|---|---|---|---|
| 1 | `oauth/` | 1,670 lines / 5 electron files | `net` (+ `safeStorage` via Copilot) | **Delegated sync map exists** (`apps/mobile/src/backend/services/oauth/desktop-sync-map.json`) — manual synchronization is ongoing; decomposition stops active bleeding |
| 2 | `webSearch/` | 2,739 lines / 9 electron files | predominantly `net` | Mobile rewrite: 37 files (`apps/mobile/src/backend/services/webSearch/`) |
| 3 | `CopilotService.ts` | 328 lines | `net`, `safeStorage` | Ported (`CopilotOAuthAdapter`: "adapted to Expo fetch and SQLite-backed auth config") |
| 4 | `FileStorage.ts` | 1,119 lines | `dialog`, `net`, `shell` | Mobile `services/file/` (549 lines) |
| 5 | `ExportService.ts` | 403 lines | `dialog` only (one save dialog) | — |
| 6 | `TopicNamingService.ts` | 460 lines | none | Equivalent logic in mobile streamManager |
| 7+ | `translate/` (183), `readableContent/` (290), `S3Storage` (201), `WebDav` (157), `ObsidianVaultService` (224), `VertexAiService` (173), `RegionService` (93), `CitationPreviewService` (255), `codeCli/` (1,214) | zero Electron imports or `net` only | partial mobile counterparts |

### Bucket C — desktop-only business; untouched

`BinaryManager` (2,030), `LegacyBackupManager` (2,125), `OvmsManager`, `PythonService`,
`localModel/`, `cacheCleanup/`, `diagnostics/`, `userDataRelocation/`, `proxy/`, `nutstore/`,
`mainNetworkDevtools/`, `deepSeekHarness/`, `AutoBackupService`, `AppUpdaterService`,
`VersionService`, `AnalyticsService`, `dataReset`.
Note: `lanTransfer/` (1,492 lines) is the **desktop half of phone-to-desktop transfer**; its
protocol layer becomes a sharing candidate if that feature is reworked — ledger entry, unscheduled.

## Decomposition Rule: Electron Symbol → Port Mapping

| Electron symbol | Disposition | Desktop adapter | Mobile adapter |
|---|---|---|---|
| `net` (fetch) | Port: injected `fetch` | `net.fetch` (proxy-wired) | Expo fetch |
| `safeStorage` | Port: `SecretStore` | safeStorage | expo SecureStore |
| `app.getPath` | Injected paths (desktop already centralizes via `application.getPath`) | paths subsystem | expo-file-system directories |
| `shell.openExternal` | Port: `openUrl` | shell | RN Linking |
| `dialog` | **Not a port — stays in the shell.** The core returns data; asking the user where to put it is shell responsibility | dialog | RN share sheet / picker |

Decomposition artifact shape: core logic → `packages/<domain>/` (content-domain name per Stage 0e,
e.g. `packages/oauth-flows/`); desktop shell remains in `src/main/services/` (IpcApi binding,
dialogs, lifecycle registration); mobile shell remains in `apps/mobile/src/backend/services/`.

## First Cut: oauth (execution template; subsequent services replicate)

1. Read `apps/mobile/src/backend/services/oauth/desktop-sync-map.json`; its per-file
   classifications are the cut list (the mobile team already performed the analysis:
   `PkceSessionOAuthAdapter`, `CopilotOAuthAdapter`, `PpioOAuthAdapter`,
   `WebviewApiKeyOAuthAdapter`, `BlockedOAuthAdapter`).
2. For each of the 5 Electron-importing files in desktop `src/main/services/oauth/`, apply the
   symbol→port mapping to separate shell from core.
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
