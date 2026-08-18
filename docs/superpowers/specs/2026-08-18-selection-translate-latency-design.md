# Selection Translation Latency Design

## Status

Approved for implementation planning on 2026-08-18.

## Context

Selection translation in v2 can start before its renderer-side language-detection resources are ready. The pooled action window is created eagerly, but `ActionTranslate` is not mounted until an action arrives, so the language list and quick-model row are still cold on the first translation.

The current sequence can therefore be:

1. `quickModel` is temporarily `undefined` while DataApi loads it.
2. Language detection reports that the model does not exist.
3. The existing v2 error fallback converts that failure to `unknown` and starts a translation.
4. The model query completes and changes the `detectLanguage` callback identity.
5. `ActionTranslate` runs again, cancels the first translation, detects the language, and starts a second translation.

PR #18574 correctly restored `reasoningEffort: 'none'` for LLM language detection, but it did not change this readiness and repeat-execution sequence. Controlled testing on current `main` still observed three model requests per action: fallback translation, language detection, and replacement translation.

V1 avoided the race because it read the quick model synchronously from Redux and stopped on a detection error. This design preserves the v2 Preference, DataApi, and main-process AI architecture while restoring V1's warm-resource and single-execution characteristics. It intentionally retains v2's user-facing detection-error fallback.

## Goals

- A normal selection action sends exactly one language-detection request followed by exactly one translation request.
- Resource loading is represented as pending, not as a detection failure.
- The eager action-window pool warms the resources needed by translation before the user invokes it.
- Query refreshes and callback identity changes cannot restart an action.
- A real detection failure still becomes `unknown` and continues with one fallback translation.
- A stale detection result cannot update the current action or start a stale translation.
- The fix remains in the renderer feature layer and does not change IPC or main-process infrastructure.

## Non-goals

- Changing the `auto`, `franc`, or `llm` detection policy.
- Replacing LLM detection with offline-only detection.
- Changing the selected quick or translation model.
- Removing the current v2 detection-error fallback.
- Adding cancellation to the one-shot language-detection IPC route.
- Moving detection orchestration into the main process.
- Refactoring unrelated translation-page behavior.

## Alternatives Considered

### 1. Warm resources, gate pending state, and trigger by semantic inputs

This is the selected approach. It fixes correctness and removes the cold DataApi lookup from the visible path while keeping the change inside the renderer. It follows existing v2 patterns: `useAssistant` distinguishes pending from missing resources, and the quick-translate window uses `useEffectEvent` so only primitive request inputs restart work.

### 2. Gate pending state without warming the pooled window

This prevents duplicate requests but leaves language and model DataApi reads on the user-visible critical path. It does not meet the goal of approaching V1 latency.

### 3. Move language detection to the main process

The main process could resolve preferences and model rows synchronously, but this requires a new or widened IPC contract and main-service ownership. The added cross-process scope and verification cost are not justified for a renderer lifecycle defect.

## Architecture

### Preference warm-up

The selection action entry point will preload all preferences that the first translation action consumes, including:

- `chat.default_model_id`
- `feature.quick_assistant.model_id`
- `feature.translate.auto_detection_method`
- `feature.translate.action.preferred_lang`
- `feature.translate.action.alter_lang`

This prevents the renderer from briefly using schema defaults before the persisted values arrive.

### Focused quick-model query

Add a focused `useQuickModel` hook in the existing model-hook module. It reads the default and quick-model preference IDs, applies the existing quick-to-default fallback, and exposes the `useModelById` result, including `model`, `isLoading`, and `error`.

`useDetectLang` will use this hook instead of `useDefaultModel`. Detection therefore fetches only the quick model rather than also subscribing to the default, translation, and painting model rows.

### Pool-time resource warm-up

`ActionWindow` will call `useDetectLang` before its `if (!action) return null` guard. The eager standby window will consequently start and retain the language-list and quick-model queries while it is hidden. The returned detection controller is passed explicitly through `SelectionActionContent` to `ActionTranslate`; no global channel or hidden mutable state is introduced.

### Detection controller contract

`useDetectLang` will return a small controller:

```ts
interface DetectLanguageController {
  detectLanguage: (text: string) => Promise<TranslateLangCode>
  isPending: boolean
}
```

`isPending` is true only while required resources are loading. The language list is always required; the quick model is required for `llm` and conservatively for `auto` because `auto` may fall back from `franc` to LLM. A settled query error, missing model, or failed detection is not pending and follows the existing fallback path. Pure `franc` mode does not wait for the quick model.

The full translation page will adopt the new return shape without changing its user-triggered behavior.

### Semantic action trigger

`ActionTranslate` will receive the controller and the existing per-action `sessionId`. Its async request body will use `useEffectEvent`, while its effect depends only on semantic request inputs:

- `sessionId`
- initialization completion
- `isPending`
- target language code
- alternate language code

Model objects, SWR refresh state, and callback identities will not trigger a request. A new selection session remains distinct even when it contains the same text as the previous session.

## Data Flow

### Warm normal path

1. The eager selection action window starts.
2. Required preferences are already cached before React renders.
3. `ActionWindow` warms the language list and quick model while no action is present.
4. The user invokes selection translation.
5. `ActionTranslate` observes `isPending === false`.
6. It performs one language detection.
7. It performs one translation using the selected target.

### Cold pending path

