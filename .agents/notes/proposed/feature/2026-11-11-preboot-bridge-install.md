# Agent Note: Install the migration bridge during preboot

Status: proposed

English | [中文](2026-11-11-preboot-bridge-install.zh.md)

## Problem

The legacy upgrade gate correctly blocks normal startup for unmigrated profiles, but currently sends users to a browser to download and install 2.1.0. The intended experience is one action inside Cherry Studio that downloads, verifies, installs, and launches that migration-capable version.

This proposal partially supersedes the browser-download interaction in [Retire v1 data migration](../../implemented/simplification/2026-11-09-retire-v1-data-migration.md). Its read-only detection, fixed 2.1.0 bridge, historical status consumers, and removal of conversion remain unchanged. Implementation is in progress in PR #23998; this note remains proposed until packaged acceptance is complete.

## Proposal

### User experience and scope

Keep the compact frameless window, common content margins, and fixed footer. The main action is “Install migration version”; the explanation explicitly names 2.1.0 and says that Cherry Studio will restart into it. Clicking once authorizes download and installation; do not ask again after download. OS permission prompts may still appear.

The window shows one current status: preparing, downloading with percentage when known, verifying, or restarting into 2.1.0. Unknown totals use indeterminate progress. Before installation handoff, cancel stops the attempt and leaves the app installed as it was; quit cancels and exits. Failed attempts keep the window open with retry and manual download. Technical errors are recorded in the main-process log; the window provides concise recovery text without a prominent filesystem path. During handoff, disable repeated actions; never display “migration complete” or “upgrade complete.”

Phase one automatically installs 2.1.0 only when the legacy source is positively identified as compatible with the bridge. Existing `legacy` classification alone does not establish that fact. Add a read-only prerequisite classification from the historical version record, using the real historical format and tested version ordering. A missing, malformed, conflicting, or unsupported record cannot enable automatic installation. For known 1.9.11-or-earlier profiles, the Global Windows x64 portable build offers one-click installation and relaunch into the signed 1.9.12 portable release when it can reopen the adjacent data directory. Other older or uncertain profiles retain the manual 1.9.12 step. The action stages both signed releases before exiting. The portable updater waits for 1.9.12 to record startup in the selected profile and exit successfully, then replaces it and launches 2.1.0 from the same path. An unsuccessful exit or missing startup record leaves 1.9.12 in place.

After launch, 2.1.0 owns migration and its existing recovery UI. Once migration finishes, users use that release's normal update flow to obtain the latest version. Returning automatically to the exact originating build is out of scope: the old executable does not implement a new handoff protocol. Do not leave a background helper, scheduled task, or marker claiming that the round trip has completed.

### Platform contract

| Installed form | Proposed first-phase path | Required packaged evidence |
| --- | --- | --- |
| Signed macOS app installed normally | `MacUpdater`, using the matching ZIP rather than DMG | Native x64/arm64, Rosetta, signing identity compatibility, replacement and launch |
| Windows NSIS installation | `NsisUpdater`, preserving installation directory and edition | x64/arm64, translated x64, elevation cancellation, install and launch |
| Linux AppImage | `AppImageUpdater`, only for the actual writable AppImage | x64/arm64, executable replacement and launch |
| Linux deb/rpm | `DebUpdater` / `RpmUpdater`, selected by the packaged `package-type` marker; use package-manager downgrade support | Package database reports 2.1.0, elevation failure stays recoverable, launch and migration |
| Windows portable | Patched `PortableUpdater`, replacing the launcher at the same path after verified staging | Both architectures, signer continuity, locked files, rollback and launch |
| Unknown Linux form, unpackaged development build | Existing manual download instructions | Correct version/edition/architecture; no automatic replacement |

Global and CN must stay in their current edition. Architecture selection uses the existing native-architecture rule, including translated processes; never select the first asset as a fallback. A cross-architecture replacement is enabled only after packaged acceptance proves its installer and profile compatibility; otherwise offer the appropriate manual installer. Missing artifacts, unavailable native updater support, or unverified profile continuity select the manual path with a concise reason.

The Linux package extension is authorized in the implementation conversation. Match manual downloads to the detected package format as well, including the historical 1.9.12 filenames. Extend the existing updater patch so RPM installation distinguishes downgrades from upgrades; do not implement package-manager commands in application code.

### Ownership and dependency boundary

Keep the existing read-only gate in `src/main/core/preboot/legacyUpgradeGate.ts`. Add a session-scoped bridge installer beside the existing legacy upgrade modules in `src/main/data/migration/`. It owns one updater instance, cancellation token, state, and event subscriptions, and is disposed with the preboot window. It is not registered as a normal lifecycle service because its entire lifetime precedes bootstrap and ends with this gate.

