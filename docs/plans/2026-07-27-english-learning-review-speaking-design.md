# English Learning Review and Speaking Design

## Context

Cherry Studio already captures two valuable kinds of English-learning source
material:

1. Translation history stores the source text, translated text, source and target
   languages, and timestamps.
2. Successful selection-assistant actions can append isolated invocations into a
   stable assistant-and-action topic. The built-in `refine` action preserves the
   original selected text and the polished response without carrying earlier
   history into later model requests.

The product goal is to turn all identifiable translation and polishing history
into a long-term English-learning loop:

```text
history → learning units → scheduled review → speaking practice
        → observed mistakes and better expressions → learning units
```

The user wants:

- every history record to participate in learning;
- automatic decomposition and deduplication instead of one card per history;
- FSRS-based scheduled review with tray-backed notifications;
- scenario conversation, shadowing, and spoken card recall;
- reuse of the providers and models already configured in Cherry Studio;
- reminders while the main window is closed to the tray, but not after an
  explicit application quit; and
- an Obsidian-compatible knowledge mirror without moving the authoritative
  review state out of Cherry Studio.

## Goals

1. Import all existing and future identifiable translation and polishing
   history without blocking the originating workflow.
2. Convert source material into useful learning units covering active
   production, vocabulary, collocation, grammar, register, and pragmatics.
3. Deduplicate repeated learning material while retaining complete provenance.
4. Schedule review locally with a well-supported FSRS implementation.
5. Provide three speaking modes over one provider-neutral speech runtime.
6. Feed speaking mistakes and newly discovered expressions back into the same
   learning pipeline.
7. Export a safe, portable, one-way knowledge projection to Obsidian.
8. Preserve progress across application restarts, partial failures, model
   changes, and source-history deletion.

## Non-goals

- Claiming that a single aggregate score proves native-level English.
- Using ordinary ASR confidence as a calibrated pronunciation score.
- Making Obsidian or Anki a second authoritative scheduler.
- Sending every historical item to a model in one unbounded batch.
- Requiring a native realtime-audio model for basic speaking practice.
- Implementing system-level reminders after the user explicitly quits Cherry
  Studio.
- Silently classifying unmarked legacy chat topics as polishing history.

## Chosen architecture

Use an independent learning domain backed by SQLite.

Translation history and assistant topics remain immutable source systems. The
learning domain stores source snapshots, deduplicated units, generated cards,
review state, attempts, and external-sync state. It never adds scheduling fields
to translation rows or chat messages.

Rejected alternatives:

1. **Add review fields to existing histories.** A history can produce many
   cards, and one deduplicated card can come from many histories. The resulting
   many-to-many relationship does not fit either source table.
2. **Store cards as assistant topics.** Topics cannot reliably model due-time
   queries, review state, deduplication, or learning analytics, and card traffic
   would pollute ordinary assistant history.

## Domain model

### Learning source

`learning_source` is the durable ingestion boundary.

Suggested fields:

- `id`
- `kind`: `translate_history`, `selection_refine`, or `speaking_session`
- `external_id`: the source record or message-group identity
- `revision_hash`
- `source_text`
- `result_text`
- `source_language`
- `target_language`
- `source_created_at`
- `processing_state`
- `processing_attempts`
- `last_error_code`
- `last_error_message`
- `created_at`
- `updated_at`

The unique identity is `(kind, external_id, revision_hash)`. Repeated data-change
notifications and process restarts therefore cannot create duplicate work.

### Learning unit

`learning_unit` is a deduplicated concept or expression.

Suggested fields:

- `id`
- `kind`: `word`, `collocation`, `idiom`, `sentence`, `grammar`,
  `register`, or `pragmatics`
- `canonical_english`
- `meaning`
- `meaning_key`
- `explanation`
- `register`
- `difficulty_level`
- `canonical_key`
- `status`: `active`, `paused`, or `deleted`
- timestamps

The material extractor must recognize more than isolated words:

- frequent phrases and collocations;
- idioms and phrasal verbs;
- idiomatic complete sentences;
- grammar patterns and error contrasts;
- formal, conversational, polite, direct, and other register differences;
- upgrades between original and polished text; and
- literal-translation artifacts and their natural English alternatives.

