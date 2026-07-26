---
name: cherry-electron-dev
description: Develop, fix, and profile Cherry Studio in a tracked Electron instance. Use for everyday implementation, UI and interaction work, bug fixing, runtime debugging, DevTools inspection, lag or jank investigation, CPU and memory monitoring, leak checks, and startup-performance analysis; bind to the verified workspace CDP session, reuse it across instructions, and launch a dedicated debug instance only when required.
---

# Cherry Studio Development

Use this workflow for implementation, UI work, bug fixing, runtime inspection,
and performance analysis in the real Electron app. It does not check out PRs,
switch branches, review code, or produce PR test reports.

## Non-negotiable rules

- Attach first. Keep a healthy Electron window running across edits and user
  instructions.
- Bind every UI action to a verified workspace PID and CDP target. Never select
  a development instance by the generic Electron name or bundle identifier.
- Treat pre-existing processes as user-owned. Replace one only when current
  workspace code or required debugging access is unavailable.
- Before signaling a process, verify its PID, command, cwd, parent/runner, PGID,
  and listening ports. Never use broad `pkill`, kill every Electron process, or
  kill an arbitrary port owner.
- Preserve `userData`, databases, caches, and preferences unless the user
  explicitly requests a reset.
- Track ownership, Electron and runner PIDs/session, workspace, ports, target,
  command, start time, and log path in
  `.context/cherry-electron-dev/instance.json`.

## Workflow

### 1. Define the target

State the requested behavior and the evidence that will prove it: visible UI,
interaction result, renderer console/network/DOM state, main-process log,
persisted state, or performance metrics. Read relevant code and nearby README
files before editing.

### 2. Verify or discover the instance

Before every Electron UI operation, read
`.context/cherry-electron-dev/instance.json`. It is a hint, not proof. Reuse it
only when all checks pass:

1. The recorded Electron PID is alive.
2. Its cwd is the exact current workspace.
3. Its recorded CDP listener belongs to that PID.
4. `/json/list` contains the expected target, normally
   `http://localhost:5173/windows/main/index.html`.

```bash
lsof -a -p <ELECTRON_PID> -d cwd -Fn
curl -fsS http://127.0.0.1:<CDP_PORT>/json/version | jq .
curl -fsS http://127.0.0.1:<CDP_PORT>/json/list | \
  jq '.[] | {id, type, title, url}'
```

If the record is absent or stale, discover before launching:

```bash
ps -axo pid=,ppid=,pgid=,command= | \
  rg -i 'Cherry Studio|CherryStudio|electron-vite|remote-debugging-port'
lsof -nP -iTCP -sTCP:LISTEN | rg 'Electron|Cherry|:9222|:5173'
lsof -a -p <ELECTRON_PID> -d cwd -Fn
ps -o pid=,ppid=,pgid=,command= -p <PID>,<PARENT_PID>
```

Ignore candidates that cannot be tied to this workspace. A packaged app and
another Conductor workspace are not interchangeable. Never assume port `9222`
belongs to this app merely because it is open.

### 3. Control only the bound target

Use these options in order:

1. Attach exclusively to the verified workspace CDP endpoint.
2. If CDP is unavailable but logs/source are sufficient, leave the app running.
3. If UI/DOM/console/network access is essential, gracefully replace the
   verified development instance with a tracked debug instance.
4. Use Computer Use only for an explicitly requested packaged Cherry Studio
   app with a unique non-Electron bundle identifier.

Never pass `Electron`, `com.github.Electron`, or a `node_modules` Electron.app
path to Computer Use or another app-control API. Such calls can launch a
different checkout.

When using CDP:

- List targets and match exact URL and title; never assume target index `0`.
- For the main window, require URL
  `http://localhost:5173/windows/main/index.html` and title `Cherry Studio`.
- Re-list after opening or closing windows. Do not navigate an existing target
  unless navigation is part of the reproduction.
- Use Playwright/CDP or optional `agent-browser`; do not install a global CLI
  just for the task.

### 4. Replace only when required

Before replacing a user-owned process, explain why and record its verified
identity. Send `SIGTERM` to the exact Electron main PID, then wait up to eight
seconds:

