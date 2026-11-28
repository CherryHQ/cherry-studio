# Agent Note: Subject-based topic groups

Status: proposed

English | [中文](2026-11-19-topic-subject-groups.zh.md)

## Problem

Topics can only be browsed by time or by assistant. The assistant is the last-used configuration, not the subject of a conversation, so one "study" assistant spans unrelated subjects (English, Python, fitness). Issue CherryHQ/cherry-studio#18237 asks for user-created subject groups that are independent of assistants.

## Proposal

Add a nullable `topic.group_id` column referencing the shared `group` table (`entityType: 'topic'`, `ON DELETE SET NULL`). A topic belongs to at most one subject group. The sidebar gains a `subject` display mode next to `time` and `assistant`.

- Membership is written through the existing `PATCH /topics/:id` (`groupId`), validated against `entityType: 'topic'`.
- Deleting a group ungroups its topics; topics are never deleted.
- Topics are grouped client-side from the existing topic list; no new list endpoint.
- Groups are created from the topic's "Move to Group" submenu, and renamed or deleted from the group header menu, through the existing `/groups` API.
- Cross-group drag is not supported in subject mode; reordering within a group keeps the global `orderKey` behavior.

## Alternatives considered

- Reuse `entity_tag` (topic tags): many-to-many, which fits topics about several subjects, but needs tag-based grouping and tag UI. Not chosen for this iteration because the issue asks for named, ordered subject groups.
- A separate topic-group table: duplicates the `group` abstraction. Rejected.

## Consequences

- One additive migration (`0042`). Drizzle's generated `ALTER TABLE` dropped `ON DELETE SET NULL`, so the SQL was corrected by hand to `REFERENCES \`group\`(\`id\`) ON DELETE set null`.
- A topic has one subject; multi-subject membership remains open for a follow-up using tags.
- The renderer `Topic` type and mapper carry `groupId`.

## Acceptance criteria

- AC1 — Users create, rename, reorder, and delete topic groups (verification: implementation)
- AC2 — A topic can be assigned to a group and moved between groups (verification: implementation)
- AC3 — Membership persists across restarts and backup/restore (verification: implementation)
- AC4 — Grouping is independent of the topic's assistant (verification: implementation)
- AC5 — Ungrouped topics appear in an "Ungrouped" section (verification: implementation)
- AC6 — Deleting a group does not delete its topics (verification: implementation)
- AC7 — The topic sidebar offers a subject display mode next to time and assistant (verification: implementation)

Reordering of groups (AC1) is not in the current implementation; it is an open item.

## Risks

- Group reorder (AC1) is not yet implemented; shipping without it leaves an acceptance gap.
- The hand-corrected migration SQL (`ON DELETE SET NULL`) can drift from Drizzle's generated DDL on regeneration.
- One group per topic may not fit multi-subject conversations; migration to tag-based membership would need a data move.

## Verification

- `drizzle-kit check` — passes.
- `vitest run` `TopicService.test.ts`, `GroupService.test.ts`, `topics.test.ts` — 149 tests pass, including group validation and FK ungrouping on group deletion (AC2, AC6).
- `vitest run` `topicsHelpers.test.ts`, `topicContextMenuActions.test.tsx`, `Topics.test.tsx`, `ConversationListOptionsMenu.test.tsx`, `useTopic.test.ts` — pass (AC4, AC5, AC7).
- `tsrs --noEmit -p tsconfig.web.json` — passes.
- Not yet verified: group reorder (AC1), backup/restore round-trip (AC3), and an Electron walkthrough of the sidebar.

## Open items

- Spec approval: the implementation was written before an `APPROVED` review and is a draft until approved.
- Group reorder (AC1) and backup/restore (AC3) verification.
