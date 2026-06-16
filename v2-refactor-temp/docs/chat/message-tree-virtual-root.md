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

1. **No marker column / no new role.** The virtual root is identified
   purely by `parentId IS NULL` — now exactly one such row per topic.
   It reuses an existing role (`role = 'system'`, `data = { parts: [] }`,
   `status = 'success'`, `siblingsGroupId = 0`). Any role-filtered
   *content* query must add `parentId IS NOT NULL` to exclude it (part of
   the blast-radius audit below).
2. **Eager creation.** The virtual root is inserted in the **same
   transaction that creates the topic**, so every topic has its root from
   birth. No lazy "ensure-on-first-message" branch.
3. **Explicit create + read, not an idempotent ensure.** Every topic-creation
   path calls `createRootMessageTx` (pure insert); message-creation paths call
   `getRootMessageIdTx` (read, throws if absent). No create-if-missing in message
   paths — a missing root is a loud bug (a creation path forgot it), not silently
   papered over.
4. **getTree keeps the renderer/API contract (Option Y).** The virtual root stays
   a DB-only concept: `getTree` treats its children as the logical roots and
   re-nulls their `parentId` in the response, so `TreeResponse` / `SiblingsGroup`
   and the flow canvas are unchanged. The DB-level single-root guarantee (the
   actual requirement) is delivered without touching the renderer. (An earlier
   draft exposed the virtual root and hid it in the renderer — dropped as more
   code for a cosmetic benefit.)

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
  persist.
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
- `getTree` (**Option Y**): fetch the virtual root, drop it from the active path,
  and treat its children as the logical roots; **re-null their `parentId` in the
  response** so `TreeResponse` / `SiblingsGroup` and the flow canvas keep the exact
  prior contract (top-level `parentId: null`, first-turn `SiblingsGroup.parentId:
  null`). The virtual root is never surfaced as a node. `SiblingsGroup.parentId`
  **stays nullable** — a presentation re-null, not the old multi-root data shape.

### Renderer

**Unchanged (Option Y).** Because `getTree` re-nulls first-turn `parentId` and
never surfaces the virtual root, the flow canvas
(`flow/topicMessageFlowGraph.ts` / `topicMessageFlowLiveTree.ts`) and the linear
chat view see the same `TreeResponse` / branch shape as before — first turns are
still top-level "root" nodes, root sibling groups still render as independent root
trees. The "multiple root trees" handling stays valid (first turns *are* the
visual roots); it is now a pure presentation concern, with the DB holding a single
physical root underneath. No renderer files change.

## Edge cases

- **Empty / never-used topic:** holds just the virtual root + `null`
  `activeNodeId`. Acceptable (one tiny content-less row).
- **Concurrent first messages:** the virtual root already exists (created in the
  topic's creation tx), so racing first messages both resolve it via
  `getRootMessageIdTx` and insert as siblings — no root race. The partial unique
  index is the backstop against a buggy double-create.
- **Multi-model first turn:** unchanged — N assistant placeholders are
  children of the (now non-root) first user message.
- **Role-filtered content queries** (`WHERE role = 'system'` etc.) must
  add `parentId IS NOT NULL` so the virtual root is not miscounted.

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
3. **Renderer** ✅ — **no change** (Option Y keeps the `getTree` / branch contract).
   Only tidy-up: dropped a vestigial `parentId == null` find in
   `handleClearTopicMessages` (it now always fell back to `uiMessages[0]`).
4. **Cleanup** — the `SiblingsGroup.parentId` stays nullable by design (Option Y
   re-null), so the `null for root sibling groups` shape is intentionally kept as a
   presentation detail, not removed.

Done as a follow-up to `#15951`, separate from it.

## Validation

- `MessageService.test.ts` — root-sibling cases rewritten as virtual-root child
  siblings; invariant coverage added: topic-create inserts exactly one root, a
  second `createRootMessageTx` hits `message_topic_root_uniq`, two `parentId:null`
  creates become siblings under one root (not two physical roots), `getPath`
  excludes the root, `getTree` re-nulls first-turn `parentId`.
- `TopicService` / `TemporaryChatService` / `PersistentChatContextProvider` /
  `ChatMigrator` / orphan-checker suites — seed fixtures moved to the single-root
  model (one virtual root per topic) via the shared `rootRow`/`withRoot` helper in
  `@test-helpers/db`.
- Flow-canvas suites (`topicMessageFlowGraph` / `LiveTree`) and
  `ChatContent.test.tsx` are **unchanged** (Option Y keeps the `getTree`/branch
  contract); the first-message edit+resend test still passes (sibling under the
  virtual root via backend `createSibling`).
- Full data-layer sweep green (2216 tests); node + web typecheck 0.

## Related

- [`branch-navigation.md`](../ai/branch-navigation.md) — branch DAG UX.
- [Data Layer cluster](../ai/data-cluster.md) — `MessageService`,
  migrators, shared message types.
