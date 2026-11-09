# Agent Note: Apply permission-mode switches to the running turn

Status: implemented

English | [中文](2026-11-09-immediate-permission-mode-switch.zh.md)

## Problem

Permission mode lives on the Agent and can be changed from the composer during a conversation. The Claude Code, Pi and Pi Durable runtimes all froze a mode change for the active turn and applied it only when the next user message reconciled the connection. The Claude driver justified this with the claim that the SDK `set_permission_mode` control request could terminate work already in flight.

The composer showed the new mode at once while the running turn kept approving, or skipping approval for, tool calls under the old mode. Switching from Full Access back to Ask Before Acting did not stop the turn's next tool call from running unattended.

The claim did not hold for the pinned SDK. A scripted local Messages API drove the SDK 0.3.311 CLI through mode switches between tool calls (default → bypass → default, bypass → default → bypass, default → plan → default, plan → bypass → plan), during a pending `canUseTool` decision and during a running Bash tool. Every turn completed successfully and each next tool call followed the new mode. The CLI's headless handler only replaces the tool-permission context; it issues no interrupt.

## Decision

Connection `reconcile` applies a permission-mode change immediately on all three runtimes, including during an active turn, so it governs the turn's next tool call:

- Claude Code enables the SDK launch capability for switching into Full Access. It starts in the configured mode and publishes a new local approval mode only after the SDK confirms `setPermissionMode`. Catalog refreshes update tool availability independently.
- Pi and Pi Durable replace the mode their approval gate reads on every tool call and call `permissionModeChanged()`, which wakes the behavior package's idle driver; the driver still acts only when the conversation is idle.
- Disabled-tool handling is unchanged: an active turn only adds newly disabled tools.
- An approval already waiting for the user keeps waiting; it is not re-decided under the new mode.
- A failed live apply returns `failed`, and the host fails closed by pausing the turn and closing the connection.

The composer applies ordinary switches directly from the menu and from Shift+Tab. Full Access keeps its scope confirmation in every state.

## Alternatives considered

- Keep the deferral: the visible mode and the enforced mode disagree for the rest of the turn, in both the loosening and tightening directions.
- Confirm ordinary switches during active turns: interrupts direct mode changes, including the Shift+Tab Plan toggle. The requester chose to keep confirmation for Full Access only.
- Re-decide pending approvals under the new mode: guard-rule `ask` decisions must survive Full Access, but pending approvals do not record their source. Deferred until that provenance exists.
- Apply immediately on Pi but keep Claude Code deferred: runtime-dependent semantics for one Agent setting.

## Consequences

A mode change reaches every live session of the Agent, including sessions running in other windows.

A rejected live apply now pauses the running turn instead of surfacing at the next message. If a future SDK makes `set_permission_mode` interrupt a turn, the Claude Code integration regression stops completing its turn and fails.

## Verification

- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts`: with the real SDK subprocess, a mid-turn bypass → default switch refuses the next Bash call and default → bypass runs it; both cases fail on the deferring driver.
- Regression — `pnpm test:main src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`: a mid-turn switch in either direction changes whether the turn's next write asks for approval; fails on the deferring connection.
- Regression — `pnpm test:main src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`: the same two directions for Pi Durable; fails on the deferring desktop host.
- Regression — `pnpm test:renderer src/renderer/components/composer/tools/definitions/__tests__/permissionModeTool.test.tsx`: ordinary mode selections apply directly, while Full Access requires confirmation and cancellation keeps the current mode.

The five affected main-process test files (including `ClaudeCodeRuntimeDriver.test.ts` and `AgentSessionRuntimeService.test.ts`) passed 309 tests. `pnpm typecheck:node`, `pnpm typecheck:web`, `pnpm i18n:check`, `pnpm docs:check` and scoped Oxfmt, Oxlint and ESLint passed.