Every source produces at least one active-production unit. If no finer-grained
item is useful, the fallback is a whole-sentence production unit.

### Provenance

`learning_unit_source` is a many-to-many link containing:

- `unit_id`
- `source_id`
- source span or extraction index
- the model-provided extraction rationale

Merging units never discards their source links. The UI can show every
translation, polishing action, or speaking session in which the expression
appeared.

### Cards and scheduling

`review_card` stores a concrete prompt-answer representation:

- recognition;
- English production from meaning or context;
- cloze;
- listening recognition; or
- spoken production.

One unit normally produces one to three cards selected for instructional value,
not every possible card type.

`review_state` stores the FSRS card state separately from card content:

- due time;
- difficulty;
- stability;
- learning state;
- last review time;
- repetitions; and
- lapses.

`review_event` is append-only and records the rating, duration, modality,
session, and pre/post scheduling state for each completed review.

### Speaking records

`practice_session` stores the mode, selected learning units, configured model
identities, start/end times, and completion state.

`practice_attempt` stores:

- the associated unit/card;
- transcript;
- target-expression coverage;
- timing and fluency observations;
- qualitative feedback;
- the suggested review rating; and
- the user-confirmed review rating.

Raw audio is temporary by default. A separate managed file reference is stored
only when the user opts to retain a representative recording.

## Ingestion and deduplication

### Existing history backfill

On first enablement, a resumable background job cursor-pages through translation
history and identifiable selection-refine aggregates. It registers sources
without waiting for model processing to finish.

The current selection aggregate ID is deterministically derived from the
assistant ID and `selection-action:refine`, so current refine topics can be
identified when their assistant/action configuration is known. Earlier
one-topic-per-invocation history and topics for deleted custom actions lack
durable action metadata. Those topics require an explicit user-assisted import
and must not be guessed from their title.

### Future incremental ingestion

Successful translation-history creation and successful refine-history
persistence emit or reuse a post-commit data-change signal. A learning ingestion
consumer records the source and enqueues an idempotent processing job. Translation
and polishing result display never waits for card generation.

Future selection persistence must pass durable provenance sufficient to identify
the action directly. The learning feature must not rely only on a localized
topic name.

### Model extraction

The configured language model receives bounded source batches and must return a
versioned, strict structured schema. The response is validated before any write.
The model may propose:

- unit type;
- canonical English;
- meaning and meaning key;
- explanation;
- register;
- examples;
- source spans; and
- suitable card types.

The model cannot write scheduling state or review results.

### Two-stage deduplication

1. Deterministic normalization canonicalizes case, whitespace, punctuation,
   inflection where appropriate, and the meaning key.
2. Semantic candidate matching considers only nearby candidates. A model may
   adjudicate whether two candidates represent the same sense or different
   senses.

Once a semantic merge decision is stored, later processing reuses it instead of
asking the model again. Different senses of the same spelling remain different
units.

All source-link, unit, card, and job-state changes for one processed source
commit in one synchronous `withWriteTx` transaction.

### Updates and deletion

- A changed source creates a new revision and is reprocessed.
- Existing unit/card identity and review progress are retained when the
  canonical learning target is materially unchanged.
- Deleting an original history record does not delete learned units or progress.
  The learning domain retains the source snapshot.
- Users can pause or delete units explicitly in the learning library.
- Units with no remaining live source are not automatically deleted.

## Review scheduling

Use the maintained `ts-fsrs` package rather than a custom memory algorithm.
Supported review ratings are:

- Again;
- Hard;
- Good; and
- Easy.

FSRS computation is local and deterministic for a given prior state, rating,
time, and configuration.

### New-card introduction

All source history enters the library immediately, but the daily queue
introduces new cards gradually. Initial setup asks for a daily time target.
Observed completion speed over the previous seven days converts that target into
a new-card budget.

Queue priority:

1. overdue cards;
2. cards due today;
3. expressions recently missed in speaking;
4. unseen new cards; and
5. optional reinforcement.

