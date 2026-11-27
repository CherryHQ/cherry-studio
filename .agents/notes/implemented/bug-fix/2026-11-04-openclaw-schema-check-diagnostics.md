# Agent Note: OpenClaw schema check diagnostics

Status: implemented

English | [中文](2026-11-04-openclaw-schema-check-diagnostics.zh.md)

## Problem

Node warnings on stderr could obscure the actual schema command failure, and a nonzero exit code could reject a schema already returned by OpenClaw. Both were reported as binary incompatibility.

## Decision

Accept a captured top-level schema object regardless of exit code and log stderr as a diagnostic. Keep incompatibility for unsupported commands, malformed successful output, and truncated output. Other nonzero failures report the check, exit code, meaningful stderr, and detected version; probe the version only on that failure path when unavailable.

## Alternatives considered

Rejecting every nonzero exit code discards usable schemas. Treating every failure as incompatibility incorrectly recommends an upgrade for runtime failures.

## Consequences

A valid object is trusted even when the command exits unsuccessfully. stderr is scanned in warning blocks; error-shaped lines outside those blocks take priority, and warning-only output is labeled accordingly. Version probing uses the first non-warning line of stdout, falling back to stderr when it contains no version. It can add up to five seconds to a failed check; probe failures leave the original diagnosis intact.

## Verification

- AC1 — `node node_modules/vitest/vitest.mjs run --project main src/main/services/__tests__/OpenClawService.test.ts`: verifies valid schemas survive nonzero exits and schema failures include actionable diagnostics.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/services/__tests__/OpenClawService.test.ts`: preserves unsupported command, invalid JSON, and timeout behavior.
