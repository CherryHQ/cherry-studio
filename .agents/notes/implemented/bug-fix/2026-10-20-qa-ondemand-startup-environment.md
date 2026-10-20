# Agent Note: On-demand QA startup and environment

Status: implemented

English | [中文](2026-10-20-qa-ondemand-startup-environment.zh.md)

## Problem

[Hosted acceptance](https://github.com/CherryHQ/cherry-studio/issues/22069) exceeded the 60-second macOS development startup budget. Windows reports lost the workflow's `TZ`, and visibility assertions rejected selectors matching multiple elements. Git Bash's [native-process environment filtering](https://github.com/git-for-windows/msys2-runtime/blob/main/winsup/cygwin/environ.cc) drops IANA timezone values containing `/`; adding another workflow-level environment declaration does not fix that boundary.

## Decision

The [controller](../../../../scripts/e2e/ondemand/run.ts) uses one 120-second readiness budget for branch and tag modes. Before reporting or launching the application, it defaults an absent `TZ` to `Asia/Shanghai`; an explicit timezone is preserved. The existing native launch chain inherits that environment. `expectVisible` checks the first matching element, consistent with `expectText`.

## Alternatives considered

- A branch-only timeout increase was declined in favor of one budget for both modes; no new dispatch input is introduced.
- Keeping strict visibility selectors with a clearer error was declined in favor of first-match assertions. Actions and `waitFor` still require a unique match.
- Repeating `TZ` in step configuration leaves Git Bash's native-process filtering in place. Changing the runner's operating-system timezone would broaden the repair beyond the controller and its application.

## Consequences

An unready application can now take 120 seconds to fail with exit 3. A hidden first selector match still fails even if a later match is visible. Actual application timezones remain measured; setting the controller default does not manufacture a successful `requiredTimezone` check. Local verification does not establish hosted Windows/macOS acceptance.

## Verification

- Regression — `pnpm test:scripts scripts/e2e/ondemand/__tests__/cli.test.ts scripts/e2e/ondemand/__tests__/steps.test.ts scripts/e2e/ondemand/__tests__/environment.test.ts scripts/e2e/ondemand/__tests__/workflow.test.ts scripts/e2e/ondemand/__tests__/report.test.ts`: 22 tests pass, including a real controller subprocess with missing `TZ`, preservation of an explicit timezone, and unchanged timezone mismatch classification.
- Regression — a real Chrome page reproduces the old multi-match assertion failure and verifies first-match success, hidden-first failure, and missing-element failure after the repair.
