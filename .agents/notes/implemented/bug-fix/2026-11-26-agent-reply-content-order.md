# Agent Note: Preserve Agent reply content order

Status: implemented

English | [中文](2026-11-26-agent-reply-content-order.zh.md)

## Problem

In [#25407](https://github.com/CherryHQ/cherry-studio/issues/25407), stage descriptions appeared after the tools they preceded. The live renderer collected intermediate text after process history. The settled renderer scanned backward from the last prose and could pull both sides of an `AskUserQuestion` into the result area after Stop. The saved parts already had the correct order.

## Decision

Run ownership and Turn lifecycle remain with the host. The shared renderer uses each assistant row's ordered parts and stable part IDs. The live and settled layouts render contiguous groups of tools and reasoning in source order, with visible prose splitting groups in place. Interactive question cards stay at their own positions, and search reads the same inline text projection as the settled renderer. [Live layout](../../../../src/renderer/components/chat/messages/blocks/addressedPartLayout.ts) · [Settled layout](../../../../src/renderer/components/chat/messages/blocks/messagePartLayouts.ts) · [Message search](../../../../src/renderer/components/chat/messages/list/messageSearch.ts)

## Alternatives considered

- Restrict the backward scan after Stop. This leaves the live layout able to move intermediate text past tools.
- Add a final-answer marker to all three harnesses. The renderer can preserve chronology using the ordered parts it already receives.

## Consequences

Agent keeps intermediate prose visible. In a view that disables intermediate prose, text followed by further ordinary process activity remains in the expandable process group at its original position. An uninterrupted content tail and explicitly inline results stay visible. Several groups can replace a single disclosure. Adjacent prose and process groups use the same vertical spacing, and the reply's elapsed time appears once. [Process grouping](../../../../src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx) · [Disclosure](../../../../src/renderer/components/chat/messages/blocks/MessageProcessGroup.tsx)

## Verification

- Regression — Focused renderer suites: 167 tests passed across part layouts, message rendering, process groups, and message search. Coverage includes addressed live updates, Stop, and a question followed by more tools.
- Regression — Electron: real DeepSeek Flash read two sample files in Claude Code, Pi, and Pi Durable, with the correct narration and tool order visible after completion and reopen. Scripted Stop and reopen passed on all three harnesses.
- Regression — Electron: replaying the same saved Pi Durable run on the baseline and fix reproduced the reorder and verified the correction. The collapsed Claude Code example measured five equal 8 CSS px gaps after the fix.
