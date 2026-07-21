# Data Service Utils

This directory holds **shared utility functions used by the data-service layer**. These utilities have a well-defined responsibility boundary and are not project-wide utilities.

Before using, read the [Row → Entity Mapping](../../../../../docs/references/data/data-api-in-main.md#row--entity-mapping) section of `data-api-in-main.md` to understand the service-layer paradigm and conventions (what `rowToEntity` looks like, when to use `nullsToUndefined`, etc.). The section below captures the design-decision history behind these utilities.

## File Index

### `rowMappers.ts` — Row → Entity mapping utilities

Serves each Service's `rowToEntity` function, performing the boundary translation from a SQLite row to a domain entity.

**Exports:**

#### `nullsToUndefined<T>(obj: T): { [K in keyof T]: null extends T[K] ? Exclude<T[K], null> | undefined : T[K] }`

Shallowly replaces top-level `null` values in the object with `undefined`, preserving all other values.

**Design boundaries:**

- **Shallow**: iterates top-level fields only; does not recurse into nested objects or arrays
- **Replace, not delete**: the returned object keeps every original field (value becomes `undefined`); it does not produce a `Partial<T>`
- **SQLite-column-boundary only**: designed for column NULL → TS undefined translation; `null` should not appear inside JSON payloads (if it does, fix the Zod schema instead)
- **Precise typing**: only fields whose type includes `null` are narrowed to `Exclude<T, null> | undefined`; `notNull()` columns pass through unchanged. This matches runtime reality — a `notNull()` column cannot produce `undefined` at this boundary.

**Example:**

```ts
import { nullsToUndefined } from './rowMappers'

const row = { id: 'x', name: 'MCP-1', description: null, timeout: null }
const clean = nullsToUndefined(row)
// clean = { id: 'x', name: 'MCP-1', description: undefined, timeout: undefined }
// type: { id: string; name: string; description: string | undefined; timeout: number | undefined }
```

#### `timestampToISO(value: number | Date): string`

Convert a guaranteed-present timestamp (millisecond epoch) to an ISO string. Use when the input type is already narrowed to `number | Date` — typically for `.notNull()` columns or post-validation values.

**Why the signature rejects `null | undefined`:** `new Date(null).toISOString()` silently returns the Unix epoch (`"1970-01-01T00:00:00.000Z"`). Letting the type system refuse `null | undefined` at the call site turns a silent bug into a compile error.

**Behavioral note on `0`:** `0` is a legitimate timestamp (Unix epoch); this helper passes it through. This differs from `timestampToISOOrUndefined` which treats `0` as falsy.

#### `timestampToISOOrUndefined(value: number | Date | null | undefined): string | undefined`

Convert an optional DB timestamp to an ISO string, preserving absence as `undefined`. Reserved for construction paths where the **entire source row may not exist** — not "this column might be null". The audit columns `createdAt` / `updatedAt` are DB-level `NOT NULL` (see `createUpdateTimestamps` in `_columnHelpers.ts`), so a row read from the DB always has real values.

The canonical use case is a merge between a builtin/preset definition and an optional DB preference row:

```ts
function builtinToMiniApp(def: BuiltinMiniAppDefinition, dbRow?: MiniAppSelect): MiniApp {
  return {
    /* ... builtin fields ... */
    createdAt: timestampToISOOrUndefined(dbRow?.createdAt), // undefined when builtin has no preference row yet
    updatedAt: timestampToISOOrUndefined(dbRow?.updatedAt)
  }
}
```

**Behavioral note on `0`:** the helper treats `0` as falsy (matching the prior `row.x ? ... : undefined` idiom). Zero is not a valid business timestamp in this codebase.

**Picking between the two helpers:**

| Scenario | Call-site pattern |
| --- | --- |
| Standard `rowToEntity` reading a DB row (audit columns are `.notNull()`) | `timestampToISO(row.createdAt)` |
| Merge path where the source row itself may be absent (e.g. builtin + optional preference) | `timestampToISOOrUndefined(dbRow?.createdAt)` |

**Example:**

```ts
import { timestampToISO, timestampToISOOrUndefined } from './rowMappers'

timestampToISO(1700000000000)                       // "2023-11-14T22:13:20.000Z"
timestampToISO(0)                                   // "1970-01-01T00:00:00.000Z" (passes through)

timestampToISOOrUndefined(1700000000000)            // "2023-11-14T22:13:20.000Z"
timestampToISOOrUndefined(undefined)                // undefined (e.g. builtin with no preference row)
```

### `orderKey.ts` — `order_key` column runtime operations

Backs every Service's reorder write path and POST-create. Encapsulates the `fractional-indexing` library, transactional SQL, and scope filtering behind a small set of wrappers. Required in all service POST-create and reorder paths; migrator helpers and migration scripts re-import from here.

**Exports:**

- `generateOrderKeySequence(count)` / `generateOrderKeyBetween(before, after)` / `generateOrderKeySequenceBetween(before, after, count)` — the ONLY wrappers around `fractional-indexing` in this codebase. Migrator helpers and migration scripts re-import from here.
- `insertWithOrderKey(tx, table, values, { pkColumn, position?, scope? })` — the only correct entry for POST-create endpoints on sortable tables; never write `tx.insert(table).values(...)` directly.
- `insertManyWithOrderKey(tx, table, valuesList, { pkColumn, position?, scope? })` — batch variant. Does ONE boundary-key lookup and ONE bulk `INSERT .. RETURNING` for N rows. Preferred whenever creating ≥2 rows at once (bulk imports, multi-row service ops). `insertWithOrderKey` internally delegates to it.
- `applyMoves(tx, table, moves, { pkColumn, scope? })` — the only correct entry for reorder operations (batch + single). Dedups duplicate ids (keeps last, warns). Contract rejections surface as `DataApiError`: missing target id → `NOT_FOUND`, missing anchor id → `NOT_FOUND`, anchor === own id → `VALIDATION_ERROR`. Resource name in the error is the Drizzle table name. Suitable for both fixed-scope and nullable-scope callers — the consumer constructs `scope?` (e.g. `isNull(col)` or `eq(col, value)`) and propagates the error verbatim.
- `resetOrder(tx, table, orderedRows, { pkColumn })` — paired with `POST /:res/order:reset`; rewrites `orderKey` with a fresh evenly-spaced sequence in the given order.
- `computeNewOrderKey(tx, table, request, { pkColumn, scope? })` — exported only for unit tests.

**Design boundaries:**

- **Only operates on `order_key`**: business validation (does `:id` exist in the resource sense) lives in the service/handler layer, not here.
- **Must run inside an outer transaction**: helpers take `tx` and never open their own transaction.
- **`scope?` (SQL)**: constrains neighbor queries to a subset for partial ordering (e.g. `userModel.providerId`, `group.entityType`). Scope applies to BOTH the target lookup and the anchor lookup — anchoring across scopes throws.
- **`pkColumn` is required**: tables have heterogeneous primary-key column names (`miniapp.appId`, `mcpServer.id`, `topic.id`, `group.id`). Helpers make zero assumptions.
- **External imports of `fractional-indexing` are forbidden**: always go through the three generator wrappers above.
- **Character set is locked to base62** (library default); no `digits` parameter is exposed. Changing the alphabet requires a whole-database migration, and the source-of-truth constant lives at the top of `orderKey.ts`.

### `keysetCursor.ts` — keyset (cursor) pagination codecs + predicate

Backs every list endpoint that pages by a `(sortKey, id)` tuple. It preserves the legacy `<key>:<id>` one-direction codec and adds a separate opaque, directional codec for bidirectional endpoints. Both use the same strict-tuple keyset WHERE builder, so the tie-break direction and SQL ordering live in one tested place instead of drifting per service.

**Exports:**

- `parseCursor<K>(raw, parseKey)` — pure `<key>:<id>` parser; splits on the FIRST `:` (so ids may contain `:`), returns `null` for any unparseable input (absent/empty raw, no separator, empty key, empty id, or a `parseKey` that rejects the key). Shared with `ftsSearch` so list and search parse identically.
- `encodeCursor(key, id)` — encode a `(key, id)` boundary into `<key>:<id>`; `key` may be a number or a string.
- `asNumericKey(s)` / `asStringKey(s)` — `parseKey` helpers for numeric (`createdAt`) and string (`orderKey`) sort columns. Both reject the empty string — `asNumericKey` must, because `Number('') === 0` is finite.
- `decodeListCursor<K>(raw, parseKey, context)` — list-browsing decode: an absent cursor returns `null` (first page, no warn); a malformed cursor warns once with the locked message and falls back to the first page (`null`). `context` is a short caller tag carried in the warn payload.
- `createKeysetCursorCodec({ family, parseKey, context })` — creates the strict versioned codec for `{ direction, key, id }`. The token binds the boundary to one caller-supplied query family; an absent token returns `null`, while malformed, stale-version, or wrong-family tokens warn and fall back to the query head.
- `keysetOrdering(keyCol, idCol, { major, tie })` — keeps the legacy `{ where(cursor), orderBy }` next-page surface and adds `seek('previous' | 'next')`. A scan owns its exclusive `where`, matching `orderBy`, and `finish(rows, limit)` restoration. Previous scans flip both major and tie directions, slice the SQL rows to `limit`, then restore canonical query order.

**Design boundaries:**

- **Two decode policies, deliberately split**: list browsing through either codec warns and falls back to the query head (`null`), while search throws 422 (`ftsSearch.decodeSearchCursor`). A stale server-issued list token must not lock the renderer; a malformed search cursor is a client contract violation.
- **Legacy warn message is locked**: `'decodeCursor: cursor unparseable, falling back to first page'` — kept uniform across existing call sites; the `context` field distinguishes the source.
- **Single-tuple keyset only**: covers `(key, id)` pagination. Multi-band / sentinel cursors (e.g. `TopicService`'s pin/topic union with a first-page sentinel) cannot be expressed as one `(key, id)` tuple, and their malformed-fallback returns a sentinel rather than `null` — they keep their own codec and must NOT be routed here.
- **Legacy endpoints stay one-directional**: existing `decodeListCursor` / `encodeCursor` tokens and `keysetOrdering.where` / `orderBy` semantics do not change. Adopt the directional codec only when an endpoint explicitly returns both cursor directions.
- **Query family is caller-owned**: normalize a stable identity containing the endpoint/read-model namespace, stream, semantic sort, and every search/filter/owner/workspace dimension that changes membership. Exclude page size, anchor id, resource revision, and viewport/UI state. The utility compares the exact string; it does not invent domain normalization.
- **Opaque is not authenticated**: the versioned base64url JSON encapsulates the wire shape and clients must not depend on its internals, but it is not a signature or authorization boundary. Services must still enforce all normal scope and membership filters.
- **Direction is declared once per scan**: `seek` emits the predicate, SQL order, and canonical-order restoration together, so previous/next traversal works for ASC, DESC, and manual `orderKey` sorts without the classic skip/repeat mismatch.

**Example:**

```ts
import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

const ordering = keysetOrdering(table.createdAt, table.id, { major: 'desc', tie: 'asc' })
const cursor = decodeListCursor(query.cursor, asNumericKey, 'translate-history')
const conditions: SQL[] = [...filterConditions]
if (cursor) conditions.push(ordering.where(cursor))
const rows = await db
  .select()
  .from(table)
  .where(and(...conditions))
  .orderBy(...ordering.orderBy) // never drifts from ordering.where
  .limit(limit + 1)
const nextCursor = hasNext ? encodeCursor(tail.createdAt, tail.id) : undefined
```

For a bidirectional endpoint, the request remains `{ cursor?, limit? }`; direction is carried by the server-issued token:

```ts
import { asNumericKey, createKeysetCursorCodec, keysetOrdering } from './utils/keysetCursor'

const codec = createKeysetCursorCodec({ family: normalizedFamily, parseKey: asNumericKey, context: 'messages' })
const cursor = codec.decode(query.cursor)
const scan = keysetOrdering(table.createdAt, table.id, { major: 'desc', tie: 'asc' })
  .seek(cursor?.direction ?? 'next')

const conditions: SQL[] = [...filterConditions]
if (cursor) conditions.push(scan.where(cursor))
const rawRows = await db.select().from(table)
  .where(and(...conditions))
  .orderBy(...scan.orderBy)
  .limit(limit + 1)
const page = scan.finish(rawRows, limit)

const head = page.rows.at(0)
const tail = page.rows.at(-1)
const previousTokenForHead = head
  ? codec.encode({ direction: 'previous', key: head.createdAt, id: head.id })
  : undefined
const nextTokenForTail = tail
  ? codec.encode({ direction: 'next', key: tail.createdAt, id: tail.id })
  : undefined
```

Emit those candidate tokens only when the endpoint knows data exists in that direction. `page.hasMoreInDirection` describes only the requested scan direction; whether the opposite cursor exists is an endpoint/read-model decision, so the generic helper does not probe domain membership.

### `ftsSearch.ts` — FTS cursor, filtering, and pagination core

Shared by full-text search services that use SQLite FTS5 trigram tables. It
owns the common opaque cursor codec, trigram-FTS candidate filtering, literal
regex revalidation, bounded offset scanning, and next-cursor assembly.

**FTS contract:**

- The caller's SQL must join its FTS5 virtual table aliased as `fts`.
- The FTS table must be created with `tokenize='trigram'` and expose a
  `searchable_text` column.
- The utility builds `fts.searchable_text LIKE ...` conditions and the caller
  inserts those conditions into its own SQL shape.

**Design boundaries:**

- **Cursor codec is shared**: `decodeSearchCursor` / `encodeSearchCursor` delegate the `<key>:<id>` parsing to `keysetCursor.parseCursor` / `encodeCursor`; this module keeps only the 422-throw policy and the `SearchCursor = { createdAt, id }` shape.
- **SQL shape stays with the owning service**: callers provide the raw SQL
  query and row mapper because each domain joins different tables.
- **Read-only search only**: this utility never writes, opens transactions, or
  applies domain ownership rules.
- **Snippet construction is injected**: callers decide how to build display
  snippets from matched text and terms.
- **Cursor sort keys are caller-owned**: `mapRow` returns the public item plus
  the `(createdAt, id)` boundary used to assemble `nextCursor`.
- **Candidate scans are bounded**: LIKE candidates that fail regex
  revalidation stop at the configured ceiling and log a warning instead of
  scanning an entire FTS table for one page.
- **Role coercion is caller-owned**: role subsets live with the message domain
  in `@shared/data/types/message`; this generic utility does not know message
  roles.

## Criteria for Adding a New Utility

Before adding a new utility to this directory, confirm:

1. **Has at least two real consumers** (history: `stripNulls` qualified because `MiniAppService` had made a copy-paste duplicate)
2. **Do not extract simple single-field operations**: operations like `value ?? undefined` are already well-covered by TypeScript itself — do not wrap them
3. **Does not duplicate an existing third-party library** (e.g. lodash) — unless we have specific boundary constraints
4. **Add a new entry to the "File Index" above** documenting responsibility, signature, boundaries, and an example

## Rejected Alternatives

The following approaches to the "SQLite NULL ↔ TypeScript optional" bridge were evaluated and rejected. **Do not re-propose them** unless you have new evidence that invalidates the reason given; if so, cite the data explicitly.

| Approach | Reason for rejection |
| --- | --- |
| Change domain types to `T \| null`, removing the bridge layer | Violates Google TS Style Guide; leaks `null` into the renderer; complicates IPC serialization; requires rewriting all of `shared/types` |
| Use a Drizzle custom column type with `fromDriver(null) → undefined` | Conflicts with Drizzle's type inference; high invasiveness; only saves one `nullsToUndefined` call |
| Adopt the `dnull` third-party library | Inactive maintenance (weekly 686 downloads, maintenance: inactive); recursive deep conversion is an over-match that swallows legitimate `null` values |
| Turn `nullsToUndefined` into a recursive version | Column level is the only source of physical `null`; recursion would swallow legitimate business `null` inside JSON payloads; wasted CPU on large payloads |
| Use `.notNull()` + empty-string default to eliminate `null` at schema level | Explicitly flagged as an anti-pattern by the Drizzle community ([discussion #1086](https://github.com/drizzle-team/drizzle-orm/discussions/1086)) — "masks the real problem" |
| Extract a single-field `nullToUndefined<T>(value)` helper | TS `??` already narrows types at the expression level; function wrapping adds no runtime or type benefit |
