# Electron Instance Management

Use this as the single runtime procedure for both `cherry-electron-dev` and
`cherry-pr-test`.

## Contents

- Session policy and scratch data
- Verify or discover an instance
- Bind CDP to the exact target
- Gracefully replace an instance
- Start and track a debug instance
- Finish or recover
- Troubleshooting

## Session policy and scratch data

Choose the caller's policy before touching Electron:

| Policy | Use | Finish |
| --- | --- | --- |
| `persistent` | Ongoing development | Leave a healthy instance running |
| `ephemeral` | A bounded PR test | Stop only the instance started by this test |

Treat pre-existing processes as user-owned. Preserve `userData`, databases,
caches, and preferences unless the user explicitly requests a reset.

Use `.context/cherry-electron-dev/` for runtime state and artifacts. The
repository ignores this path, and `mkdir -p` creates it in Conductor and
ordinary clones:

```bash
mkdir -p .context/cherry-electron-dev
```

Track the active instance in `.context/cherry-electron-dev/instance.json` with:

- workspace path and Git HEAD at launch
- `persistent` or `ephemeral` policy and `user` or `agent` ownership
- `launch_purpose` (`development`, `pr-test:<number>`, or `external`)
- `workflow_relation` (`started` or `borrowed`)
- Electron PID, runner PID/session, and process group
- CDP and main-process inspector ports
- exact main-window target URL
- development profile suffix
- launch command, log path, and start time

The file is a hint, not proof. Revalidate it before every UI operation.
At the start of a new workflow, an already-running instance is `borrowed` even
when the same agent launched it during an earlier instruction.

## Verify or discover an instance

Reuse the record only when all checks pass:

1. The Electron PID is alive.
2. Its cwd is the exact current workspace.
3. The recorded CDP listener belongs to that PID.
4. `/json/list` contains the recorded Cherry Studio target.
5. When exact checked-out code matters, the launch Git HEAD matches current
   HEAD; otherwise restart instead of relying on HMR for main-process changes.

```bash
lsof -a -p <ELECTRON_PID> -d cwd -Fn
lsof -nP -a -p <ELECTRON_PID> -iTCP:<CDP_PORT> -sTCP:LISTEN
curl -fsS http://127.0.0.1:<CDP_PORT>/json/version | jq .
curl -fsS http://127.0.0.1:<CDP_PORT>/json/list | \
  jq '.[] | {id, type, title, url}'
```

If the record is missing or stale, discover before launching:

```bash
ps -axo pid=,ppid=,pgid=,command= | \
  rg -i 'Cherry Studio|CherryStudio|electron-vite|remote-debugging-port'
lsof -nP -iTCP -sTCP:LISTEN | rg 'Electron|Cherry|:9222|:5173'
lsof -a -p <ELECTRON_PID> -d cwd -Fn
ps -o pid=,ppid=,pgid=,command= -p <PID>,<PARENT_PID>
```

Ignore candidates that cannot be tied to this workspace. A packaged app and
another checkout are not interchangeable. Never infer ownership from an open
port alone.

If a candidate passes every applicable check, adopt it immediately instead of
launching:

1. Attach to its verified CDP endpoint.
2. Write or refresh `instance.json` with its live identity and
   `workflow_relation: borrowed`.
3. Preserve a trustworthy existing policy and ownership. Without a trustworthy
   record, treat a pre-existing process as `user` owned and `persistent`.
4. End the launch path. Start another instance only when no suitable candidate
   exists or replacement is required.

## Bind CDP to the exact target

Use the verified CDP endpoint exclusively. List targets and match URL and
title; never assume target index `0`. The normal main target is titled
`Cherry Studio` and uses:

```text
http://localhost:5173/windows/main/index.html
```

If the dev server selects another port, require the same
`/windows/main/index.html` path and record the exact URL. Re-list after windows
open or close. Do not navigate a target unless navigation is part of the test.