```bash
kill -TERM <ELECTRON_PID>
for _ in $(seq 1 16); do
  kill -0 <ELECTRON_PID> 2>/dev/null || break
  sleep 0.5
done
kill -0 <ELECTRON_PID> 2>/dev/null && echo "still running"
```

If Electron exits but its verified same-workspace `pnpm`/`electron-vite`
runner remains, terminate that runner separately. Do not signal a process group
until every member is inspected. Do not escalate automatically to `SIGKILL`;
report the PID and logs and ask before forcing a process that may be migrating,
backing up, or preventing quit.

Verify the old PID and ports are gone, then launch from the current workspace
in a tracked long-lived terminal/session:

```bash
mkdir -p .context/cherry-electron-dev
pnpm debug 2>&1 | tee .context/cherry-electron-dev/electron.log
```

Resolve the real Electron and runner PIDs, then update `instance.json` with the
fields listed above and `agent` ownership. Keep the same development profile;
set an isolated `CS_DEV_USER_DATA_SUFFIX` only when the task requires separate
data.

Wait for CDP readiness and identify the target:

```bash
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:9222/json/version >/dev/null && break
  sleep 0.5
done
curl -fsS http://127.0.0.1:9222/json/list | \
  jq '.[] | {id, type, title, url}'
```

If `9222` is owned by an unrelated process, do not kill it. Read
`package.json`, choose a free port, and change only the debug port.

### 5. Develop and verify

1. Reproduce or inspect before editing.
2. Capture the smallest useful evidence.
3. Trace the responsible code path and make only the requested change.
4. Keep Electron running; use HMR and verify renderer changes in the same
   window.
5. Repeat the same scenario and compare before/after evidence.

Store temporary logs, screenshots, and profiles under
`.context/cherry-electron-dev/`, never source control. For UI work, inspect the
real window at the relevant size and theme. For renderer failures, inspect both
renderer and main-process evidence.

Restart only for a non-reloadable layer, crash, unreliable state, or explicit
startup profiling. Gracefully replace only the tracked instance, refresh
`instance.json`, and keep the replacement running.

Run the narrowest relevant validation and follow current user/repository
instructions for lint, formatting, and tests.

## Performance and DevTools

For lag, jank, high CPU, memory growth, leaks, slow startup, or explicit
DevTools use, read
[Performance Debugging](references/performance-debugging.md).

- Attach to the exact verified renderer target.
- Start with idle and repeatable scenario baselines.
- Use metric snapshots for orientation, bounded traces for stalls, repeated
  checkpoints for leak suspicion, and the main inspector only when renderer
  evidence is quiet.
- Save artifacts under
  `.context/cherry-electron-dev/performance/<timestamp>/`.
- Open the target's `devtoolsFrontendUrl` only when visible DevTools helps.
- Detach the profiling session afterward; never close the browser, page, or
  Electron process.

## Persistent handoff

Leave both reused user-owned instances and healthy agent-launched instances
running after the instruction. Stop one only for an explicit user request, a
required restart, or an unhealthy instance blocking progress. Never silently
restart a user-owned instance that stopped.

Report the reused/launched PID, whether it remains running, CDP port, tracking
file, evidence/artifact paths, reproduction, and verification.

## Wrong-instance recovery

If an unexpected window or main PID appears:

1. Stop UI actions.
2. Compare it with the tracked PID and verify the new PID's command and cwd.
3. Send `SIGTERM` only to that unexpected PID and wait for exit.
4. Revalidate the tracked PID, cwd, CDP port, and main target.
5. Resume only through the tracked CDP endpoint.

Never close all Electron processes to recover.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| CDP works but the page is missing | Re-list targets and match URL/title; splash, migration, settings, detached tabs, and mini-apps are separate targets. |
| `pnpm debug` exits | Inspect `electron.log` for a profile lock, native rebuild, database/startup failure, or port collision; confirm the old PID exited. |
| Splash or migration is stuck | Read startup logs and wait; do not bypass, reset, or force-close without understanding its phase. |
| CDP automation is unavailable | Never fall back to generic Electron control. Use logs/source, or explain why UI evidence requires graceful replacement. |