Sibling cards from the same unit are separated within a session. Repeatedly
failed cards receive shorter cross-session intervals without appearing in a
frustrating immediate loop.

### Learning scheduler service

Add a lifecycle-managed `LearningSchedulerService`.

1. On readiness, query SQLite for the earliest due card or persisted snooze
   deadline.
2. Register one `once` trigger with the existing `SchedulerService`.
3. When it fires, re-query all due cards and emit one aggregate notification.
4. After a review, import, snooze, or configuration change, unregister and
   rebuild the next trigger.
5. Reconcile on system resume and relevant clock/timezone changes.

The scheduler itself remains non-persistent. SQLite is authoritative, and each
application start reconstructs the timer.

### Notification behavior

- One aggregate notification represents the current due batch.
- Clicking it shows the main window and navigates to today's review.
- Snooze choices include 15 minutes, one hour, tonight, and tomorrow.
- Quiet hours defer and coalesce reminders.
- No system notification is emitted while a review session is already open.
- Closing the main window to the tray keeps the main process and scheduler
  alive.
- Explicit quit stops lifecycle services and reminders.
- Restarting after a long absence reconstructs the overdue queue without
  replaying historical notifications.

## Speech architecture

The existing model catalog distinguishes transcription and speech model kinds,
but the application lacks a complete provider-neutral STT/TTS execution service
and a realtime-audio runtime. Build this capability upstream instead of placing
provider-specific calls in learning components.

### Speech session service

Add a lifecycle-managed `SpeechSessionService` with provider adapters and three
capability levels:

1. Native bidirectional realtime audio for providers that support it.
2. STT → text language model → streaming TTS.
3. STT → text language model with text-only assistant output when no TTS model
   is configured.

Settings select or auto-recommend:

- realtime conversation model;
- transcription model;
- TTS model and voice; and
- feedback model.

Renderer capture uses `AudioWorklet`. High-frequency audio frames use a
dedicated message channel rather than request/response IPC. Long-lived
credentials and provider connections remain in the main process. Session
cancellation stops capture, transcription, generation, and playback together.

### Scenario conversation

- Select a small set of due or weak expressions and a user-relevant scenario.
- Do not reveal target answers by default.
- Native realtime providers allow full-duplex interruption.
- The composed pipeline stops current TTS when the user begins speaking again.
- Live captions can be hidden.
- End-of-session feedback covers natural rewrites, grammar, collocation,
  register, unused targets, and newly discovered expressions.
- Proposed new expressions require user confirmation before entering the
  learning pipeline.

### Shadowing

The flow is reference playback → user recording → alignment → focused retry.

Evidence-backed output includes:

- word omissions, substitutions, and additions;
- speech rate, start latency, pauses, and repetition;
- relative rhythm and phrase-boundary differences; and
- qualitative pronunciation coaching from an audio-capable evaluator.

Ordinary ASR confidence must never be presented as a calibrated phoneme or
accent score. Precise pronunciation scoring requires a dedicated pronunciation
assessment or forced-alignment adapter. Users can retry only the problematic
segment.

### Spoken card recall

- Prompt with meaning, context, image, or an incomplete dialogue.
- Transcribe the user's active English response.
- Check required target-expression coverage deterministically where possible.
- Use a model to assess meaning, naturalness, register, and acceptable
  alternatives rather than exact string equality.
- Show the user's answer, reference answer, a natural rewrite, and reference
  audio.
- Suggest an FSRS rating, but let the user override it before commit.

### Speech failure and privacy

- Incomplete or failed speech requests do not alter FSRS state.
- Network interruption retains temporary audio only for an explicit retry.
- Leaving the practice session deletes temporary audio.
- Raw recordings are not retained unless the user opts in.
- Missing model capabilities are described precisely, and modes degrade only
  along the supported capability levels.

## Obsidian ecosystem

Cherry Studio is the only authoritative scheduler and practice system. Obsidian
is a portable, searchable knowledge projection.

The default export structure is:

```text
English Learning/
├── Expressions/
│   └── take something for granted--lu_a13f.md
├── Daily/
│   └── 2026-07-27.md
└── Dashboard.md
```

### Atomic expression notes

