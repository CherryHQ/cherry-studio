# English Learning Review and Speaking — Implementation Plan

**Date:** 2026-07-27  
**Status:** Approved design → implementation-ready  
**Design:** [2026-07-27-english-learning-review-speaking-design.md](./2026-07-27-english-learning-review-speaking-design.md)

## Goal

Turn every eligible translation and selection-refinement history item into deduplicated English learning units, schedule review with FSRS, support three speaking modes, notify while Cherry Studio is resident in the tray, and mirror the learning corpus into Obsidian.

Cherry Studio remains the source of truth and execution surface. Obsidian is a one-way knowledge mirror, not the scheduler.

## Delivery constraints

- Work on `main`-based feature branches.
- Keep translation, topic, and message schemas unchanged unless a narrowly scoped provenance contract is required.
- Persist learning business data through SQLite and DataApi.
- Send imperative system, notification, audio, and filesystem commands through IpcApi.
- Register long-lived main-process resources through the lifecycle service registry.
- Use `application.getPath(...)` for app-owned paths. User-selected Obsidian vault paths are external resources and must be validated before access.
- Use `@cherrystudio/ui`, Tailwind, semantic design tokens, and i18n for all new UI.
- Route logs through `loggerService`.
- Generate Drizzle migrations; never hand-edit migration SQL.
- Every stage must include tests and pass its scoped verification before the next stage.

## Scope order

The feature should ship in three independently usable increments:

1. **Review foundation:** ingestion, automatic split/deduplication, FSRS, daily review, notification, and Obsidian mirror.
2. **Universal speaking:** spoken recall, shadowing, and scenario conversation through STT → configured chat model → TTS, with text-only fallback.
3. **Native realtime:** low-latency speech sessions for providers/models that expose a compatible realtime transport.

This order prevents incomplete realtime-provider support from blocking the core review product.

## Phase 0 — Resolve upstream contracts

### Task 0.1: Lock the history provenance contract

**Inspect**

- `src/main/data/services/TranslateHistoryService.ts`
- `src/main/data/services/TemporaryChatService.ts`
- `src/shared/data/api/schemas/temporaryChats.ts`
- `src/renderer/windows/selection/action/components/ActionGeneral.tsx`
- `src/main/data/dataApiDataChange.ts`

**Decision to implement**

Add a generic, optional provenance descriptor to temporary-chat persistence rather than parsing prompt text or hard-coding a topic name:

```ts
type TemporaryChatProvenance =
  | {
      kind: 'selection-action'
      actionId: string
      selectedText: string
    }
```

The persistence result must expose the persisted topic ID and ordered persisted message IDs. The learning ingestion trigger consumes that typed result after the transaction commits. If this requires cross-domain transactional outbox support, implement the smallest generic post-commit data-change event instead of writing learning rows inside `TemporaryChatService`.

**Files**

- Modify `src/shared/data/api/schemas/temporaryChats.ts`
- Modify `src/main/data/services/TemporaryChatService.ts`
- Modify `src/renderer/hooks/useTemporaryTopic.ts`
- Modify `src/renderer/windows/selection/action/components/ActionGeneral.tsx`
- Add or modify focused tests beside each affected module

**Acceptance**

- Refine history is identifiable without inspecting localized prompts or topic names.
- The source user/assistant message IDs are stable and available to ingestion.
- Non-refine selection actions remain persistable and do not enter the learning corpus.
- A failed downstream ingestion does not roll back or lose the original chat history.

**Verify**

```bash
pnpm vitest run src/main/data/services/__tests__/TemporaryChatService.test.ts
pnpm vitest run src/renderer/windows/selection/action/components/__tests__
```

### Task 0.2: Define reusable speech capability contracts

**Inspect**

- `packages/aiCore/src/core/providers/types/index.ts`
- `src/shared/utils/model.ts`
- `src/main/ai/provider/listModels.ts`
- provider adapters under `packages/aiCore/src`
- existing audio capture/playback utilities in `src/renderer`

**Decision to implement**

Create a provider-neutral speech capability description:

```ts
interface SpeechCapabilities {
  realtime: boolean
  transcription: boolean
  synthesis: boolean
  chat: boolean
}
```

Model resolution follows this preference order:

1. user-selected compatible configured model;
2. configured default model with the required capability;
3. any enabled compatible configured model;
4. next lower delivery tier;
5. text-only response with a visible explanation.