Use Playwright/CDP or optional `agent-browser`. Do not install a global CLI just
for a task, and do not launch another instance because one controller is
unavailable.

Never pass `Electron`, `com.github.Electron`, or a `node_modules` Electron.app
path to Computer Use or another app-control API. Shared Electron identifiers
can launch or select the wrong checkout.

## Gracefully replace an instance

Replace only when current-workspace code or required CDP access is unavailable.
Before replacing a user-owned process, explain why and record its PID, command,
cwd, parent/runner, PGID, and ports.

Send `SIGTERM` to the exact Electron main PID and wait up to eight seconds:

```bash
kill -TERM <ELECTRON_PID>
for _ in $(seq 1 16); do
  kill -0 <ELECTRON_PID> 2>/dev/null || break
  sleep 0.5
done
kill -0 <ELECTRON_PID> 2>/dev/null && echo "still running"
```

If Electron exits but its verified same-workspace runner remains, terminate
that PID separately. Never use broad `pkill`, kill arbitrary port owners, or
signal a process group before inspecting every member.

Do not escalate automatically to `SIGKILL`. Report the remaining PID and logs
and ask before forcing a process that may be migrating, backing up, or
preventing quit. Verify the old PID and ports are gone before replacement.

## Start and track a debug instance

Read `package.json` for the current debug command. If its default CDP or
inspector port belongs to an unrelated process, choose free ports and change
only those arguments; do not kill the owner.

Prefer a managed terminal session. With a terminal tool such as
`exec_command`, request a PTY and short initial yield, retain its returned
session ID, and let this command continue:

```bash
pnpm debug 2>&1 | tee .context/cherry-electron-dev/electron.log
```

Do not run that command as an ordinary blocking call. If no managed-session
tool exists, use a recorded background runner:

```bash
nohup pnpm debug >.context/cherry-electron-dev/electron.log 2>&1 &
echo $!
```

Immediately record the returned runner PID. Resolve and record the real
Electron PID and PGID after launch.

Keep the existing development profile for `persistent` work. For an isolated
PR test, set a distinct `CS_DEV_USER_DATA_SUFFIX` and record it.

Wait for the selected CDP endpoint, then identify and record the exact target:

```bash
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:<CDP_PORT>/json/version >/dev/null && break
  sleep 0.5
done
curl -fsS http://127.0.0.1:<CDP_PORT>/json/list | \
  jq '.[] | {id, type, title, url}'
```

Write `instance.json` only after PID, cwd, listener ownership, and target checks
pass. Give a new instance `workflow_relation: started`; never reclassify a
borrowed instance as newly started.

## Finish or recover

For `persistent`, leave healthy user-owned and agent-owned instances running.
For `ephemeral`, stop an instance only when all of these are true:

1. Its verified record has `workflow_relation: started`.
2. Its verified record still says `ephemeral` and `agent` owned.
3. Its PID, cwd, and launch purpose still match the current test.

Leave every borrowed instance running, regardless of whether its existing
ownership is `user` or `agent`.

If an unexpected window or PID appears:

1. Stop UI actions.
2. Identify only the new PID by command and cwd.
3. Gracefully stop that verified unexpected PID.
4. Revalidate the tracked PID, cwd, CDP listener, and target.
5. Resume only through the tracked CDP endpoint.

Never close all Electron processes to recover from a targeting mistake.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| CDP works but the page is missing | Re-list targets and match URL/title; splash, migration, settings, detached tabs, and mini-apps are separate targets. |
| Debug launch exits | Inspect the recorded log for a profile lock, native rebuild, database/startup failure, or port collision; confirm the old PID exited. |
| Splash or migration is stuck | Read startup logs and wait; do not bypass, reset, or force-close without understanding its phase. |
| CDP automation is unavailable | Use logs/source when sufficient. If UI evidence is essential, explain why and use the replacement procedure; never fall back to generic Electron control. |
