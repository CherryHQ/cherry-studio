# Agent Note: Skill labels and grouped bulk assignment in the Agent skill selector

Status: proposed

English | [中文](2026-10-28-skill-labels-and-grouped-selection.zh.md)

## Problem

Installed skills have no supported user-label organization. Settings → Skills renders the shared resource catalog with only the `all` / `system` / `builtin` scope tabs (`src/renderer/pages/settings/SkillsSettings.tsx:10`, `:29`, `:41`), and the Agent skill selector shared by Agent creation and Agent editing renders one flat `CatalogToggleGrid` whose search matches `skill.name` only, whose single bulk control is one global “enable all” switch, and which has no section, per-section control or label-aware filtering (`src/renderer/components/resourceCatalog/dialogs/skill/SkillCatalogPicker.tsx:51`, `:58`, `:69`, `:92`; consumers `src/renderer/components/resourceCatalog/dialogs/create/steps/CapabilityStep.tsx:32`, `src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx:1279`). Configuring a coherent set of skills therefore means scrolling and toggling rows one by one, and repeating that work for every Agent.

The only grouping-adjacent field that exists is `sourceTags` — publisher metadata parsed from a skill's `SKILL.md` (`src/shared/data/api/schemas/skills.ts:17`; parse and persist paths `src/main/utils/markdownParser.ts:391`, `src/main/ai/skills/SkillService.ts:544`). A generic user-tag store already exists with CRUD, many-to-many bindings and batch reads (`src/main/data/db/schemas/tagging.ts:11`, `:26`; `src/main/data/services/TagService.ts:135`, `:241`; `src/main/data/api/handlers/tags.ts:23`, `:63`), but `'skill'` is not an admitted entity type (`src/shared/data/types/entityType.ts:26`), the installed-skill response has no user-label projection (`src/shared/data/api/schemas/skills.ts:7`), and the v2 skills contract deliberately pins that an outer `tags` field and a `tagIds` query filter are rejected (`src/shared/data/api/schemas/__tests__/skills.test.ts:26`; a second contrary pin at `src/main/ai/skills/__tests__/SkillService.test.ts:352`).

