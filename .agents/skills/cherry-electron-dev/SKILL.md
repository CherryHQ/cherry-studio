---
name: cherry-electron-dev
description: Develop, fix, profile, and test PRs in a tracked Cherry Studio Electron instance. Use for implementation, UI and interaction work, runtime debugging, DevTools inspection, performance analysis, and interactive PR verification with a test report. Reuse a verified workspace instance and manage its lifetime according to the selected workflow.
---

# Cherry Studio Development

## Choose the workflow

- For ongoing implementation, debugging, or profiling in the current checkout,
  follow the development loop below with the `persistent` runtime policy.
- For a bounded PR test, read [PR Testing](references/pr-testing.md) and follow
  that workflow with the `ephemeral` runtime policy. It covers PR checkout,
  interactive tests, reporting, cleanup, and restoration of the original branch.
- For code review without interactive app testing, use `gh-pr-review`.

## Required runtime workflow

Before reading or controlling Electron UI, read
[Electron Instance Management](references/electron-instance.md) and select the
policy for the chosen workflow. Preserve a borrowed instance's existing policy
and ownership.

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

## Development handoff

Leave reused user-owned and healthy agent-launched instances running after the
instruction. Stop one only when the user asks, a required restart is part of
the task, or the instance is unhealthy and blocks progress.

Report the verified PID, whether it remains running, CDP port, tracking file,
evidence paths, reproduction, and verification.
