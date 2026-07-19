# Preboot

Pre-bootstrap phase: code that must run **before** `application.bootstrap()`
is called.

## What is the bootstrap phase?

`application.bootstrap()` is the NestJS/Spring-style orchestration function
that builds the IoC container and runs the lifecycle stages
(Background / BeforeReady / WhenReady). It is the *only* meaning of
"bootstrap" in this codebase.

But some setup must happen even earlier — synchronously, with no lifecycle
services available — because `application.bootstrap()` itself depends on it.
Most importantly: `application.initPathRegistry()` is called from preboot
in `main/main.ts` after userData resolution, the single-instance lock,
and crash telemetry setup (Chromium flag setup runs later, at the top of
`startApp()` after the factory-reset gate). It calls
`buildPathRegistry()` to build a frozen snapshot of the path registry by
reading `app.getPath('userData')` and other Electron paths. So all
`app.setPath('userData', …)` calls must complete **before**
`application.initPathRegistry()` is called, and the registry must be
initialized **before** `application.bootstrap()` (which asserts the
registry exists and refuses to start otherwise).

This directory holds that pre-bootstrap work.

## Membership criteria

Code belongs in `core/preboot/` if **all** are true:

1. It must run before `application.bootstrap()` is called. Running before
   bootstrap is a **timing contract, not directory ownership** — this
   criterion is necessary but never sufficient on its own.
2. It is **non-removable**: the app cannot start correctly without it.
   Removable capabilities — even ones whose execution must happen during
   the preboot phase — live in their nature-home (e.g. `services/`) and
   are invoked from `main.ts` at the right point in the preboot sequence.
3. It only depends on Electron `app` top-level APIs and synchronously-loaded
   modules (e.g. `BootConfigService`, `loggerService`).
4. It directly performs side effects on global state (paths, command-line
   switches, file relocations) — or is a pure helper that supports a
   side-effecting preboot operation.
5. It does **not** depend on any lifecycle-managed service (anything
   accessed via `application.get(...)`). This is the real hard
   constraint: async preboot code is allowed when necessary, but
   depending on services that only exist after `application.bootstrap()`
   is not.

If any of these is false, the code belongs in a regular service under
`services/` or in a lifecycle-managed module.

## Vocabulary

The v2 main process has three startup phases. This is the preferred
terminology across the codebase — please don't introduce alternative names
without good reason.

- **preboot** — the phase this directory owns: setup code that must run
  before `application.bootstrap()` is called. Typically synchronous, but
  may be async when the operation cannot be expressed synchronously
  (e.g. a v1→v2 migration gate that awaits a DB probe). Preboot modules
  must not depend on any lifecycle-managed service — that is the real
  constraint, not whether the code awaits. This is what an OS or Linux
  developer would call "early boot" or "init phase 0". It is *not* a
  NestJS/Spring concept.
- **bootstrap** — the `application.bootstrap()` orchestration function
  (defined at `src/main/core/application/Application.ts:108`). It builds
  the IoC container and runs the lifecycle stages. NestJS/Spring-style
  terminology, applied consistently across `core/application/`,
  `core/lifecycle/`, and decorators. **Do not confuse** with the
  OS-level "bootstrap = early boot loader" — that meaning is what
  `preboot` covers. The path registry is initialized separately via
  `application.initPathRegistry()` from preboot, **not** inside
  `bootstrap()` — `bootstrap()` only asserts that the registry has
  already been initialized.
- **lifecycle stages** — the substages *inside* `application.bootstrap()`:
  `Background`, `BeforeReady`, `WhenReady` (defined in `core/lifecycle/`).
  These run after preboot and during bootstrap. They are not separate
  top-level phases.
- **running** — steady state after `application.bootstrap()` returns and
  the main window is shown.

The legacy file `src/main/bootstrap.ts` predates this vocabulary and uses
the OS meaning of "bootstrap". It is kept on disk during the v2 transition
as reference but is no longer imported anywhere; a follow-up cleanup PR
will delete it.

### Term: "userData"

Throughout `core/preboot/`, the word **userData** refers exclusively to
Electron's `app.getPath('userData')` directory — the OS-level directory
tree where Chromium and Electron persist their state alongside the
application's own files.

It does **not** mean "user data" in the colloquial sense (用户数据). The
Electron userData directory contains a mix of user content
(`cherrystudio.sqlite`, `Data/Files`, `Data/KnowledgeBase`, …) AND
Chromium runtime state (`Network/`, `Partitions/`, `IndexedDB`,
`Local Storage`, …) AND application logs (`logs/`). When this code talks
about "copying userData", it means copying the **entire OS directory** as
a single opaque tree — there is no curated "user content only" subset.

v1 used to distinguish "occupied dirs" (`logs`, `Network`,
`Partitions/webview/Network`, locked by the running process on Windows)
from the rest of userData and copy them in two separate phases: the
renderer copied the unlocked bulk while running, and the main process
copied the occupied dirs during the next startup's narrow "no renderer
yet" window. v2 abandons that distinction entirely — the whole directory
is copied at startup **after** the previous process has fully exited, so
nothing is locked. See `occupiedDirs` in
`src/renderer/pages/settings/DataSettings/BasicDataSettings.tsx` for the
deprecated v1 constant.

