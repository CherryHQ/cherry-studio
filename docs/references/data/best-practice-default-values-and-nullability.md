# Default Values & Nullability

Standards for placing default values across the data stack and judging column nullability.
Read this when designing a new SQLite table, defining a Zod entity schema, or reviewing PRs
that introduce defaults at any layer.

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
- narrow string fields to literal-union types (e.g. `clean.type as MCPServer['type']`).

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

`UpdateSchema = CreateSchema.partial()` is **only safe when Create has no `.default()`
calls**. Because Zod v4 retains `.default()` through `.partial()`, deriving Update from a
Create that carries defaults causes PATCH bodies to materialize those defaults, which the
service then writes to the row.

When Create has defaults — or whenever in doubt — derive Update directly from the entity:

```ts
// ✅ Always safe
export const UpdateXxxSchema = XxxSchema.pick(XXX_MUTABLE_FIELDS).partial()
```

This dovetails with [API Design Guidelines § Rule C](./api-design-guidelines.md#c-derive-dtos-via-pick-whitelist-with-field-atoms-and-zstrictobject).

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
| **#1 DB DEFAULT** (`text().notNull().default('')`) | Stable values that **rarely change** (`''`, `0`, `false`, sentinel emoji) | Single source at the schema; DB enforces it for any caller, including raw SQL | Changing a `DEFAULT` requires a hand-written table-rebuild migration — SQLite doesn't support `ALTER COLUMN SET DEFAULT`, and `drizzle-kit` only emits a placeholder comment. Acceptable for stable values; painful for tunable ones. |
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

### Quick chooser

| Default value's character | Pick |
|---|---|
| Static, literal, near-immutable (`''`, `0`, `false`, `'🌟'`) | DB DEFAULT |
| Dynamic per row (timestamps, UUIDs) | Drizzle `$defaultFn` |
| Tunable product policy that may evolve | Service `??` |
| Anything else | Try DB first, then Service. Skip Zod. |

## Standard Layered Design

Reference end-state for an `assistant`-like entity, demonstrating R1–R5:

```ts
// ─── DB schema ────────────────────────────────────────────────
// Stable defaults live here; settings has no DB DEFAULT because it's a
// tunable product value (Service is its source of truth).
export const assistantTable = sqliteTable('assistant', {
  id: uuidPrimaryKey(),                                  // $defaultFn UUID
  name: text().notNull(),                                // required, no default
  prompt: text().notNull().default(''),                  // R4: DB handles
  emoji: text().notNull().default('🌟'),                 // R4: DB handles
  description: text().notNull().default(''),             // R4: DB handles
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
async create(dto: CreateAssistantDto): Promise<Assistant> {
  const [row] = await this.db.insert(assistantTable).values({
    ...dto,
    settings: dto.settings ?? DEFAULT_ASSISTANT_SETTINGS  // R4: only field needing a service-side default
    // prompt / emoji / description omitted → DB DEFAULT applies
    // modelId omitted (or null) → SQLite stores NULL
  }).returning()
  return rowToAssistant(row)
}

async update(id: string, dto: UpdateAssistantDto): Promise<Assistant> {
  const [row] = await this.db.update(assistantTable)
    .set(dto)                                            // Drizzle skips undefined — PATCH-correct
    .where(eq(assistantTable.id, id)).returning()
  return rowToAssistant(row)
}
```

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
| `UpdateSchema = CreateSchema.partial()` with `.default()` on Create fields | Zod v4 preserves defaults through `.partial()`; PATCH bodies materialize them and overwrite row state | Derive Update from entity directly (R5) |
| `.default(DEFAULT_X_SETTINGS)` on Zod entity / Create schema | Defaults bleed into every derived schema; non-handler callers bypass it; renderer typings split into z.input / z.output | Move default to service `??` (Decision Matrix 2) |
| `rowToEntity` running `?? '🌟'` to mask NULL | The product wants every row to have an icon — express that in the column constraint, not the mapper | `text().notNull().default('🌟')` |
| Service `create()` passes every field, including ones the DB has DEFAULTs for | Restates DB knowledge in app code; drift risk if defaults change in only one place | Omit fields the DB / `$defaultFn` already handles (R4) |

## Case Studies

### A. `assistant.prompt / emoji / description / settings` — anti-pattern (current state)

Three layers each define defaults:

| Field | DB column (`assistant.ts`) | Zod Create | rowToAssistant (`AssistantService.ts`) |
|---|---|---|---|
| `prompt` | `text().default('')` (nullable) | `.default('')` | `row.prompt ?? ''` |
| `emoji` | `text()` (nullable, **no** default) | `.default('🌟')` | `row.emoji ?? '🌟'` |
| `description` | `text().default('')` (nullable) | `.default('')` | `row.description ?? ''` |
| `settings` | `text({mode:'json'}).$type<AssistantSettings>()` (nullable) | `.default(DEFAULT_ASSISTANT_SETTINGS)` | `normalizeSettings(row.settings)` |

**Diagnosis**: violates R1 (columns "should" always have values but are nullable),
R2 (default in three places per field), R3 (`??` in rowMapper).

**Fix**: per the Standard Layered Design above. After the fix only `settings` retains a
service-side `??`; the other three columns become `NOT NULL` with DB DEFAULTs and
`rowToAssistant` no longer fabricates anything.

### B. `assistant.modelId` — correct (current state)

The DB column `text().references(...)` is nullable; the entity declares
`UniqueModelIdSchema.nullable()`; the row mapper reads `row.modelId` directly to preserve
the `T | null` contract; the renderer treats NULL as "no model selected" and renders
accordingly.

**Diagnosis**: this is what a legitimately-nullable field looks like — NULL has a domain
meaning, no read-path mask, no fabricated default.

### C. `agent.accessiblePaths` — anti-pattern (current state)

DB column (`agent.ts`): `text({ mode: 'json' }).$type<string[]>()` — nullable, no DB
DEFAULT. RowMapper (`AgentService.ts` `rowToAgent`): `accessiblePaths: row.accessiblePaths ?? []`.

**Diagnosis**: same shape as Case A. The product wants every agent to have a non-empty
workspace path list (`AgentService.computeWorkspacePaths` even enforces this on create),
so the column should be `NOT NULL` and the rowMapper's `?? []` should disappear.

## Related References

- [API Design Guidelines § Rule C](./api-design-guidelines.md#c-derive-dtos-via-pick-whitelist-with-field-atoms-and-zstrictobject) — DTO derivation rules
- [Database Patterns § Column Nullability and Defaults](./database-patterns.md#column-nullability-and-defaults) — column-level decision
- [DataApi in Main § Row → Entity Mapping](./data-api-in-main.md#row--entity-mapping) — `nullsToUndefined`, `T | null` preservation
- [Zod issue #4799](https://github.com/colinhacks/zod/issues/4799) — `.partial()` and `.default()` interaction
- [SQLite ALTER TABLE limitations](https://www.sqlite.org/lang_altertable.html) — why DB DEFAULT changes are painful