Each learning unit is projected as one Markdown note with stable YAML:

```yaml
---
cherry_id: lu_a13f
type: collocation
level: B2
register: conversational
tags:
  - english/collocation
  - cherry-learning
---
```

The note includes meaning, source context, natural usage, related wikilinks, and
optional Obsidian Spaced Repetition-compatible card syntax. Compatibility syntax
does not make the Obsidian plugin authoritative and does not export Cherry's
FSRS state.

### Daily log and dashboard

Daily logs summarize completed reviews, speaking time, mistakes, and newly
created units. The dashboard uses Dataview-compatible YAML and queries to show
recent learning, weak categories, registers, and source distribution.

### Safe synchronization

Automatic sync writes Vault Markdown atomically and does not require Obsidian to
be running. The Obsidian CLI is useful for development verification and explicit
user actions only.

Rules:

- file names contain a stable short ID;
- SQLite maps unit IDs to Vault identity and relative paths;
- `cherry_id` relocates a note after the user moves or renames it;
- Cherry updates only explicit managed blocks and `cherry_*` properties;
- user-authored content outside managed blocks is never overwritten;
- an externally changed managed block becomes `needs_attention`;
- missing or offline Vaults leave a resumable sync queue;
- writes reject absolute paths, `..`, `.obsidian`, symlink escapes, and any
  target outside the configured Vault; and
- review state is not read back from Obsidian.

Anki/AnkiConnect can be added later as a separate export adapter with stable
external ID mapping. Two-way scheduler synchronization is out of scope.

## Product surface

Add a pinnable `/app/learning` application using TanStack Router and
`@cherrystudio/ui`.

### Today

- due count and estimated duration;
- start-review action;
- entry points for the three speaking modes;
- ingestion and sync status; and
- concise progress summary.

### Review

A distraction-minimized card surface supporting keyboard and voice operation.
The answer and rating controls appear only after recall.

### Speaking

Separate entry points for scenario conversation, shadowing, and spoken card
recall, backed by the same session and model-capability controls.

### Library

Search and filter by kind, source, register, status, and learning state. Users
can inspect provenance, resolve merge/sync conflicts, pause units, and delete
learning content independently from original histories.

### Progress

Report active production, listening, pronunciation evidence, fluency, grammar,
and pragmatics separately. Do not collapse these into an unsupported
"native-level" score.

### Settings

- daily time target and new-card policy;
- quiet hours and reminder behavior;
- speech/realtime models and voice;
- recording retention;
- Obsidian Vault, root directory, and sync behavior; and
- background-processing controls.

The interface follows `DESIGN.md`: neutral chrome, semantic status colors,
shared primitives, no page-local brand palette, and i18n for all visible text.

## Error and recovery model

Long-running work uses explicit durable states:

```text
pending → processing → completed
                     ↘ failed → retrying
                     ↘ needs_attention
```

This applies to source extraction, semantic merge adjudication, speech analysis,
and Obsidian synchronization.

- Startup recovers abandoned `processing` work using a lease/attempt policy.
- Retriable provider and network failures use bounded exponential backoff.
- Validation, permission, and conflict errors become `needs_attention`.
- Each error stores a stable classification and safe summary.
- Model or prompt-version changes may reprocess learning content without
  resetting FSRS history.
- Central logging uses `loggerService`; no raw source text or credentials are
  written to logs.

## Delivery stages

### Stage 1: Learning core

- schemas and DataApi domain services;
- history backfill and incremental ingestion;
- model extraction and deduplication;
- cards, FSRS, daily queue, and tray notifications;
- Today, Review, Library, Progress, and Settings surfaces; and
- Obsidian expression notes, daily logs, and dashboard.

This stage is independently useful and forms the complete scheduled-review
product.

### Stage 2: Structured speaking

- provider-neutral STT/TTS service;
- spoken card recall;
- shadowing;
- recording privacy and retention; and
- unified attempts and feedback.

### Stage 3: Realtime conversation

- native realtime provider adapter;
- STT/LLM/TTS fallback pipeline;
- interruption, cancellation, captions, and backpressure;
- end-of-conversation feedback; and
- confirmed feedback-to-card loop.

