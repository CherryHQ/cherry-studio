# Contributor Implementation Spec Summary (PR Reviewer / Contributor Quick Read)

> This document is synthesized from `docs/references/backup/backup-architecture.md` (§2/§3.5/§5.4/§6/§6.2/§7/§8.5). **Purpose**: let reviewers / contributors quickly understand how the contributor system lands (placement + lifecycle + aggregate boundary + invariants + identity propagation).

---

## 1. Overview: What the contributor system is

Backup devolves "which domain owns which user-data tables, references, aggregate boundaries, and restore strategies" from a centralized rule store (`DomainRegistry`/`DomainStripper`/`DomainImporter`/`FileCollector`, v1 throwaway) to each business domain, which declares one `BackupContributor`.

**BackupContributor = schema + backupPolicy + operations, three separated layers**:

| Layer | What goes in | What does NOT go in |
|---|---|---|
| `schema` (Entity facts) | table ownership, reference facts, primary-key shape, aggregate boundary, file-ref source, JSON soft reference | SET_NULL/DELETE_ROW actions, import ordering, restore strategy |
| `backupPolicy` | omitted reference override, unique-key merge, field-level FIELD_MERGE, `platformSpecificKeys` | database I/O, file operations, async hooks |
| `operations` (optional) | file resource discovery, beforeArchive, per-row transform, afterImport, blob restore, cloneAggregate | facts and policies expressible as pure data |

- A contributor is a **frozen constant object** (not a class): `export const TOPICS_CONTRIBUTOR = deepFreeze<BackupContributor>({ domain, schema, backupPolicy, operations })`. Rationale: pure data + stateless pure-function hooks; `schema-only` domains naturally support `operations: undefined`; `deepFreeze` guarantees immutability after finalize (any mutation throws TypeError in strict mode).
- **The core mechanism is `schema.aggregates` (aggregate boundary AggregateBoundary)**: it elevates the object-boundary SKIP/OVERWRITE/RENAME from prose descriptions to a **statically verifiable** mechanism—one topic together with its message tree, one Agent session together with its messages, is either imported as a whole or skipped as a whole.

---

## 2. Placement: Where contributor declarations live

> Addresses PR #12659 review A3/L289: avoid concentrating domain facts into the backup module.

**Rule**: each domain's contributor declaration is **co-located at the actual location of that domain's owning module** (respecting existing main-process directory boundaries, not forcing `src/main/services/`), and the business domain owner maintains that domain's entity facts (table ownership / references / aggregates / file-ref / JSON soft references).

- Path: co-locate at the actual location of the domain's owning module. **per-domain subdirectory** (`<owning>/<domain>/backupContributor.ts`) is the default; a **flat owning module** (multiple domain Services sharing one directory, e.g. `src/main/data/services/`) SHALL use a per-domain subdirectory (`<dir>/<domain>/backupContributor.ts`) or a unique filename (`<dir>/backupContributor-<domain>.ts`) to avoid multiple domains contending for the same path. Valid location examples (respecting main-process directory boundaries): `src/main/services/<domain>/` (service domains such as topics/agents), `src/main/data/services/<domain>/` (data services, e.g. providers), `src/main/features/knowledge/` (knowledge), `src/main/ai/` (AI/agent). Each domain may split into multiple files (e.g. KNOWLEDGE restoreResources is heavy IO and may live in an independent file); tests are placed nearby in that domain's `__tests__/`.
- **The backup module only holds**: the unified barrel (`contributors/index.ts` aggregating the 14 domain exports) + `ContributorManager` + registry + orchestrator. **Pure types / context types / deepFreeze / dbSchemaRefs / BackupDomain / ConflictStrategy belong to the neutral layer** (`@main/data/db/backup/`, see below); backup and each domain's contributor depend on it in the same direction. **It carries no domain-specific table/column/aggregate facts**—otherwise domain facts regress into being concentrated in the backup module, contradicting the devolution goal.
- Check: `src/main/services/backup/contributors/` **SHALL contain only** the barrel (index.ts) / finalize (ContributorManager); **SHALL NOT contain** the orchestrator (belongs in `src/main/services/backup/orchestrator/`) / pure types / context types / deepFreeze (belong in the neutral layer `@main/data/db/backup/`) / domain schema/policy/operations declarations.