Do not infer capability solely from a model name when provider metadata or an adapter contract is available. Keep model-name heuristics isolated as a tested last resort.

**Files**

- Add shared types under the existing `src/shared/model/` category
- Add provider-neutral resolution logic under `src/main/ai/`
- Add unit tests for capability resolution and fallback order

**Acceptance**

- No API keys or model configurations are duplicated in learning preferences.
- The resolver returns an explicit capability gap rather than a generic provider failure.
- Realtime-only models remain hidden from unrelated model pickers unless the upstream product intentionally changes that behavior.

### Task 0.3: Confirm dependency and external-path rules

**Actions**

- Check `patches/` and current dependencies before adding `ts-fsrs`.
- Use the library API through a small local adapter so stored review state does not depend on UI code.
- Reuse `ObsidianVaultService` for vault discovery.
- Add a shared validator for user-selected vault roots and learning-relative paths.
- Do not use Obsidian CLI for automatic sync; Obsidian may be closed. Write atomic Markdown files directly.

**Acceptance**

- An implementation note records the selected `ts-fsrs` version and serialized state fields.
- Vault writes cannot escape the selected vault root through `..`, symlinks, or crafted learning-unit titles.

## Phase 1 — Learning data foundation

### Task 1.1: Add shared domain types and API schemas

**Add**

- `src/shared/data/types/englishLearning.ts`
- `src/shared/data/api/schemas/englishLearning.ts`

**Modify**

- `src/shared/data/api/schemas/apiSchemas.ts`

**Define**

- source kinds: `translation`, `selection_refine`
- source lifecycle: `pending`, `processing`, `ready`, `failed`, `excluded`
- unit kinds: `expression`, `sentence`, `correction`, `pattern`
- card direction: `recognition`, `production`, `listening`
- review rating: `again`, `hard`, `good`, `easy`
- practice modes: `scenario`, `shadowing`, `spoken_recall`
- sync state: `pending`, `synced`, `conflict`, `failed`
- cursor-based list, daily queue, mutation, retry, and dashboard DTOs

Use Zod validation at the API boundary. Keep renderer-only view models out of shared data types.

**Acceptance**

- `ApiSchemas` includes all learning endpoints.
- Bounded list limits and enum validation are explicit.
- API mutations return the changed resource or an explicit result, never an untyped success blob.

### Task 1.2: Add SQLite schemas

**Add**

- `src/main/data/db/schemas/learningSource.ts`
- `src/main/data/db/schemas/learningUnit.ts`
- `src/main/data/db/schemas/reviewCard.ts`
- `src/main/data/db/schemas/reviewEvent.ts`
- `src/main/data/db/schemas/practiceSession.ts`
- `src/main/data/db/schemas/practiceAttempt.ts`
- `src/main/data/db/schemas/learningExternalSync.ts`

Closely related junctions may live in their owning schema file:

- `learning_unit_source`
- `review_state`

**Required constraints and indexes**

- unique `(source_kind, source_record_id, source_revision)`
- unique normalized exact hash for a canonical unit candidate
- unique `(learning_unit_id, card_direction)`
- one review state per card
- index review state by `(due_at, suspended)`
- index source by `(status, updated_at)`
- index external sync by `(target, state, updated_at)`
- foreign keys with deliberate deletion semantics

Use stable UUIDs for learning-domain identity. Preserve review history when an upstream source disappears; detach or archive provenance instead of deleting the canonical unit.

**Generate**

```bash
pnpm db:migrations:generate
pnpm db:migrations:check
```

**Tests**

- schema constraints
- cascade/archive behavior
- generated migration applies to a clean test database

### Task 1.3: Implement data services

**Add**

- `src/main/data/services/LearningSourceService.ts`
- `src/main/data/services/LearningUnitService.ts`
- `src/main/data/services/ReviewService.ts`
- `src/main/data/services/PracticeService.ts`
- `src/main/data/services/LearningExternalSyncService.ts`

**Add tests**

- `src/main/data/services/__tests__/LearningSourceService.test.ts`
- `src/main/data/services/__tests__/LearningUnitService.test.ts`
- `src/main/data/services/__tests__/ReviewService.test.ts`
- `src/main/data/services/__tests__/PracticeService.test.ts`
- `src/main/data/services/__tests__/LearningExternalSyncService.test.ts`

