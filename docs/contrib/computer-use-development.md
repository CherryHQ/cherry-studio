---
description: Local Computer Use SDK linking and helper permission verification before npm distribution
sources:
  - src/main/services/ComputerUseService.ts
  - src/main/services/TrayService.ts
  - src/main/core/paths/pathRegistry.ts
  - src/shared/ipc/schemas/computerUse.ts
  - src/renderer/pages/settings/ComputerUseSettings.tsx
---

# Computer Use development

This development slice connects the native Computer Use SDK to Cherry's permission settings. It does not yet expose Agent desktop tools or ship a packaged runtime. Code Mode remains a later, optional consumer; ordinary tools will use the same SDK independently of Code Mode.

## Local dependency setup

The SDK has not been published. This branch temporarily uses `link:./.context/computer-use-sdk`; it requires local setup before installation and is not ready for clean CI or release packaging. Replace the link with an exact npm version and regenerate the lockfile during distribution work. No machine-specific paths are stored in the manifest or lockfile.

Build the SDK and runtime in a separate `CherryHQ/cherry-computer-use` checkout, then link their outputs from this workspace. On macOS/Linux:

```sh
# Set this to your fork checkout; do not commit its value.
COMPUTER_USE_CHECKOUT=/path/to/cherry-computer-use
npm --prefix "$COMPUTER_USE_CHECKOUT" install
npm --prefix "$COMPUTER_USE_CHECKOUT" run sdk:build
# macOS: build the complete helper app.
(cd "$COMPUTER_USE_CHECKOUT" && ./scripts/build-open-computer-use-app.sh debug)
mkdir -p .context
ln -s "$COMPUTER_USE_CHECKOUT/packages/sdk" .context/computer-use-sdk
ln -s "$COMPUTER_USE_CHECKOUT/dist/Open Computer Use (Dev).app" .context/computer-use-runtime
pnpm install --frozen-lockfile
pnpm debug
```

On Linux, build the matching native executable using the fork's platform build instructions and point `.context/computer-use-runtime` to it. The SDK must be built before linking; Cherry imports only its public package exports.

### Windows checkout and testing

Check out both companion PR branches in sibling directories. In `cherry-computer-use`, use Node 24 and Go 1.23.4 or later from an interactive Windows PowerShell session:

```powershell
npm ci --ignore-scripts
npm run sdk:test
New-Item -ItemType Directory -Force dist/native | Out-Null
go -C packages/runtime-go test ./...
go -C apps/OpenComputerUseWindows test ./...
go -C apps/OpenComputerUseWindows build -trimpath -o ../../dist/native/open-computer-use.exe .
$env:COMPUTER_USE_RUNTIME_PATH = Join-Path $PWD 'dist/native/open-computer-use.exe'
node --test protocol/native.test.mjs
```

Run the real counter-window test using `protocol/fixtures/README.md` in that checkout. It covers screenshots, semantic clicks, stale/foreign references, app stop and independent runtime cleanup. Use Windows PowerShell (`powershell.exe`) for its WinForms fixture; keep the desktop logged in and stop if any build or test command fails.

Then, from the Cherry Studio checkout:

```powershell
$computerUseCheckout = (Resolve-Path ../cherry-computer-use).Path
New-Item -ItemType Directory -Force .context | Out-Null
New-Item -ItemType Junction -Path .context/computer-use-sdk -Target (Join-Path $computerUseCheckout 'packages/sdk')
Copy-Item (Join-Path $computerUseCheckout 'dist/native/open-computer-use.exe') .context/computer-use-runtime.exe
pnpm install --frozen-lockfile
pnpm debug
```

The junction setup is for a fresh checkout. Copy the rebuilt executable again after changing the runtime; the SDK junction follows its checkout automatically. The helper copy avoids requiring file-symlink privileges. On Windows, **Settings → Computer Use** should return the platform's empty permission list; desktop actions currently run through the SDK fixture, not Cherry Agent tools. These branches still need local setup before CI/install and do not yet package native helpers.

## Permission flow

Open **Settings → Computer Use**. Loading or refreshing the page only queries permission state. Selecting a permission button explicitly requests that permission through the native helper. On macOS, grant access to the **Open Computer Use** helper shown in System Settings; Cherry's own screen-recording permission is a separate identity. Development builds use the **Open Computer Use (Dev)** name.

