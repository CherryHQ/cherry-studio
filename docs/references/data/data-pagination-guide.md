# Pagination Guide

Canonical spec for paginating any list endpoint in the DataApi system. It is the
single home for the cross-cutting pagination concepts; the type signatures, hook
APIs, and the server-side codec each keep their own authoritative doc and are
linked from here. This is the sibling of [Ordering Guide](./data-ordering-guide.md) —
ordering and pagination are the two list-shaping concerns, and a list endpoint
often uses both at once.

> If you only need one fact: pagination has **two modes** — offset and cursor.
> A given endpoint is **one or the other**, fixed in its schema, and the type
> system enforces the matching hook and response shape end to end.

## 1. Two Modes — Pick One Per Endpoint

| Mode | Request params | Response | Renderer hook | Use it for |
|---|---|---|---|---|
| **Offset** | `page` + `limit` | `{ items, total, page }` | `usePaginatedQuery` | Page navigation, tables, "page 3 of 12", anything that needs a `total` count |
| **Cursor** (keyset) | `cursor` + `limit` | `{ items, nextCursor? }` | `useInfiniteQuery` | Infinite scroll, chat history, feeds, large/append-only data where offset would drift under concurrent writes |

The mode is a property of the endpoint, declared once in its API schema, and is
**not caller-configurable**. Mixing them is a compile-time error, not a runtime
hang: `usePaginatedQuery` rejects a cursor path and `useInfiniteQuery` rejects an
offset path (the path generic is constrained via `OffsetPaginatedPath` /
`CursorPaginatedPath`, both derived from `InferPaginationMode`).

**Choosing offset vs cursor.** Prefer **cursor** for anything that grows without
bound or is read newest-first while being written to (messages, sessions,
translate/painting history) — offset's `page * limit` window silently skips or
repeats rows when items are inserted between requests. Prefer **offset** when the
UI shows discrete page controls or needs an exact total (knowledge bases,
assistants, files, MCP servers).

## 2. The Four Layers (Quickstart)

Adding pagination to a list endpoint touches the same four layers as ordering.
Each layer has an authoritative doc — this guide is the map.

