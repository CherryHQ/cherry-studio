# Agent Note: Bound unattended Pi shell commands

Status: implemented

English | [中文](2026-11-12-pi-shell-default-timeout.zh.md)

## Problem

Pi shell commands without an explicit timeout could hold a turn indefinitely. A script can finish writing its output while an open connection or child process prevents it from exiting.

## Decision

Desktop Pi Bash and PowerShell tools supply a 120-second timeout when the call omits it. The native SDK still owns timeout validation, process-tree termination, partial output and error reporting. Explicit deadlines remain unchanged, including longer deadlines for intentional long-running work. The schema and description advertise the default.

## Alternatives considered

- A second watchdog would duplicate native cancellation and process ownership.
- Killing commands merely because they emit no output would interrupt legitimate silent work.
- Editing generated user scripts would not protect the next command.

## Consequences

An omitted deadline no longer waits indefinitely. Explicitly requested long deadlines can still wait longer. This is scoped to the ordinary Pi desktop runtime used by the affected sessions; Pi Durable has a separate execution owner. No new setting, retry, background execution or command blacklist is introduced.

## Verification

- Regression — `src/main/ai/runtime/pi/piShellTimeout.test.ts`: a real shell with an unfinished child times out and the child exits; explicit longer deadlines finish successfully; short and invalid deadlines retain native behavior.
