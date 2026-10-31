# Agent Note: ACP cumulative session cost

Status: implemented

English | [中文](2026-10-22-acp-session-cost.zh.md)

## Problem

ACP reports cumulative native-session costs, while Cherry's usage ledger records individual provider invocations. Adding every ACP update to that ledger would count the same spend repeatedly. The reported currency can also fall outside the ledger's supported currencies.

## Decision

Keep a typed Main-authored snapshot in the existing `agent_session_message.data.localSessionCost` JSON: native session ID, report time, and either the original amount/currency or an unknown-cost marker. Updates replace the amount, including downward corrections and explicit zero. Missing or invalid reports leave the last known value intact. A different native session replaces it with an unknown marker; copied fork history drops it.

Shared cache carries live state. A read-only DataApi resource restores the latest persisted snapshot without starting the CLI. The usage details show session cost separately from context occupancy and invocation billing, preserving the reported currency. Very small positive costs have a display floor rather than appearing free.

## Alternatives considered

- Insert cumulative amounts into `ai_usage_record`: violates its per-invocation ownership and duplicates spending.
- Derive invocation deltas: native history, downward corrections, currency changes and missing reports make the result unreliable.
- Add a table or column: the existing message JSON can retain this optional snapshot without a migration.

## Consequences

No database schema change or currency conversion is required. Existing message cost projections and analytics retain their semantics. Renderer message writes cannot forge or clear snapshots. Before any message exists, costs remain runtime-only; the first assistant persistence retains them. This feature reports what the Agent provides and does not make it an invoice.

## Verification

- Regression — Protocol subprocess tests cover startup/resume reports, repeated/downward/zero amounts, extended metadata, missing/invalid costs and unrelated sessions. Production-migrated SQLite tests cover replacement, message-write protection, fork isolation and separation from invocation records.
- Regression — Renderer tests cover history restoration, read-model notifications, live updates, session switching, unknown/zero amounts and tiny positive amounts.
- Electron — A controlled ACP process verifies visible costs, page reload, connection release/resume and application restart. This is protocol/UI acceptance without model inference, not real-provider billing verification.
