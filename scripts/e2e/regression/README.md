# Regression controller

This directory owns the CI controller for the [Playwright regression scenarios](../../../tests/e2e/regression/README.md).
It controls only the application recorded in its isolated run directory; it never discovers or stops a developer's Electron instance.

The separate [on-demand QA controller](../ondemand/README.md) reuses the ref, installation, and lifecycle functions for one temporary test on one selected platform. Its reports and task selection remain independent from regression runs.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `cases.ts` | Case IDs, titles, task tags, phases, required capabilities, and selection |
| `cli.ts`, `phases.ts` | CLI entry points and one Playwright invocation per selected phase |
| `installation.ts`, `artifacts.ts` | Release installation, asset selection, and hashing |
| `macRuntime.ts` | Isolated Developer ID signing for macOS development notification tests |
| `windowsNotificationShortcut.ts` | Register the SDK shortcut with the Windows shell and remove the unchanged owned copy |
| `lifecycle.ts` | Start, reuse, restart, and stop the owned application |
| `mockProvider.ts`, `mockWorker.ts` | Start, verify and stop the run-owned aiMock service |
| `process.ts` | OS process identity, ancestry, ports, and termination |
| `debugBridge.ts`, `cdpClient.ts` | Explicit main-process debug operations and HTTP callback delivery |
| `systemAutomation.ts` | Native dialogs and notifications, external text selection, and keyboard input |
| `macPermissionObserver.jxa` | Scoped OS permission prerequisites on disposable hosted macOS runners |
| `RegressionReporter.ts` | Playwright result adapter and run-state updates |
| `RedactionReporter.ts` | Redact configured credentials before other Playwright reporters serialize steps and errors |
| `state.ts`, `report.ts` | Run state, platform/aggregate verdicts, and human-readable reports |
| `fixtureFiles.ts`, `paths.ts`, `config.ts` | Input fixtures, run-owned paths, and configuration |

Dependencies flow from CLI and E2E fixtures into these modules. The controller does not import E2E scenarios or production services.
The debug bridge may inspect the owned main process; it must never manufacture a successful product result.
Native save helpers are asynchronous so fixture HTTP servers keep serving while the application prepares an export.
The macOS save driver scopes accessibility controls to the owned PID, waits for folder navigation and filename
readback, then presses Save. Panel inspection skips file lists and web content. Native Swift scratch files
stay under the private run directory. Keyboard input requires that same application to own the foreground.
macOS notification lookups treat disappearing accessibility objects as absent; other automation errors still fail the case.
Scenario cleanup cancels only owned Windows file dialogs, preventing a failed export from intercepting the next case's save.
External-resource cleanup rechecks target ownership before closing windows or terminating processes. A recorded
window that gains unrelated content is preserved, and its ledger entry remains available for a later cleanup retry.
Process ownership requires a newly observed matching window; a new windowless process alone is not evidence.
Once verified, that process identity remains eligible for cleanup after its windows close.
macOS inspection retries disappearing accessibility objects only; permission and ownership failures still surface.
Process-group shutdown retains each verified member's PID, command and start time for bounded escalation after
the runner exits. A reused PID or an unknown orphan cannot inherit that proof.
After a normal development-app exit, cleanup allows its process group to finish naturally before
rechecking ownership. A surviving unknown process still blocks termination.
The explicit profile/restart operation prepares Windows connections by closing non-main windows before CDP attaches; simply locating a window does not perform this preparation. Both branch and installer launches enable the main-process inspector for this explicit compatibility step.
Windows native dialogs can expose their controls as UIA panes. The adapters match
native classes and control IDs inside owned windows, and verify address-bar focus
with Win32 `GetGUIThreadInfo` before sending the directory-navigation key.
Native dialog fixtures request normal Electron shutdown through their owned stdin
pipe before falling back to verified process-tree termination.
macOS multi-file selection uses the same version-aware panel driver as single-file
selection. It accepts only the complete contents of one isolated fixture directory,
so Select All cannot import an unrequested file. Native fixtures verify the returned paths.

Windows development notification checks keep `APPDATA` isolated. The controller prepares
the required shell directories and copies the SDK-generated shortcut into the real Start Menu
with an exclusive run-specific name. A persisted checksum protects unrelated or modified files;
the case and controller cleanup both remove the unchanged copy.

## Execution contract

Everything MCP uses `@modelcontextprotocol/server-everything@1.0.0`. The workflow
prepares it in the same run-owned npm cache used by the application. For a local
`all`, `mcp-skills` or `everything-mcp` run, prepare that cache before launch:

```sh
npm_config_cache=/absolute/run-directory/private/npm-cache \
  npm exec --yes --package=@modelcontextprotocol/server-everything@1.0.0 -- node --version
```

Manual runs accept any branch in the current repository or a `v*` release tag as
the `ref` input. The resolver pins it to an exact commit before either platform
checks out the application; fork references and raw commit SHAs are not inputs.
Ambiguous branch/tag names require `refs/heads/...` or `refs/tags/...`.

