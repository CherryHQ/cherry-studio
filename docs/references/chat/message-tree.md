# Message Tree

Canonical reference for the chat **message-tree model**: how a topic's messages are
structured, the invariants that hold, and the contract consumers (read paths, the flow
canvas) rely on. Schema: `src/main/data/db/schemas/message.ts`. Service:
`src/main/data/services/MessageService.ts`.

> Scope: topic chat messages (`message` table). Agent-session messages
> (`agent_session_message`) are a separate, flat model and are not covered here.

## Structure

A topic's messages form a tree stored as an **adjacency list** — each row points at its
parent via `parentId`. Multi-model responses (one user turn, N assistant replies) are
**sibling groups**: rows that share a `parentId` and a non-zero `siblingsGroupId`.

| Column | Meaning |
|---|---|
| `parentId` | Parent message id. `NULL` **only** for the virtual root (see below). |
| `topicId` | Owning topic (FK, `ON DELETE CASCADE`). |
| `role` | `user` / `assistant` / `system` content, or `root` (virtual root sentinel). |
| `siblingsGroupId` | `0` = normal single branch; `>0` = members of one multi-model group under the same parent. |
| `topic.activeNodeId` | The currently-selected leaf — the "where we are" pointer that read paths walk up from. |

### Virtual root

Every topic owns exactly **one content-less virtual root**: `role = 'root'`,
`parentId = NULL`, `data = { parts: [] }`. Every real message hangs **below** it. The
first user turn and its resends are ordinary siblings under this shared parent, so
"resend the first message" is structurally identical to any other sibling creation — no
multiple physical roots.

```
root            (role='root', parentId=NULL, no content, never rendered)
 ├─ user "v1"  ┐
 ├─ user "v2"  ├─ one siblingsGroup — "resend first message" = a normal sibling
 └─ user "v3"  ┘
       └─ assistant → user → assistant → …
```

The dedicated `role = 'root'` makes the row **self-identifying**: role-filtered content
queries (`WHERE role = 'system'`, etc.) exclude it for free — no `parentId IS NOT NULL`
caveat. `role = 'root'` and `parentId IS NULL` are equivalent; `parentId IS NULL` stays
the indexed root *lookup* key.

## Invariants

| Invariant | Enforced by |
|---|---|
| Exactly one (live) virtual root per topic | `message_topic_root_uniq` — a partial `UNIQUE` index on `(topic_id)` `WHERE parent_id IS NULL AND deleted_at IS NULL`. Rejects a second live root on insert. |
| Every content message has a non-null parent | **DB CHECK** `message_root_parent_check` `((role = 'root') = (parent_id IS NULL))` — a content row (`role != 'root'`) with a null parent is rejected at the storage layer, not by convention. First-turn content messages get `parentId = <virtual root>`. |
| `role = 'root'` ⇔ `parentId IS NULL` | Same **DB CHECK** `message_root_parent_check`. `createRootMessageTx` (runtime) / `ChatMigrator` (migration) are the sole *writers* of the root row, but the biconditional itself is enforced structurally. |
| `activeNodeId` is never the virtual root | `NULL` for an empty topic, otherwise a content message; read paths drop the root from the active path. |
| The virtual root is deletable only via topic deletion | `delete()` hard-rejects it (see below); the topic FK `ON DELETE CASCADE` is the only path that removes it. |

The virtual root is created **eagerly**, in the same transaction that creates the topic —
so every topic has its root from birth. Writers:

- Runtime: `MessageService.createRootMessageTx(tx, topicId)` — called by `TopicService.create`,
  `TopicService.duplicate`, and `TemporaryChatService` persist.
- Migration: `ChatMigrator` builds the same row inline per topic and reparents former v1
  physical roots onto it, so migrated topics match freshly created ones.

Message-creation paths never create the root — they read it via
`getRootMessageIdTx(tx, topicId)` (throws if absent; a missing root is a loud bug, never
papered over).

## Delete semantics

| Target | Behavior |
|---|---|
| Virtual root | **Rejected** (`INVALID_OPERATION`), regardless of `cascade`. Deleting it would orphan first-turn children (unique-index violation) or leave a rootless topic. |
| Content message, `cascade = false` | Splice the node out: reparent its children onto its parent (their grandparent), then delete it. A child carries its `siblingsGroupId` (relative to its old parent), so each distinct non-zero moved group is **rebased** to a fresh id above any group already at the destination — it can't merge into an unrelated group there. |
| Content message, `cascade = true` | Delete the message and its whole subtree. |
| "Clear all messages" | `clearTopicMessages(topicId)` (`DELETE /topics/:topicId/messages`) — deletes every non-root row of the topic in one statement and clears `activeNodeId`; the content-less virtual root stays. The structural replacement for the old "delete the root to clear the topic" (now rejected). |

The self-FK (`parentId → message.id`) is **`ON DELETE CASCADE`**. Deleting a node
removes its whole subtree in one statement — no leaf-first ordering, and no `SET NULL`
to manufacture a colliding `parentId = NULL` row. This is why `cascade = true`,
`clearTopicMessages`, `purgeByTopicIdsTx` (topic delete), and the `topic` FK cascade are
all single unordered deletes that stay correct. `cascade = false` reparents children **before**
deleting the node, so the cascade fires on nothing. (A `cascade = false` delete of a
first-turn message reparents its children onto the virtual root — structurally valid;
they become first-turn nodes.)

> `SET NULL` was actively wrong under `message_topic_root_uniq`: it nulls a surviving
> in-set child's `parentId` mid-delete, transiently creating a second `parentId = NULL`
> row that violates the index (a reachable crash when deleting any multi-model topic).
> `PRAGMA defer_foreign_keys` does not help — it defers FK *checking*, not the action.

## Consumer contract

- **`rootId` is the authoritative first-turn signal.** `getBranchMessages` and `getTree`
  return `rootId: string | null` (the topic's virtual-root id) on every page, alongside
  `activeNodeId`. A message is a **first turn** iff `message.parentId === rootId` — the only
  reliable check. Do **not** infer "first turn" from "parent not in the loaded list" (the
  branch is paginated, the root is never in the response) nor from the v1 `askId` field
  (role-coupled, `undefined` for user messages). When `rootId` is unknown, treat nothing as a
  first turn (fail-safe). See [#16120](https://github.com/CherryHQ/cherry-studio/issues/16120).
- **`getPathRowsToNodeTx`** walks from a node up to the virtual root and **excludes** the
  root — the displayed conversation starts at the first user message.
- **`getTree`** finds the virtual root (`parentId IS NULL`), drops it from the active
  path, and treats its children as the logical roots. First-turn nodes keep their **real**
  parent (the virtual root id) in the response; the virtual root is **never** returned as a
  node. Hence `TreeNode.parentId` and `SiblingsGroup.parentId` are non-null `string`.
- **Flow canvas** *(forward reference — the renderer flow-canvas work lives on the
  `feat/chat-page` integration branch, not this PR branch)*: the edge builder will skip
  edges whose parent isn't a rendered node — the virtual root, which first turns hang off
  but which is never a node — so first turns still render as graph roots.
- **Role-based content queries** need no special root handling: the root is `role = 'root'`,
  so it is excluded by construction.

## Related

- [Database Patterns](../data/database-patterns.md), [DataApi in Main](../data/data-api-in-main.md).
