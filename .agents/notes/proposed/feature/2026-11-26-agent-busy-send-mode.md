# Agent Note: Visible busy send mode selection for the Agent composer

Status: proposed

English | [中文](2026-11-26-agent-busy-send-mode.zh.md)

## Problem

When an Agent turn is running, the send control needs to make queue, steer, and interrupt available explicitly and report which action Main accepted.

## Proposal

Show a component-local selector for runtimes advertising all three `busySendModes` while the Agent is streaming. Hide it during editing and when `steerWhileBusy` applies. Queue is the default. The dedicated steer shortcut overrides the selection. Reset to Queue after an accepted interrupt, when the Agent becomes idle, or when the session changes. Include the selected mode in the trigger's accessible name.

Accept `busyMode` only for interactive Agent submits without legacy `followUp`. Show feedback from Main's `busyDisposition`. Steer reports submission acceptance. Native queues preserve the ownership rules in [Pi Durable follow-up queue](../../implemented/feature/2026-11-26-pi-durable-queue.md) and [Pi Durable turn authority](../../implemented/architecture/2026-11-18-pi-durable-turn-authority.md). Host fallbacks are read-only in the dock alongside reorderable native rows. The host saves waiting inputs as recoverable `paused` rows until native placement or local handling confirms receipt.

For a live turn, reserve the replacement user and assistant rows before invoking user Stop. Hold the Stop target's topic lock, with the root before the recovered topic if both are needed. Recheck the target after acquiring the locks. An idle request sends normally. A busy transition without a live target rejects the interrupt. Stop or activation failure repairs the pair atomically. The replacement user is recoverable as `paused` from reservation through reply linking, including after a crash before native binding.

## Alternatives considered

A persisted mode would carry interrupt selection across sessions. Automatically resending withdrawn follow-ups would defeat explicit Stop. Stopping before reservation could drop the replacement input on a crash.

## Acceptance criteria

- AC1 — Eligible runtimes advertise all three modes, the request and response preserve the selected mode and the receipt, and invalid combinations are rejected. (verification: shared and main Vitest)
- AC2 — Native and host queues return their own receipts. Native rows remain editable, reorderable and withdrawable, and host rows remain read-only with unsent recovery if the queue clears. (verification: main and renderer Vitest)
- AC3 — Explicit steer and the dedicated shortcut retain same-Run placement when the runtime places the input there. A queued fallback reports its actual destination. (verification: main and renderer Vitest)
- AC4 — Interrupt reserves the replacement before the retained user Stop, drains under the target lock, and preserves an unsent input through failure or a crash before native binding. Idle submissions skip Stop. (verification: main Vitest with SQLite)
- AC5 — The closed selector announces the selected mode, and availability and reset behavior match the Agent state across locales. Scoped lint, formatting, locale gates, both TypeScript projects, and the Electron smoke scenario verify the change. Round two passed the scoped Vitest, lint, formatting and locale checks. Both TypeScript commands exited nonzero (1 on the final run and 2 on earlier runs) with pre-existing diagnostics (10 Node, 2 web), including three on unchanged lines in two modified files. Electron and Playwright were outside the round-two run and remain unverified. (verification: renderer Vitest, static checks, and Electron)

## Risks

A native admission receipt can precede placement. Retained Stop and restart behavior are covered by targeted tests. The live Electron smoke scenario still needs verification.
