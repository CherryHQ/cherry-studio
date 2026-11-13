# Agent Note: Fail fast when Claude Code has no Linux session bus

Status: implemented

English | [中文](2026-11-02-claude-code-linux-session-bus.zh.md)

## Problem

When Claude Code's final Linux subprocess environment has no `DBUS_SESSION_BUS_ADDRESS`, launching it can fail inside packaged `zypak` and close the Agent transport. Repeating the launch does not restore the missing desktop-session configuration and previously surfaced only a generic transport failure.

## Decision

Reject Claude Code environment construction on Linux when the final session-bus address is absent or blank. Preserve the existing desktop-process and login-shell address sources, but do not synthesize an address. The error carries app-owned translation keys with an actionable instruction to configure the launching desktop environment and restart Cherry Studio; it is raised before the SDK query can spawn a child.

## Alternatives considered

- Guess a bus socket from `XDG_RUNTIME_DIR` — rejected because the desktop session owns the address and a guessed endpoint may be wrong.
- Let `zypak` fail and report the closed transport — rejected because it repeats child launches and gives no configuration guidance.

## Consequences

An absent address now fails once per explicit request without launching Claude Code, so repeated requests cannot create repeated failing subprocesses. A non-empty address that points to an unreachable bus is not detected by this environment check and still requires packaged Linux validation.

## Verification

- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`: parent and login-shell addresses are retained; missing address returns the actionable setup error, and failed environment construction never starts a warm or cold query.
- Renderer — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`: the error title and recovery guidance render without AI diagnosis.
- Packaged Linux desktop verification was not run in this sandbox.