Use `setupTestDatabase()` and production migrations. Use synchronous Drizzle calls inside `withWriteTx`.

**Business rules**

- Source registration is idempotent.
- Reprocessing a changed source creates a new source revision and reconciles links.
- Exact duplicate units merge transactionally.
- Semantic duplicate candidates can merge only after the model returns structured confidence above the configured threshold.
- A merge never discards provenance, prior review events, or practice attempts.
- User edits pin the canonical text and prevent background extraction from silently overwriting it.

### Task 1.4: Implement DataApi handlers

**Add**

- `src/main/data/api/handlers/englishLearning.ts`

**Modify**

- `src/main/data/api/handlers/apiHandlers.ts`

**Endpoints**

- dashboard summary
- list/filter sources
- retry/exclude source
- list/get/update/suspend learning unit
- get daily review queue
- submit review rating
- list practice history
- get/update learning preferences that are business data only
- get sync status and retry a sync item

Keep notification, microphone, audio playback, and filesystem commands out of DataApi.

**Verify**

```bash
pnpm vitest run src/main/data/services/__tests__/Learning
pnpm typecheck
```

## Phase 2 — Import, split, and deduplicate

### Task 2.1: Create the learning lifecycle service and jobs

**Add**

- `src/main/features/englishLearning/EnglishLearningService.ts`
- `src/main/features/englishLearning/index.ts`
- `src/main/features/englishLearning/tasks/jobTypes.ts`
- `src/main/features/englishLearning/tasks/importHistoryJobHandler.ts`
- `src/main/features/englishLearning/tasks/extractLearningUnitsJobHandler.ts`
- tests under `src/main/features/englishLearning/**/__tests__/`

**Modify**

- `src/main/core/application/serviceRegistry.ts`

`EnglishLearningService` must:

- extend `BaseService`;
- register job handlers during lifecycle initialization;
- enqueue one idempotent backfill job on first enable or schema-version advance;
- subscribe to typed post-commit history events;
- reconcile interrupted `processing` sources at startup;
- never hold raw API credentials.

Job payloads must be registered by declaration merging in `tasks/jobTypes.ts`.

### Task 2.2: Backfill every eligible history item

**Translation source**

- Read `translate_history` in keyset pages.
- Include every non-empty source/target pair.
- Record source ID, timestamps, languages, and a deterministic revision hash.

**Selection-refine source**

- Read only topics/messages carrying the typed provenance contract introduced in Task 0.1.
- Pair the selected source text with the successful assistant refinement.
- Ignore incomplete, errored, and non-refine conversations.

**Recovery**

- Persist a cursor/checkpoint after each committed page.
- Make re-running safe.
- Mark malformed sources `failed` with a user-visible retry path.

**Acceptance**

- Count reconciliation proves every eligible history record is `ready`, `processing`, `pending`, `failed`, or `excluded`.
- Restarting during backfill neither duplicates nor skips records.

### Task 2.3: Structured extraction

Use a configured Cherry Studio chat model and require a validated JSON response containing:

- atomic English expression or sentence;
- natural meaning;
- source correction when applicable;
- usage note;
- example;
- tags;
- CEFR estimate;
- extraction confidence.

Pipeline:

1. deterministic cleanup and paragraph/sentence boundary split;
2. model extraction for ambiguous or multi-unit content;
3. Zod validation;
4. one repair attempt for invalid structured output;
5. explicit `failed` status if still invalid.

Batch within provider limits, but isolate each source result so one malformed item does not fail the whole batch.

### Task 2.4: Two-stage deduplication

**Stage A — deterministic**

- Unicode normalization;
- whitespace and punctuation normalization;
- conservative case folding;
- exact normalized hash match.

**Stage B — semantic**

- Compare only bounded candidates selected by lexical similarity, shared lemmas, or embeddings already available through Cherry Studio.
- Ask the configured model for `same`, `related`, or `distinct` plus confidence.
- Auto-merge only `same` above the threshold.
- Preserve `related` as a relationship, not a merge.
- Store the decision, model ID, and confidence for audit.

**Tests**

- punctuation/case duplicates;
- correction versus genuinely different meaning;
- phrasal verbs with different particles;
- same surface form with different senses;
- model timeout and invalid response;
- deterministic repeatability.

