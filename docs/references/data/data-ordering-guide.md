# Ordering Guide

Canonical spec for any sortable resource in the DataApi system. Uses a single fractional-indexing design ([fractional-indexing](https://www.npmjs.com/package/fractional-indexing), Rocicorp, ~2 KB gzip) — `PATCH /{resource}/:id/order` with an anchor body. Scales from tens to thousands of rows without background rebalancing; applies uniformly whether the view is paginated or not. Replaces the two incompatible predecessors (`PATCH /miniapps` absolute `sortOrder` integers and `PATCH /mcp-servers` full `orderedIds` list).

Every sortable resource stores its position as a string `order_key` column. A reorder is always **relative** against an anchor (another row's id, or a `first` / `last` sentinel), never an absolute index. The server computes a new key between neighbours in one transaction; the renderer optimistically reorders its local cache and revalidates on completion.

## Quickstart — The Four Layers

A sortable resource touches four layers. The toolkit provides one import per layer — this section shows the end-to-end picture at a glance before the specification dives into specifics.

### 1. Database schema — `orderKeyColumns` + index helpers

File: `src/main/data/db/schemas/_columnHelpers.ts`. Spread `...orderKeyColumns` into the table definition (the field name is locked to `orderKey` at the type level) and attach the right index helper.

```typescript
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { orderKeyColumns, orderKeyIndex, scopedOrderKeyIndex } from './_columnHelpers'

// Whole-table ordering
export const mcpServer = sqliteTable(
  'mcp_server',
  {
    id: text().primaryKey(),
    ...orderKeyColumns,                     // TEXT NOT NULL `order_key`
  },
  (t) => [orderKeyIndex('mcp_server')(t)]   // CREATE INDEX mcp_server_order_key_idx
)

// Partitioned ordering (scope = providerId)
export const userModel = sqliteTable(
  'user_model',
  {
    id: text().primaryKey(),
    providerId: text('provider_id').notNull(),
    ...orderKeyColumns,
  },
  (t) => [scopedOrderKeyIndex('user_model', 'providerId')(t)]  // (provider_id, order_key)
)
```

### 2. API schema — `OrderEndpoints<TRes>`

File: `packages/shared/data/api/schemas/_endpointHelpers.ts`. Intersect the resource's schema type with `OrderEndpoints<'/res'>` to inject the two PATCH endpoints into `ApiSchemas`.

```typescript
import type { OrderEndpoints } from './_endpointHelpers'

export type McpServerSchemas = {
  '/mcp-servers': { GET: { ... }; POST: { ... } }
  '/mcp-servers/:id': { GET: { ... }; PATCH: { ... }; DELETE: { ... } }
} & OrderEndpoints<'/mcp-servers'>
// Adds '/mcp-servers/:id/order' (PATCH) and '/mcp-servers/order:batch' (PATCH)
// with correct params / body (OrderRequest, OrderBatchRequest) / response.
```

Handlers validate with the matching Zod schemas (`OrderRequestSchema`, `OrderBatchRequestSchema`) exported from the same file.

### 3. Server-side service — `insertWithOrderKey` / `applyMoves` / `resetOrder`

File: `src/main/data/services/utils/orderKey.ts`. Use these helpers on any `POST` create path, reorder path, and `/order:reset` path — **never** hand-write `tx.insert(table).values({ orderKey })` or touch `fractional-indexing` directly.

```typescript
import { insertWithOrderKey, insertManyWithOrderKey, applyMoves, resetOrder } from './utils/orderKey'

await insertWithOrderKey(tx, mcpServerTable, values, { pkColumn: mcpServerTable.id })
await insertManyWithOrderKey(tx, mcpServerTable, valuesList, { pkColumn: mcpServerTable.id })
await applyMoves(tx, mcpServerTable, moves, { pkColumn: mcpServerTable.id })
await resetOrder(tx, mcpServerTable, orderedRows, { pkColumn: mcpServerTable.id })

// Scoped variants pass a `scope` SQL expression, e.g.:
//   scope: eq(userModelTable.providerId, providerId)
```

Migrators (Redux/Dexie → SQLite) use the pure-function counterparts `assignOrderKeysInSequence` / `assignOrderKeysByScope` from `src/main/data/migration/v2/utils/orderKey.ts` — see [v2 Migration Guide — Order-Key Stamping in Migrators](./v2-migration-guide.md#order-key-stamping-in-migrators).

### 4. Renderer — `useReorder` hook

File: `src/renderer/src/data/hooks/useReorder.ts`. One hook on top of `useMutation`; drop its `applyReorderedList` straight into a drag-and-drop callback.

```tsx
import { useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'

// Paginated collection — items live under `.items`.
function McpServerList() {
  const { data } = useQuery('/mcp-servers')
  const { applyReorderedList, isPending } = useReorder('/mcp-servers')
  return <DraggableList items={data?.items ?? []} onReorder={applyReorderedList} />
}

// Flat-array collection — the response *is* the list.
function PinList() {
  const { data } = useQuery('/pins')
  const { applyReorderedList } = useReorder('/pins')
  return <DraggableList items={data ?? []} onReorder={applyReorderedList} />
}

// Non-`id` primary key (e.g. miniapp.appId):
useReorder('/miniapps', { idKey: 'appId' })
```

Optimistic writes / server revalidation / failure rollback are all handled internally through the DataApi cache hooks (`useReadCache` / `useWriteCache` / `useInvalidateCache`) — the component never tracks the list in local state and never calls SWR directly. `useReorder` reads the items list from the cache by auto-detecting flat arrays and `{ items }`-shaped objects; see §4.3 for nested shapes.

---

The sections below spell out the normative spec for each layer.

## 1. API Shape

### `PATCH /{resource}/:id/order` — primary

Request body — exactly one of:

```jsonc
{ "before":   "row-abc" }            // move :id before row-abc
{ "after":    "row-xyz" }            // move :id after row-xyz
{ "position": "first" }              // (or "last") move :id to the head/tail
```

Response: `204 No Content`.

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Body does not match the three-way union |
| `NOT_FOUND` | 404 | `:id` or `before`/`after` anchor id does not exist |

### `POST /{resource}/order:reset` — auxiliary (opt-in per resource)

```jsonc
{ "preset": "alphabetical" }
```

Each resource declares its own `preset` enum inline. Server sorts the rows per preset, then rewrites every `order_key` in a single transaction. **Not** funneled through `useReorder` — call with a plain `useMutation`:

```typescript
useMutation('POST', '/providers/order:reset', { refresh: ['/providers'] })
```

### `PATCH /{resource}/order:batch` — auxiliary (used internally by `useReorder`)

```jsonc
{
  "moves": [
    { "id": "a", "anchor": { "after": "b" } },
    { "id": "c", "anchor": { "position": "first" } }
  ]
}
```

Moves apply **sequentially in one transaction**; each anchor resolves against the state produced by preceding moves. Duplicate ids fold (last wins, warn logged); no-op moves (`newKey === currentKey`) are skipped. `useReorder.applyReorderedList` auto-dispatches: zero changes → no-op, one change → primary endpoint, two+ → this endpoint. Same error codes as the primary.

---

## 2. Database Schema Rules

(Code examples are in Quickstart §1.)

- **Column**: `order_key TEXT NOT NULL`. Always injected via `...orderKeyColumns`; the spread locks the TS field name to `orderKey`.
- **Index**: required. Use `orderKeyIndex(tableName)(t)` for whole-table or `scopedOrderKeyIndex(tableName, scopeColumn)(t)` for partitioned tables.
- **Known partition dimensions** in the codebase:
  - Live (active consumers): `group.entityType`, `pin.entityType`, `user_model.providerId`, `miniapp.status`, `user_provider.isEnabled`.
  - Planned / hypothetical: `topic.groupId` (adopted when `topic` migrates to the spec).
- **No secondary order axes**. Each sortable table exposes exactly one `order_key`. Orthogonal user intents — e.g. "in a group" vs "pinned" — are modelled as separate tables, not as overloaded scope values on a shared column. Resource-specific design (polymorphic shape, purge contracts, concurrency semantics) lives in each schema / service's JSDoc, not here — this guide scopes to the ordering mechanism only.

---

## 3. Server-Side Service Helpers

All runtime `order_key` reads and writes go through `src/main/data/services/utils/orderKey.ts` — the single place in the codebase allowed to import `fractional-indexing`.

| Helper | Use for |
|---|---|
| `insertWithOrderKey(tx, table, values, { pkColumn, position?, scope? })` | Single-row POST create on a sortable table. |
| `insertManyWithOrderKey(tx, table, valuesList, { pkColumn, position?, scope? })` | Batch/seed create (≥2 rows). One boundary lookup + one bulk insert; `insertWithOrderKey` delegates to it internally. |
| `applyMoves(tx, table, moves, { pkColumn, scope? })` | Reorder path for both `PATCH /:id/order` (wrapped as a single move) and `PATCH /order:batch`. |
| `applyScopedMoves(tx, table, moves, { pkColumn, scopeColumn })` | Reorder path for tables partitioned by a discriminator column. Infers scope from the target row, enforces single-scope batches, and delegates to `applyMoves`. See §3.1. |
| `resetOrder(tx, table, orderedRows, { pkColumn })` | `POST /order:reset` — caller sorts by preset, helper rewrites every key. |
| `computeNewOrderKey(...)` | Internal to `applyMoves`; exported only for tests. |
| `generateOrderKeySequence` / `generateOrderKeyBetween` / `generateOrderKeySequenceBetween` | The ONLY sanctioned wrappers around `fractional-indexing`. Services, migrators, and custom-migration scripts all re-import from here. |

Binding semantics:

- **`pkColumn` is required.** Primary-key column names vary (`miniapp.appId`, `mcpServer.id`, `topic.id`, ...); helpers make zero assumptions.
- **Must run inside an outer transaction.** Helpers take `tx` and never open their own.
- **`scope` applies symmetrically** to target, anchor, and neighbour lookups — anchoring across scopes throws.
- **`insertManyWithOrderKey` preserves input order under `ORDER BY orderKey ASC`.** For `position: 'last'` the batch lands after existing rows; for `'first'` before; within the batch, relative order mirrors `valuesList`.

Scoped usage:

```typescript
// Topic: groupId is nullable, both NULL and non-NULL are real partitions
await insertWithOrderKey(tx, topicTable, values, {
  pkColumn: topicTable.id,
  scope: values.groupId ? eq(topicTable.groupId, values.groupId) : isNull(topicTable.groupId),
})

// user_model: scope by providerId
await applyMoves(tx, userModelTable, moves, {
  pkColumn: userModelTable.id,
  scope: eq(userModelTable.providerId, providerId),
})
```

---

## 3.1 Scoped Reorder Pattern

Scope inference is a **service-layer** responsibility. The HTTP client sends `{ before: X }` / `{ after: X }` / `{ position: 'first' | 'last' }` — it never names the scope. The handler validates the body with `OrderRequestSchema` and forwards the id and anchor verbatim; it does not read the row or resolve the scope. The service SELECTs the target row, reads its scope column, and applies `eq(scopeColumn, value)` to `applyMoves`.

`applyScopedMoves` (`src/main/data/services/utils/orderKey.ts`) is the infra-level helper that encodes this pattern. `GroupService` and `PinService` are its first two consumers; any future table scoped by a discriminator column should prefer it over hand-rolling `SELECT → applyMoves` boilerplate.

**Contract**:

- A batch that spans more than one distinct scope value is rejected with `VALIDATION_ERROR`. Scoped reorders must stay within one partition; cross-scope moves are a row update (`PATCH /:id`), not a reorder.
- A target id missing from the table is reported as `NOT_FOUND`. The missing-id check runs before the multi-scope check.
- Empty `moves` is a no-op (no DB access).

```ts
await applyScopedMoves(tx, pinTable, moves, {
  pkColumn: pinTable.id,
  scopeColumn: pinTable.entityType
})
```

---

## 4. Renderer Integration

### 4.1 Sequence

```
User  Component          SWR cache         Main           SQLite
 |        |                  |               |              |
 | drop→  | applyReorderedList                              |
 |        |--- useWriteCache(url, next) ---> overwrite      |
 | [UI instantly updates from optimistic value]             |
 |        |--- PATCH /:res/:id/order --> IPC --> UPDATE --> |
 |        |<---------- 204 -----------------                |
 |        | useMutation.refresh → auto GET → overwrite      |
 | [UI settles with server truth]                           |
 | on error: useInvalidateCache(url) → GET → overwrite      |
```

Three observable steps: **optimistic write → PATCH → revalidate** (or **invalidate** on error). The optimistic value is derived by a pure `reorderLocally(items, id, anchor, idKey)` from the current cache — the hook never constructs `order_key` client-side. All cache side-effects go through the DataApi hooks; `useReorder` holds zero direct SWR imports.

### 4.2 Non-`id` primary keys — the `idKey` option

```tsx
useReorder('/miniapps', { idKey: 'appId' })
```

Flows into both the optimistic reducer and the new-list diff. The server-facing contract is unchanged — `move(id, anchor)` still takes a plain string id, PATCH body shape is untouched. `idKey` only affects how the client **extracts** ids from cached items.

Single field only — composite keys like `${providerId}:${modelName}` are out of scope; pre-project a synthetic id field before passing items to the drag library.

### 4.3 Supported cache shapes

`useReorder` inspects the cached value at `collectionUrl` to locate the items list. Three shapes are recognized out of the box:

| Shape | Example endpoints | How items are extracted |
|---|---|---|
| **Flat array** `T[]` | `GET /pins`, `GET /groups`, `GET /tags`, `GET /providers` | The cache value *is* the array. |
| **Wrapped pagination** `{ items, total, page }` / `{ items, nextCursor }` | `GET /miniapps`, `GET /mcp-servers`, `GET /assistants`, `GET /knowledges` | Reads `cache.items`; preserves `total` / `page` / `nextCursor` on optimistic writes. |
| **Naked items wrapper** `{ items: T[] }` | `GET /knowledges/:id/items` | Reads `cache.items`. |

No caller configuration is required for any of the three. Both pagination shapes (`OffsetPaginationResponse` and `CursorPaginationResponse`) fall under the same `{ items }` branch — metadata fields are passed through unchanged.

### 4.4 Using accessors for nested shapes

For responses the defaults cannot reach — grouped views, GraphQL-style connections, or envelopes with a different field name — pass `selectItems` and `updateItems` together. Passing one without the other throws at hook construction.

```tsx
// Envelope with a different field name: cache = { data: T[], meta }
useReorder('/custom', {
  selectItems: (cache) => (cache as Envelope).data,
  updateItems: (cache, items) => ({ ...(cache as Envelope), data: items })
})

// Grouped view: cache = { groups: [{ id, items }], version }
useReorder('/grouped-view', {
  selectItems: (cache) => (cache as GroupedView).groups[0].items,
  updateItems: (cache, items) => {
    const c = cache as GroupedView
    return { ...c, groups: [{ ...c.groups[0], items }, ...c.groups.slice(1)] }
  }
})

// GraphQL-ish connection: cache = { edges: [{ node }], pageInfo }
useReorder('/connection', {
  selectItems: (cache) => (cache as Conn).edges.map((e) => e.node),
  updateItems: (cache, items) => {
    const c = cache as Conn
    return { ...c, edges: items.map((node, i) => ({ ...c.edges[i], node })) }
  }
})
```

`updateItems` must be the inverse of `selectItems`: a round trip through the pair must yield the same items list.

### 4.5 Degradation: not-loaded vs. unrecognized cache

The hook distinguishes two failure modes so calls remain safe even when preconditions aren't met.

| Precondition | `move` / `applyBatch` | `applyReorderedList` |
|---|---|---|
| **Cache not yet loaded** (`readCache` returns `undefined`) | no-op, warn on each call | no-op, warn on each call |
| **Cache loaded, shape unrecognized** | skip optimistic overlay, **PATCH still fires**, warn (de-duplicated per hook) | no-op, warn (de-duplicated per hook) |

Rationale:

- "Not loaded" is a UX timing bug — the user interacted before data arrived. Every occurrence is worth logging; each is an independent event.
- "Unrecognized shape" is a caller contract issue (missing accessors for a nested cache). `move`'s `id` / `anchor` arguments are self-contained and the server can honor them without a client-side diff, so the PATCH is allowed through. `applyReorderedList`, by contrast, needs a current baseline to compute minimal moves — without one, the new list would have to be replayed blindly, which is unsafe. The warning is deduplicated because a misconfigured accessor would otherwise log on every drag.

### 4.6 Anti-pattern: don't shadow SWR with local state

```tsx
// WRONG — fights SWR cache, flickers, goes stale
const [list, setList] = useState<Item[]>([])
useEffect(() => { setList(data?.items ?? []) }, [data])

// RIGHT — render straight from SWR; optimistic updates go to the cache
const { data } = useQuery('/mcp-servers')
<DraggableList items={data?.items ?? []} onReorder={applyReorderedList} />
```

The cached list is the source of truth. Every subscriber of the same key stays in sync automatically.

---

## 5. v2 Migrator Usage

Pure-function helpers `assignOrderKeysInSequence` / `assignOrderKeysByScope` stamp pre-flattened arrays; no DB access; delegate to `generateOrderKeySequence` from the service-layer wrapper.

**→ See [v2 Migration Guide — Order-Key Stamping in Migrators](./v2-migration-guide.md#order-key-stamping-in-migrators).**

---

## 6. URL and Naming Conventions

- **Sub-resource name**: `/order`. Never `/sort`, `/rank`, `/position`.
- **Custom methods**: colon notation — `/{resource}/order:reset`, `/{resource}/order:batch` (Google AIP-136; see [API Design Guidelines — Non-CRUD Operations](./api-design-guidelines.md#non-crud-operations)).
- **Body enum**: `position: 'first' | 'last'` — distinct from the `/order` URL segment.
- **DB column**: `order_key` (SQL) / `orderKey` (TS), always `TEXT NOT NULL`. No nullable variants.
- **Type names**: every order-related export prefixed with `Order` (`OrderRequest`, `OrderRequestSchema`, `OrderBatchRequest`, `OrderBatchRequestSchema`, `OrderEndpoints`). No `Sort*` / `Position*` / `Rank*` aliases — the `Order` prefix is what keeps `_endpointHelpers.ts` classifiable as it grows.

**Disallowed**: `POST /{res}:reorder`, `POST /{res}/reorder`, `PUT /{res}/order` (rejected full-list design), collection-level `PATCH /{res}` for reordering, nested URLs like `/groups/:gid/topics/:id/order` (group dimension travels in the body, not the path).

---

## 7. Migration Checklist — New Sortable Resource

Complete in one PR:

1. **Schema**: `...orderKeyColumns` + `orderKeyIndex(tableName)(t)` or `scopedOrderKeyIndex(tableName, scopeColumn)(t)`.
2. **Endpoints**: `& OrderEndpoints<'/{res}'>` on the resource's schema type. Add `POST /{res}/order:reset` inline if needed. Handlers validate bodies with `OrderRequestSchema` / `OrderBatchRequestSchema`.
3. **Service**: `insertWithOrderKey` for create, `applyMoves` (or `applyScopedMoves` for discriminator-partitioned tables) for reorder, `resetOrder` for reset. For partitioned tables, the relevant scope predicate is:
   - `group`: `eq(groupTable.entityType, entityType)` — live (`GroupService.reorder` / `reorderBatch` via `applyScopedMoves`).
   - `pin`: `eq(pinTable.entityType, entityType)` — live (`PinService.reorder` / `reorderBatch` via `applyScopedMoves`).
   - `user_model`: `eq(userModelTable.providerId, providerId)`.
   - `miniapp`: `eq(miniappTable.status, status)`.
   - `topic`: `topic.groupId ? eq(topicTable.groupId, groupId) : isNull(topicTable.groupId)` — hypothetical, pending `topic` migration.
   - `user_provider` / `mcp_server`: whole-table (`scope: undefined`).

   New scoped consumers should prefer `applyScopedMoves` (which handles scope lookup and rejects cross-scope batches) over composing `applyMoves` with a manually assembled `eq(...)` scope.
4. **Migrator**: replace legacy `sortOrder = index` with `assignOrderKeysByScope` (or `assignOrderKeysInSequence` for whole-table). Drop `index` / `sortOrder` parameters from `transform*` functions.
5. **Renderer**: `useReorder(collectionUrl)`, or `useReorder(collectionUrl, { idKey: 'appId' })` for non-`id` pk. If the `GET` response is neither a flat array nor `{ items }`-shaped (e.g. a grouped or connection-style envelope), also pass `selectItems` / `updateItems` — see §4.4.
6. **Drizzle custom migration** (runs when the consuming resource's PR lands, not part of the base-infrastructure PR): add `order_key` nullable → backfill bucket-by-bucket via `generateOrderKeySequence` imported from `@data/services/utils/orderKey` (never from `fractional-indexing` directly) → promote to `NOT NULL` → drop the old `sort_order` column → create the index. Until this step runs, the production schema keeps the legacy `sort_order INT` column — the base infrastructure never touches existing tables.

---

## 8. FAQ

**Paginated lists — what if the drag anchor is off-page?** The server resolves `before`/`after` by id against the database, not against the client's loaded window. Any visible row's id is a valid anchor. That's what makes the scheme work for topics/messages that never fit on screen.

**Is `order:reset` safe under concurrent calls?** Yes. Reset is deterministic (same preset + row data → same keys via `generateOrderKeySequence`). SQLite's write lock serializes concurrent resets; the second overwrites the first and the end state is consistent.

**Known boundary — fractional-indexing collisions.** Two transactions reading the same anchor pair simultaneously both call `generateKeyBetween` and produce **identical** new keys. `order_key` is not `UNIQUE`, so both rows succeed — the effect is a tie in `ORDER BY order_key` (two rows alternate in the UI). No data loss; the next drag self-repairs. Single-user SQLite makes it extremely rare. Future fix: composite `(order_key, pk)` index + deterministic tiebreaker. **Don't implement now.**

**Known boundary — multi-window drag flicker.** Window A mid-drag receives window B's cache invalidation → revalidates with server state (not yet including A's in-flight reorder) → optimistic value overwritten → UI snaps back → A's PATCH returns → another revalidate brings new order in → UI jumps forward. ~150–300 ms, visual-only, no data loss. Future fix: suspend external revalidations while an in-flight PATCH holds the key.

**Why no dual-mode sort (default-by-createdAt / switch-to-custom)?** `order_key` is always present and maintained regardless of which sort mode the UI shows. Mode switching belongs at the **query layer** — a business-level Preference picks `ORDER BY lastAccessedAt DESC` or `ORDER BY order_key ASC` at read time. Keeping `order_key` unconditional gives a uniform write path and avoids "when do we first materialize keys" complexity.

---

## 9. Group Ordering

`group` table — `src/main/data/db/schemas/group.ts`. Partition column: `entityType`. Each entityType owns an independent `orderKey` sequence. `GroupService.reorder` / `reorderBatch` delegate to `applyScopedMoves` with `scopeColumn: groupTable.entityType`; see §3.1.

Resource design (API shape, consumer-side `groupId` linkage) is documented on `GroupService` and consumer migrations — not here.

---

## 10. Pin Ordering

`pin` table — `src/main/data/db/schemas/pin.ts`. Partition column: `entityType`. Pin order is scoped per entityType via `scopedOrderKeyIndex('pin', 'entityType')`. `PinService.reorder` / `reorderBatch` delegate to `applyScopedMoves` with `scopeColumn: pinTable.entityType`; see §3.1.

Resource design (polymorphic `(entityType, entityId)` shape, idempotent concurrent-safe `pin()`, `purgeForEntity` delete contract, hard-delete-on-unpin) is documented on `pin.ts` schema and `PinService` — not here.
