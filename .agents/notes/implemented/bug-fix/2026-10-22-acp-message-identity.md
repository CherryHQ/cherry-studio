# Agent Note: ACP native message identity

Status: implemented

English | [中文](2026-10-22-acp-message-identity.zh.md)

## Problem

ACP message chunks can carry an opaque native message ID. The adapter discarded it and merged consecutive text chunks even when their native IDs differed. History therefore lost both native identity and the boundary between those messages.

## Decision

End the current content part when the reported native message ID changes. Text and reasoning parts retain the ID in `providerMetadata.acp.messageId`; other ACP content retains it in `data-acp-content.data.messageId`. Missing and null IDs mean no attribution and never inherit the preceding ID. Tool and content-type boundaries continue to split parts, so one native message can occupy multiple parts.

Cherry message UUIDs remain the local identity. The existing `agent_session_message.data.parts` JSON stores native attribution without new columns or migrations. Native IDs are not global deduplication or replay keys; native history loading continues to suppress replayed content.

## Alternatives considered

- Replace Cherry UUIDs with native IDs: native IDs are opaque, optional and scoped to the Agent's history, while existing references require Cherry identity.
- Add one native ID column per row: a Cherry assistant reply can contain several native messages.
- Reuse native IDs as stream part IDs: a native message can span tools and content types, and reusing a completed part ID risks conflating separate segments.

## Consequences

Agents that omit IDs keep the existing grouping behavior. Mixed identified and unidentified chunks form separate parts to avoid false attribution. The change preserves content order and native IDs in history; it does not import native history or create additional Cherry reply rows.

## Verification

- Regression — `src/main/ai/runtime/localAgent/__tests__/messageIdentity.test.ts` drives a real ACP fixture process through the AI SDK stream reader and production-migrated SQLite storage, covering changed/repeated IDs, missing/null IDs, empty chunks, tool and rich-content boundaries, consecutive turns and history round trips.
- Electron — A controlled ACP process verifies actual chat persistence, page reload, connection release/resume and distinct Cherry UUIDs without renderer errors. This is not real-provider acceptance.
