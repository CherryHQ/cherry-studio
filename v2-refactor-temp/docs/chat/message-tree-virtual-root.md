# Message Tree — Per-Topic Virtual Root

**Status:** implemented on `feat/message-tree-virtual-root` (follow-up to
`#15951`). Originates from the `#15951` (chat message flows) review thread:
the reviewer questioned the `null for root sibling groups` shape and asked
for a virtual root node so the tree has a single guaranteed root (see
[Decisions](#decisions)).

## Problem

The message tree is an adjacency list (`message.parentId`) with the
convention **`parentId = null` ⟺ root**.

- `MessageService.create({ parentId: null })` enforces a single root —
  it rejects a second root with *"Topic already has a root message"*
  (`MessageService.ts:848`).
- But `createSibling()` on a root message **bypasses** that check: it
  inserts another `parentId = null` row as a sibling
  (`MessageService.ts:769`), so a topic can hold **multiple physical
  roots**, grouped by `siblingsGroupId`. This is how "resend / edit the
  first user message" is implemented today — as a *root sibling*.

Consequences of multiple physical roots:

- The read path special-cases root sibling groups with an
  `isNull(parentId)` branch (`MessageService.ts:557`).
- `SiblingsGroup.parentId` must be nullable — the literal
  `null for root sibling groups` comment at
  `src/shared/data/types/message.ts:490` that started the review.
- The flow canvas carries dedicated "expand root sibling groups into
  independent root trees" / "multiple root trees" logic
  (`flow/topicMessageFlowGraph.ts`, `flow/topicMessageFlowLiveTree.ts`).
- The `parentId IS NULL = root` assumption is spread across **~101
  (main) / 8 (shared) / 25 (renderer)** sites, each of which conflates
  "the root" with "the first user message."

Product requirement (from the thread): resending the first user message
must stay in the **same topic** (DeepSeek / ChatGPT UX), not spawn a new
topic — so "forbid first-turn resend" is not an option.

## Target design — virtual root sentinel

Every topic owns exactly **one content-less virtual root message row**
(`parentId = null`). Every real conversation message hangs **below** it,
so the first user turn and its resends are ordinary siblings under a
shared parent:

```
virtual root            (parentId = null, no content, never rendered)
 ├─ user "v1"  ┐
 ├─ user "v2"  ├─ one siblingsGroup — "resend first message" = a normal sibling
 └─ user "v3"  ┘
       └─ assistant → user → assistant → …
```

This makes first-turn resend **structurally identical** to any other
sibling creation, and the single-root guarantee becomes a DB invariant
instead of application discipline.

### Decisions

1. **Dedicated `role = 'root'`, no marker column.** The virtual root is a
   self-identifying `role = 'root'` row (`data = { parts: [] }`,
   `status = 'success'`, `siblingsGroupId = 0`), exactly one per topic.
   `role = 'root'` and `parentId IS NULL` are equivalent — `parentId IS NULL`
   stays the root *lookup* key (what `message_topic_root_uniq` covers) and
   `createRootMessageTx` / the migrator are the sole writers of both. Because
   the role is dedicated, role-filtered *content* queries (`WHERE role = 'system'`
   etc.) exclude the root for free — no `parentId IS NOT NULL` caveat. (A
   separate discriminator column was rejected: it would have to be threaded
   through every query/type; extending the role enum is lighter and
   self-describing.)
2. **Eager creation.** The virtual root is inserted in the **same
   transaction that creates the topic**, so every topic has its root from
   birth. No lazy "ensure-on-first-message" branch.
3. **Explicit create + read, not an idempotent ensure.** Every topic-creation
   path calls `createRootMessageTx` (pure insert); message-creation paths call
   `getRootMessageIdTx` (read, throws if absent). No create-if-missing in message
   paths — a missing root is a loud bug (a creation path forgot it), not silently
   papered over.
4. **getTree exposes the real parent; tree `parentId` is non-null.** A first turn
   keeps its real parent — the topic's virtual root — in the `getTree` response
   (no re-null), so `SiblingsGroup.parentId` and `TreeNode.parentId` are non-null
   `string`, eliminating the `null for root sibling groups` shape that prompted the
   review. The virtual root is never returned as a tree node; the flow-graph edge
   builder skips edges whose parent isn't a rendered node, so first turns still
   render as graph roots. Non-null is established by control-flow narrowing (a guard
   in `messageToTreeNode`, a skip in the live builder), not assertions. (An earlier
   draft re-nulled at the boundary to avoid touching the renderer — dropped because
   it kept the `null` shape and the live-tree merge fed virtual-root parentIds into
   the canvas anyway, so the edge guard was needed regardless.)

> `topic.rootMessageId` was considered and **rejected**: the partial
> unique index below already (a) guarantees a single root and (b) gives
> indexed O(1) access via `WHERE topic_id = ? AND parent_id IS NULL`. A
> pointer column would only duplicate a derivable fact and add a sync
> burden on create/delete/migrate. (Contrast `topic.activeNodeId`, which
> is genuine non-derivable navigation state and stays.)

### Schema (`src/main/data/db/schemas/message.ts`)

- Redefine `parentId IS NULL` to mean **only the virtual root**; all
  content messages get a non-null `parentId`.
- Add a partial unique index — the actual single-root guarantor and the
  root-access index in one:

  ```sql
  CREATE UNIQUE INDEX message_topic_root_uniq ON message(topic_id)
  WHERE parent_id IS NULL;
  ```

- The existing self-FK (`parentId → message.id`, `ON DELETE SET NULL`)
  and `message_role_check` are unchanged.

No `topic` schema change. v2 schemas are throwaway, so this lands as a
regenerated migration, not a patch.

### Invariants

- Each topic has **exactly one** `parentId IS NULL` row = the virtual
  root; it is content-less and **never rendered**.
- Every content message (`user` / `assistant` / `system`) has a non-null
  `parentId`. First-turn user messages have `parentId = <virtual root>`.
- `activeNodeId` never points at the virtual root (it is `null` for an
  empty topic, otherwise a content message).
- The "root sibling" concept no longer exists — first-turn siblings are a
  normal `(parentId = root, siblingsGroupId)` group.

### Write paths (`MessageService` / `TopicService`)

- Every topic-creation path inserts the virtual root via
  `MessageService.createRootMessageTx(tx, topicId)` (pure insert):
  `TopicService.create`, `TopicService.duplicate`, and `TemporaryChatService`
  persist. The v1→v2 `ChatMigrator` builds the same row inline per topic
  (batch insert) and reparents former physical roots onto it, so migrated
  topics match freshly created ones.
- Message-creation paths resolve the parent via `getRootMessageIdTx(tx, topicId)`
  (read + throw-if-missing): `MessageService.create` (`parentId: undefined` on an
  empty topic / explicit `null`), `createUserMessageWithPlaceholders`, and
  `copyPathRowsTx` (destination root). The *"Topic already has a root message"* /
  *"…no activeNodeId"* error branches are **deleted**.
- `createSibling()`: the source `parentId` is now always non-null, so the
  root-sibling special case disappears; it becomes a uniform insert.

### Read paths

- `getPathRowsToNodeTx` (`:508`) walks up, stops at the virtual root, and
  **excludes it** from the returned path (the displayed conversation
  starts at the first user message).
- `getBranchMessages`: first-turn siblings now have `parentId = <virtual root>`,
  so they match the normal `eq(parentId, …)` sibling path (the `isNull` branch is
  simply never hit, since the path excludes the virtual root).
- `getTree`: fetch the virtual root, drop it from the active path, and treat its
  children as the logical roots. First-turn nodes keep their **real** parent (the
  virtual root id) — no re-null — and the virtual root is never returned as a node.
  So `SiblingsGroup.parentId` and `TreeNode.parentId` are non-null `string`
  (`message.ts` drops `| null` on both); `messageToTreeNode` guards the (impossible)
  null parent to narrow without an assertion.

### Renderer

The flow canvas needs **one** change: the edge builder
(`flow/topicMessageFlowGraph.ts`) skips edges whose parent isn't a rendered node —
the virtual root, which first turns hang off but which is never a node — so first
turns still render as graph roots. `GraphInputNode` keeps a nullable internal
`parentId` (null = "no rendered parent"). The live builder
(`topicMessageFlowLiveTree.ts`) skips a parentless row (never occurs) so its node
`parentId` is non-null too. This edge guard was needed regardless: the live-tree
merge feeds the real (virtual-root) parentId into the canvas, so re-nulling in
`getTree` alone never sufficed — which is why Option X (above) is both cleaner and
the only consistent option.

## Edge cases

- **Empty / never-used topic:** holds just the virtual root + `null`
  `activeNodeId`. Acceptable (one tiny content-less row).
- **Concurrent first messages:** the virtual root already exists (created in the
  topic's creation tx), so racing first messages both resolve it via
  `getRootMessageIdTx` and insert as siblings — no root race. The partial unique
  index is the backstop against a buggy double-create.
- **Multi-model first turn:** unchanged — N assistant placeholders are
  children of the (now non-root) first user message.
- **Role-filtered content queries** (`WHERE role = 'system'` etc.) need no
  special handling — the virtual root is `role = 'root'`, so it is excluded
  by construction.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Synthetic (presentation-only) root** — keep `parentId = null` roots in DB, fabricate a single root only in the tree layer | Does not give the *DB-level* single-root guarantee the reviewer asked for; the multi-root data shape and scattered assumptions remain |
| **`topic.rootMessageId` pointer** | Redundant with the partial unique index (which already guarantees + indexes the root); adds a sync burden — rejected in-thread |
| **`parentId = topicId` (topic *is* the root)** | Breaks the `parentId → message.id` self-FK |
| **Forbid first-turn resend (treat as new topic)** | Violates the same-topic product requirement |

## Phased plan & blast radius

1. **Schema** ✅ — partial unique index `message_topic_root_uniq`; regenerated
   migration.
2. **Service** ✅ — `createRootMessageTx` (topic-creation paths) + `getRootMessageIdTx`
   (message paths); rewire `create` / `createSibling` /
   `createUserMessageWithPlaceholders` / `getPathRowsToNodeTx` / `getBranchMessages`
   / `getTree` / `copyPathRowsTx` / `duplicate` / temp-chat; delete root-sibling
   special cases. Tests updated + invariant coverage added.
3. **Renderer** ✅ — flow-graph edge guard (skip edges to the unrendered virtual
   root) + live-builder skip of parentless rows; `GraphInputNode` keeps a nullable
   internal parentId. Tidy-up: dropped a vestigial `parentId == null` find in
   `handleClearTopicMessages` (it always fell back to `uiMessages[0]`).
4. **Types** ✅ — `SiblingsGroup.parentId` and `TreeNode.parentId` are now non-null
   `string`; the `null for root sibling groups` shape is **removed** (the reviewer's
   original concern), since first-turn groups carry the virtual root as their parent.

Done as a follow-up to `#15951`, separate from it.

## Validation

- `MessageService.test.ts` — root-sibling cases rewritten as virtual-root child
  siblings; invariant coverage added: topic-create inserts exactly one root, a
  second `createRootMessageTx` hits `message_topic_root_uniq`, two `parentId:null`
  creates become siblings under one root (not two physical roots), `getPath`
  excludes the root, `getTree` keeps first-turn `parentId` = the virtual root id.
- `TopicService` / `TemporaryChatService` / `PersistentChatContextProvider` /
  `ChatMigrator` / orphan-checker suites — seed fixtures moved to the single-root
  model (one virtual root per topic) via the shared `rootRow`/`withRoot` helper in
  `@test-helpers/db`.
- Flow-canvas suites (`topicMessageFlowGraph` / `LiveTree`) — fixtures updated for
  non-null `parentId` (roots use the virtual-root sentinel); `ChatContent.test.tsx`
  is unchanged, and the first-message edit+resend test still passes (sibling under
  the virtual root via backend `createSibling`).
- Full data-layer sweep green (2216 tests); node + web typecheck 0.

## Related

- [`branch-navigation.md`](../ai/branch-navigation.md) — branch DAG UX.
- [Data Layer cluster](../ai/data-cluster.md) — `MessageService`,
  migrators, shared message types.