**Ownership boundary + neutral layer**: pure types / context types / runtime helpers / codegen artifacts / enums consumed by contributors belong to the **process-local neutral layer** `@main/data/db/backup/` (data/schema-owned, main-only): `contributor-types` (BackupContributor/EntityGraphSchema + hook context interfaces), `contexts` (BackupScopedDb/BackupReadonlyDb), `freeze` (deepFreeze), `dbSchemaRefs` (codegen DB_TABLES/COLUMNS/PK/FK/FTS + branded types), `domains` (BackupDomain/ConflictStrategy, main-only—the renderer passes simple parameters converted by BackupService and does not import the enums). Business domains (topics/agents/...) + backup service import this neutral layer **in the same direction** to declare and export contributors—avoiding a data-domain contributor → services/backup reverse dependency, and keeping the shared layer from growing (dbSchemaRefs / main-only enums do not go into shared). **SHALL NOT** redefine the `DbTableName`/`DbColumnName` branded types (import from `@main/data/db/backup/dbSchemaRefs`).

> `domain/` (the centralized rule store) is v1 throwaway: contributors are implemented in parallel, and once equivalence tests pass the orchestrator's import source is switched over and `domain/` is deleted—do not fix its bugs, do not add fallbacks.

---

## 3. Lifecycle: How ContributorManager starts up

> Addresses PR #12659 review A3/L304.

**ContributorManager = non-lifecycle named-export singleton**, aligning with CLAUDE.md "Non-Lifecycle Services Decision Guide":

- Export: `export const contributorManager = new ContributorManager()`.
- Does **not** `extends BaseService`, does **not** apply `@Injectable`/`@ServicePhase`, is **not** registered in `serviceRegistry.ts`, has **no** `@DependsOn`.
- Rationale: it holds no long-lived resources, **does not connect to DB**, has no IPC/timer/event subscription—only the pure-functional behavior of "one-time finalize at startup producing a frozen BackupRegistry".

**Lazy finalize**: `getRegistry()` triggers synchronous finalize + deep freeze + cache (idempotent) on first call. On failure it throws `ContributorFinalizeError` (containing domain/table/owner/violated invariant).

**Trigger timing**: `BackupService` (a WhenReady lifecycle service) calls `contributorManager.getRegistry()` in `onInit()` to lazily trigger finalize—via a direct `import { contributorManager }` (**not** `application.get`, since it is not in the lifecycle container). Failure → `BackupService.onInit` fails → the lifecycle container refuses to start and reports. This preserves the startup-time validation semantics, equivalent to the original `WhenReady + @DependsOn` approach, but without promoting the pure static finalizer to a lifecycle service.

**finalize does not connect to DB**: it only reads codegen artifacts (`dbSchemaRefs.ts`) + contributor declarations, and does not call `application.get('DbService')`. Actual DB table coverage is gated by **coverage tests (CI)**—finalize validates consistency among declarations, coverage tests validate actual schema table coverage; the two are complementary.

**BackupService remains a lifecycle service** (holding long-lived resources such as orchestrator / RESTORE BARRIER / journal): `@Injectable('BackupService') + @ServicePhase(Phase.WhenReady) + @DependsOn(['RestoreSafetyManager'])`. It does **not** `@DependsOn(['DbService'])` (DbService is BeforeReady, and phase ordering auto-enforces startup before WhenReady; CLAUDE.md hard constraint: WhenReady services must not `@DependsOn` BeforeReady services).

> Check: `serviceRegistry.ts` **SHALL NOT** contain `ContributorManager`.