Instantiate the platform updater from the installed `electron-updater` package; do not initialize `AppUpdaterService`, mutate its singleton, or extract an application-wide update framework for this one flow. The existing service reads Preference and depends on WindowManager, SchedulerService, and NotificationService. Downloading itself requires none of them. Use `loggerService` and registry-owned paths; a minimal `AppAdapter` supplies cache/config paths and the existing application quit integration without inventing another application lifecycle.

The updater cache must be separate from normal update downloads and from legacy profile data. Resolve it through a dedicated path registry key under the application-owned cache location. The adapter also redirects updater-owned bookkeeping such as `.updaterId` into that isolated location, not the legacy profile. No SQLite, Preference, migration-status, Chromium storage, or legacy config writes are allowed. Compare the discovered profile with what 2.1.0 will actually reopen: custom-path and install-mode continuity are eligibility requirements, not assumptions. Do not rewrite legacy configuration to make the bridge find a different profile.

### Fixed artifacts and verification

Use a small checked-in target manifest generated from the official 2.1.0 release metadata: exact version, edition, OS, architecture, installer kind, URL, and SHA-512. For each eligible target, a minimal provider uses the library's supported custom-provider extension to expose exactly one pinned artifact. Reuse the library's downloader, checksum validation, cache verification, signature checks, and installer. Do not implement ZIP extraction or application replacement in application business code, modify updater private fields, or add a local metadata server.

A generic fixed-tag feed was considered first. It supplies existing metadata but does not itself enforce a single edition/architecture target or an immutable expected checksum. The installed updater's file selection uses `process.arch`, whereas the product selects native architecture on translated hosts. An explicit pinned provider supplies the product contract without patching dependency selection behavior. Reuse library metadata types; reject any missing/mismatched target rather than selecting another version.

Configure `autoDownload = false`, `autoInstallOnAppQuit = false`, and instance-local `allowDowngrade = true`: the running build is newer than the bridge. Use full downloads for this one-off transition. Download starts only after the explicit action. Preserve Windows publisher verification and macOS signing requirements; checksum mismatch, signature failure, or unavailable trust information must not proceed to installation. Fixed HTTPS URLs and embedded hashes constrain the selected artifact; this is not a claim of signed release metadata on Linux.

### State, IPC, and exit

The main process owns `idle → preparing → downloading → verifying → installing`; pre-handoff failures go to `failed`, cancellation returns to `idle`, and retry creates a fresh attempt. Only one attempt runs. Serialize attempts, give each a cancellation token, and remove its listeners before retry so late progress/completion cannot update the next attempt. Throttle progress events and provide a current snapshot on renderer reload.

Extend the existing isolated preboot IPC with start, cancel, snapshot, and state events. The renderer sends intents, never URLs, paths, versions, or updater settings. Preserve sender, main-frame, and origin validation. Native close before handoff cancels and exits without installing; `autoInstallOnAppQuit` remains disabled throughout. Remove attempt listeners on terminal failure/cancel and all IPC/window listeners on exit.

Installation handoff is distinct from ordinary window completion. Refactor the gate's current unconditional `application.quit()` so it cannot race `quitAndInstall()` or tear down the macOS native updater's staging server. The updater controls successful installation exit. Keep the error listener and window available until handoff is actually committed; an observable installer-start failure restores retry/manual actions. After the process exits, installer or power failures cannot be reported by this window; the next launch re-runs read-only detection. There is no automatic rollback or destructive cleanup of user data.

### Evidence and implementation sequence

Repository inspection on 2026-11-11 confirmed `electron-updater` 6.7.0, direct platform updater constructors, the custom-provider extension, cancellation/download events, and the normal service's lifecycle dependencies. The official 2.1.0 release contains both editions, both architectures, macOS ZIP files, and updater metadata; the macOS and Windows metadata include SHA-512 values. Presence does not prove installation, signer compatibility, or profile continuity.

First prove the pinned provider and downgrade handoff in disposable packaged installations with synthetic legacy profiles. Gate enabled platform/forms on those results. Then connect the existing UI, add explicit scoped contract tests, and run packaged acceptance before enabling the action in shipping builds. No real user installation or data is replaced during development verification. Update the implemented retirement note only when this proposal actually changes shipped behavior.

### Implementation evidence and remaining release gate

The user approved extending the existing electron-updater 6.7.0 patch. Custom AppAdapters now retain the Electron download transport, and MacUpdater exposes `dispose()` to remove its own native listeners and close its staging server after download settlement. Application code uses these public capabilities without accessing private updater fields.

The implementation includes a 24-target manifest (Global/CN, x64/arm64, macOS/Windows/Linux), isolated cache and bookkeeping, serialized cancel/retry, renderer progress, and updater-owned exit. The manifest comes from official `v2.1.0` metadata and portable asset bytes checked against release SHA-256 digests. Automatic eligibility excludes unpackaged builds, translated processes, and non-portable Windows installations without publisher verification metadata. Custom profiles and portable/deb/rpm forms are included; portable signature verification occurs before exit. Unknown or pre-1.9.12 history makes the 1.9.12 prerequisite the primary action.