## Phase 3 — FSRS review and daily queue

**Implementation note (2026-07-28):** the review adapter pins `ts-fsrs@5.4.1`. Persisted state is
owned by Cherry Studio and contains `dueAt`, `stability`, `difficulty`, `elapsedDays`,
`scheduledDays`, `reps`, `lapses`, `learningSteps`, `phase`, `lastReviewAt`, `suspended`, and
`schedulerVersion`. Library `Card` objects do not cross the adapter boundary.

### Task 3.1: Add the FSRS adapter

**Add**

- `src/main/features/englishLearning/review/fsrsAdapter.ts`
- `src/main/features/englishLearning/review/__tests__/fsrsAdapter.test.ts`

The adapter owns:

- conversion between persisted review state and `ts-fsrs`;
- card creation defaults;
- rating application;
- due-date calculation;
- library-version migration.

Never calculate the next due date in the renderer.

### Task 3.2: Materialize review cards

Create three card directions where content supports them:

- recognition: English → meaning/use;
- production: meaning/context → English;
- listening: audio → transcription/meaning.

Do not create an empty listening card when no synthesis path exists; mark it available once a compatible speech path is resolved.

### Task 3.3: Build the daily queue

Queue order:

1. overdue cards;
2. cards due today;
3. failed/relearning cards;
4. bounded new cards fitting the daily time budget.

Interleave unit types and avoid immediately showing two cards from the same unit. Estimate remaining time from the user's rolling median response time, falling back to conservative defaults.

Submitting a rating and its review event must be one transaction. Repeated requests with the same client mutation ID must be idempotent.

### Task 3.4: Add review preferences

Use Preference for settings rather than SQLite business tables:

- enabled;
- daily time budget;
- preferred review time;
- quiet hours;
- default snooze duration;
- new-card cap;
- Obsidian mirror enabled/vault/folder;
- preferred model IDs per capability.

If these keys belong to the generated preference catalog, update the classification source and regenerate; do not edit generated schema files directly.

## Phase 4 — Background scheduling, tray, and notifications

### Task 4.1: Implement `LearningSchedulerService`

**Add**

- `src/main/features/englishLearning/LearningSchedulerService.ts`
- focused lifecycle and time-boundary tests

**Modify**

- `src/main/core/application/serviceRegistry.ts`

Responsibilities:

- restore the next persisted reminder on application startup;
- schedule the next due boundary through `SchedulerService`;
- recalculate after review, preference change, snooze, clock/time-zone change, or system resume;
- coalesce notifications so one due boundary produces one notification;
- remain active while all windows are closed and the tray keeps the app alive;
- stop and dispose timers on explicit application quit.

Use `PowerService` events for resume/time-change handling if available; improve that upstream service if the required event is missing.

### Task 4.2: Complete action-notification routing

**Modify**

- `src/shared/types/notification.ts`
- `src/main/services/NotificationService.ts` only if required by the generic action contract
- renderer notification action registry under `src/renderer/services/notification/`
- focused IPC and renderer tests

Add `learning` to `NotificationSource`. Use stable actions:

- `learning.open-today`
- `learning.snooze`

Clicking the notification must:

1. show/focus the main window;
2. navigate to `/app/learning?view=today`;
3. preserve the due queue if the route takes time to mount.

Snooze writes a persisted `snoozedUntil`; it does not alter FSRS due dates.

**Acceptance**

- Closing the main window to tray still allows an on-time notification.
- Explicit Quit stops future notifications.
- Restart restores a pending snooze.
- A notification clicked after the queue is already complete opens the completed daily view without resurrecting cards.

## Phase 5 — Review UI

### Task 5.1: Add navigation and route

**Add**

- `src/renderer/routes/app/learning.tsx`
- `src/renderer/pages/learning/LearningPage.tsx`
- route/page tests

**Modify**

- `src/renderer/utils/sidebar.ts`
- `src/renderer/components/app/sidebarIcons.tsx`
- `src/shared/data/preference/preferenceTypes.ts` through its generator when required
- i18n locale sources

Use a semantic icon such as `GraduationCap` or `Brain`, subject to the existing icon set. Add the learning app to sidebar ordering without forcing it into existing users' customized visible favorites.

### Task 5.2: Build the daily review surface

**Add under `src/renderer/pages/learning/`**