---

## 4. Aggregate boundary + 26 invariants key points

### 4.1 AggregateBoundary (§6.2 derivation formula)

`AggregateBoundary { root, renamable, [identityKey?], [identityClass?], [conflictDefault?], [members?] }`—besides `root` and `renamable`, all other fields are **derived by default from `references + primaryKeys`**; a contributor declares them explicitly only when deviating from the default (explicit overrides must also be self-consistent with the derivation; invariant 14 rejects drift).

| Field | Default derivation | When to declare explicitly |
|------|----------|----------|
| `root` | — (hand-written, domain fact: which table is the "object" semantic root) | required |
| `renamable` | — (hand-written, domain fact: whether it can be safely cloned) | required |
| `identityKey` | `primaryKeys[root].columns`; **when root has a UNIQUE constraint (non-PK), it must include the UNIQUE key** (prevents cross-device same-value-different-UUID colliding with SQLite UNIQUE, e.g. `agent_workspace.path`/`tag.name`/`note(rootPath,path)`/`pin(entityType,entityId)`/`agent_global_skill.folderName`/`job_schedule(type,name)`) | PK is composite and the UNIQUE key is not entirely PK |
| `identityClass` | `primaryKeys[root].kind`: `uuid-v4`/`uuid-v7`→`uuid-entity`, `natural`/`composite`→`natural-key`; root has a UNIQUE constraint (non-PK) → `natural-key` | `slot` (predefined slot, codegen cannot infer) |
| `conflictDefault` | `uuid-entity`→`SKIP`; `natural-key`/`slot`→`FIELD_MERGE` | when deviating from default (in production only preference/note deviate to SKIP, a settings-class exception, requiring reason + invariant 21) |
| `members` | source tables of in-domain owning include references pointing to root (`viaColumn`=ref.column, `parent`=ref target, in topological order); junction tables, cross-domain refs, and in-domain owning refs pointing to other aggregate roots are **not counted** | when default members need to be excluded (e.g. self-ref self-reference) |

`AggregateMember { table, viaColumn, cascade:'include'|'optional' }`: include = processed with root as a whole; optional = only set null when root conflicts. Derivation is performed by `finalize` at startup, **not** during hook invocation.

### 4.2 26 invariants key points (refined from §8.5, not a verbatim copy)

Each failure throws `ContributorFinalizeError(invariantId, payload)`, with payload containing domain/table/sourceType/owner fields.

**Ownership and exhaustiveness**:
- #1 each domain has exactly one contributor (`registry.length===14` strict equality: `PREFERENCES/PROVIDERS/PROMPTS/MCP_SERVERS/TAGS_GROUPS/ASSISTANTS/AGENTS/SKILLS/MINIAPPS/TOPICS/KNOWLEDGE/TRANSLATE_HISTORY/PAINTINGS/FILE_STORAGE`).
- #2 each Drizzle user-data table has exactly one owner or is excluded with a reason; #3 no table is owned by multiple contributors; #4/#5 ALWAYS_STRIP/INFRASTRUCTURE/exclusion-set runtime tables are not owned by contributors (`job_schedule` is not excluded wholesale; `type='agent.task'` row-scope is assigned to AGENTS).

**Reference and PK facts**:
- #6 the source table (`ref.table`) of a references entry belongs to the declaring owner; the target may be cross-domain; #7 `omittedReferenceOverrides` binds a declared reference + is non-redundant + has a reason.
- #8 each owned table has exactly one primary-key fact and the columns exist in codegen; #9 the PK kind is not ambiguous; #22 the PK kind is not autoincrement (zero autoincrement PK across the entire database is the foundational prerequisite for having no id remap).
- #10 the references-derived dependency graph has no cycle (Kahn topological sort; a cycle throws `CircularReferenceError`); #23 shared-table row-scope coverage is exhaustive + unmatched fail-loud (prevents dirty type values from silently dropping data).

