# Agent Note: Feishu knowledge onboarding

Status: proposed

English | [中文](2026-10-25-feishu-knowledge-onboarding.zh.md)

## Problem

Importing from Feishu requires creating an empty knowledge base first. Existing accounts hide the authorization entry, and Wiki-only wording obscures document links. Sync controls and embedding cost disclosure make the final decision harder to understand.

## Proposal

Offer blank creation and import from Feishu in the new knowledge base entry. Reuse the existing authorization, scope preview, creation fields, and sync services. Show name, optional group, and optional embedding model at final confirmation. Create the base only after confirmation; keep its identity and successfully created sources when retrying partial failures. Closing after a failed import retains the created base for recovery.

Expose an Add account action beside existing connections. Keep QR application selection first and manual credentials secondary. Give the application selector its own row, keep its popup within the trigger width, and show long application identifiers as secondary text. Use underline tabs for scope selection; an exhausted empty Wiki list displays the link form directly. Accept both document and Wiki links. Use a daily-sync switch, default off, and explicitly disclose that the embedding model provider may charge for indexing and subsequent updates.

This implements the onboarding direction confirmed in the workspace conversation. Remote retrieval and new credential/provider abstractions remain outside this change; credential ownership stays with the [shared credentials proposal](../architecture/2026-10-21-shared-connector-credentials.md).

## Alternatives considered

- Keep creation and import separate: preserves unnecessary navigation and empty bases on cancellation.
- Duplicate authorization and model selection: creates inconsistent account and model behavior.
- Roll back partially imported bases: risks removing successfully imported content; preserve and retry instead.

## Acceptance criteria

- AC1 — New knowledge base offers blank creation and Feishu import; existing-base import remains available (verification: renderer tests and Electron inspection; owner: implementation author)
- AC2 — Closing before final confirmation creates neither a base nor a source (verification: renderer test; owner: implementation author)
- AC3 — Failed source creation retries against the same base and skips successful sources (verification: renderer tests; owner: implementation author)
- AC4 — Existing accounts retain a visible Add account action; authorization reuses existing application selection (verification: renderer tests and Electron inspection; owner: implementation author)
- AC5 — Document/Wiki wording, optional daily sync, and embedding cost disclosure are visible and localized (verification: renderer tests, locale checks, Electron inspection; owner: implementation author)

## Risks

Base and source creation cross separate persistence boundaries. A base may remain when import fails; retain it, show the error, and allow retry. Real Feishu consent requires a user account and is separate from UI and adapter validation. Model dimension probing can incur provider usage and must happen only after confirmation.
