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
| Exactly one virtual root per topic | `message_topic_root_uniq` — a partial `UNIQUE` index on `(topic_id)` `WHERE parent_id IS NULL`. Rejects a second root on insert. |
| Every content message has a non-null parent | Convention + the single writer below; first-turn content messages get `parentId = <virtual root>`. |
| `role = 'root'` ⇔ `parentId IS NULL` | `createRootMessageTx` (runtime) and `ChatMigrator` (migration) are the **sole writers** of both; nothing else inserts a `parentId = NULL` row. |
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
| Content message, `cascade = false` | Reparent children onto the message's parent, then delete the message. |
| Content message, `cascade = true` | Delete the message and its whole subtree. |
| "Clear all messages" | Delete the virtual root's **children** (cascade), not the root — the empty virtual root stays. |

Cascade delete runs **leaf-first** (deepest depth → shallowest). The self-FK
(`parentId → message.id`) is `ON DELETE SET NULL`: deleting a node with a *surviving*
in-set child would null that child's `parentId` mid-delete, transiently creating a second
`parentId = NULL` row that collides with `message_topic_root_uniq`. Removing leaves first
means every deleted node has no surviving children, so `SET NULL` never fires.
(`PRAGMA defer_foreign_keys` does **not** help — it defers FK *checking*, not the
`SET NULL` action.)

## Consumer contract

- **`getPathRowsToNodeTx`** walks from a node up to the virtual root and **excludes** the
  root — the displayed conversation starts at the first user message.
- **`getTree`** finds the virtual root (`parentId IS NULL`), drops it from the active
  path, and treats its children as the logical roots. First-turn nodes keep their **real**
  parent (the virtual root id) in the response; the virtual root is **never** returned as a
  node. Hence `TreeNode.parentId` and `SiblingsGroup.parentId` are non-null `string`.
- **Flow canvas** (`flow/topicMessageFlowGraph.ts`): the edge builder skips edges whose
  parent isn't a rendered node — the virtual root, which first turns hang off but which is
  never a node — so first turns still render as graph roots.
- **Role-based content queries** need no special root handling: the root is `role = 'root'`,
  so it is excluded by construction.

## Related

- [Database Patterns](../data/database-patterns.md), [DataApi in Main](../data/data-api-in-main.md).
- `v2-refactor-temp/docs/chat/message-tree-virtual-root.md` — the design record (decision log) behind the virtual root; this page is the permanent reference.