Scoped tests exercise session cancellation, verification failure, retry, late events, native listener disposal, custom-adapter transport, IPC guards, and handoff exit protection. These are not proof of replacing a signed application. Packaged installation, signing compatibility, restart into 2.1.0, and migration remain release-blocking acceptance work on all three operating systems; AC5 is not complete. Do not treat this implementation branch as release-ready on the strength of unit or renderer tests.

### Custom profiles and portable installation extension

The user approved extending one-click installation to custom data directories and Windows portable builds. This supersedes the earlier exclusions and the blanket prohibition on application replacement: portable replacement belongs in the existing electron-updater dependency patch, not application business code.

Before installer handoff, persist the selected profile under the normalized executable key in BootConfig. The released 2.1.0 reads the same mapping. No user data is copied and no legacy config is rewritten. Download/cancel does not write the mapping; persistence failure prevents installation, and observable handoff failure restores the prior mapping. Keep the executable location and edition unchanged.

PortableUpdater reuses the pinned download and checksum pipeline. Its hidden PowerShell worker stages the portable EXE beside the original, verifies SHA-512 and valid matching Authenticode publisher subjects, then signals readiness before the app quits. It waits for the application and launcher file lock, renames the old EXE to a backup, replaces it, and launches from the same location. Replacement/start failure restores and launches the backup; the worker records post-exit errors beside the cached download. It never touches the adjacent data directory. Missing or invalid signatures fail closed with retry/manual recovery. A hidden command host launches PowerShell with redirected pipes. The PowerShell worker can outlive the updater’s Windows job. After the worker signals readiness, the updater acknowledges the handoff on stdin before quitting. EOF without acknowledgment cancels replacement. Windows native replacement acceptance remains required and must not be inferred from mocked tests.

## Alternatives considered

- Keep browser downloads only: smallest implementation, but leaves the requested installation work to the user; retain it as fallback.
- Start or reuse `AppUpdaterService`: pulls normal lifecycle/settings into a gate that must run before them and risks changing regular update configuration.
- Generic fixed-tag feed without target filtering: simpler, but cannot encode the required pinned native-architecture artifact contract alone.
- Custom download-and-replace scripts: duplicate installer, signature, permission, restart, and OS-specific failure handling already owned by the library.
- Restore conversion in the current build or automate the entire historical-version chain: reverses migration retirement or requires a protocol absent from already-published versions.

## Acceptance criteria

- AC1 — Only prerequisite-compatible profiles and validated installed forms expose automatic bridge installation; unsupported/uncertain cases retain actionable manual instructions. (verification: unit; owner: legacy profile/platform tests)
- AC2 — A user action selects the required version or sequence (1.9.12 then 2.1.0 for eligible older portable profiles) with matching edition, native architecture, installer kind and pinned checksum; wrong/missing targets never fall through to another asset. (verification: unit; owner: bridge provider tests)
- AC3 — Download, verification failure, cancel, retry, duplicate clicks, late events and renderer reload produce consistent visible state, with reachable footer controls and no duplicate installation. (verification: renderer and unit; owner: preboot window/session tests)
- AC4 — Checking, downloading, cancellation and pre-handoff failure leave legacy profile bytes unchanged and do not bootstrap normal services or create a database. (verification: Electron; owner: isolated preboot fixture checks)
- AC5 — Each enabled packaged platform/form installs and launches 2.1.0, reopens the intended default/custom profile, and allows its migration to finish; edition, architecture and signing continuity are evidenced. (verification: packaged artifact; owner: desktop release validation)
- AC6 — Quit never installs accidentally, successful updater handoff is not interrupted by gate cleanup, and observable installer-start failure leaves recovery available. (verification: unit and packaged artifact; owner: preboot lifecycle tests and desktop release validation)
- AC7 — The compact window remains aligned and usable with progress, errors and long translations in light/dark themes; text distinguishes installation from migration and explains the later normal update. (verification: renderer and Electron; owner: legacy upgrade UI validation)
- AC8 — The bilingual Spec, affected reference documentation and localized strings match delivered scope, and record platform exclusions and unverified paths explicitly. (verification: docs gate and i18n; owner: implementation author)

## Risks

Historical macOS signing identities, Windows publisher changes, translated-process replacement, custom profiles, and filesystem permissions can prevent in-place installation despite valid metadata. Unsupported combinations must remain manual until evidenced. Download failure preserves the installed app, but power loss after installer handoff can leave the application requiring manual repair; no atomic cross-platform rollback is promised. The old release's migration and subsequent update remain separate user-visible stages. Published assets may become unavailable; fixed hashes prevent silently accepting changed binaries but cannot ensure availability.