**Soft reference coverage**:
- #11 every `FileRefSourceType` has an owner or a runtime-only exclusion; #12 declared `jsonSoftReferences` columns actually exist and are of json type (no reverse full-database scan).

**Aggregate boundary (core)**:
- #13 aggregate.root is under the owner; identityKey is its PK or a business UNIQUE key (prevents cross-device same-value-different-UUID colliding with UNIQUE); a non-PK natural-key/slot identityKey must be confirmed by codegen `DB_UNIQUE_KEYS` to actually have a UNIQUE constraint; a PK-backed identityKey (uuid/natural/composite PK) is exempt.
- #14 aggregate.members is derived from owning include references—junction tables, cross-domain refs, and in-domain owning refs pointing to **other aggregate roots** are not counted (only owning refs pointing to this root enter members); optional self-references are not counted; multiple owning references pointing to a member/root must declare an explicit parent, otherwise rejected as ambiguous; a parent chain with a cycle is rejected.
- #15 in members, each member table belongs to this contributor, and viaColumn is a real FK column pointing to root.identityKey or to the parent member's PK (multi-layer cascade A→B→C, C.viaColumn→B, §4.1 parent derivation); junction tables are not counted.
- #16 a renamable:true aggregate must have `operations.cloneAggregate`.
- #26 a renamable:true aggregate's root PK must be single-column (the importer's newRootKey is a single value; cloneAggregate only replaces one PK column; a composite-PK renamable would cause rename identity corruption—change to renamable:false instead).

**FK self-consistency (requires codegen-generated `DB_FOREIGN_KEYS`)**:
- #19 each `EntityReference.kind` is self-consistent with the generated FK onDelete (cascade/restrict → owning or junction; set null/no action → optional; set default → reject).
- #20 a junction/co-owned FK is not declared optional; a NOT NULL column cannot SET_NULL.
- #24 declared EntityReferences correspond to generated FKs; #25 the reverse—**every DB FK must be declared by the owner contributor** (prevents undeclared cross-domain FKs such as `agent.model→user_model` from causing topological missing dependency edges, omitted actions not triggering, and dangling FK rows).

**Freeze and conflict default**: #17 schema is deep-frozen; #18 failure info contains locating fields; #21 a natural-key/slot aggregate's conflictDefault is not SKIP (the settings-class preference/note exception allows SKIP, including `platformSpecificKeys` to exclude cross-platform incompatible keys).

---

## 5. identity propagation (§5.4)

**Scenario**: an owning/required FK points to a **natural-key aggregate** (target merged via identityKey FIELD_MERGE, local UUID wins). The backup target's UUID is merged away by FIELD_MERGE; the importer **must** build a `{backup target id → local canonical id}` mapping and, when importing the source, rewrite that FK to the local id—otherwise the owning FK dangles (`defer_foreign_keys` COMMIT fails, or the source is lost).

**The rewrite boundary is determined by whether the ref is required (not by whether it is JSON)**:

- **required ref** (target missing → functionality broken)—**must rewrite** when target is merged: ① DB owning FK (`agent_session.workspaceId → agent_workspace`, cross-device same path different uuid); ② **required JSON ref** (AGENTS: `agent_channel.workspace.workspaceId` / `job_schedule(type='agent.task').jobInputTemplate.workspace.workspaceId`, both `AgentSessionWorkspaceSource`), the latter marked as required class via `jsonSoftReferences` and participating in identity propagation—otherwise restore appears successful (`foreign_key_check` passes) but the channel/scheduled task references a dangling workspace.
- **tolerant ref** (`message.data.fileEntryId` attachment soft ref, `file_ref.sourceType`)—**not rewritten** when target is merged/missing; missing only degrades to a Toast + orphan detection.
- **optional ref** (e.g. `translate_history.sourceLanguage → translate_language`)—rewrite to preserve association, or SET_NULL per optional semantics (cannot leave a dangling backup uuid).
- **junction ref** (e.g. `entity_tag.tagId → tag`)—cascade-pruned with root; the FK is rewritten together when target is merged.

