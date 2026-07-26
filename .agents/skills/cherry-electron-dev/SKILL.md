---
name: cherry-electron-dev
description: Develop, fix, and profile Cherry Studio in a tracked Electron instance. Use for everyday implementation, UI and interaction work, bug fixing, runtime debugging, DevTools inspection, lag or jank investigation, CPU and memory monitoring, leak checks, and startup-performance analysis; bind to the verified workspace CDP session, reuse it across instructions, and launch a dedicated debug instance only when required.
---

# Cherry Studio Development

Use this workflow for normal Cherry Studio development: implementing features,
building or refining UI, fixing bugs, inspecting runtime state, exercising
interactions, and verifying behavior in the real Electron app. It does not
check out PRs, switch branches, perform code review, or generate PR test
reports.

## Principles

- Attach first. Reuse an already running Cherry Studio instance whenever it
  provides enough access for the task.
- Bind every UI action to a verified workspace PID and CDP target. Never select
  a development instance through a generic Electron application name or bundle
  identifier.
- Treat processes started by the user as user-owned. Do not stop, restart, or
  replace them merely for convenience.
- Launch a dedicated debug instance only when the task requires CDP, renderer
  console/DOM/network inspection, main-process debugging, or code from the
  current workspace that the running instance is not using.
- Before signaling a process, verify its PID, command, working directory, and
  listening ports. Never use broad `pkill` patterns or kill every process on a
  port.
- Preserve app data. Do not delete or reset Electron `userData`, databases,
  caches, or preferences unless the user explicitly requests it.
- Track instance ownership: whether it existed before the task or was launched
  by the agent, its Electron PID, runner PID/session, workspace, CDP port, and
  log location.
- Treat a healthy Electron window as a persistent development session. Keep it
  running across code changes and user instructions instead of cleaning it up
  after each task.

## Prerequisites

- macOS
- `pnpm install` has completed for the current workspace
- `curl`, `jq`, and `lsof`
- CDP through Playwright or `agent-browser`

`agent-browser` is optional. Do not launch a second Electron instance solely
because that CLI is unavailable.

## Workflow

### 1. Define the development target

State the requested outcome, the behavior to implement or reproduce, and the
evidence needed to consider it complete. Read the relevant code path and nearby
README files before changing code.

Examples of evidence:

- visible UI state or interaction result
- renderer console error or failed request
- DOM style, geometry, or accessibility state
- main-process log or lifecycle event
- persisted state before and after an action
- DevTools metrics, trace events, CPU activity, or memory growth

### 2. Bind to the tracked instance

At the start of every instruction that reads or operates the Electron UI, check
`.context/cherry-electron-dev/instance.json` before using any UI-control tool.
Treat the file as a hint, not proof.

Reuse the tracked instance only after all checks pass:

1. The recorded Electron PID is alive.
2. `lsof -a -p <ELECTRON_PID> -d cwd -Fn` reports the exact current workspace.
3. The recorded CDP port is listening from that Electron PID.
4. `/json/list` contains the expected Cherry Studio target, normally
   `http://localhost:5173/windows/main/index.html`.

When these checks pass, attach directly to the recorded CDP endpoint. Do not
rediscover the app through macOS accessibility or application lists.

If the record is missing or stale, discover running instances before launching
anything:

```bash
ps -axo pid=,ppid=,pgid=,command= | \
  rg -i 'Cherry Studio|CherryStudio|electron-vite|remote-debugging-port'
lsof -nP -iTCP -sTCP:LISTEN | rg 'Electron|Cherry|:9222|:5173'
```

For each candidate Electron main PID, verify its working directory and parent
chain:

```bash
lsof -a -p <ELECTRON_PID> -d cwd -Fn
ps -o pid=,ppid=,pgid=,command= -p <PID>,<PARENT_PID>
```

If its command or working directory cannot be associated with this workspace,
do not signal it. A packaged Cherry Studio app or another Conductor workspace
is not interchangeable with the current workspace.

Look for a CDP port in the process command. Confirm it is really a DevTools
endpoint:

```bash
curl -fsS http://127.0.0.1:<CDP_PORT>/json/version | jq .
curl -fsS http://127.0.0.1:<CDP_PORT>/json/list | \
  jq '.[] | {id, type, title, url}'
```

Do not assume port `9222` belongs to Cherry Studio merely because it is open.

### 3. Control only the bound instance

Choose the least disruptive path:

1. If the verified workspace instance exposes CDP, use that CDP exclusively.
2. If it has no CDP and logs/source inspection are sufficient, leave it running
   and use those.
3. If a development instance has no CDP but UI control is required, follow the
   graceful replacement workflow and launch a tracked debug instance.
4. Use Computer Use only for an explicitly requested packaged Cherry Studio
   app with a unique non-Electron bundle identifier, never for a workspace
   development instance.

#### Never address a development instance as generic Electron

Do not call Computer Use with any of these targets:

- `Electron`
- `com.github.Electron`
- an `Electron.app` path from `node_modules`

Do not call any app-control API that may transparently launch the named app.
Development checkouts share Electron identifiers, so such calls cannot bind to
the recorded PID and may launch another checkout's default Electron window.

When using CDP:

- Connect to the confirmed HTTP endpoint or its `webSocketDebuggerUrl`.
- List targets before selecting one. Electron may expose the main window,
  splash/migration windows, DevTools, and mini-app webviews.
- Select the target whose URL and title match the behavior under test; do not
  assume target index `0`.
- For the main window, resolve the page by exact URL
  `http://localhost:5173/windows/main/index.html` and verify the title is
  `Cherry Studio` before clicking or typing.
- Re-list targets after opening or closing windows.
- Do not navigate an existing target to a new URL unless that navigation is
  part of the reproduction.

If `agent-browser` is installed, it may be used:

```bash
agent-browser connect <CDP_PORT>
agent-browser tab
```

Otherwise use the available Playwright/CDP control tool. Do not install a new
global CLI during the debug task.

### 4. Replace the instance only when required

Before stopping a user-owned instance, explain briefly why a dedicated debug
instance is necessary. Record its PID, parent/runner PID, PGID, working
directory, command, and ports so it is not confused with the replacement.

#### Gracefully stop the existing app

Send `SIGTERM` to the verified Electron main PID first:

```bash
kill -TERM <ELECTRON_PID>
```

Cherry Studio handles `SIGTERM` through its application lifecycle and allows
up to five seconds for service shutdown. Wait up to eight seconds and verify
that the exact PID exited:

```bash
for _ in $(seq 1 16); do
  kill -0 <ELECTRON_PID> 2>/dev/null || break
  sleep 0.5
done
kill -0 <ELECTRON_PID> 2>/dev/null && echo "still running"
```

If the Electron process exited but a verified `pnpm`/`electron-vite` runner
from the same workspace remains, send `SIGTERM` to that runner and wait again.
Do not signal an entire process group until every member has been inspected.

Do not automatically escalate to `SIGKILL`. A stuck app may be holding a
database migration, backup, or other quit-prevention operation. Report the
remaining PID and logs, then get explicit approval before forcing it.

Verify that the old PID is gone and its CDP/Vite ports are released before
starting the replacement.

#### Launch and track the dedicated instance

Use the repository's debug script from the current workspace:

```bash
mkdir -p .context/cherry-electron-dev
pnpm debug 2>&1 | tee .context/cherry-electron-dev/electron.log
```

Run it in a tracked long-lived terminal/session rather than an unowned
background process. The script starts Electron with renderer CDP on port
`9222` and main-process inspection enabled. Keep the terminal/session ID and
resolve the actual Electron PID after launch.

After launch, record the following in
`.context/cherry-electron-dev/instance.json` so a
later instruction or agent can rediscover and reuse the same window:

- workspace path
- Electron PID and verified runner PID/session
- CDP port
- main-window target URL
- launch command
- log path
- start time
- `agent` ownership

The live process and CDP endpoint remain the source of truth; validate the
record before reusing it and refresh stale PIDs rather than signaling them.

Do not change `CS_DEV_USER_DATA_SUFFIX` by default: using the same development
profile preserves the state being debugged, and the previous same-profile
instance has already been stopped gracefully. Use an isolated suffix only when
the task explicitly requires separate data.

Wait for CDP readiness:

```bash
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:9222/json/version >/dev/null && break
  sleep 0.5
done
curl -fsS http://127.0.0.1:9222/json/list | \
  jq '.[] | {id, type, title, url}'
```

If port `9222` belongs to an unrelated process, do not kill it. Read
`package.json`, choose an unused port, and run the equivalent debug command
with only the remote-debugging port changed.

### 5. Profile performance with DevTools

