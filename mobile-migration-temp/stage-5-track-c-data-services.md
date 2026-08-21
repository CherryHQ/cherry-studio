# Stage 5 / Track C — Data Services: Business-Rule Layer Extraction

## Objective

Deduplicate the 30 same-name data services by extracting their platform-independent business rules
into shared pure modules, while retaining per-application execution shells that own the
synchronous/asynchronous divide.

## Preconditions

**Stage 4b (`db-schema`) is a hard prerequisite** — service-layer sharing presupposes shared table
definitions. Stage 4a (`lifecycle-kernel`) provides the registration host.

## Measured State

- Desktop `src/main/data/services/`: 35 files (33 services + `dataServiceRegistry.ts` + `utils/`),
  **all with zero Electron imports** — coupling is exclusively `@application` (DI) and Drizzle.
- Mobile `apps/mobile/src/backend/data/services/`: **30 services re-implemented under identical
  class names** (`AgentChannel`, `AgentGlobalSkill`, `Agent`, `AgentSessionMessage`,
  `AgentSession`, `AgentTask`, `AgentWorkspace`, `AiUsageRecord`, `Assistant`, `ContentSearch`,
  `EntitySearch`, `FileEntry`, `FileRef`, `Group`, `Job`, `KnowledgeBase`, `KnowledgeItem`,
  `McpServer`, `Message`, `MiniApp`, `Model`, `Note`, `Painting`, `Pin`, `Prompt`,
  `ProviderRegistry`, `Provider`, `Tag`, `TemporaryChat`, `Topic`, `TranslateHistory`,
  `TranslateLanguage`).
- Desktop-only: `AgentChannelWorkflowService`, `JobScheduleService`.
- **The structural wall (sampled on `TagService`):** desktop 480 lines / `async` count 0
  (better-sqlite3 is synchronous; `withWriteTx` requires a synchronous callback holding
  `BEGIN IMMEDIATE`); mobile 365 lines / `async` count 39 (expo-sqlite is asynchronous). Textual
  diff 611 lines, dominated by the sync/async transform plus schema drift.

**Conclusion:** whole-service unification is not directly achievable — the synchronous/asynchronous
execution models cannot be papered over by an interface. The shareable stratum is the business-rule
layer.

## Target Shape

```
packages/<domain>-rules/            # or folded into data-contract; decide by volume at execution
  Pure functions: validation, default resolution, ordering rules, query shapes
  (Drizzle query-builder fragments), entity state machines (e.g. message status
  transitions), error taxonomy.
  Dependencies: packages/db-schema (table definitions), data-contract (types). Zero I/O.

Per-application thin execution shells:
  desktop  src/main/data/services/XxxService.ts        — synchronous shell, withWriteTx
  mobile   apps/mobile/src/backend/data/services/…     — asynchronous shell, await tx
```

Rule modules return Drizzle expressions/query shapes; execution (sync vs async) belongs to the
shells.

## Execution Order

1. **Shape validation on the smallest pair:** `TagService` (480↔365) or `PromptService`
   (desktop coupling: el=0 / app=2 / db=2; measured diff 209 lines). Deliver the first `-rules`
   module + both rewritten shells; both applications' suites green → shape confirmed before
   batching.
2. **Batch order by ascending desktop coupling** (`@application` / db reference counts):
   `PinService` (2/2) → `TemporaryChatService` (2/2) → `GroupService` (2/2) → `NoteService` (2/5)
   → … → the heavyweights last: `MessageService` (26/28), `AgentSessionService` (18/18),
   `ProviderService` (18/17), `TopicService` (17/18).
3. One service per PR. Gate: CRUD contract tests on both shells against real databases (desktop:
   `setupTestDatabase()` from `@test-helpers/db`; mobile: its existing DB test rig). Repository
   testing law applies: assert contracts, no behavior-pinning tests.
4. Untouched: the two desktop-only services and both `dataServiceRegistry` implementations.

## On Further Unifying the Execution Shells

**Deliberately undecided.** After the rule layer lands across the batch, re-evaluate: if the shells
have become mechanical boilerplate, a desktop transaction-model redesign (heavy, separately
chartered) could merge them; if shell maintenance cost is negligible, dual shells are the terminal
state.

## Verification (per-service PR)

```
pnpm test:main                                   # desktop data-service suites (setupTestDatabase)
pnpm --filter cherry-studio-app test
```
Sync-manifest domains `data-main` / `data-renderer` shed entries as the batch progresses.