> **Scalar ID column (no FK declaration) three-way classification** (prevents the "no FK = dangling" misjudgment + prevents the "pointing to user data must declare an EntityReference" over-broad reading):
> - Points to a **non-DB resource** (app-builtin preset/constant/directory, e.g. `knowledge.fileProcessorId`, `userModel.presetModelId`/`userProvider.presetProviderId`/`miniApp.presetMiniAppId`) → naturally not an EntityReference candidate (no target table row); not declared, not rewritten.
> - Points to **DB user data + has FK** → declare an `EntityReference` and go through identity propagation (invariants #24/#25 require declared EntityReferences to correspond to generated FKs).
> - Points to **DB user data + no FK** (scalar soft ref, e.g. `topic.activeNodeId`→message, `painting.providerId/modelId`) → **do not declare an EntityReference** (no FK; invariant #24 requires a declaration to correspond to an FK); such cases are handled by `cloneAggregate` rewrite (renamable aggregate, e.g. `activeNodeId` rewritten via the clone mapping to the new message id) or as a tolerant ref (missing only degrades, e.g. painting soft ref). Domains that accept dangling must note the reason in the domain spec (e.g. PAINTINGS).
> "No FK declaration" ≠ dangling risk—classified three-way by "whether the target is a DB resource + whether it has an FK".

> **≠ removed ID remap**: remap generates a new uuid for a uuid-entity source record's PK (not needed; preserve source PK is idempotent); identity propagation redirects the source FK to the natural-key target's canonical id (the source record's PK is unchanged—required by natural-key merge).

**Typical workflow (AGENTS)**: `agent_session.workspaceId → independent agent_workspace aggregate` (an intra-domain cross-aggregate owning reference: same AGENTS domain, but two separate independent aggregate roots). workspaceId is a cascade NOT NULL owning FK, but the target `agent_workspace` (natural-key `path` UNIQUE) is an independent aggregate root, not `session.root`—so invariant 14 does not count it into `session.members`, and the workspace is not forced to be a member. This is not equal to evading owning validation: invariant 25 forces AGENTS to declare this FK → invariant 19 validates that onDelete=cascade corresponds to kind=owning self-consistency (codegen `DB_FOREIGN_KEYS` as data source). `agent_session` renamable:false (cross-aggregate owning clone contradiction + collides with `path` UNIQUE).

---

## 6. Per-domain key decisions (§3.5, 14 domains)

`identityClass` / default `conflictDefault` are finalize-derived values; explicit declaration is only for deviating from the default.

| Domain | Aggregate root (+ include members) | identityClass | renamable | Default conflictDefault | lite |
|---|---|---|---|---|---|
| PREFERENCES | `preference[scope,key]` / `note` (`(rootPath,path)` UNIQUE) | natural-key | false | SKIP / SKIP (**settings-class exception**: local-first + backfill; `platformSpecificKeys` excludes cross-platform incompatible keys) | ✓ |
| PROVIDERS | `user_provider` + `user_model`(providerId) | natural-key | false (derived key) | FIELD_MERGE | ✓ |
| PROMPTS | `prompt` | uuid-entity | false | SKIP | ✓ |
| MCP_SERVERS | `mcp_server` | uuid-entity | false | SKIP | ✓ |
| TAGS_GROUPS | `tag`/`group`/`pin` + `entity_tag` (polymorphic junction) | tag/pin natural-key, group uuid-entity | false | tag/pin FIELD_MERGE, group SKIP | ✓ |
| ASSISTANTS | `assistant` + `assistant_mcp_server`/`assistant_knowledge_base` | uuid-entity | true | SKIP | ✓ |
| AGENTS | `agent_session`(+`agent_session_message`) / `agent_workspace` / `agent_channel` / `agent` + `job_schedule`(type='agent.task') row-scope + `agent_skill`(junction) | agent_workspace/job_schedule natural-key, rest uuid-entity | session:false (cross-aggregate owning ref), rest false | agent_workspace/job_schedule FIELD_MERGE, rest SKIP | ✓ |
| MINIAPPS | `mini_app`(app_id) | natural-key | false | FIELD_MERGE | ✓ |
| SKILLS | `agent_global_skill` (`folderName` UNIQUE) | natural-key | false | FIELD_MERGE | ✓ |
| TOPICS | `topic` + `message`(topicId) | uuid-entity | true | SKIP | ✓ |
| KNOWLEDGE | `knowledge_base` + `knowledge_item` | uuid-entity | **false** (`{baseId}` directory consistency is hard to preserve; RENAME degrades to SKIP) | SKIP | ✗ |
| TRANSLATE_HISTORY | `translate_language`(langCode) + `translate_history`(uuid-entity independent aggregate) | natural-key / uuid-entity | false | FIELD_MERGE / SKIP | ✗ |
| PAINTINGS | `painting` | uuid-entity | false | SKIP | ✗ |
| FILE_STORAGE | `file_entry` | uuid-entity | false (no safe clone path; RENAME degrades to skipping same-name-different-size files) | SKIP | ✗ |

> lite preset: 10 domains included, 4 domains (KNOWLEDGE/TRANSLATE_HISTORY/PAINTINGS/FILE_STORAGE) excluded, `includeFiles=false`/`restoreFiles=false`. Junction tables (`agent_channel_task`/`agent_skill`) are not counted as aggregate members; they go through an independent junction reference.

---

## 7. Contributor declaration example (TOPICS)

Aggregate root `topic` + member `message(topicId)`; on conflict → the whole group (topic + its message tree) is processed by strategy.

```typescript
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { type BackupContributor } from '@main/data/db/backup/contributor-types'
import { deepFreeze } from '@main/data/db/backup/freeze'

// TOPICS owns topic(uuid-v4) + message(uuid-v7) two tables
// message.topicId→topic.id: in-domain cascade FK → owning include member
// message.modelId→user_model.id: cross-domain set null FK → optional ref (referencedDomain=PROVIDERS)
// message.parentId→message.id: self-reference set null → optional (self), not counted as aggregate member
export const TOPICS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'TOPICS',
  schema: {
    tables: [table('topic'), table('message')],
    references: [
      // owning include ref → member
      // optional cross-domain / self refs
    ],
    primaryKeys: [/* topic: uuid-v4, message: uuid-v7 */],
    aggregates: [{
      root: 'topic',
      renamable: true,
      // identityKey / identityClass / conflictDefault / members derived by default from references+primaryKeys
      // members default = [message (viaColumn=topicId, include)]
    }],
    fileRefSourcePolicies: [
      // file_ref.sourceType='chat_message' → ownerDomain=TOPICS
    ],
    jsonSoftReferences: [
      // message.data contains fileEntryId soft reference → tolerant
    ]
  },
  backupPolicy: { /* omittedReferenceOverrides / uniqueMergeRules / fieldMergePolicies */ },
  operations: {
    // renamable:true so cloneAggregate must be implemented
    // cloneAggregate must rewrite the topic.activeNodeId scalar soft ref to the new aggregate's message id
  }
})
```

> TOPICS `renamable:true`: when RENAME-cloning a topic, `activeNodeId` (a scalar text soft ref pointing to message, no FK) **must** be rewritten by `cloneAggregate` (mapped to the new topic's corresponding message id), otherwise the restored topic points to the old aggregate's node / dangling reference—listed as this domain's `cloneAggregate` required rewrite rule.

---

> Master architecture reference document: `docs/references/backup/backup-architecture.md` (in this repo, exhaustive treatment; this document is a refined quick-read version of its contributor landing points).
