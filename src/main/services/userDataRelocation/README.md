# userDataRelocation

Owns userData relocation end to end: validating a requested target directory, persisting the request, executing the copy/switch on the next launch, committing the new location, and driving the dedicated progress window.

"userData" means Electron's entire OS-level `app.getPath('userData')` tree, handled as one opaque unit (see `core/preboot/README.md` → Term: "userData"). A copy always covers the whole tree — there is no curated "user content only" subset.

## Execution model

Relocation gets a dedicated launch: the request is persisted to BootConfig, the app relaunches, and the next launch — with the previous process fully exited and the source tree quiescent — copies or switches the whole directory, commits, and relaunches into the new location. A relocation launch never continues into lifecycle bootstrap.

## Module map

| File | Role |
|---|---|
| `execution.ts` | `runUserDataRelocation()` — launch-time entry owning the whole flow: state read, sessionData isolation, copy/recover/rollback, commit, progress, window driving, relaunch |
| `request.ts` | run-time request face: `inspectUserDataRelocationTarget()`, `requestUserDataRelocation()` |
| `validation.ts` | shared path validation: request assertions, protected-tree rules, path primitives |
| `window.ts` | dedicated pre-lifecycle BrowserWindow controller |
| `types.ts` | domain aliases over the shared BootConfig schema |
| `index.ts` | barrel — the only import surface for code outside this directory |

Internal dependency direction (acyclic): `execution → validation, window, types`; `request → validation, types`; `validation → types`. Externally both faces depend downward on `core/preboot/userDataLocation` and `data/bootConfig`.

## Two faces and the BootConfig contract

| Face | Caller | Entry |
|---|---|---|
| Request (app running) | `ipc/handlers/app.ts` — the IpcApi boundary keeps only `isPackaged` policy + `IpcError` mapping | `inspectUserDataRelocationTarget`, `requestUserDataRelocation` |
| Execution (next launch) | `main.ts` preboot sequence — the only caller | `runUserDataRelocation` |

`temp.user_data_relocation`: request writes `pending`; execution reads it, discards stale requests, overwrites with `failed` on any error, and clears it on commit or on user-confirmed restart from the failed screen. `app.user_data_path`: the commit step writes it; `core/preboot/userDataLocation.ts` reads it when resolving userData on every launch. Both keys are validated against the shared zod schema at the BootConfig load/set boundary.

## Preboot-phase constraints

`runUserDataRelocation()` runs before `application.bootstrap()`; these constraints are intrinsic to that timing, not style choices:

- No lifecycle service exists yet — nothing on the execution path may use `application.get()`.
- The progress window bypasses WindowManager (`window.ts` builds a raw BrowserWindow) and installs an operation-scoped handler on the shared `IpcChannel.IpcApi_Request` channel — safe only because a relocation launch exclusively owns the process and never starts IpcApiService.
- A pending copy must redirect `sessionData` to a throwaway directory **before** the first `app.whenReady()` await, or Chromium starts writing into the source tree mid-copy.
- An error escaping before the window exists would hard-exit with no UI and replay the still-pending request on every launch — a boot loop. Every failure path therefore degrades to a persisted `failed` state, which the next launch only explains in the error window.
- A relocation launch returns to `main.ts` before `application.bootstrap()`, so it never consumes the path registry's earlier `app.session` snapshot.

## Relocation safety model

Relocation never merges into or clears an arbitrary directory. Copy mode accepts only a missing or empty target. A non-empty target may be selected only in switch mode; files already present there are left unchanged.

Each copy request has a unique task ID. Temporary work trees and promoted targets carry an ownership marker for that task, and recovery removes a tree recursively only when the marker matches. Unknown files, targets without the matching marker, and non-empty aside directories are preserved and make the operation fail safely. Source descendants, source ancestors, filesystem roots, and protected operating-system or application paths are rejected before any target mutation.