## Layout

```
preboot/
├── singleInstance.ts    claims Electron's single-instance lock and exits
│                        second instances. Runs after userData resolution so
│                        dev instances with different userData suffixes use
│                        isolated locks.
├── userDataLocation.ts  decides where userData lives (dev suffix or
│                        BootConfig-driven), performs relaunch copy; also
│                        exports the shared isUsableDataDir(p) validator
│                        (isDirectory ∧ R_OK|W_OK|X_OK) that the v1→v2
│                        migration path selector reuses for one identical bar
├── chromiumFlags.ts     Chromium startup flags (command-line switches and
│                        hardware-acceleration toggles) that must run
│                        before app.whenReady(). Invoked at the top of
│                        startApp() after factoryResetGate — it reads
│                        BootConfig values the gate may have just reset, so
│                        a reset session boots on the post-reset values
├── crashTelemetry.ts    crashReporter + process-level error hooks +
│                        webContents hardening (Document-Policy response
│                        header and unresponsive renderer call-stack
│                        collection)
├── factoryResetGate.ts  factory-reset gate (#17131); consumes the BootConfig
│                        `temp.factory_reset` marker at the top of startApp()
│                        — before backupRestoreGate, after the single-instance
│                        lock and the frozen path registry — wiping userData
│                        (except the process-held logs/ and Crashpad/ and the
│                        re-downloadable Runtime/ + Toolchain/ model artifacts)
│                        and CHERRY_HOME user state (config/, mcp/, trace/ +
│                        the OVMS model registry), then resetting BootConfig
│                        to defaults (keeping app.user_data_path). Directories
│                        whose shape makes a whole-tree pass too risky degrade
│                        to a manifest wipe: 'owned-manifest' (sentinel-proven
│                        near-root / ~/.cherrystudio: Cherry artifacts + v1
│                        artifacts + .claude/tesseract) or strict 'manifest'
│                        (no sentinel: Cherry-named artifacts only). Bounded
│                        retry: attempts AND the wipe-mode decision are
│                        durably recorded in the marker before each pass
│                        (cap 2; a pass never runs on unrecorded accounting,
│                        and retries reuse the recorded mode because the pass
│                        deletes the sentinel it derives from), critical
│                        delete failures relaunch straight back into preboot
│                        to retry — never a writable app on a pending marker
│                        — with the cap turning that into give-up: marker
│                        cleared, user warned, boot continues. The
│                        completed-wipe marker clear is a HARD persist — if
│                        that write fails the gate quits rather than arm a
│                        re-wipe of freshly created data.
├── backupRestoreGate.ts
│                        backup-restore gate; promotes a staged restored DB
│                        (if any) at the top of startApp(), after the
│                        single-instance lock and the frozen path registry,
│                        before v2MigrationGate reads the DB. Thin shell that
│                        never throws — except when recovery left no live DB
│                        at all (booting on would create a fresh empty
│                        database), where it fails fast instead. The
│                        promotion logic lives in src/main/data/db/restore/
│                        (same layering as v2MigrationGate → MigrationEngine).
├── v2MigrationGate.ts   v1→v2 migration decision gate; runs before
│                        bootstrap. Calls resolveMigrationPaths() to
│                        detect v1 legacy userData before engine init.
│                        Temporary — scoped for deletion once all
│                        users have migrated off v1. Its fat
│                        orchestrating-gate shape is tolerated only
│                        because it is throwaway — do not copy it for
│                        permanent capabilities.
└── __tests__/           unit tests for each sibling module
```

The directory is intentionally flat. New domains add a sibling file rather
than a subdirectory. Subdirectories are reserved for the case where one
domain genuinely needs multiple files.

### Development userData suffix

Unpackaged development runs never read packaged BootConfig relocation state.
Instead, `userDataLocation.ts` appends a suffix to Electron's default
`userData` directory before the path registry and single-instance lock are
initialized. The default suffix is `Dev`.

Set `CS_DEV_USER_DATA_SUFFIX` to run multiple development instances with
isolated app data and locks. Use `.env` for a persistent local default:

```bash
CS_DEV_USER_DATA_SUFFIX=DevQuito
```

Or pass it inline for a single dev process:

```bash
CS_DEV_USER_DATA_SUFFIX=DevQuito pnpm dev
```

The trimmed suffix is appended to the default path. Empty or whitespace-only
values fall back to `Dev`.

### No barrel export

`preboot/` intentionally has no `index.ts` re-export. Consumers must import
each function from its concrete module file:

```ts
import { resolveUserDataLocation } from '@main/core/preboot/userDataLocation'
import { configureChromiumFlags } from '@main/core/preboot/chromiumFlags'
```

Each preboot module has its own timing contract (`userDataLocation` must run
before `initPathRegistry`; `chromiumFlags` must run before `app.whenReady`).
A barrel export would fold away which function lives in which module — and
therefore which timing rules apply — making the preboot sequence in
`main/main.ts` harder to reason about. Importing from concrete paths keeps
the timing story visible at every call site.
