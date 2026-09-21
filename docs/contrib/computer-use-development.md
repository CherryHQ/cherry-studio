---
description: Computer Use SDK setup, Agent tools, task ownership and tray stopping before npm distribution
sources:
  - src/main/services/ComputerUseService.ts
  - src/main/services/TrayService.ts
  - src/main/ai/tools/computerUse.ts
  - src/main/ai/mcp/servers/computerUse.ts
  - src/main/core/paths/pathRegistry.ts
  - src/shared/ipc/schemas/computerUse.ts
  - src/renderer/pages/settings/ComputerUseSettings.tsx
---

# Computer Use development

This development slice connects the native SDK to permission settings, ordinary chat tools and local Claude/Pi/DSH Agent tools. Cherry owns runtime lifecycle, application ownership and user-stop state. A packaged runtime and a dedicated Computer Use scripting API remain pending; ordinary tools work with Code Mode disabled.

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

The junction setup is for a fresh checkout. Copy the rebuilt executable again after changing the runtime; the SDK junction follows its checkout automatically. The helper copy avoids requiring file-symlink privileges. On Windows, **Settings → Computer Use** should return the platform's empty permission list; enable desktop control separately to expose the Cherry tools. These branches still need local setup before CI/install and do not yet package native helpers.

## Permission flow

Open **Settings → Computer Use**. Loading or refreshing the page only queries permission state. Selecting a permission button explicitly requests that permission through the native helper. On macOS, grant access to the **Open Computer Use** helper shown in System Settings; Cherry's own screen-recording permission is a separate identity. Development builds use the **Open Computer Use (Dev)** name.

The macOS SDK opens the existing native onboarding window and a draggable helper app tile beside System Settings. An accepted drag immediately dismisses the panel and ends the SDK guide. Complete any remaining system confirmation there; Cherry rechecks the actual grant with a new helper. **Done** and the window close button also end the guide. Dismissing without granting is allowed. The helper remains alive during this interaction; the request defaults to a five-minute deadline and supports cancellation.

Completing the guide refreshes the status in Cherry. Each query or request uses a fresh private helper session and closes it in `finally`; a request stays pending until the guide ends, so the helper cannot disappear during a drag. A later query observes grants without restarting Cherry. The SDK guide does not restart or terminate the protocol process itself. Concurrent permission calls are serialized. Shutdown cancels in-flight work, waits for cleanup, and prevents queued prompts from launching. These short onboarding sessions are separate from Agent task sessions, which retain snapshots across tool calls.

Only a native `granted` result is displayed as granted. macOS preflight cannot distinguish all ungranted states and currently reports `unknown`. Windows/Linux return an empty permission list, which means no OS permission flow is implemented; it does not establish desktop availability or authorize an Agent task.

Keep the helper bundle path and signing identity stable when validating macOS grants. Rebuilding an ad-hoc signed helper may require granting permissions again. Runtime distribution, signing, ASAR-external resources, and packaged application validation remain pending.

The user reported successful testing of the existing runtime slice on all three platforms on 2026-09-21. That report does not cover this new host integration or future cursor/input capabilities. An enabled macOS System Settings toggle alone does not prove that a rebuilt helper matches its earlier grant; verify the signing identity when investigating permission regressions.

## Agent control and stopping

Enable **Settings → Computer Use → Allow agents to control desktop applications**. This persistent grant defaults to off and is independent of OS permissions. Disabling it immediately revokes tool execution and closes current tasks. Channel-linked Agent sessions and sealed built-in agents cannot access desktop control.

The ordinary chat tools are `computer_list_apps`, `computer_open_app`, `computer_get_app_state` and `computer_click`. Claude/Pi/DSH consume the same implementation through their existing in-process tool bridge under `computer`. Only semantic left clicks are exposed. Observation never activates an application and actions never enable global input. Screenshots reach the model as image content alongside snapshot and element IDs. Completed actions with unavailable observations remain completed; uncertain effects must not cause automatic replay.

Each chat run or Agent turn lazily starts one private SDK/runtime and can own multiple applications. Host-created task handles never come from model parameters. Chat completion, failure and cancellation close the runtime. Agent terminal/idle and connection-close events also release tasks, even when the Agent connection stays warm. Permission onboarding retains separate short sessions.

- An application stays exclusively owned across observation and action, until stop or task cleanup is confirmed. `TrayService` displays each application and its conversation/Agent owner, with single-app and stop-all actions. The tray remains available while control or stopped-owner entries exist, even when the ordinary tray preference is off.
- Protocol v2 supplies `openAppSession`, `listAppSessions` and `stopAppSession`; observations/actions require an `appSessionId`. Request cancellation and task-level close are separate. Rebuild both SDK/helper and restart Cherry after updating the link; old v1 helpers fail the handshake.
- Native stopping bypasses the action queue, rejects new work, and waits for cleanup confirmation. Stopping automation does not quit the user's application. Tray shows stopping until confirmation; uncertain cleanup retains the application reservation and disables execution.
- Cherry retains user-stop state in memory per conversation/Agent session across calls, turns and SDK recreation. Only **Allow control again** in the tray clears it. After stop-all, start a new turn; allowing control does not revive an ended task or old snapshots. Unconfirmed cleanup cannot be cleared through that menu. Resume is not an Agent tool.
- Software cursors, held input, typing, scrolling, movement and dragging remain future capabilities. The fork's `docs/design-docs/computer-use-runtime.md` owns the native contract. X11 and Wayland capabilities require separate validation.

## Host integration acceptance

With desktop control enabled, ask a local chat or Agent to list applications, open a test application, observe it and click a harmless element. While it is controlling two applications, stop one from the tray: the other should remain usable. Retry the stopped target in the same conversation and a later turn; both must remain blocked until the user allows control again. Stop-all must close every task, including helpers still starting. A new turn must observe again because old sessions and snapshots are invalid.

Disabling desktop control must stop ongoing work, including on warm Agent connections. Completing/cancelling a turn must release its helper without terminating the target app. Test these host behaviors separately from the fork's native desktop fixtures.

## Checks

```sh
pnpm test:main src/main/services/__tests__/ComputerUseService.test.ts src/main/services/__tests__/ComputerUseService.control.test.ts src/main/ai/mcp/servers/__tests__/computerUse.test.ts src/main/ai/tools/adapters/aiSdk/builtin/__tests__/ComputerUseTools.test.ts
pnpm test:renderer src/renderer/pages/settings/__tests__/ComputerUseSettings.test.tsx
pnpm lint
pnpm docs:check
```

The fork additionally owns SDK package tests, native protocol tests and real desktop fixtures. Permission tests do not prove that screenshots or input work; run the fixture after the user grants access.