- `components/DailyReview.tsx`
- `components/ReviewCard.tsx`
- `components/ReviewRatingBar.tsx`
- `hooks/useDailyReview.ts`
- co-located tests

Interaction:

- prompt first;
- reveal on click/keyboard;
- rate with four FSRS ratings;
- support keyboard shortcuts;
- show progress and estimated time, not a distracting permanent score;
- make undo explicit and limited to the immediately previous review.

### Task 5.3: Add Library, Speaking, and Progress views

The page provides:

- **Today:** due queue and completion state;
- **Library:** source/unit search, merge audit, edit, suspend, retry;
- **Speaking:** mode selection and recent sessions;
- **Progress:** retention, due load, studied time, and skill mix.

Keep components co-located until another domain genuinely reuses them.

**Accessibility**

- all primary actions keyboard reachable;
- visible focus rings;
- no meaning conveyed by color alone;
- reduced-motion support;
- screen-reader labels for review state and recording controls.

## Phase 6 — Obsidian one-way mirror

### Task 6.1: Build safe Markdown rendering

**Add**

- `src/main/features/englishLearning/obsidian/markdownRenderer.ts`
- `src/main/features/englishLearning/obsidian/pathSafety.ts`
- unit tests

Output:

```text
English Learning/
  Expressions/<stable-id>.md
  Daily/YYYY-MM-DD.md
  Dashboard.md
```

Atomic note frontmatter includes:

- stable learning unit ID;
- canonical English;
- meaning;
- type/tags/CEFR;
- source references;
- Cherry deep link;
- sync revision.

Do not mirror FSRS mutable state as an editable source of truth. A small generated status summary is acceptable inside a clearly managed block.

### Task 6.2: Implement sync jobs

**Add**

- `src/main/features/englishLearning/tasks/syncObsidianJobHandler.ts`
- integration tests using a temporary vault directory

Rules:

- write to a temporary sibling file and rename atomically;
- identify managed files by stable ID, never title alone;
- update only the managed block when a user has added notes outside it;
- detect conflicting edits inside the managed block and mark `conflict`;
- never delete a user-edited file automatically;
- retry transient failures with bounded backoff;
- work while Obsidian is closed.

### Task 6.3: Generate daily log and Dataview dashboard

Daily logs summarize:

- cards reviewed;
- speaking minutes;
- difficult units;
- new units;
- next due load.

`Dashboard.md` contains a useful static fallback plus optional Dataview queries. The mirror remains readable without the Dataview plugin.

## Phase 7 — Universal speaking pipeline

### Task 7.1: Add generic speech IPC and lifecycle service

**Add**

- `src/shared/ipc/schemas/speech.ts`
- `src/main/ai/speech/SpeechSessionService.ts`
- `src/main/ai/speech/transcriptionAdapter.ts`
- `src/main/ai/speech/synthesisAdapter.ts`
- focused tests

**Modify**

- IPC schema/router registration
- `src/main/core/application/serviceRegistry.ts`

The service owns provider calls and abortable session resources. The renderer owns microphone permission, capture, playback, and waveform state.

No raw audio is retained by default. Persist only derived attempt metrics and transcript unless the user explicitly enables recording retention later.

### Task 7.2: Add renderer audio session controls

**Add under the learning page**

- `speech/useMicrophoneSession.ts`
- `speech/useAudioPlayback.ts`
- `speech/SpeechControls.tsx`
- tests with browser media mocks

Handle:

- permission denied;
- input device missing/disconnected;
- recording cancellation;
- app backgrounding;
- provider timeout;
- user interruption during playback.

### Task 7.3: Implement spoken recall

Flow:

1. show meaning/context or play prompt;
2. capture user speech;
3. transcribe;
4. compare with canonical unit using deterministic text similarity plus model feedback;
5. show transcript, omissions, grammar/wording feedback, and a model answer;
6. ask the user for the FSRS rating rather than deriving it solely from ASR.

ASR confidence must be labeled as recognition confidence, never pronunciation quality.

### Task 7.4: Implement shadowing

Flow:

1. synthesize/play the target;
2. capture repetition;
3. transcribe;
4. align words and pauses;
5. show transcript-level differences and timing guidance.

Do not claim phoneme-level pronunciation scoring unless the active provider supplies a documented pronunciation-assessment API.

### Task 7.5: Implement scenario conversation

Create a bounded session context:

- scenario and CEFR target;
- relevant learning units;
- recent turns;
- corrective policy;
- end condition.

Use STT → configured chat model → TTS. Stream text feedback when audio synthesis is unavailable. Store session/attempt summaries through `PracticeService`.

## Phase 8 — Native realtime speech

### Task 8.1: Add provider adapters

Implement realtime only for providers with a verified compatible API. Each adapter must expose:

- session creation;
- audio input format;
- incremental transcript events;
- audio output events;
- interruption/cancel;
- terminal/error state;
- token/usage reporting when supplied.

Keep provider-specific event names out of learning UI.

### Task 8.2: Add automatic tier selection

At session start:

1. resolve current capabilities;
2. attempt realtime;
3. fall back to universal pipeline on unsupported capability;
4. fall back to text-only if transcription or synthesis is unavailable;
5. explain the active mode without blocking practice.

Do not silently switch providers when that would have a material privacy or cost implication; respect the configured provider preference order.

### Task 8.3: Realtime reliability tests

Test:

- reconnect before first response;
- mid-turn disconnect;
- user barge-in;
- cancellation;
- partial transcript replacement;
- duplicate/out-of-order provider events;
- device change;
- fallback without duplicate assistant turns.

## Phase 9 — End-to-end recovery and observability

### Task 9.1: Add explicit recovery paths

On startup:

- retry or fail interrupted import/extraction jobs according to handler policy;
- reconcile sources stuck in `processing`;
- restore the next reminder;
- retain incomplete Obsidian sync items;
- close abandoned speech sessions as interrupted.

### Task 9.2: Add structured logs and product metrics

Log IDs and state transitions, but do not log full source text, transcripts, or API credentials.

Useful counters:

- eligible/imported/failed sources;
- extracted/merged units;
- review completion and response time;
- notification fired/opened/snoozed;
- speech tier selected and failure category;
- Obsidian sync success/conflict/failure.

Analytics remains subject to the application's existing privacy controls.

### Task 9.3: Full journey tests

Cover:

1. old translation → backfill → extracted unit → due card → rating → Obsidian note;
2. new translation → incremental ingestion without restart;
3. refine action → typed provenance → learning source;
4. duplicate histories → one canonical unit with multiple sources;
5. window close → tray → notification → click → today's queue;
6. snooze → restart → later notification;
7. explicit quit → no further process notification;
8. speech capability fallback;
9. vault unavailable → queued sync → later recovery.

## Required verification for every implementation PR

Run focused tests during each task, then before commit:

```bash
pnpm install
pnpm lint
pnpm test
pnpm format
pnpm build:check
pnpm test:lint
```

For database changes also run:

```bash
pnpm db:migrations:generate
pnpm db:migrations:check
```

For UI changes:

- visually inspect light and dark themes;
- verify narrow and standard widths;
- test keyboard-only review;
- verify microphone permission denial;
- verify notification deep-link routing in the packaged Electron app.

## Recommended PR sequence

1. `feat(learning-data): add learning schemas and data API`
2. `feat(learning-ingestion): import and deduplicate language history`
3. `feat(learning-review): add FSRS queue and review events`
4. `feat(learning-reminders): schedule tray-backed review notifications`
5. `feat(learning-ui): add daily review and learning library`
6. `feat(learning-obsidian): mirror units and daily logs`
7. `feat(speech-runtime): add configured-model speech pipeline`
8. `feat(learning-speaking): add three speaking practice modes`
9. `feat(speech-realtime): add native realtime provider adapters`

Each PR must be independently testable and must not leave a user-visible dead-end navigation item.

## Definition of done

- Every eligible historical translation and refine record has an auditable ingestion state.
- New eligible records enter the pipeline automatically.
- Units are automatically split and deduplicated without losing provenance.
- The FSRS queue survives restart and records every rating transactionally.
- Due reminders fire while Cherry Studio is resident in the tray, support snooze, deep-link to Today, and stop on explicit Quit.
- All three speaking modes work through at least the universal pipeline, with honest capability degradation.
- Cherry Studio uses already configured providers/models.
- Obsidian contains stable atomic notes, daily logs, and a dashboard without owning schedule state.
- Recovery, privacy, accessibility, and failure states have automated coverage.
- Repository lint, test, format, build, migration, and CI-equivalent lint gates pass.
