# Agent Note: Show observed elapsed time beside a running Bash command

Status: implemented

English | [中文](2026-11-13-bash-card-observed-elapsed.zh.md)

## Problem

A Bash call that produces no output was indistinguishable from a frozen turn. The reply-wide process timer
measures the whole reply, so it cannot attribute the wait to a command, and the Bash card header showed only a
status word. The report that prompted this change showed two multi-minute gaps inside single commands. A
default limit cannot cover that case on its own: the runtime only applies its 120-second default when the call
omits a timeout, and explicitly longer timeouts stay valid, so a silent command may legitimately run for
minutes and still needs to look alive.

## Decision

The Bash card header shows an elapsed label while the command is executing, updating once per second, in the
collapsed header so it needs no expansion. Observation starts when the call becomes executing, not while its
arguments stream and not while approval is pending. The label is observation-only: it measures from mount, so
remounting a still-running card restarts it. No execution timestamp is propagated from the runtime.

## Alternatives considered

- Propagating a start timestamp would make reattachment accurate, but the runtime's start event carries no
  timestamp: one would have to be captured and carried through the projection, which adds persistent state for a
  case the report did not raise.
- A percentage or progress bar would be invented information; a silent command has no measurable progress.
- Reusing the reply-wide process timer would attribute the wait to the whole reply instead of the command.
- Warning on output silence would break legitimate quiet work, and the timeout already bounds runaway commands.

## Consequences

A silent command is visibly alive and attributable to one call. The counter is honest about its limits: after a
remount it reads from zero rather than claiming the command's true duration. Terminal and historical cards carry
no advancing clock. Two layout facts follow from the same row: a tool header that renders a command preview keeps
its activity phrase at intrinsic width and lets that preview truncate, and the status/elapsed cluster keeps its
own intrinsic width, wrapping only when the row is narrower than the cluster. Below that width — narrower than
the cluster plus the row gap — the header's overflow still clips the cluster rather than shrinking the elapsed
value.

## Verification

- AC1 — `AgentExecutionTimeline.test.tsx`: a silent invoking call shows an advancing label, preliminary output does not reset it, terminal states remove it, two calls keep independent clocks, and a remount restarts observation deliberately.
- AC2 — Real Electron run with a long command: the header row measured 540 px wide with its right edge at x=930 inside a 960 px window and the elapsed label painted at x=916…930, where before the change the row was 650 px wide ending at x=1040 with the label outside the viewport.
- AC3 — `piShellTimeout.test.ts`: aborting a real shell process tree that carries an explicit 600-second timeout rejects as `Command aborted` inside the settlement budget, leaves no surviving child PID and emits no post-wait sentinel.
- Regression — `MessageProcessGroup`, `PlaceholderBlock`, `toolResponse` and `AgentToolRenderer` suites stay green; this diff changes the spacing of a tool header, not the values those suites assert.
