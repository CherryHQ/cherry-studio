# Agent Note: Delete a conversation branch

Status: implemented

English | [中文](2026-10-29-delete-conversation-branch.zh.md)

## Problem

Trying another phrasing or model from the same message creates another branch, so the branch list grows with every attempt. A branch can be extended but never removed, and the only way to reclaim the space is deleting single messages or the whole conversation. Deleting one unwanted branch must not disturb the shared prefix or any other path.

## Decision

Branch Management offers deletion on a node whose persisted subtree leads to exactly one complete path. Deletion removes that path's exclusive suffix — the leaf plus its linear ancestors below the nearest fork — while keeping the nearest shared ancestor and every surviving alternative. Selecting a linear ancestor of the suffix deletes the same range, so a user does not have to find the terminal message. A still-empty reservation is deletable on its own without pruning its ancestors, through the existing `DELETE /messages/:id?awaitingInputOnly=true` route, which keeps the branch-cleanup flow working when nothing has been typed yet.

The rule is enforced in one write transaction in `MessageService.deleteBranch`. It rejects the only-path case, the virtual root, a selection whose subtree has more than one leaf, and any message in the range that is still generating or waiting for tool approval. Nothing is written when a check fails. When the deleted range owns the topic's active pointer, the pointer falls back to a surviving leaf; otherwise it is left untouched. Survivors are never reparented, regrouped or stripped of context metadata.

The renderer computes the same range from the topic tree to decide whether to offer the action, and requires an explicit confirmation before sending `DELETE /messages/:id/branch`. The server revalidates everything, including the approval state that tree previews do not carry.

## Alternatives considered

- Deleting only the selected node leaves the branch present through its parent, so the list never shrinks.
- Deleting the whole selected subtree can remove several branches at once when the selection is above a fork.
- The reply-group endpoint deletes every sibling answer of one turn, including the alternatives the user wants to keep.
- Deleting the conversation removes the shared prefix and every other path.
- Archiving or hiding keeps the unwanted messages stored instead of removing them.
- Bulk cleanup adds selection and scope rules beyond "delete this branch".

## Consequences

Deletion is destructive and irreversible, and the confirmation text says so. No branch identity is persisted, so "the original conversation" means every path the user did not select; the other branches keep their messages, and the shared prefix above the fork is untouched. The action is unavailable when the tree API truncated the selected subtree before a complete path becomes visible, because the panel cannot prove the range is exclusive. Deleting an empty reservation remains available in that state. The client predicate is only a convenience: the database transaction is the authority for pending work, approval waits, topic ownership and the last-branch rule.

## Verification

- AC1 — The branch list offers deletion on an eligible node and hides it for a forked subtree, the only path, a truncated frontier and live-only nodes: `src/renderer/pages/home/utils/__tests__/topicBranchDeletion.test.ts` (11 cases) and the availability cases in `src/renderer/pages/home/components/__tests__/TopicBranchPanel.test.tsx`.
- AC2 — Every deletion requires confirmation, cancelling sends no request, and a repeated confirm click sends only one: `src/renderer/pages/home/components/__tests__/TopicBranchPanel.test.tsx`; the smoke spec cancels once and asserts the messages are still readable before confirming.
- AC3 — The branch and its messages are permanently removed, and unsafe requests change nothing: `src/main/data/services/__tests__/MessageService.test.ts` (`185 passed`, including suffix deletion, sole-path, root, pending and approval-waiting rejections) plus the by-id `NOT_FOUND` and tree-absence checks in `tests/e2e/smoke/deleteConversationBranch.test.ts`.
- AC4 — The shared prefix and other branches keep their messages, group ids and context metadata, and an affected active pointer lands on a surviving leaf: the retained-row equality and active-fallback cases in `MessageService.test.ts`, the surviving-preview case in `TopicBranchPanel.test.tsx`, and the retained-parent/group/content assertions in the smoke spec.
- AC5 — Deleted entries stay gone after a restart: `tests/e2e/smoke/deleteConversationBranch.test.ts` (1 passed, 10.9 s) closes Electron, relaunches on the same profile without reseeding, and repeats the by-id, tree and panel assertions; the panel reports `2 branches · 5 nodes` instead of `3 branches · 8 nodes`.
