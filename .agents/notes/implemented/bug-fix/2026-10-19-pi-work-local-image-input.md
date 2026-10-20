# Agent Note: Local image input for Pi Work with LM Studio

Status: implemented

English | [中文](2026-10-19-pi-work-local-image-input.zh.md)

## Problem

Work (`agent-session`) requests branch early in `src/main/ai/AiService.ts`, bypassing ordinary Chat attachment materialization. The Pi driver reduces local attachments to filename and absolute-path text. Local images therefore never reach the model input in LM Studio Work turns: a local fake upstream captures zero images. Unreadable attachments also produce no error.

## Decision

- Limit the behavior to `matchesPreset(provider, SystemProviderIds.lmstudio)` with an actual `openai-completions` endpoint, an `openai-compatible` adapter, and a model declaring image input through `MODEL_CAPABILITY.IMAGE_RECOGNITION` or `inputModalities` containing `image`. Other providers, including arbitrary OpenAI-compatible providers or localhost targets, non-image attachments, and text-only input retain their existing behavior.
- `src/main/ai/runtime/pi/piUserContent.ts` reuses `materializeNativeFilePart`. Successfully inlined images are removed from a temporary copy passed to the text builder and supplied to `session.prompt(text, { images, streamingBehavior })` as Pi-native image input.
- Preparation is atomic across the batch. Any image read failure, empty content, or image-processing failure rejects the submission with `PiImagePreparationError`, carrying `i18nKey`, a named `detailI18nKey`, and the original filename. No completion request or partial image batch is sent.
- For the target route, steer submissions containing local images return `false` from `redirect()`. The existing host fallback queues them for the next turn; no asynchronous steer state machine is added.
- The target route reuses `transformLmStudioRequestBody` through Pi's `onPayload`: multiple images use bare base64, while a single image retains its data URL.

## Alternatives considered

- Inline `file://` only in the request transform in `lmstudio.ts`: the transform cannot see attachments already reduced to text, so it cannot recover the images or obtain attachment names for named errors.
- Enable preparation for every OpenAI-compatible provider: this also changes cloud providers' image paths and exceeds the scope.
- Skip the model image-capability check: non-vision models would receive image blocks that the endpoint may reject, worsening the existing path-text behavior.
- Prepare image steer asynchronously and steer immediately afterward: this requires a new timing and cancellation protocol around the synchronous boolean contract of `redirect()`, beyond this repair.
- Degrade a bad attachment to a model-visible note: the issue's acceptance requirement is a local, named, actionable error.

## Consequences

Local images on the target route now enter model input automatically. Preparation failures reject the submission, an intentional behavior change within the declared scope. Mid-turn image submissions move to the next turn. Pi still processes images a second time; the preflight prevents silent image loss rather than replacing Pi's processing.

Ordinary Chat's nullable materialization fallback, attachment storage and upload, non-image encoding, shared `agentUserContent` behavior, the Claude Code driver, retired-history import, and cloud providers remain unchanged.

## Verification

The product verification below is recorded for commit `1a05c6da3fd62ce98a42af8e7cb7da8695a6354e`; these checks are not rerun for this documentation-only addition.

- Regression — `pnpm exec vitest run --project main` with explicit filters for `piUserContent`, `PiRuntimeConnection`, `modelInjection`, `lmstudio`, `fileProcessor`, `attachmentRouting`, `agentUserContent`, and `serializeError`: 271 tests pass across eight files, covering image preparation, route selection, wire conversion, and affected consumers.
- Regression — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`: 18 tests pass, including named image-preparation error rendering.
- Regression — `pnpm i18n:check`, node/web/e2e typechecks, and oxlint/oxfmt checks all exit 0.
- Regression — real `PiRuntimeConnection.send` with a real `node:http` fake upstream: two-image and nine-image payloads match byte for byte; missing and empty files produce zero requests and named errors.
- Regression — real Electron smoke in `tests/e2e/smoke/agentLocalImageTurn.test.ts`: both cases pass, including the successful turn regression and error-card screenshots.

Not verified: acceptance of bare base64 for multiple images by a real LM Studio version, Windows path behavior, and the source of the user's original 400 response.