1. An action arrives before resource warm-up completes.
2. The UI clears any previous session and shows the existing loading state.
3. No AI request is sent while `isPending === true`.
4. When pending becomes false, the action performs one detection and one translation.

### Detection-error fallback path

1. Resource queries have settled, so `isPending` is false.
2. Detection fails because the model is missing, the provider fails, or the output is invalid.
3. `detectLanguageOrUnknown` logs the error and returns `unknown`.
4. `ActionTranslate` performs one translation using the existing fallback target selection.
5. The detection error is not shown in the action result, preserving current v2 behavior.

## Concurrency and Cancellation

Each semantic request receives a monotonically increasing request token.

- Starting a new action, changing a target language, or regenerating invalidates the previous token.
- An in-flight translation is cancelled through the existing `useTranslate.cancel()` path.
- After language detection resolves, the continuation checks its token before updating state or starting translation.
- A stale detection result is discarded even though the one-shot detection IPC request itself cannot currently be cancelled.
- Completion and error handlers update UI only when their token remains current.

Adding detection IPC cancellation is deliberately excluded. The short stale request may complete in the background, but it cannot create visible output or a second translation.

## User-visible State

- Pending resource warm-up uses the existing loading presentation; no new copy or localization keys are needed.
- A new session clears content from the previous session immediately, including when resources are still pending.
- The detected-language badge updates only from the current request.
- Stop and regenerate continue to use the existing controls. Regenerate passes through the same pending and request-token guards.

## Change Scope

Expected production files:

- `src/renderer/windows/selection/action/entryPoint.tsx`
- `src/renderer/windows/selection/action/ActionWindow.tsx`
- `src/renderer/windows/selection/action/components/ActionTranslate.tsx`
- `src/renderer/hooks/useModel.ts`
- `src/renderer/hooks/translate/useDetectLang.ts`
- `src/renderer/pages/translate/TranslatePage.tsx` for the hook return-shape adaptation only

Expected focused tests:

- `src/renderer/hooks/translate/__tests__/useDetectLang.test.ts`
- `src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx`
- `src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx` only if needed to protect the no-action warm-up outcome at a behaviorally useful boundary

No shared schema, IPC, main-process service, persistence, migration, or user-visible string changes are expected.

## Test Design

### Regressions to protect

1. While language or quick-model resources are pending, the action sends neither detection nor translation; once ready, it sends one of each.
2. A rerender caused by model data or detection callback replacement does not create another externally observable request.
3. A real detection rejection still starts exactly one fallback translation.
4. A stale detection from a previous session cannot update the UI or translate the previous text.
5. A new session containing the same text still performs one new translation.

The tests will assert user-visible state and external AI/translation effects. They will not pin effect dependency arrays, SWR cache internals, hook registration order, or CSS classes. Existing tests continue to own the `franc`, LLM output-validation, and prompt-policy branches.

### Automated verification

Run focused renderer tests only, including the changed hook and component suites. Per explicit user direction, do not run the full `pnpm test` suite.

The implementation will run the repository's non-test quality gates (`pnpm lint`, `pnpm format`, `pnpm test:lint`, and `pnpm docs:check-links`) plus focused renderer tests. It will not run `pnpm build:check`, because that script transitively invokes the full `pnpm test` suite and would violate the explicit user constraint.

## Manual Performance Verification

Use the tracked Electron instance and the existing controlled model server. Configure the same model as both quick and translation model, keep reasoning disabled, and return language detection and translation responses after a fixed 150 ms delay.

Current baseline on the same setup:

- Median UI completion time: approximately 1,738 ms.
- Requests per action: three.
- Sequence: fallback translation, language detection, replacement translation.

After the change, run five consecutive selection actions and require:

- Exactly two model requests per normal action.
- Language detection is the first request.
- Translation starts only after detection completes.
- No translation abort/restart appears in logs.
- Detection continues to send `reasoningEffort: 'none'`.
- All five runs satisfy the request sequence.
- Median completion time is no more than approximately 1,300 ms, a reduction of at least 25% from the controlled baseline.

Record action-to-detection-start and detection-complete-to-translation-complete separately. If request sequencing is fixed but the median does not improve by at least 25%, do not declare the performance issue resolved; profile the remaining window-dispatch or rendering delay.

## Risks and Tradeoffs

- Every eager selection action window performs one language-list query and one quick-model query even if the next action is not translation. SWR deduplication and the pool's single standby window bound this cost, and moving the work off the visible path is the intended performance tradeoff.
- A stale language-detection request cannot be aborted at the IPC layer. Request tokens prevent visible effects but do not reclaim that short provider request.
- Hoisting the detection controller through the action-window component tree adds explicit props. This is preferable to hidden global state and keeps the owner and lifecycle visible.
- Conservatively warming the quick model for `auto` mode may do work that a long input ultimately handles through `franc`, but it preserves LLM fallback readiness and keeps the runtime branch deterministic.

## Acceptance Criteria

The change is complete when:

1. Focused regression tests pass.
2. No full test suite has been run, per user direction.
3. Five controlled manual runs each contain one detection and one translation request, with no restart.
4. The controlled median improves by at least 25% or the work remains open for further profiling.
5. Existing v2 detection-error fallback behavior remains intact.
6. No IPC, main-process AI service, schema, migration, or persistence changes are introduced.