| Layer | What you write | Authoritative doc |
|---|---|---|
| **1. API schema** | `query` = `OffsetPaginationParams` / `CursorPaginationParams` (compose with `SortParams` / `SearchParams`); `response` = `OffsetPaginationResponse<T>` / `CursorPaginationResponse<T>` | [api-types.md § Pagination Types](./api-types.md#pagination-types) |
| **2. Server service** | Offset: `(page-1)*limit` + `count(*)`. Cursor: the shared `keysetCursor` codec + `keysetOrdering` (never hand-roll the cursor or the `ORDER BY`) | [data-api-in-main.md](./data-api-in-main.md), [services/utils README — `keysetCursor.ts`](../../../src/main/data/services/utils/README.md) |
| **3. Renderer hook** | Offset: `usePaginatedQuery`. Cursor: `useInfiniteQuery` + `useInfiniteFlatItems` | [data-api-in-renderer.md](./data-api-in-renderer.md#useinfinitequery-cursor-based-infinite-scroll) |
| **4. Query-param wire format** | `page`+`limit`, `cursor`+`limit`, `sortBy`+`sortOrder`, `search` | [api-design-guidelines.md § Query Parameters](./api-design-guidelines.md#query-parameters) |

## 3. Wire Contract

### Request parameters

These four composable param interfaces live in `src/shared/data/api/apiTypes.ts`
(see [api-types.md § Pagination Types](./api-types.md#pagination-types) for the
full table):

| Type | Fields | Notes |
|---|---|---|
| `OffsetPaginationParams` | `page?`, `limit?` | `page` is 1-based |
| `CursorPaginationParams` | `cursor?`, `limit?` | `cursor` is an **opaque, exclusive** boundary token |
| `SortParams` | `sortBy?`, `sortOrder?` | `sortOrder` is `'asc'` / `'desc'` |
| `SearchParams` | `search?` | Compose as needed |

Compose them in a route's `query` with `&`:

```typescript
// Offset list with sort + search
query?: OffsetPaginationParams & SortParams & SearchParams & { type?: string }
response: OffsetPaginationResponse<Item>

// Cursor feed
query?: CursorPaginationParams & { userId: string }
response: CursorPaginationResponse<Message>
```

### Response shapes

| Type | Fields | Description |
|---|---|---|
| `OffsetPaginationResponse<T>` | `items`, `total`, `page` | Page-based results |
| `CursorPaginationResponse<T>` | `items`, `nextCursor?` | `nextCursor` absent ⇒ no more data |
| `PaginationResponse<T>` | union of both | Use only when either mode is acceptable; narrow with `isOffsetPaginationResponse` / `isCursorPaginationResponse` |

Endpoints frequently **extend** these base responses with extra top-level
metadata — e.g. `TranslateHistoryListResponse extends CursorPaginationResponse<T>`
adds `total`, and `BranchMessagesResponse` (`GET /topics/:id/messages`) adds
`activeNodeId` / `rootId` / `assistantId`. The `items` array and the pagination
fields stay exactly as above; `useInfiniteFlatItems` reads only `items` while
consumers read the extras off `pages[0]` (see § 5).

### Cursor semantics — exclusive boundary

The `cursor` marks an **exclusive** boundary: the cursor item itself is never
included in the response. Direction is per-endpoint:

| Pattern | Use case | Behaviour |
|---|---|---|
| "after cursor" | Forward pagination, newer items | Returns items **after** the cursor |
| "before cursor" | Backward / historical loading | Returns items **before** the cursor |

For example, `GET /topics/:id/messages` uses "before cursor" to walk backward
through history; other endpoints may page forward. The concrete direction is the
endpoint's documented contract.

```typescript
// Illustrative — load most-recent messages, then older ones
const res1 = await api.get('/topics/123/messages', { query: { limit: 20 } })
// res1: { items: [msg80...msg99], nextCursor: 'msg80-id', activeNodeId: '...' }

const res2 = await api.get('/topics/123/messages', {
  query: { cursor: res1.nextCursor, limit: 20 }
})
// res2: { items: [msg60...msg79], nextCursor: 'msg60-id' }
// msg80 is NOT in res2 — the cursor is exclusive.
```

### Client-side derivations

```typescript
// OffsetPaginationResponse
const pageCount = Math.ceil(total / limit)
const hasNext = page * limit < total
const hasPrev = page > 1

// CursorPaginationResponse
const hasNext = nextCursor !== undefined
```

The renderer hooks compute these for you (see § 5) — derive by hand only when
calling `DataApiService` directly.

## 4. Server Implementation

### Offset

Compute `offset = (page - 1) * limit`, run the page query and a `count(*)` in
one `Promise.all`, and return `{ items, total, page }`. The canonical real
example is `AssistantService.list` (`src/main/data/services/AssistantService.ts`,
backing `GET /assistants`):

```typescript
async list(query: ListAssistantsQuery): Promise<{ items: Assistant[]; total: number; page: number }> {
  const { page, limit } = query
  const offset = (page - 1) * limit
  const [rows, [{ count }]] = await Promise.all([
    this.db.select().from(assistantTable).where(whereClause)
      .orderBy(...orderByClauses).limit(limit).offset(offset),
    this.db.select({ count: sql<number>`count(*)` }).from(assistantTable).where(whereClause)
  ])
  return { items: rows.map(rowToEntity), total: Number(count), page }
}
```

Keep the same `whereClause` on both queries so the count matches the page. When
filtering against a related table, filter via a `WHERE` subquery (not a `JOIN`)
so `count(*)` does not multiply rows.

### Cursor (keyset)

List endpoints that page by a `(sortKey, id)` tuple **must** use the shared codec
and ordering builder in `src/main/data/services/utils/keysetCursor.ts` — never
hand-write the cursor encode/decode, the keyset `WHERE` tuple, or the `ORDER BY`.
Doing it by hand is how the WHERE predicate and the ORDER BY drift apart and
silently skip or repeat rows at the page boundary.

```typescript
import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

// One direction spec yields BOTH the WHERE predicate and its matching ORDER BY.
const ordering = keysetOrdering(table.createdAt, table.id, { major: 'desc', tie: 'asc' })
const cursor = decodeListCursor(query.cursor, asNumericKey, 'translate-history')

const conditions: SQL[] = [...filterConditions]
if (cursor) conditions.push(ordering.where(cursor))

const rows = await db.select().from(table)
  .where(and(...conditions))
  .orderBy(...ordering.orderBy)   // cannot drift from ordering.where — same dir spec
  .limit(limit + 1)               // fetch one extra to detect "has next"

const hasNext = rows.length > limit
const pageRows = hasNext ? rows.slice(0, limit) : rows
const tail = pageRows.at(-1)
const nextCursor = hasNext && tail ? encodeCursor(tail.createdAt, tail.id) : undefined
return { items: pageRows.map(rowToEntity), nextCursor }
```

`TranslateHistoryService` (`src/main/data/services/TranslateHistoryService.ts`)
is the canonical real implementation of this pattern (it returns an extended
response that also carries `total` — see § 3). The codec's full
export surface, the `<key>:<id>` wire format, the empty-key guard, and the
list-vs-search decode policy split are documented in
[services/utils README — `keysetCursor.ts`](../../../src/main/data/services/utils/README.md).

**Decode policy — fall back, don't throw.** `decodeListCursor` treats an absent
cursor as "first page" (no warn) and a malformed cursor as a warn-and-fall-back
to the first page. A server-issued opaque token going stale must never throw and
lock the renderer. (Full-text search uses the opposite policy — see § 6.)

**Multi-band cursors are not routable through `keysetOrdering`.** A cursor that
encodes more than a single `(key, id)` tuple — e.g. `TopicService.listByCursor`,
which pages a pinned section then an unpinned section with a first-page sentinel —
cannot be expressed as one tuple and keeps its **own** codec. Do not force such
endpoints through the shared helper.

**Determinism under ties.** `keysetOrdering` always appends the `id` tiebreaker
(`[<major> keyCol, <tie> idCol]`), so page-walking stays deterministic even when
two rows share the same sort key (e.g. an `order_key` collision). This is by
construction, not a fix for an observed skip/dup — see
[Ordering Guide § 8 FAQ — fractional-indexing collisions](./data-ordering-guide.md#8-faq).

## 5. Renderer Consumption

### Offset — `usePaginatedQuery`

```typescript
import { usePaginatedQuery } from '@data/hooks/useDataApi'

const { items, page, total, hasNext, hasPrev, nextPage, prevPage } =
  usePaginatedQuery('/assistants', { limit: 10 })   // limit defaults to 10
```

It manages the `page`/`limit` query params internally and resets to page 1 when
the rest of the query changes. The full result also exposes `isLoading`,
`isRefreshing`, `error`, `refresh`, and `reset`. Rejects cursor-paginated paths
at compile time.

### Cursor — `useInfiniteQuery` + `useInfiniteFlatItems`

`useInfiniteQuery` exposes the **raw `pages` array**; consumers derive a flat
item list with `useInfiniteFlatItems`, explicitly picking the order that matches
the endpoint and the container layout — never assume page-load order equals
display order.

```typescript
import { useInfiniteQuery, useInfiniteFlatItems } from '@data/hooks/useDataApi'

// Simple feed: page 0 newest, within-page descending — page order == display order
const { pages, hasNext, loadNext, isLoading } = useInfiniteQuery('/feed')
const items = useInfiniteFlatItems(pages)

// Branch-walk in a `column-reverse` chat container: flip each page so the flat
// output is newest-first and feeds straight into the reversed layout.
const { pages, hasNext, loadNext } = useInfiniteQuery('/topics/:topicId/messages', {
  params: { topicId }
})
const messages = useInfiniteFlatItems(pages, { reverseItems: true })
const activeNodeId = pages[0]?.activeNodeId ?? null   // top-level metadata, no cast

// Time-ascending render in a non-`column-reverse` container: flip page order
const ascItems = useInfiniteFlatItems(pages, { reversePages: true })
```

`pages` is reference-stable across rerenders while SWR's underlying data is
unchanged, so `useInfiniteFlatItems(pages)` skips recomputation. Rejects
offset-paginated paths at compile time. See
[data-api-in-renderer.md](./data-api-in-renderer.md#useinfinitequery-cursor-based-infinite-scroll)
for the hook signatures and the hook-choosing table.

### Reorder + pagination

`useReorder` works on paginated lists transparently. Both
`OffsetPaginationResponse` (`{ items, total, page }`) and
`CursorPaginationResponse` (`{ items, nextCursor }`) fall under the same
`{ items }` cache branch — metadata fields pass through unchanged on optimistic
writes, and any visible row's id is a valid drag anchor even when the list never
fits on screen. See
[Ordering Guide § 4.3 Supported cache shapes](./data-ordering-guide.md#43-supported-cache-shapes).

## 6. Full-Text Search Pagination

FTS5 search endpoints paginate with the **same `<key>:<id>` cursor format** but a
**different decode policy**: a malformed search cursor is a client contract
violation and throws `422` (`ftsSearch.decodeSearchCursor`), whereas a malformed
list cursor warns and falls back to the first page (`decodeListCursor`, § 4). The
two share `parseCursor` / `encodeCursor` and differ only in the throw policy. The
FTS core (candidate filtering, bounded offset scanning, next-cursor assembly)
lives in `src/main/data/services/utils/ftsSearch.ts`; see
[services/utils README — `ftsSearch.ts`](../../../src/main/data/services/utils/README.md).

## 7. Gotchas

- **Cursor is exclusive** — the cursor row is never re-returned. Off-by-one bugs
  come from assuming inclusivity.
- **Never hand-roll keyset SQL** — use `keysetOrdering` so the `WHERE` tuple and
  `ORDER BY` derive from one direction spec and cannot disagree.
- **Always append the `id` tiebreaker** — a sort on the major key alone is
  non-deterministic under ties and breaks keyset page-walking.
- **Keep `whereClause` identical** on the offset page query and its `count(*)`,
  or `total` won't match the page.
- **List cursors warn-and-fall-back; search cursors throw 422** — don't copy one
  policy into the other.
- **Multi-band cursors keep their own codec** — `TopicService.listByCursor` is
  not routable through `keysetOrdering`.
- **Page-load order ≠ display order** — choose `reversePages` / `reverseItems`
  in `useInfiniteFlatItems` deliberately.

## 8. See Also

- [api-types.md § Pagination Types](./api-types.md#pagination-types) — type signatures, guards, `Infer*` helpers
- [data-api-in-renderer.md](./data-api-in-renderer.md#useinfinitequery-cursor-based-infinite-scroll) — `usePaginatedQuery` / `useInfiniteQuery` / `useInfiniteFlatItems`
- [data-api-in-main.md](./data-api-in-main.md) — service-layer patterns
- [services/utils README](../../../src/main/data/services/utils/README.md) — `keysetCursor.ts` codec + `ftsSearch.ts`
- [api-design-guidelines.md § Query Parameters](./api-design-guidelines.md#query-parameters) — wire-format conventions
- [Ordering Guide](./data-ordering-guide.md) — the sibling list-shaping concern; reorder cache shapes and tie determinism