For lag, jank, high CPU, memory growth, leaks, slow startup, or explicit
DevTools requests, read
[Performance Debugging](references/performance-debugging.md) before collecting
data.

- Keep the validated Electron instance running and attach to its exact renderer
  target through CDP.
- Use a quick metric snapshot for orientation, a bounded trace for interaction
  stalls, repeated memory checkpoints for leak suspicion, and the main-process
  inspector only when evidence points outside the renderer.
- Capture an idle baseline and the same reproducible interaction window. Do not
  diagnose performance from one unbounded recording or a single CPU sample.
- Save generated profiles under
  `.context/cherry-electron-dev/performance/<timestamp>/`.
- Open the selected target's `devtoolsFrontendUrl` only when a visible DevTools
  panel is useful. Do not address or launch an Electron app to open DevTools.
- Performance collection must not close the CDP browser, page, or Electron
  process. Detach only the profiling session after collection.

### 6. Run the development loop

1. Inspect or reproduce the current behavior before editing when possible.
2. Capture the smallest useful evidence: logs, console messages, request
   details, DOM state, screenshots, or persisted values.
3. Trace the behavior to the responsible code path and identify the smallest
   implementation that satisfies the request.
4. Make only the requested, surgical change.
5. Keep the current Electron instance running. For renderer changes, wait for
   hot module replacement and verify in the same window.
6. Re-run the same reproduction and compare before/after evidence.

Store temporary screenshots and logs under `.context/cherry-electron-dev/`,
with
descriptive names. Do not add them to source control.

For UI work, inspect the real running app at the relevant window size and
theme. For renderer failures, check both the renderer console and main-process
log; do not infer the cause from one side alone.

For performance work, compare the same scenario before and after a change and
report both the raw artifact path and a short interpretation of the relevant
metric deltas.

Restart only when the changed layer cannot be hot-reloaded, the app crashes, or
runtime state makes the result unreliable. For a required restart, gracefully
stop only the tracked instance, relaunch it, update `instance.json`, and keep
the replacement running for the next instruction.

Daily development does not automatically authorize broad validation. After a
code change, run the narrowest relevant check and follow the current user and
repository instructions for lint, format, or tests.

## Persistent session and handoff

- If the skill reused a user-owned instance, leave it running.
- Leave a healthy dedicated instance launched by the agent running after the
  current instruction so later work can reuse its Electron window and CDP
  session.
- Do not close Electron merely because a code change or one user request is
  complete.
- Stop the tracked instance only when the user explicitly asks, a required
  restart is part of the development task, or it is unhealthy and blocks
  progress. Use `SIGTERM`, wait, and verify the exact owned PIDs exited.
- Do not silently restart a user-owned instance that was stopped. Restart it
  only when the user asks and the original workspace and command are known.
- Never stop other workspaces, packaged Cherry Studio, or unrelated processes.
- Report which instance was reused or launched, whether it remains running,
  its CDP port and tracking-file location, where logs/screenshots were saved,
  what reproduced the issue, and how the result was verified.

## Wrong-instance recovery

If an unexpected Electron window or new main PID appears:

1. Stop all UI actions immediately.
2. Compare current PIDs with the tracked PID and identify only the newly
   created process by command and working directory.
3. Send `SIGTERM` only to that verified unexpected PID and wait for it to exit.
4. Verify the tracked PID, workspace cwd, CDP port, and main target are still
   healthy.
5. Resume through the tracked CDP endpoint only.

Never close all Electron processes to recover from a targeting mistake.

## Troubleshooting

### CDP is reachable but the expected page is missing

List `/json/list` again. Splash, migration, settings, detached tabs, and
mini-app windows are separate targets. Match by URL/title rather than index and
wait for the main renderer to finish starting.

### The app exits immediately after `pnpm debug`

Check `.context/cherry-electron-dev/electron.log` for:

- another instance holding the same-profile single-instance lock
- a native dependency rebuild failure
- database migration/startup failure
- port collision

Confirm the old Electron PID actually exited before retrying.

### The app is stuck on splash or migration

Wait for startup logs before interacting. A migration window is expected for
some development profiles. Do not bypass, reset, or force-close a migration
without understanding its current phase.

### CDP automation is unavailable

Do not fall back to generic Electron Computer Use. Inspect logs and source when
that is sufficient. If UI, DOM, console, or network evidence is essential,
explain why a CDP-enabled instance is required, then follow the graceful
replacement workflow.
