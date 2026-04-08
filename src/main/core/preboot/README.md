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
Most importantly: `application.bootstrap()` calls `buildPathRegistry()` at
its entry, which freezes the path registry by reading
`app.getPath('userData')`. So all `app.setPath('userData', …)` must complete
before `application.bootstrap()` is called.

This directory holds that pre-bootstrap work.

## Membership criteria

Code belongs in `core/preboot/` if **all** are true:

1. It must run before `application.bootstrap()` is called.
2. It only depends on Electron `app` top-level APIs and synchronously-loaded
   modules (e.g. `BootConfigService`, `loggerService`).
3. It directly performs side effects on global state (paths, command-line
   switches, file relocations) — or is a pure helper that supports a
   side-effecting preboot operation.

If any of these is false, the code belongs in a regular service under
`services/` or in a lifecycle-managed module.

## Vocabulary

The v2 main process has three startup phases. This is the preferred
terminology across the codebase — please don't introduce alternative names
without good reason.

- **preboot** — the phase this directory owns: synchronous setup before
  `application.bootstrap()` is called. This is what an OS or Linux
  developer would call "early boot" or "init phase 0". It is *not* a
  NestJS/Spring concept.
- **bootstrap** — the `application.bootstrap()` orchestration function
  (defined at `src/main/core/application/Application.ts:108`). It builds
  the IoC container, freezes the path registry, and runs the lifecycle
  stages. NestJS/Spring-style terminology, applied consistently across
  `core/application/`, `core/lifecycle/`, and decorators. **Do not confuse**
  with the OS-level "bootstrap = early boot loader" — that meaning is
  what `preboot` covers.
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
nothing is locked. See `packages/shared/config/constant.ts:occupiedDirs`
for the deprecated v1 constant.

## Layout

```
preboot/
├── index.ts             named exports only — no top-level side effects
├── userDataLocation.ts  decides where userData lives, performs relaunch copy
└── (future)             devMode suffix, command-line flags, etc.
```

The directory is intentionally flat. New domains add a sibling file rather
than a subdirectory. Subdirectories are reserved for the case where one
domain genuinely needs multiple files.
