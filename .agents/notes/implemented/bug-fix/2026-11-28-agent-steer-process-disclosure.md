# Agent Note: Settle process disclosures at an Agent steer boundary

Status: implemented

English | [中文](2026-11-28-agent-steer-process-disclosure.zh.md)

## Problem

Process groups before a steer continued to render as active because their display segments shared the active Run's source ID. A group with finished tools stayed expanded until the whole Run ended, even though the next input had already been placed.

## Decision

Follow the ownership in the [Agent timeline Spec](../../proposed/architecture/2026-11-19-agent-session-timeline-and-context-transfer.md). The timeline reports whether a segment precedes the latest placed input of its Run. The shared renderer applies the existing completed disclosure to each earlier group when its parts settle and focus leaves the group. Both layouts use the normalized tool status to recognize pending approvals, active tools, and preliminary results.

## Alternatives considered

Using the last visible segment as the activity boundary would leave earlier groups open until new output arrived. Ending the segment's live subscription at placement would cut off late updates to tools still owned by that segment.

## Consequences

Finished groups can fold before the next reply starts. In-flight parts retain their subscriptions and original positions. Manual disclosure uses the segment and group identities. Inline prose stays visible, including after a paused Run is reopened.

## Verification

- Regression — `src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx`: a queued input leaves groups active, a placed steer folds the settled group, and the other group stays active through preliminary output and retains keyboard focus through the final result.
- Regression — `macOS Electron, Pi Durable and a local mock provider`: the previous process folds before post-steer output, and stopping and reopening the Run preserves the prose on both sides.