Grouping by publisher metadata is not usable as the primary dimension today: none of the six ordinary bundles under `resources/skills/*/SKILL.md` and none of the fourteen conditional Code CLI templates under `resources/code-cli-skills/*/SKILL.md` declares a top-level `tags` key (measured by parsing each file's initial YAML block), so those skills alone would populate only an Unlabeled section. Templates are installed conditionally when their executable is available (`src/main/services/codeCli/CodeCliService.ts:152`, `:160`). Externally installed skills may carry metadata tags; their prevalence in real installations is not established here.

The reported cost — repeated scrolling and missed selections as a collection grows — comes from the issue report, not from a measured usability study.

## Proposal

### 1. One shared label model, not a second one

A label is a user-owned organization concept shared by the surfaces that organize skills, stored in the existing SQL tables: a `tag` row plus an `entity_tag` binding to the installed skill. This reuses tag CRUD, name uniqueness, many-to-many bindings, batch reads and cascade cleanup, so it introduces **no new table, column or schema migration**. It does change two contracts: the entity-type API enum (`src/shared/data/types/entityType.ts:26`) and the installed-skill response (see §2). Labels are flat; they do not encode hierarchy, ordering or drag-and-drop.

Answers to the four product questions, offered here as proposals awaiting Approval:

| Question | Proposal |
| --- | --- |
| Do it at all, and is grouping one shared concept or Settings-only? | Yes. One shared label store; the Agent selector is the first consumer because group-level bulk assignment is the untracked gap. Settings → Skills gains only a minimal assignment surface on skill details — not a second organization model. |
| Folders/hierarchy or flat labels? | Flat labels. Flat many-to-many labels meet this delivery's organization need without defining hierarchy, ordering or drag-and-drop. A future hierarchy is a separate design. |
| First-delivery scope? | Label assignment on skill details, plus collapsible label sections, per-section bulk enable/disable and label-aware search in the Agent skill selector. Not the Skills-page tree, packaging, rename or notes. |
| Built-in “organize by source”? | Not in this delivery. Source is installation provenance (`src/main/ai/skills/SkillService.ts:153`) and is already shown as a badge (`src/renderer/components/resourceCatalog/catalog/SkillSourceBadge.tsx:6`) while scope is a filesystem classification, so automatic source sections are rejected as a scope choice, not as useless data. Sections are one per label, plus a final Unlabeled section. |

### 2. Read projection on the installed skill

`InstalledSkill` gains a user-label projection carrying each label's **id and name** (derived from `TagSchema`, `src/shared/data/types/tag.ts:21`). Color and timestamps stay out: no consumer in this delivery reads them, and the editor's label vocabulary comes from `/tags`.

The projection must be produced on every `InstalledSkill`-returning path, including `list`, `listAll`, transactional single reads, folder lookup and the responses of global-toggle and install operations, passing the caller's transaction where one exists (`src/main/data/services/AgentGlobalSkillService.ts:38`, `:67`, `:104`, `:127`, `:312`). List reads resolve labels with the existing batch helper (`src/main/data/services/TagService.ts:241`) instead of one lookup per skill: loading them inside the row mapper would add a query per skill. `GET /skills` keeps rejecting `tagIds` (`src/shared/data/api/schemas/skills.ts:39`) and `PATCH /skills/:skillId` keeps accepting only global availability (`:51`); user-label writes go through the tag API.

Label operations never rewrite descriptor metadata or availability, and metadata refresh may change `sourceTags` and other metadata normally without touching user-label bindings.

### 3. Supersession of the metadata-only decision

This proposal partially supersedes the v2 decision to expose only publisher metadata tags on installed skills. User-owned purpose/project organization now has both a producer (§3) and a consumer (§4), which the earlier decision lacked. `sourceTags` remains publisher metadata and keeps its meaning. `/skills` continues rejecting `tagIds`, skills PATCH remains global-availability-only, and user-label writes use the tag API. Naming the response property `labels` does not remove the semantic reversal: the literal rejection of an outer `tags` field can stay, but the misleading test titles must change and positive label-contract coverage must be added.

### 4. Producer: skill details

Settings → Skills → skill details (`src/renderer/pages/settings/SkillDetails/SkillDetails.tsx:187`) gains a small label surface: create a label, assign an existing label to this skill, unassign a label from this skill. Unassign means **remove the binding**, not delete the shared tag. Creating a label and assigning it are separate writes (`TagService.ts:135`, `:284`), so a successful create followed by a failed assignment leaves a reusable label and must not be reported as an assigned one. Failed writes keep the last committed bindings visible and surface a localized error. Builtin descriptor content being read-only (`SkillDetails.tsx:246`) does not restrict label editing: labels are database rows.

Creating labels inside the picker, bulk labeling of installed skills and a global label manager are follow-ups; the detail route already exists and is a sufficient producer.

### 5. Selector: sections, group control, search

`SkillCatalogPicker` composes the existing Accordion primitive (`packages/ui/src/components/primitives/accordion.tsx:7`, `:21`) around the existing `CatalogToggleGrid` (`src/renderer/components/resourceCatalog/dialogs/components/CatalogPicker.tsx:60`), one section per label plus a final Unlabeled section.

Section scope, as proposed: sections only for labels represented among globally available skills; nonempty Unlabeled last; section identity is the label id; sections are ordered by label name and skills keep their existing order inside a section (`src/main/data/services/AgentGlobalSkillService.ts:90`). Search is trimmed and case-insensitive, matching a skill name **or** a section label name; a label-name match reveals that section's members, other sections keep only their skill-name matches, matching sections are revealed, and clearing the query restores the previous collapse state without changing selections. Source or `sourceTags` alone creates no section. Independent tag chips and combined tag-plus-text filtering are follow-up work.

Selection stays the existing id array (`SkillCatalogPicker.tsx:26`, `:94`); the picker never stores a subscribed group, so a skill added to a label later is never granted to an existing Agent. A section control's target is that section's eligible, query-matching members **regardless of collapse state** — otherwise a collapsed section would have an empty target — and the same set is counted. Contents: `A={x,y}`, `B={y,z}` → select A then B → clear A leaves `{z}`; `y` is off in both sections, B is mixed, and no duplicate id is submitted.

The existing behaviour that must survive:

- Create-mode builtins are checked and locked, excluded from submitted selectable ids; edit-mode builtins are editable like other available skills; globally disabled skills stay absent.
- Group actions preserve ids outside their target set in both modes, including edit mode's preserved hidden ids, which cover ids outside the available selectable set — not merely search-hidden rows. A selected-but-unpickable row may still be switched off.
- The global “enable all” switch keeps operating on all available selectable ids independent of search, collapse and labels; in edit mode it preserves hidden selections and in create mode it keeps its existing whole-array replacement, including dropping hidden draft selections on OFF; with no selectable ids it is unchecked and disabled.
- Loading, `disabled`, and groups with no eligible members cannot change selection.
- `trailingItem` renders exactly once outside sections — hidden while loading, present after loading even with no matches or every section collapsed — and the marketplace/import/system menu keeps its portal and parent-dialog dismissal behaviour (`CatalogPicker.tsx:87`, `:181`; `SkillCatalogPicker.tsx:109`, `:163`).

The per-section control is a checkbox with an indeterminate state (`packages/ui/src/components/primitives/checkbox.tsx:8`, `:17`; a binary switch cannot express “mixed”), placed beside the section heading **outside** the accordion trigger's interactive content, so expansion and selection are separate keyboard-operable controls; toggling selection does not expand or collapse. The visible text and the accessible name both carry the label and the eligible matching-member count.

### 6. Invalidation

The projection is embedded in `/skills` responses, so a label mutation that leaves mounted consumers stale is a correctness bug, and `TagService` currently publishes no skill-change notification on create/bind/rename/delete (`src/main/data/services/TagService.ts:160`, `:195`, `:284`, `:412`). The cheapest correct mechanism is one post-commit notification batch covering `/skills` and `/skills/:skillId` using the existing publisher (`src/main/data/services/AgentGlobalSkillService.ts:210`; contract `src/main/data/dataApiDataChange.ts`), plus a label-option refresh where needed. Binding operations know their skill ids; rename and delete may conservatively invalidate the skill endpoints without enumerating affected ids. Not in scope: a broadcast per skill, a new event framework, or a mandatory pre-delete id scan. Revalidation must preserve dirty Agent form state.

## Alternatives considered

| Alternative | Assessment |
| --- | --- |
| Group by publisher `sourceTags` | Zero shipped skills declare tags, so the shipped library would show only Unlabeled until a user installs third-party tagged skills; it also cannot express purpose/project intent the user chooses. Kept as a badge, not as the grouping dimension. |
| Group by `source` as a built-in dimension | Rejected as a product scope choice: source is provenance, scope is filesystem classification, and the reporter's own alternative ranks user tags first. It can be reconsidered additively later. |
| New JSON label column on `agent_global_skill` | Duplicates the existing many-to-many store, needs a migration plus its own rename/uniqueness policy, and serves no requirement that `entity_tag` cannot. |
| Folders/hierarchy now | Larger surface (tree model, ordering, folder UI) overlapping the categorization already tracked by #19760; flat labels are the cheaper step the reporter offered. |
| Store the selected label and expand it when an Agent loads | Silently grants skills added to a label later, and cannot express “this Agent has x but not y” when both share a label. Selection stays an id list. |
| Keep the metadata-only contract and do nothing | Leaves the reported repeated-work cost and the untracked selector gap in place; the v2 decision predates any producer/consumer for user labels. |

## Acceptance criteria

- AC1 — In Settings → Skills → skill details, a user can create and assign a shared label, reuse an existing label, and unassign a label from either a builtin or nonbuiltin installed skill; the resulting bindings survive page reopening and window reload. (verification: renderer and Electron; owner: label-producer implementer)
- AC2 — Invalid label input or a failed label assignment/unassignment leaves the last committed bindings visible and presents a localized error; if label creation succeeds but assignment fails, the UI does not report assignment success and the created label remains reusable. (verification: renderer and main service tests with real SQLite; owner: label-producer implementer)
- AC3 — Every response carrying an InstalledSkill exposes its current user-label IDs and names, including an empty array for an unlabeled skill; label operations leave descriptor metadata and global availability unchanged, and the skills API continues rejecting tagIds query filters and label writes through skills PATCH. (verification: shared schema and main service tests; owner: data implementer)
- AC4 — Loading a nonempty installed-skill list adds at most one label-data query and no per-skill or per-label renderer requests; list and single-skill results agree on label membership and names. (verification: real-SQLite query instrumentation and response assertions; owner: data implementer)
- AC5 — Same-ID reinstall, builtin synchronization, and metadata reconciliation preserve user-label bindings; uninstall or reconciliation deletion atomically removes that skill's bindings while retaining shared label definitions, and a subsequent fresh installation does not inherit deleted bindings. (verification: main service tests with real SQLite; owner: data implementer)
- AC6 — Both Agent create and Agent edit show collapsible sections for labels represented among globally available skills, ordered by label name, with nonempty Unlabeled last; a multiply labeled skill appears in each applicable section, and source or sourceTags alone creates no section. (verification: renderer consumer tests; owner: selector implementer)
- AC7 — A section control selects or clears precisely its eligible query-matching members regardless of collapse state, preserves all other selected IDs, and derives all/mixed/none from that same set; activating mixed selects all, and selecting A={x,y}, then B={y,z}, then clearing A leaves only z selected with B mixed and no duplicate IDs. (verification: stateful renderer interaction tests; owner: selector implementer)
- AC8 — Create-mode builtin skills remain checked and locked without entering submitted selectable IDs, edit-mode builtins remain editable, globally disabled skills remain absent, and group operations respect row eligibility and preserve outside IDs in both modes; loading, disabled, and zero-eligible-member groups cannot change selection. (verification: picker and create/edit consumer tests; owner: selector implementer)
- AC9 — Global enable-all operates on all available selectable IDs independently of search, collapse, or labels; edit mode preserves selected IDs outside that set, create mode retains its existing whole-draft replacement behavior including clearing hidden draft selections on OFF, and an empty selectable set leaves the control unchecked and disabled. (verification: stateful renderer interaction tests; owner: selector implementer)
- AC10 — Trimmed, case-insensitive search matches skill names or section label names; a label-name match reveals that section's members, other sections retain only skill-name matches, matching sections are revealed, and clearing search restores the prior collapse state without changing selections. (verification: renderer interaction tests; owner: selector implementer)
- AC11 — Section expansion and bulk selection are separate keyboard-operable controls; bulk selection does not expand or collapse the section, mixed state is exposed accessibly, and visible text plus the accessible name identifies the label and eligible matching-member count. (verification: renderer accessibility assertions and Electron keyboard interaction; owner: selector implementer)
- AC12 — Marketplace, local-import, and system-skill actions remain usable with the existing portal and parent-dialog dismissal behavior; after loading, the trailing action appears exactly once outside sections even with no matches or all sections collapsed, while loading and empty states remain truthful. (verification: existing picker consumer tests and Electron; owner: selector implementer)
- AC13 — After Agent creation or successful edit autosave, reopening shows the chosen per-skill enablement without duplicate submitted IDs; later label assignment, unassignment, rename, or deletion neither grants skills to an Agent nor removes its saved skill selections or changes global availability. (verification: Electron with a disposable profile and persisted-data assertions; owner: desktop verifier)
- AC14 — After a successful label mutation, continuously mounted skill selectors, skill details, and label options converge to committed data through the existing notification/revalidation mechanism, including another subscribed renderer when present, without resetting unsaved Agent selections; failed mutations produce no false successful state. (verification: main notification tests and renderer convergence tests; owner: invalidation implementer)
- AC15 — Every new interface string, accessible label, count message, and user-facing error uses i18next and has a reviewed translation in all 15 renderer locales, with no untranslated placeholders or interpolation/plural mismatches. (verification: i18n check and locale review; owner: label-producer and selector implementers)

## Risks

- `EntityTypeSchema` is one flat enum shared by tags, groups and pins, and its design note states that adding a value opens all three at the schema boundary (`src/shared/data/types/entityType.ts:12`). Admitting `'skill'` therefore lets group and pin APIs accept skill ids even though this delivery ships no skill-group or skill-pin UI, membership or rendering. This is a boundary expansion explicitly included in the requested Spec Approval, not an accepted side effect; per-feature gating is a separate decision because the flat enum is deliberate.
- Label names are one database-wide vocabulary: trimmed, 1–64 characters, unique per database (`src/shared/data/types/tag.ts:14`; `src/main/data/db/schemas/tagging.ts:11`). Duplicate-name conflicts, cross-entity rename/delete effects and the lack of case-insensitive identity must stay understandable. Per-Agent private dictionaries would be a new contract.
- `entity_tag` has no foreign key to the skill table, so stale entity bindings can exist and deletion must purge them. Tag foreign keys cascade on tag deletion and tag reads use an inner join (`tagging.ts:34`; `TagService.ts:114`, `:218`), so deleting a shared tag removes bindings without touching skills.
- Skill ids are UUIDs, so no `EntityIdSchema` expansion is needed (`src/shared/data/types/entityType.ts:43`); invalid ids are rejected at the boundary.
- The tag API caps one entity's submitted tag list and one tag's submitted entity list at 100 entries (`src/shared/data/api/schemas/tags.ts:13`). Neither is an Agent group-selection limit, and a replace-all operation must not be chunked as if it appended bindings.
- Metadata refresh rewrites `sourceTags` from `SKILL.md` (`src/main/ai/skills/SkillService.ts:549`, `:1134`); the label projection must never be written from that path or a reinstall would erase user organization.
- Atomic cleanup is required, not merely a purge call: uninstall must delete the skill and its bindings in one transaction while keeping reusable tag definitions (`AgentGlobalSkillService.ts:157`).
- Large installations multiply rendered rows by label membership rather than by skill count; the grid maps rows directly with no virtualization (`CatalogPicker.tsx:102`). List-query time, serialized projection size, search/expand/toggle latency and notification-driven refetches need measurement with representative high-membership data before the existing grid is claimed sufficient.
- Accordion composition can accidentally nest interactive controls; independent focus targets, mixed state, visible action scope, and behaviour when search removes the focused row all need verification.
- Background label refresh can race with Agent initialization and autosave; revalidation must preserve dirty selections and the existing hidden-selection policy.
- Fifteen-locale coverage includes plurals, accessible names, long user-created label names and error text; key synchronization does not prove translation quality or layout usability.

## Implementation layering after Approval

| Layer | Work | Acceptance coverage |
| --- | --- | --- |
| 1. Data | Entity-type admission, label projection on every `InstalledSkill` path, batch read, atomic purge, notification batch | AC3, AC4, AC5, AC14 |
| 2. Producer | Label surface on skill details with failure and partial-success semantics | AC1, AC2 |
| 3. Selector | Sections, per-section control, label-aware search, preserved invariants and accessibility | AC6–AC12 |
| 4. End-to-end and locale | Persisted Agent selection, cross-consumer convergence, all 15 locales | AC13, AC15 (with the earlier layers' evidence) |

Each layer links this Spec and lists the ACs it covers; the final layer maps every criterion to evidence and moves this note to `implemented`.

## Scope fences

- This Spec PR contains only the proposed English/Chinese note and its pairing sidecar. Implementation starts after explicit human Approval on the current Spec head.
- The feature assigns **skills to an Agent by label**; it does not group or bulk-select Agents themselves.
- Labels are flat, shared, user-owned organization metadata: no merge with publisher `sourceTags`, no hierarchy, no ongoing label-based Agent entitlement.
- Skill details is the initial create/reuse/unassign surface. Picker label creation, bulk labeling, and a global label rename/delete manager are follow-ups.
- Selector filtering uses label-name and skill-name matching in the existing search field. Independent tag chips, multi-label boolean filtering and server-side `/skills?tagIds=…` filtering are outside this delivery.
- Automatic source sections, Settings-catalog label grouping, folders, drag-and-drop, packaging, display-name overrides and skill notes remain follow-up work coordinated with #19760.
- Existing tag rename/delete operations must refresh the new consumers; this does not authorize redesigning tag synchronization across unrelated product domains.
- No separate label store, SQL migration, skills-PATCH expansion, persistent collapse preference or speculative hierarchy compatibility is introduced.
- The Spec PR links the issues without claiming the feature is implemented or closing either issue.

## What this Spec does not establish

- Real installed-library or marketplace metadata-tag prevalence; only shipped-template contents were measured.
- Whether detail-only labeling is discoverable enough for users organizing large collections.
- Acceptable performance limits, representative skill/label/membership counts, SQLite parameter-limit behaviour at extreme sizes, or the cost difference between a full `Tag[]` and the narrower projection.
- Actual keyboard/screen-reader behaviour, focus recovery, viewport fit, translated count messages or cross-renderer convergence.
- Any implementation correctness: no implementation exists yet.
- Human acceptance of the four product choices or of the shared-enum expansion.
