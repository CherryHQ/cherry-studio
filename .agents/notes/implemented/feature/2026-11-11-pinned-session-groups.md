# Agent Note: Pinned workspace and agent groups

Status: implemented

English | [中文](2026-11-11-pinned-session-groups.zh.md)

## Problem

Workspace groups could not be pinned, and pinned agent groups remained inside the ordinary agent section. Frequently used groups needed a common entry point without losing access to their tasks.

## Decision

Reuse the existing pins service for workspace entities. In workspace and agent views, move pinned groups into the top Pinned section with their expandable tasks. Keep separately pinned tasks independent of group pins, including when a group is unpinned. Empty pinned groups remain visible. Place pin and unpin commands in their own context-menu section.

## Alternatives considered

Keeping pinned groups at the top of their original section preserves the old agent behavior but splits frequent items across sections. Flattening group tasks into Pinned loses group identity and expansion. Both were rejected in favor of the user-selected common section.

## Consequences

Workspace deletion purges its pin within the same transaction and publishes pin invalidation after commit, including empty workspaces. Existing generic pin rows need no schema migration. Group dragging cannot cross pinned and unpinned sections. Time view continues to show individually pinned tasks only.

## Verification

- Regression — `Sessions.test.tsx`: pinned workspace and agent groups, empty groups, independently pinned tasks, section collapse, and unpin restoration.
- Regression — `workdirGroupActions.test.tsx`: pin and unpin execution, mutation-disabled actions, and unavailable workspace actions.
- Regression — `workspacePins.test.ts`: persistent workspace pin creation, removal, and cleanup on empty-workspace deletion using the production database migrations.