## Verification

### Data and business logic

- Use `setupTestDatabase()` with production migrations.
- Repeated source events produce one source revision and no duplicate cards.
- Many histories can link to one unit without losing provenance.
- Identical spelling with different meanings remains separate.
- Source modification preserves progress when the learning target is unchanged.
- Source deletion does not erase units or review history.
- Invalid structured model output cannot mutate learning or scheduling state.
- Multi-write processing rolls back atomically.

### Scheduler and notifications

- Test due, overdue, snooze, quiet hours, resume, and timezone changes with fake
  clocks.
- Verify one aggregate notification and click navigation.
- Verify reminders continue with the main window hidden to tray.
- Verify explicit quit stops reminders.
- Verify restart reconstructs the next trigger from SQLite.

### Speech

- Contract-test every speech provider adapter.
- Cover native realtime, composed audio, and text-only degradation.
- Verify interruption, cancellation, slow-consumer backpressure, disconnect,
  and component unmount.
- Verify incomplete sessions never update FSRS.
- Verify ordinary ASR cannot produce a labeled phoneme score.

### Obsidian

- Use a temporary Vault for create, update, relocation, and idempotent append
  tests.
- Preserve user-authored blocks and properties.
- Detect externally changed managed blocks as conflicts.
- Reject absolute paths, traversal, `.obsidian`, and symlink escape.
- Recover queued sync after the Vault becomes available.

### Renderer and system checks

- Test daily queue, card controls, model gaps, microphone denial, and sync
  conflicts.
- Test notification-to-route behavior.
- Keep all visible text in i18n.
- Run `pnpm lint`, `pnpm test`, `pnpm format`, and `pnpm build:check`.
- Manually smoke-test microphone permission, tray behavior, and notifications
  on macOS, Windows, and Linux.

## Confirmed, inferred, and needs verification

### Confirmed

- Translation history contains the required source/result/language metadata.
- Selection `refine` uses isolated temporary generation and aggregate history
  persistence.
- The scheduler supports one-shot triggers but intentionally does not persist
  them.
- Tray-on-close behavior and notification click broadcasts already exist.
- Model types distinguish transcription and speech capabilities.
- Existing Obsidian integration can discover Vaults and export Markdown through
  user-driven flows.

### Inferred design decisions

- Cherry Studio remains the authoritative scheduler.
- Obsidian is a one-way knowledge mirror.
- Raw recordings are ephemeral by default.
- New cards are introduced according to a time budget instead of immediately.

### Needs verification during implementation planning

- Exact source provenance changes required at the selection persistence
  boundary for future custom polishing actions.
- The supported provider matrix for native realtime, STT, and streaming TTS.
- The safest repository-compliant abstraction for atomic writes to a
  user-selected external Vault.
- Whether current application power/timezone events cover every target platform
  or require an additional lifecycle hook.
- The preferred FSRS parameter defaults and when enough review history exists
  for safe optimization.

## Evidence index

- Translation schema:
  `src/main/data/db/schemas/translateHistory.ts`
- Translation business service:
  `src/main/data/services/TranslateHistoryService.ts`
- Selection refine prompt and aggregate target:
  `src/renderer/windows/selection/action/components/ActionGeneral.tsx`
- Aggregate topic derivation and persistence:
  `src/main/data/services/TemporaryChatService.ts`
- Scheduler contract:
  `src/main/core/scheduler/SchedulerService.ts`
- Tray lifecycle:
  `src/main/services/TrayService.ts`
- Close-to-tray behavior:
  `src/main/services/MainWindowService.ts`
- Notification action metadata and click behavior:
  `src/shared/types/notification.ts`,
  `src/main/services/NotificationService.ts`
- Speech/transcription capability classification:
  `src/shared/utils/model.ts`,
  `packages/aiCore/src/core/providers/types/index.ts`
- Existing Obsidian integration:
  `src/main/services/ObsidianVaultService.ts`,
  `src/renderer/components/ObsidianExportDialog.tsx`,
  `src/renderer/pages/settings/DataSettings/ObsidianSettings.tsx`
- UI design contract:
  `DESIGN.md`
