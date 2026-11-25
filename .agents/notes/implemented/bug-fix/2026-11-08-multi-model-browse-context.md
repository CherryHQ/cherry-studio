# Agent Note: Browsing a multi-model reply is not a context-selection action

Status: implemented

English | [中文](2026-11-08-multi-model-browse-context.zh.md)

## Problem

The fold-view model selector and the context action shared one handler. Switching the visible reply therefore moved `topic.activeNodeId` through that reply. When the same group also had a later sent turn, the visible conversation switched to that reply's branch, so the later turn appeared to disappear. Browsing and instructing the next request to use a reply are separate user intents.

## Decision

Changing the visible reply in fold view updates only the group's `foldSelected` UI state and selected reply. It does not call `setActiveBranch` or change `topic.activeNodeId`. The explicit context action continues to call `setActiveBranch`, and navigation that changes the active branch continues to select that branch's visible reply.

## Alternatives considered

- Keep the shared handler and add visual markers: this makes the new intent visible but still moves the active path while the user only browses.
- Remove active-branch-to-view synchronization: this would also break explicit branch navigation, where the visible reply should follow the selected branch.

## Consequences

Browsing another model reply in fold view no longer changes the active path or the context indicator. Explicitly choosing an answer for context keeps the existing branch-switch behavior. The UI cache records the active reply alongside the browsed selection so remounting restores that selection only if the active reply is unchanged, and follows branch navigation otherwise. Mounting and subsequent selection changes reconcile the cached selection with the visible reply, clearing stale selections so later navigation cannot restore them. This cache is temporary and does not survive an application restart. Rapid explicit context selections remain serialized.

## Verification

- Regression — `pnpm test:renderer src/renderer/components/chat/messages/__tests__/MessageGroup.test.tsx src/renderer/pages/home/__tests__/ChatContent.test.tsx`: browsing another reply in fold view preserves the active context indicator without calling `setActiveBranch` across streaming updates, restores the browsed reply on remount when the active branch is unchanged, follows branch navigation when changed while unmounted, and does not restore a stale browsed reply after the active reply changes while mounted or unmounted and navigation returns to the original branch.
