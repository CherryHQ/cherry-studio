---
description: Rules for column nullability and single-source default placement across DB, Drizzle, Zod, and service layers
sources:
  - src/main/data/db/schemas
  - src/shared/data/api/schemas
  - src/main/data/services
---

# Default Values & Nullability

Standards for placing default values across the data stack and judging column nullability.
Read this when designing a new SQLite table, defining a Zod entity schema, or reviewing PRs
that introduce defaults, partial updates, or object merges at any layer.

## Problem

A default value can technically be placed in **six** distinct locations in this stack:

| # | Layer | Timing | Direction |
|---|---|---|---|
| 1 | DB column `DEFAULT 'X'` | INSERT (SQL) | Write |
| 2 | Drizzle `$defaultFn` / `$default` | INSERT (JS, before SQL) | Write |
| 3 | Zod schema `.default()` (entity / Create / Update) | `.parse()` | Write |
| 4 | Service explicit `dto.x ?? DEFAULT` | Pre-INSERT | Write |
| 5 | `rowToEntity` `row.x ?? DEFAULT` | Post-SELECT | **Read** |
| 6 | Renderer form / hook pre-fill | Before POST | Write (upstream) |

When the same field has defaults defined in **more than one** place, the values must be kept
in sync by hand, and any drift produces silent bugs:

- **PATCH leakage**: Zod v4 `.partial()` retains `.default()` on inner fields, so a
  `PATCH /entity/:id { fooId: 'x' }` body parsed against `UpdateSchema = CreateSchema.partial()`
  materializes every default value. The service then writes those defaults to the row,
  overwriting user-set fields. (Zod issues #4799, #5642, #4179.)
- **Read/write drift**: a `rowToEntity` masks DB NULL with a hardcoded `'🌟'`. Months later
  someone changes the Zod create default to `'✨'`. New rows get `'✨'`; older rows still
  surface as `'🌟'`. The two ends of the same field disagree.

The rules below close both classes of bug by enforcing **one source of truth per field**
plus **read paths that don't fabricate state the DB doesn't carry**.

## Five Rules

### R1. NULL vs NOT NULL must reflect domain semantics

A column is `nullable` only when **NULL carries a domain meaning distinct from any value
in the column's domain**. Examples:

- `assistant.modelId`: NULL = "no model selected yet" — a real product state, distinct from
  any specific model id.
- `topic.deletedAt`: NULL = "not deleted" — no timestamp value can express this.
- `message.parentId`: NULL = "root node" — distinct from any non-empty id.

Otherwise the column is `NOT NULL`. If a column "should" always have a value but is
currently nullable, **fix the column constraint**, not the read path.

### R2. Each field has at most one source of truth for its default

Pick exactly one of locations #1–#4 (write-side) per field, plus location #5 only when
the field is genuinely `T | null` and the read should preserve it. **Never define the same
default in multiple places.** The chooser is in
[Decision Matrix 2](#decision-matrix-2-where-should-the-default-value-live).

### R3. Read path must not fabricate defaults

`rowToEntity` may only:

- spread a row;
- run `nullsToUndefined(row)` once at the SQLite NULL → TypeScript `undefined` boundary;
- call `timestampToISO` / `timestampToISOOrUndefined` for `Date.now()` ↔ ISO conversion;
- narrow string fields to literal-union types (e.g. `clean.type as McpServer['type']`).

`row.x ?? someValue` is **forbidden**. If the impulse arises, the column is mis-designed:
switch it to `NOT NULL` with a DB DEFAULT or `$defaultFn`, or accept that the entity field
is genuinely `T | null` and surface NULL to the renderer.

**Exception**: when the domain type declares `T | null` (e.g. `AssistantSchema.modelId.nullable()`),
bypass `clean` and reference `row.x` directly to preserve the contract. See
[Row → Entity Mapping](./data-api-in-main.md#row--entity-mapping).

### R4. Write path covers only what the database cannot

`service.create()` should pass values into `db.insert(...).values({...})` **only** for
columns where:

1. The column is `NOT NULL`, AND
2. The column has neither a DB `DEFAULT` nor a `$defaultFn`, AND
3. The DTO doesn't already supply a value.

For everything else, **omit the field**. Drizzle leaves it out of the SQL; the DB applies
its own default (or NULL for nullable columns). Don't restate values the DB already knows.

### R5. Update schema must derive from a defaults-free source

`UpdateSchema = SourceSchema.pick(...).partial()` is safe from default leakage **only
when the selected fields, including their nested schemas, are defaults-free**. This applies
whether the source is Create or Entity. Zod v4 applies defaults inside optional fields;
`.partial()` does not remove them or make nested objects partial.

Reuse defaults-free field atoms and the mutable-field whitelist:

```ts
// Safe from default leakage only if the selected field schemas are defaults-free.
export const UpdateXxxSchema = XxxSchema.pick(XXX_MUTABLE_FIELDS).partial()
```

Check `.default()`, `.prefault()`, preprocessing, and transforms throughout the selected
shape. A PATCH parser must not synthesize omitted updates or use `.catch()` to turn an
invalid supplied value into an omitted update. Filtering parsed keys against the raw body
is not a replacement for fixing the schema: a top-level filter cannot repair nested defaults.

This dovetails with [API Design Guidelines § Rule C](./api-design-guidelines.md#c-derive-dtos-via-pick-whitelist-with-field-atoms-and-zstrictobject).

## PATCH and Merge Contract

These rules govern new or deliberately revised update contracts. Existing differences
must be audited and migrated with their callers; this section does **not** authorize a
global cleanup function or silently change an existing deletion convention.

### P1. Separate state, changes, and resolved values

An entity describes state; a PATCH describes instructions for changing that state; a
resolved configuration includes inherited values. They are not interchangeable objects.
`DataApiService.patch()` selects a method and transports a body — it does not choose a
merge algorithm. Neither the name `PATCH` nor `Partial<T>` implies JSON Merge Patch.

The owning DTO must declare each mutable field's update granularity: scalar assignment,
whole-value replacement, first-level merge, recursive merge, or explicit collection
operations. Reuse the owning field schemas; do not create a second handwritten vocabulary.

### P2. Define presence before choosing an operator

The following applies to **members of a patch object**. Inside a whole replacement value,
omitted members belong to the new value; they do not inherit members from the old one.

| Input | Contract for new partial-update DTOs |
|---|---|
| Key absent | No instruction: preserve stored state, including whether an override exists. |
| Own key with `undefined` | For an optional patch member, no instruction. Normalize to absence at the owning boundary before applying the patch; never interpret it as deletion. A required replacement member still needs a valid value. |
| `null` | Only accepted with a named field meaning: store domain NULL, remove an override, or another explicitly declared state. These meanings are not interchangeable. |
| `false`, `0`, `''` | Preserve if valid for that field; never use truthiness to decide whether to update. |
| `[]` | Clear a replacement collection; perform no operations for an explicitly declared operation list. Never infer which from the array alone. |
| `{}` | Determined by the field's algorithm. It can replace an object with an empty one or leave an existing object unchanged under a merge. |

Normalize only at declared patch locations, after identifying allowed fields. Do not
recursively strip all empty values, discard unknown keys to make validation pass, or
round-trip through JSON to "clean" a request. Known object shapes reject unknown fields;
an intentionally open extension map must declare its value and reserved-key policy.
The canonical patch passed to merge logic has no `undefined` members at those locations.

Use a named clear/reset operation when `null` is already a meaningful stored value and
cannot also unambiguously express removal. Do not add such an operation to fields that
do not need it. `value == null` is not a deletion test: it also matches `undefined`.

**Existing exception:** `UpdateAgentDto.configuration` explicitly uses an own
`undefined` value to delete a first-level key. Its schema and service currently preserve
that distinction. Keep it until a dedicated caller-and-service migration establishes a
replacement contract; applying generic undefined filtering would break reset behavior.

### P3. Merge according to the domain, not the object's depth

- Choose replacement for an indivisible value, and partial merge only where members
  can be updated independently. A nested object is not evidence that it needs deep merge.
- Arrays replace as a unit unless the DTO explicitly defines operations using stable
  item identity. Generic array concatenation or index-wise deep merge is not PATCH policy.
- If claiming RFC 7396, follow its JSON semantics: object members merge recursively,
  `null` members delete, and arrays/scalars replace. JSON has no `undefined` value.
  An empty object patch on a non-object target produces an object, not a universal no-op.
- Evaluate affected cross-field invariants against the resulting state, not just the
  supplied fragment. Do not silently repair unrelated stored data during an update;
  invalid legacy state requires an explicit migration or rejection policy.

### P4. Apply changes once, against authoritative stored state

The producer sends the intended changed fields, not a spread of a cached entity or
resolved configuration. Whole-value replacement is allowed only when that is the actual
operation; if stale replacement can overwrite another writer, define conflict handling.

The boundary validates shape and presence without creating defaults. The owning service
applies the patch to current **stored** values, validates affected invariants, and persists
the result. Internal service callers must obey the same contract as handler callers.
Do not merge into a preset-expanded read model and persist inherited values as overrides.
Equality to today's default alone does not prove the user's intention was to inherit.

Use synchronous `withWriteTx` for read-then-write and related multi-table changes; a single
column assignment can use one atomic statement. Follow [Write Serialization](./database-patterns.md#write-serialization-dbservicewithwritetx).
Audit actual interleaving opportunities rather than assuming every synchronous read
outside a transaction is a race. Define empty-patch, missing-resource, timestamp, and
post-commit notification behavior; an empty change must not accidentally reset data.

Drizzle's omission of `undefined` in `.set()` concerns **column assignments**, not members
inside a supplied JSON-column value. `{ settings: { ...old, ...patch } }` can overwrite a
nested member with `undefined`; ignoring undefined columns does not preserve that member.

### P5. Preserve meaning across the actual transport

Trace caller → schema → adapter → handler → service → storage. Electron IPC uses
Structured Clone, not a JSON stringify/parse round-trip. Do not assume an own undefined
key disappears in transit. Conversely, JSON cannot encode an undefined deletion marker.
If an operation crosses JSON, persistence, or replay boundaries, prove that its meaning
survives those boundaries; serializing the final state is different from serializing a patch.

### Audit and verification requirements

For each update chain, record the producer and writer locations plus this contract:

| Audit item | Required evidence |
|---|---|
| Allowed fields and presence | Raw and parsed forms for absent, own undefined, null, invalid, and unknown members; include nested patch locations. |
| Update granularity | Per-field replacement/merge/collection rule, clear/reset representation, and reserved-key ownership. |
| Defaults and inheritance | Where defaults originate; whether the write uses raw stored state or a resolved snapshot. |
| Persistence | Resulting row/JSON/relations, affected invariants, transaction scope, and failure atomicity. |
| Other consumers | Renderer and internal writers, real transport encoding, replay/retry behavior, and observable no-op behavior. |

Tests must start with meaningful non-default stored values and assert the promised final
state, including untouched siblings and explicit clears. Cover invalid input with no
partial writes, empty objects/arrays, and the actual serialization boundary in use.
Use the repository's [database test setup](../testing/database-testing.md), not mocked
Drizzle chains. A merge function test alone cannot prove that a caller sends a patch.

For each implemented correction, demonstrate a failing regression test or a targeted
mutation (for example, introduce an unintended default or replace a merge with a spread),
then restore it. Expected values come from the domain contract or producer-owned fixtures,
not from copying current implementation output. External protocol assertions cite their
source and retrieval date. Static inspection is not runtime verification.

Protocol/library references, retrieved **2026-09-14**:

- [RFC 7396 §2](https://www.rfc-editor.org/rfc/rfc7396.html#section-2) — JSON Merge Patch algorithm.
- [Zod 4 migration guide](https://zod.dev/v4/changelog#defaults-applied-within-optional-fields) — defaults inside optional fields.
- [Drizzle update](https://orm.drizzle.team/docs/update) — undefined column assignments versus null.
- [Electron ipcRenderer.invoke](https://www.electronjs.org/docs/latest/api/ipc-renderer#ipcrendererinvokechannel-args) — Structured Clone transport.

## Decision Matrix 1: Should this column be NULL or NOT NULL?

| Pattern | Choose | Example |
|---|---|---|
| Optional foreign key | `nullable` | `assistant.modelId`, `task.assigneeId`, `message.parentId` |
| Time of an event that may not have occurred | `nullable` | `deletedAt`, `cancelledAt`, `lastLoginAt` |
| Tri-state boolean | `nullable` | `verification.passed: true \| false \| null` |
| Sparse attribute where "absent" ≠ "empty" | `nullable` | `user.middleName`, `product.discontinuedReason` |
| Unassigned-tagged state | `nullable` | `pr.reviewerId` (unassigned vs assigned) |
| Every row should have a value, with `''` / `0` / `[]` as the "empty" form | `NOT NULL` + DB DEFAULT | `assistant.prompt = ''`, `agent.sortOrder = 0`, `tag.color` |
| Product policy "every row has X by default" | `NOT NULL` + DB DEFAULT | `assistant.emoji = '🌟'` |
| Counter / aggregate | `NOT NULL` + DB DEFAULT | `views`, `retryCount` |
| Audit timestamps | `NOT NULL` + `$defaultFn` | `createdAt`, `updatedAt` |
| Required foreign key | `NOT NULL` | `topic.userId`, `message.topicId` |

**Reverse check**: if `rowToEntity` carries `row.x ?? someValue` for column `x`, that is
reverse evidence that `x` should be `NOT NULL` — see R3.

## Decision Matrix 2: Where should the default value live?

| Location | Best for | Trade-off | SQLite-specific note |
|---|---|---|---|
| **#1 DB DEFAULT** (`text().notNull().default('')`) | Type-level "empty" values that **by definition won't change** (`''`, `0`, `false`, `[]`) | Single source at the schema; DB enforces it for any caller including raw SQL | **Effectively a near-permanent choice in SQLite** — every change forces a full-table rebuild and never touches existing rows. See [§ DB defaults are near-permanent](#db-defaults-are-near-permanent) below. |
| **#2 Drizzle `$defaultFn`** (`integer().$defaultFn(() => Date.now())`) | Dynamic per-row values: UUIDs, `Date.now()` | Lives in schema file but runs in the JS layer; consistent for all Drizzle-driven inserts | Doesn't apply to raw SQL writers — but those should be rare here |
| **#3 Zod `.default()`** | **Avoid** on entity / Create / Update — see warnings below | Couples shared schema package to runtime constants; forces `z.input` / `z.output` type split; bypasses non-handler callers (seeders, internal-service calls) | n/a |
| **#4 Service `dto.x ?? DEFAULT`** | Tunable product values that may evolve (e.g. `DEFAULT_ASSISTANT_SETTINGS`) | Lives next to business logic; covers **all** callers (handler, seeder, internal); changes are pure code edits with no migration | Best fit when the ideal value tracks product iteration |

### Why Zod `.default()` is discouraged

1. **Caller asymmetry** — Zod defaults run at `.parse()` time. Handler-driven inserts get
   them; seeder / service-to-service / migration code paths construct DTOs directly and
   don't, producing inconsistent rows.
2. **Type duality** — `.default()` makes a schema's `z.input` and `z.output` types diverge:
   body callers see optional fields, service receivers see required ones. Either every
   `Create*` schema spawns paired `…Body` / `…Dto` types, or one of the two ends is
   mistyped.
3. **PATCH leakage** — see R5. Even when defaults live only on Create, deriving Update
   from Create re-introduces them; deriving from entity adds rule complexity that's easy
   to forget.

If a default truly must live in Zod (e.g., a query-string parameter with a baseline
value), keep it on the **specific** schema it applies to (typically `ListXxxQuerySchema`),
never on the entity, Create, or Update.

### DB defaults are near-permanent

Putting a value into a DB column `DEFAULT` for the first time costs nothing — it lands in the next migration's `CREATE TABLE`. **Changing it later is expensive and asymmetric**, so the first write is effectively the final one. Three forces compound:

- **SQLite has no `ALTER COLUMN SET DEFAULT`** ([sqlite.org/lang_altertable](https://www.sqlite.org/lang_altertable.html)). Changing a `DEFAULT` requires the 12-step table-rebuild dance: create a new table with the new schema, copy data, drop, rename, recreate indexes / triggers / FKs.
- **Each change costs a full-table rebuild at runtime**. `drizzle-kit` auto-generates the rebuild SQL (PRAGMA / `CREATE __new_xxx` / `INSERT ... SELECT` / `DROP` / `RENAME` / re-create indexes), so codegen is not the bottleneck — the SQLite operation is. It copies every row, holds a schema lock for the duration, and consumes ~2× temporary disk for the duplicated table; on multi-GB tables this is no longer free. FTS5 virtual tables and triggers attached to the rebuilt table are also dropped and must be recreated by separate custom-SQL statements.
- **`DEFAULT` changes never touch existing rows**. Rows created before the change keep their old default value. If the new constraint can't tolerate the old values (e.g. tightening to `NOT NULL` while legacy rows hold `NULL`), the rebuild's `INSERT ... SELECT` line must be hand-edited with `COALESCE(col, 'fallback')` — `drizzle-kit` will not synthesize that for you.

Before placing a value into a DB `DEFAULT`, ask:

| Question | If you can't confidently answer "yes" |
|---|---|
| Has this value been validated against real product usage? | Move to service `??` until validated |
| Is this value's meaning **stable** against provider updates / UX redesigns / A/B tests / regulatory changes? | Move to service `??` |
| Is "rows created before any future change keep the old default" acceptable? | Move to service `??`, or budget a backfill migration upfront |

**The safe bias**: only DB-DEFAULT the values that are **type-level "empty"** (`''`, `0`, `false`, `[]`) — those almost never change because they're absence markers, not product decisions. Anything that's a product choice (`'🌟'`, default model parameters, sentinel category values) goes in service `??` first; promote to DB only after the value has stabilized through at least one release cycle in production.

A service-side default change is a code edit, one PR, no migration risk. A DB `DEFAULT` change is a full-table rebuild migration: copy every row, recreate indexes / triggers / FTS, and hand-write `COALESCE` for any legacy NULL backfill the new constraint can't tolerate. Reviewed differently, gated differently, slow on production-sized tables. **Don't trade tomorrow's agility for today's tidiness.**

### Quick chooser

| Default value's character | Pick |
|---|---|
| Type-level "empty" by definition (`''`, `0`, `false`, `[]`) — won't change because not a product choice | DB DEFAULT |
| Dynamic per row (timestamps, UUIDs) | Drizzle `$defaultFn` |
| Product-chosen value (`'🌟'`, model parameters, sentinel category) — could conceivably evolve | Service `??` |
| Unsure whether it'll ever change | **Service `??`** — cheap to change later; promote to DB only after the value has stabilized |

Skip Zod regardless.

## Standard Layered Design

Reference end-state for an `assistant`-like entity, demonstrating R1–R5:

```ts
// ─── DB schema ────────────────────────────────────────────────
// Stable defaults live here; settings has no DB DEFAULT because it's a
// tunable product value (Service is its source of truth).
export const assistantTable = sqliteTable('assistant', {
  id: uuidPrimaryKey(),                                  // $defaultFn UUID
  name: text().notNull(),                                // required, no default
  prompt: text().notNull().default(''),                  // type-level empty: DB handles
  emoji: text().notNull(),                               // product-chosen ('🌟' may evolve): Service fills
  description: text().notNull().default(''),             // type-level empty: DB handles
  modelId: text().references(() => userModelTable.id),   // legitimately nullable (R1)
  settings: text({ mode: 'json' })
    .$type<AssistantSettings>()
    .notNull(),                                          // NOT NULL, no DB DEFAULT — Service fills
  ...createUpdateDeleteTimestamps                        // $defaultFn for createdAt / updatedAt
})
```

```ts
// ─── Zod schema ───────────────────────────────────────────────
// Pure shape: no .default() calls anywhere.
export const AssistantSchema = z.strictObject({
  id: AssistantIdSchema,
  name: z.string().min(1),
  prompt: z.string(),
  emoji: z.emoji(),
  description: z.string(),
  modelId: UniqueModelIdSchema.nullable(),               // T | null contract preserved
  settings: AssistantSettingsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type Assistant = z.infer<typeof AssistantSchema>

const ASSISTANT_MUTABLE_FIELDS = {
  name: true, prompt: true, emoji: true, description: true,
  modelId: true, settings: true
} as const

// Create: all mutable fields, all optional except `name`. No defaults.
export const CreateAssistantSchema = AssistantSchema
  .pick(ASSISTANT_MUTABLE_FIELDS).partial().required({ name: true })
export type CreateAssistantDto = z.infer<typeof CreateAssistantSchema>

// Update: derived from entity, not from Create. R5.
export const UpdateAssistantSchema = AssistantSchema
  .pick(ASSISTANT_MUTABLE_FIELDS).partial()
export type UpdateAssistantDto = z.infer<typeof UpdateAssistantSchema>
```

```ts
// ─── Service ──────────────────────────────────────────────────
create(dto: CreateAssistantDto): Assistant {
  const row = this.db.insert(assistantTable).values({
    ...dto,
    emoji: dto.emoji ?? '🌟',                             // product-chosen default: Service is the source of truth
    settings: dto.settings ?? DEFAULT_ASSISTANT_SETTINGS  // tunable product default: Service is the source of truth
    // prompt / description omitted → DB DEFAULT '' applies
    // modelId omitted (or null) → SQLite stores NULL
  }).returning().get()
  return rowToAssistant(row)
}

update(id: string, dto: UpdateAssistantDto): Assistant {
  const row = this.db.update(assistantTable)
    .set(dto)                                            // Column assignments; no nested merge implied.
    .where(eq(assistantTable.id, id)).returning().get()
  return rowToAssistant(row)
}
```

The update sketch shows non-empty column assignments only. A production method also
handles empty changes and missing rows; JSON partial updates need the field-specific
semantics in [PATCH and Merge Contract](#patch-and-merge-contract).

```ts
// ─── Row → Entity ─────────────────────────────────────────────
// No `??` fallbacks. R3.
function rowToAssistant(row: typeof assistantTable.$inferSelect): Assistant {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    modelId: row.modelId,                                // preserve T | null contract
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}
```

## Anti-patterns

| Wrong | Why | Correct |
|---|---|---|
| Column nullable + `rowToEntity` does `row.x ?? someDefault` | Read path masks NULL state; future schema changes drift silently between layers | Make column `NOT NULL` with DB DEFAULT (R1, R3) |
| Same default value defined in DB DEFAULT, Zod `.default()`, and `rowToEntity` `??` | Three places must stay in sync; any change forgets one | Pick one source of truth (R2) |
| `UpdateSchema = SourceSchema.partial()` with defaults on selected fields | Zod v4 preserves defaults through `.partial()`; PATCH bodies materialize them and overwrite row state | Derive from defaults-free field schemas, including nested members (R5) |
| `.default(DEFAULT_X_SETTINGS)` on Zod entity / Create schema | Defaults bleed into every derived schema; non-handler callers bypass it; renderer typings split into z.input / z.output | Move default to service `??` (Decision Matrix 2) |
| `rowToEntity` running `?? '🌟'` to mask NULL | The product wants every row to have an icon — express it in the column constraint plus the **default-fill stage**, not the mapper | `text().notNull()` + service `dto.emoji ?? '🌟'` (product-chosen value belongs in service — see [§ DB defaults are near-permanent](#db-defaults-are-near-permanent)) |
| Service `create()` passes every field, including ones the DB has DEFAULTs for | Restates DB knowledge in app code; drift risk if defaults change in only one place | Omit fields the DB / `$defaultFn` already handles (R4) |
| Putting a product-chosen value (`'🌟'`, default `temperature`, sentinel category) in DB `DEFAULT` thinking "I can tune it later" | SQLite has no `ALTER COLUMN SET DEFAULT`; changing it requires a hand-written table-rebuild and doesn't update existing rows. The "tune later" assumption is false | Service `??`; promote to DB only after the value has stabilized through a release cycle (see [§ DB defaults are near-permanent](#db-defaults-are-near-permanent)) |

## Current Examples

### `assistant.prompt` and `assistant.description`: type-level empty

Both columns are `NOT NULL DEFAULT ''`. Create DTO omission delegates to the
database default, and `rowToAssistant` reads the resulting strings without a
fallback. The empty value is structural and stable, so the database owns it.

### `assistant.emoji` and `assistant.settings`: product defaults

Both columns are `NOT NULL`, but carry no database default. `AssistantService`
supplies `'🌟'` and `DEFAULT_ASSISTANT_SETTINGS` on create. The row mapper reads
the stored values directly. These product choices can evolve without rebuilding
the table merely to change a default clause.

### `assistant.modelId`: meaningful NULL

The nullable foreign key means “no model selected.” The entity schema retains
`null`, and the row mapper reads `row.modelId` directly. No layer replaces the
domain state with a fabricated default.

Together these columns show the three supported cases: a stable type-level DB
default, a service-owned product default written into a `NOT NULL` column, and a
genuinely nullable domain field.

## Related References

- [API Design Guidelines § Rule C](./api-design-guidelines.md#c-derive-dtos-via-pick-whitelist-with-field-atoms-and-zstrictobject) — DTO derivation rules
- [Database Patterns § Column Nullability and Defaults](./database-patterns.md#column-nullability-and-defaults) — column-level decision
- [DataApi in Main § Row → Entity Mapping](./data-api-in-main.md#row--entity-mapping) — `nullsToUndefined`, `T | null` preservation
- [Zod issue #4799](https://github.com/colinhacks/zod/issues/4799) — `.partial()` and `.default()` interaction
- [SQLite ALTER TABLE limitations](https://www.sqlite.org/lang_altertable.html) — why DB DEFAULT changes are painful
- [drizzle-team/drizzle-orm#2489](https://github.com/drizzle-team/drizzle-orm/issues/2489) — drizzle-kit's unsupported-SQLite-ALTER comment doesn't name the affected table/column
