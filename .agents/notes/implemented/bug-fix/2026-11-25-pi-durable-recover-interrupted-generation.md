# Agent Note: Resume Pi Durable generation after an unclean exit

Status: implemented

English | [中文](2026-11-25-pi-durable-recover-interrupted-generation.zh.md)

## Problem

The Pi Durable Harness used one retry switch for upstream model failures and generation interrupted by host exit. Disabling its upstream retries when Cherry's gateway took over also disabled crash recovery. After reopening, Durable recorded the interrupted turn as terminal and left the follow-up queued.

## Decision

The Durable dependency patch allows host-exit recovery independently of provider retries. Desktop enables it with the existing Durable retry budget and backoff. The shared gateway still handles upstream provider retries. [Provider retry policy](2026-11-19-subagent-retry-error-projection.md)

## Alternatives considered

Enabling all native retries would let the gateway and Durable both retry the same provider failure. Resubmitting the input from Main would bypass Durable's existing task and input identities.

## Consequences

On reopen, Durable resumes the interrupted generation from committed history, retaining completed subagent work. Once the turn settles, it can place the queued follow-up. Explicit Stop keeps its cancellation semantics.

## Verification

- Regression — `piDurableTurnAuthority.test.ts`: the macOS Electron case kills Main during partial output, reopens the same profile and verifies that the original and queued replies finish and the completed subagent report remains available.