GitHub's **Use workflow from** selector chooses the controller branch, while `ref`
chooses the application under test. To validate workflow and test changes before
merging, select the PR branch for both, or use:

```sh
gh workflow run e2e-regression-test.yml --repo CherryHQ/cherry-studio \
  --ref feature/e2e-fix -f ref=feature/e2e-fix -f task=all
```

Branch runs prepare `download:binaries`, `rebuild:electron`, and `build:utility-process` once after installing
application dependencies. The controller then launches the development server directly,
including on profile switches and persistence-test restarts. Local controller runs must
perform the same preparation in the target checkout before `launch`; release installers
do not need it. Restarting preserves the owned application's profile. On Windows,
restart of a live instance requests `app.quit()` through its verified main-process inspector and waits
for normal shutdown so persistence tests do not simulate a forced crash. A shutdown
timeout fails the restart; it does not force termination and launch a replacement.
An already-exited launch is cleaned up with the same ownership checks before its replacement starts.
Branch launches invoke the checkout's dotenv and electron-vite entry points through Node,
so package-manager subprocesses cannot escape the owned process group. Each profile sets
`CS_DEV_PROFILE_ROOT` inside the run directory to isolate boot configuration, migration
state, user data, and logs from developer instances. Launches disable occluded-window
backgrounding so Playwright actionability checks keep receiving animation frames.
Profile-root startup also explicitly sets Electron's temporary directory before freezing
the path registry, because setting `TMPDIR` alone does not isolate that API on macOS.
Both branch and installer launches give the child a profile-owned home, Claude config
directory, Codex home, and temporary directory. Windows AppData directories are created there too. Code Mate
configuration writes therefore use the isolated profile's credentials
and settings rather than the developer's CLI configuration. Before each UI connection,
the controller verifies the owned process's home, temporary and CLI configuration paths
and Windows AppData path. It rejects an older running instance whose paths escape the profile.

For branch runs selecting `all`, the workflow closes the regression instance, builds the application,
then runs the standalone smoke suite with isolated per-test profiles and no retries. Each platform's
smoke HTML/JSON report is bundled separately and its counts appear in the aggregate summary.
A failed smoke run fails both platform and aggregate jobs; release-installer runs use the regression suite.

The workflow keeps one separately timed step per phase (21 today). Each calls `run-phase`; the controller intersects its phase with the run's selected task and returns immediately for unselected phases.
`cases.ts` is the execution manifest. Each case declares `tasks`: the first entry is
its module task, followed by any focused tasks. Module names follow the case library's
modules, using English kebab-case without execution-order prefixes. For example,
`notes` selects all implemented Notes cases across phases, while `notes-smoke` selects
only the create-and-save scenario. `knowledge` includes the library scenarios and the
`knowledge-smoke` persistence flow. Phase IDs use camelCase without numeric prefixes
and match `tests/e2e/regression/phases/<phaseId>.test.ts`. Their first occurrence in
the manifest determines execution order; workflow steps must follow that order.

The workflow task dropdown lists `all`, module tasks, then focused tasks. When adding a
task, update the workflow options too; the manifest tests enforce that the lists stay
in sync. Reports retain the selected task ID. Existing reports keep their recorded
task names and outcomes.
`native-settings` selects the native notification and startup/tray cases for focused
desktop verification. The complete Settings phase allows 40 minutes on hosted runners.

`run.json` schema version 2 records both cases and phases. The parent marks a phase running before starting Playwright; the reporter records test results and executor errors; a nonzero child exit also fails the phase.
A phase left pending/running becomes blocked during finalization. Passing cases cannot hide a failed or unfinished phase. Missing platform reports block the aggregate gate.
Only one phase writes a platform's run state at a time; keep `workers: 1` and sequential workflow steps.
The macOS and Windows jobs run in parallel; each platform keeps its own isolated run directory.
The native-adapter gate runs after run-state initialization and stores its JSON
results in the platform report, so an adapter failure still produces blocked-case evidence.
Hosted macOS images disable the Notification Center launch agent. The workflow reads its actual
plist label, records the GUI service's enabled/loaded state, enables it for native checks, and
restores the recorded state afterward. This preparation never runs on a developer's Mac.
On macOS, the workflow observes known runner and isolated-app requests for local-network access
and Terminal/System Events automation. The observer requires a GitHub-hosted environment and an
initialized directory below `RUNNER_TEMP`, records permission kinds and system process names,
and stops before app cleanup within the job's six-hour limit.
Windows notification checks open the real notification center and identify its foreground window by
native class, caption and shell process before obtaining its UIA tree from the window handle.
Notification clicks still use the actual visible notification and must return to the completed topic.
Windows process-identity queries hide their consoles so ownership checks do not steal native-dialog focus.
The save adapter sends its Unicode script through standard input, avoiding the Windows command-line limit.
Test names and generated report text use English. External errors and captured application content retain their original language. Keep `RedactionReporter.ts` first when selecting custom reporters so configured credentials are removed from steps and errors before JSON, HTML and blob serialization.

