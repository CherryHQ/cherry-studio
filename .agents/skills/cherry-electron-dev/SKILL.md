---
name: cherry-electron-dev
description: Develop, fix, and profile Cherry Studio in a tracked Electron instance. Use for everyday implementation, UI and interaction work, bug fixing, runtime debugging, DevTools inspection, lag or jank investigation, CPU and memory monitoring, leak checks, and startup-performance analysis; reuse a verified workspace instance across instructions and launch or replace one only when required.
---

# Cherry Studio Development

Use this skill for ongoing work in the current checkout. Do not use it to check
out or report on PRs; use `cherry-pr-test` for that workflow.

## Required runtime workflow

Before reading or controlling Electron UI, read
[Electron Instance Management](references/electron-instance.md) and use its
`persistent` policy.

That reference is the only authority for instance discovery, `instance.json`,
CDP target selection, launching, replacement, shutdown, and troubleshooting.
Do not reproduce those procedures here or substitute generic Electron app
control.

## Development loop

1. State the requested behavior and the evidence that will prove it.
2. Read the relevant code and nearby README files.
3. Verify and reuse the tracked instance through the runtime reference.
4. Reproduce or inspect the current behavior before editing when practical.
5. Capture the smallest useful evidence: UI state, DOM, console/network output,
   main-process logs, persisted state, or performance metrics.
6. Trace the responsible code path and make only the requested change.
7. Keep Electron running. Use HMR for renderer changes and verify in the same
   window.
8. Repeat the same scenario and compare before/after evidence.

Inspect the real window at the relevant size and theme for UI work. Check both
renderer and main-process evidence for renderer failures.

Restart only for a non-reloadable layer, crash, unreliable runtime state, or
startup profiling. Use the reference's exact-instance replacement procedure,
refresh `instance.json`, and keep the replacement running.

Run the narrowest relevant validation and follow current user and repository
instructions for lint, formatting, and tests.

## Performance and DevTools

For lag, jank, high CPU, memory growth, leaks, slow startup, or explicit
DevTools use, read
[Performance Debugging](references/performance-debugging.md).

Store temporary logs, screenshots, and profiles under
`.context/cherry-electron-dev/`. Compare a quiet baseline with the same bounded
scenario before and after a fix. Detach profiling sessions afterward; do not
close the CDP browser, page, or Electron process.

## Handoff

Leave reused user-owned and healthy agent-launched instances running after the
instruction. Stop one only when the user asks, a required restart is part of
the task, or the instance is unhealthy and blocks progress.

Report the verified PID, whether it remains running, CDP port, tracking file,
evidence paths, reproduction, and verification.
