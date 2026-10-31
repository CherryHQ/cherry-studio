# Agent Note: Native Agent usage ownership

Status: implemented

English | [中文](2026-10-30-agent-usage-ownership.zh.md)

## Problem

Provider completion and native assistant-message publication are independent. Holding completed invocation records in memory until a response ID receives a message owner loses usage on process exit. Assigning every call to the current root reply misattributes delayed child continuations and native auxiliary requests.

## Decision

Persist completed invocations immediately with request-time session, source, pricing and credential snapshots. Native response IDs may subsequently fill the message link and refine session ownership to the child archive. This transaction also rebuilds the message usage projection. It cannot change amounts, tokens, prices, credentials or source, create a second charge, or replace an existing message owner.

Calls without a native assistant message remain session-owned. Desktop-owned Pi summary and verification requests capture their initiating owner before the gateway hop; child summaries carry the child's session without a parent message. Capture tokens are internal, session-bound and released after the request. The appended migration preserves existing records with unknown session ownership.

## Alternatives considered

- Buffer records until native correlation: rejected because process loss discards completed provider usage.
- Assign auxiliary usage to the last visible message: rejected because ordering does not establish ownership.
- Recalculate or reinsert the invocation when its owner arrives: rejected because request-time pricing and exactly-once counting must survive late correlation.

## Consequences

Amounts and request-time attribution stay immutable; native message correlation is a narrowly permitted enrichment. Session totals can include auxiliary calls absent from message totals. Historical rows are not backfilled from guesses. This remains best-effort observable usage analytics, not a provider invoice reconciliation system.

## Verification

- Regression — `AgentSessionUsageAttribution.test.ts` covers immediate persistence, both correlation orders, child message projection, session-only queries, close, late completion and duplicate binding without another charge.
- Regression — `ApiGatewayService.test.ts` covers delayed ownership, child summary ownership, cross-session rejection, credential restriction and capture release.
- Regression — Both Pi desktop connection tests carry native child response IDs through initial output and continuation to the child's product message.
- Regression — `agentUsageOwnershipMigration.test.ts` upgrades a populated production migration chain and preserves historical fee fields.