Capability requirements belong to cases. Missing required capabilities skip execution with an explicit reason and are recorded as blocked, never passed.
Capability probes are preflight checks, not evidence that a product interaction succeeded.

## Combined report

Initialize with `--provider-mode real` (default) or `--provider-mode mock`. Mock runs
call `mock-start --run-dir ...` before preflight and launch. The controller uses the
exact aiMock version in `package.json` and `pnpm-lock.yaml`, binds a free loopback
port, and records PID, token, port and version in `mock.json`. It verifies the worker
command, listener and authenticated identity before reuse. `mock-stop` and `cleanup`
stop only the recorded worker, including when application cleanup fails. Workflow
cleanup runs with `always()`; runner teardown remains the fallback on hard cancellation.

JSON, Markdown and JUnit reports retain the configured provider mode and mock version.
Mock verdicts use `mock_*`, including tag runs; they are not release acceptance.
Aggregation blocks missing provider provenance, mixed real/mock platforms, or evidence
that differs from the requested mode. Older reports without provider provenance must
be rerun. Cases using their own fixtures record `data-source` annotations, retained in
JSON and platform Markdown, even when the configured backend is real.

The aggregate job publishes `test-report`. Download and extract
it, then open `index.html` to browse every platform and phase in one HTML
report, including failures and attachments. The same artifact contains
`summary.md`. Only the aggregate job writes GitHub's summary: platform
counts, actionable case/phase issues, and a cross-platform case table. Full
platform reports, logs, fixtures, and generated files are bundled under
`evidence/macos` and `evidence/windows` without duplication in the summary.
After the complete bundle is uploaded, the aggregate job deletes only this run's
temporary `test-evidence-macos` and `test-evidence-windows` artifacts. If download,
assembly, or upload fails, temporary artifacts are retained for diagnosis.
When the platform jobs succeeded, an aggregate-only rerun can recover missing
temporary artifacts from the previous bundle. Failed platform jobs never fall
back to old evidence. Rerunning a job replaces its same-named artifact.

Each phase retains a blob report with a platform/phase-specific filename. The aggregate
job uses Playwright's built-in `merge-reports` with an explicit test root for cross-OS
paths. Bundled platform evidence retains raw logs and generated files. The JSON
aggregate verdict remains authoritative, including missing or interrupted phases.

## Verification

Media fixtures are checked in under `fixtures/media` and copied into each isolated run by `createFixtures`.
The MP4 is a generated five-second H.264 clip (320 × 180, 24 fps); the WAV is a one-second 440 Hz PCM tone
(mono, 16 kHz, 16-bit). They contain no third-party content. Desktop scenarios copy these files under
case-owned names instead of depending on a runner-installed media encoder.

- `pnpm exec vitest run --project scripts scripts/e2e/regression`
- `pnpm typecheck:e2e`
- `CHERRY_TEST_RUN_DIR=/tmp/cherry-regression-list pnpm test:e2e:regression --list`
- `pnpm lint` and `pnpm docs:check`

Enumeration does not launch Electron or require an initialized run. Full desktop acceptance still requires both hosted platforms and the aggregate gate.

## macOS development notifications

Electron's native notification API requires a Developer ID signed runtime. Before
launching a development run that includes `MP-110`, prepare a run-owned copy:

```sh
CHERRY_E2E_MAC_SIGN_IDENTITY="Developer ID Application: Your Identity (TEAMID)" \
  pnpm exec tsx scripts/e2e/regression/cli.ts prepare-mac-runtime \
  --run-dir /absolute/run-directory --target-root /absolute/checkout
```

This uses an already-installed local signing identity, preserves the checkout's
Electron download, and reuses the signed copy across profile restarts.
The copy has a workspace-specific application identifier and name, so notification
activation cannot select another development workspace with the default Electron identity.
That identity stays stable across runs and profile restarts. CI imports
`CSC_LINK`/`CSC_KEY_PASSWORD` into a temporary keychain for this step only, restores
the original search list, and removes its certificate files and keychain before
launch. The signed runtime stays under the isolated run directory, outside uploaded
reports and evidence. Remove the run directory after stopping the owned application
and archiving its redacted report.

For local notification runs, use a short run directory in a user-owned cache
directory. macOS can exclude applications under `/tmp` from application lookup,
preventing notification authorization. The scenario initializes the notification
backend and accepts only an Allow action whose permission card names the isolated
signed application; it never changes another application's notification settings.

Notification assertions open Notification Center and inspect only the unique case
text, so system banner preferences do not determine whether delivery is detected.
They still click the real system notification and verify conversation activation.
Windows checks use Action Center on Windows 10 and Notification Center on Windows 11,
verify the native panel's visibility, and restore its previous state during cleanup.
Collapsed notification stacks are expanded before locating and opening the matching notification;
expanding a stack alone is never reported as a successful notification click.