The macOS SDK opens the existing native onboarding window and a draggable helper app tile beside System Settings. An accepted drag immediately dismisses the panel and ends the SDK guide. Complete any remaining system confirmation there; Cherry rechecks the actual grant with a new helper. **Done** and the window close button also end the guide. Dismissing without granting is allowed. The helper remains alive during this interaction; the request defaults to a five-minute deadline and supports cancellation.

Completing the guide refreshes the status in Cherry. Each query or request uses a fresh private helper session and closes it in `finally`; a request stays pending until the guide ends, so the helper cannot disappear during a drag. A later query observes grants without restarting Cherry. The SDK guide does not restart or terminate the protocol process itself. Concurrent permission calls are serialized. Shutdown cancels in-flight work, waits for cleanup, and prevents queued prompts from launching. These short onboarding sessions are separate from future Agent task sessions, which must retain snapshots across tool calls.

Only a native `granted` result is displayed as granted. macOS preflight cannot distinguish all ungranted states and currently reports `unknown`. Windows/Linux return an empty permission list, which means no OS permission flow is implemented; it does not establish desktop availability or authorize an Agent task.

Keep the helper bundle path and signing identity stable when validating macOS grants. Rebuilding an ad-hoc signed helper may require granting permissions again. Runtime distribution, signing, ASAR-external resources, and packaged application validation remain pending.

The local helper has now been rebuilt with a fixed certificate identity and its signature verified. Regrant access to this helper, then rebuild and restart it to verify that permissions remain valid. The earlier Accessibility diagnosis found a grant referencing an older ad-hoc build; an enabled System Settings toggle alone does not prove that the current helper matches the grant. Reauthorization, permission persistence and the macOS desktop fixture are still pending.

## App control sessions and pending host integration

The 2026-09-18 design decision adds per-app control contexts inside each Agent task's SDK/runtime session. It does not require a separate helper process for every app. Permission onboarding keeps its independent short sessions. The SDK and native contract are now implemented; Cherry task ownership, user-stop policy, Tray controls and cursor feedback remain pending. The detailed contract lives in the fork's `docs/design-docs/computer-use-runtime.md`.

- Cherry's main process owns task/app control ownership, coordination between tasks and the user's stop state. The existing `TrayService` will expose the active apps and their tasks, with controls to stop one app or all control tasks.
- Protocol v2 adds `openAppSession`, `listAppSessions` and `stopAppSession`; observation/actions require an `appSessionId`. Request-level `AbortSignal` and task-level `close()` remain separate. Rebuild both SDK/helper and restart Cherry after updating the local link; old v1 helpers fail the handshake. The SDK remains independent of Electron and Tray UI.
- Native runtime isolates snapshots and cancellation per app. Stop/state queries bypass the ordinary queue; stop cancels current work, rejects queued/new work and waits for cleanup confirmation. It stops automation, not the user's app; unconfirmed cleanup disables the runtime. Held input and software cursor cleanup will be added with those future capabilities. Tray must use this native result before reporting completion.
- Cherry retains the user-stop state across subsequent tool calls and SDK recreation. The Agent cannot automatically resume control after a user stops it. Ordinary tools use this same boundary with Code Mode disabled; script access remains a later integration.
- Software cursor feedback follows native execution and the target window. Reuse the fork's macOS overlay after moving its global state into app contexts; Windows and Linux need separate implementations and validation. Animation does not prove an action succeeded or provide independent OS input pointers.

The implementation order is stable macOS signing and real desktop verification, app-context contracts, Tray stopping, cursor feedback for supported clicks, then input/move/drag and broader platform/package validation. Acceptance must cover app isolation, rejected stale snapshots, stopping queued/running work, released input and overlay resources, and preventing automatic resumption after user stop. Global input still requires coordination, and X11/Wayland capabilities must be validated separately.

## Checks

```sh
pnpm exec vitest run src/main/services/__tests__/ComputerUseService.test.ts src/renderer/pages/settings/__tests__/ComputerUseSettings.test.tsx
pnpm lint
pnpm docs:check
```

The fork additionally owns SDK package tests, native protocol tests and real desktop fixtures. Permission tests do not prove that screenshots or input work; run the fixture after the user grants access.
