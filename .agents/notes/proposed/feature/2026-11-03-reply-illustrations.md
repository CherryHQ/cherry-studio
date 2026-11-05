# Agent Note: Generate illustrations within assistant replies

Status: proposed

English | [中文](2026-11-03-reply-illustrations.zh.md)

## Problem

The standalone image MCP waits for image generation before returning a Markdown image to the answering model. It cannot observe an ordinary assistant reply or control a placeholder inside Cherry Studio. The requested experience puts the illustration intent in the same text-model reply, reserves its position immediately, continues displaying text, and replaces the placeholder when image generation completes.

The user has chosen integration into Cherry Studio instead of coordinating a separately launched MCP server. The feature must expose automatic, forced-on, and forced-off modes in settings. A reply illustration belongs to a passage in an assistant reply; it is distinct from a separately generated painting.

## Proposal

### Established direction

Add the feature to this checkout. Teach the answering model to include delimited illustration intents in its ordinary reply. Consume those intents without exposing their raw text in the rendered answer. Image generation must not block subsequent text output. Use `[[IMAGE]]...[[/IMAGE]]` to delimit each plain-text image prompt. The opening delimiter reserves a placeholder; the closing delimiter submits the complete prompt immediately, without waiting for the answer to finish.

Reuse the existing [image-generation entry point](../../../../src/main/ai/AiService.ts) and [image IPC contracts](../../../../src/shared/ipc/schemas/ai.ts) where appropriate. Generated images should use the application's managed file system and durable message ownership. An external stdio process and loopback image server are unnecessary for this integrated feature.

Interpret the stream before live rendering and final message persistence diverge. Keep illustration identity stable across repeated stream updates and view remounts so displaying an answer cannot itself create another paid request. Preserve text and illustration order.

This proposal awaits an explicit human Approval on the current Spec PR head. Local exploration does not satisfy upstream approval. Implementation layers must remain draft until that approval is recorded.

### Accepted product decisions

| Decision | Accepted behavior |
| --- | --- |
| Mode semantics | Automatic lets the answering model decide whether to include illustrations; forced-on asks for exactly the target count per new reply; forced-off prevents new generation and preserves existing images. |
| Quantity | Automatic exposes a per-reply maximum; forced-on exposes a target count that also serves as the parser's hard maximum. Both default to one, range from 1 to 10, and are remembered independently. There is no separate exact-count switch. |
| Prompt visibility | The raw image prompt stays out of the answer text. Each illustration has a disclosure button that reveals the complete prompt as plain text, including while generation is pending or after it fails. |
| Scope and default | One global setting, initially forced-off, covering ordinary assistant chat. Agent coding sessions and group conversations are outside the initial scope. |
| Image configuration | Select an existing configured image model and reuse its provider credentials. |

The three modes control the system prompt: automatic allows zero to the configured maximum, forced-on requests exactly the configured target, and forced-off injects no illustration instruction and disables marker processing. The prompt and stream parser use the same per-reply quantity snapshot: the automatic maximum or the forced-on target. Excess markers are consumed without generating images or exposing hidden prompts. Missing or truncated markers do not trigger an extra LLM request to create or repair prompts, so fewer images may complete than requested. Each accepted intent keeps its own identity. Stopping a reply cancels unfinished image requests; completed images remain. Individual failed or cancelled images can be retried explicitly. Image configuration reuses the existing default painting model selector.

Upgrade existing settings once before loading preferences. A previously enabled exact-count switch converts automatic or forced-on mode to forced-on, preserving the old target clamped to the old maximum. Forced-on without that switch starts with a target of one. Forced-off stays off, and the automatic maximum is preserved. Remove the retired switch preference after conversion; later mode changes do not overwrite either quantity.

The main process owns job identity, cancellation, file ownership and revisioned updates. Allow two concurrent image requests with a five-minute timeout per active request. Capture mode and quantity settings when admitting a reply. Restart abandons unfinished requests; only explicit retry submits another request and may incur another provider charge.

### User-image references

Each block may start with a reserved line such as `references: ["image_2", "image_1"]`, followed by the image prompt on the next line. An omitted line or empty array preserves text-only generation. The answering model decides separately for each illustration whether editing, subject identity, style, or layout needs reference images. Only application-issued references may be used; ordinary prose naming an image never triggers an upload.

Candidates are materialized user images from the current topic and branch that reach the current model request, including earlier turns. Application labels precede their images. Retained attachment indexes, summary-only images, assistant-generated images and other topics are excluded. The final model middleware narrows the candidate list again after context shaping, including fallback requests.

References are deduplicated in first-occurrence order. Invalid references or malformed lists fail that illustration. Unsupported image input, excessive image counts, missing files and unreadable originals also fail explicitly; no selected input is silently dropped. Use the model's declared mode and input limit: a model such as Seedream can accept images in generate mode without an edit mode.

Store the ordered input file ids and names with the illustration, and register them as message-owned file references. Prompt details show their names and image previews. Deleting the original upload message does not remove the answer's references; removing all holders allows normal cleanup. Explicit retries retain the saved prompt and original selection, including after restart, but resolve the current default painting model and recheck its capabilities and count limit. An invalid selection requires a new answering-model reply rather than a retry with different images.

### Verification plan

Test the observable stream and message outcomes with a delayed image provider. Cover marker splits between chunks, incomplete markers, ordinary code that contains an example marker, failed image requests, repeated updates, and reopening a completed answer. Exercise the actual settings and inline placeholder in Electron after the feature is implemented. Keep checks scoped to changed modules and their consumers.

## Alternatives considered

- Retaining the standalone MCP keeps the original packaging but leaves inline parsing and rendering to a second application. The user explicitly chose integration.
- A local chat proxy can rewrite markers into image URLs but cannot reliably control the requested placeholder, retry, and message lifecycle inside Cherry Studio.
- Rendering-only marker parsing can hide text initially but leaves final storage, conversation context, and duplicate-submission ownership unresolved.
- Reimplementing image-provider configuration duplicates existing capabilities. Reuse of configured image models and credentials is confirmed.
- Keeping an exact-count switch alongside forced-on allows contradictory automatic settings and separate prompt/parser limits. A mode-specific quantity removes that overlap.

## Acceptance criteria

- AC1 — Settings expose automatic, forced-on, and forced-off illustration modes and preserve the selected mode across application restarts (verification: Leezehuan / implementation author; renderer and main integration tests)
- AC2 — In an enabled mode, an opening illustration marker reserves its original reply position; its complete intent starts image generation while subsequent reply text continues before the image is ready (verification: Leezehuan / implementation author; stream integration tests and Electron)
- AC3 — A completed image appears at the reserved position without replacing or reordering surrounding text, and reopening the saved answer retains that image (verification: Leezehuan / implementation author; persistence integration tests and Electron)
- AC4 — Repeated stream updates and view remounts cannot submit the same illustration intent more than once (verification: Leezehuan / implementation author; stream integration tests)
- AC5 — Chunk boundaries and incomplete illustration markers do not expose hidden prompt fragments or discard ordinary answer text; example markers inside code remain ordinary code (verification: Leezehuan / implementation author; parser and renderer tests)
- AC6 — Image-generation failure preserves the written answer and gives the illustration an explicit failure state instead of an indefinite spinner (verification: Leezehuan / implementation author; stream integration tests and Electron)
- AC7 — The integrated feature operates without starting a separate MCP process or requiring the standalone loopback image server (verification: Leezehuan / implementation author; Electron)
- AC8 — Automatic shows only its maximum and forced-on only its target (both default 1, range 1–10); quantities are remembered independently, and the prompt and parser use the active quantity, never generating more than that quantity (verification: Leezehuan / implementation author; settings, prompt, stream integration tests and Electron)
- AC9 — Each illustration keeps its prompt hidden from answer text and offers a button to expand the complete prompt beside the image or placeholder as plain text (verification: Leezehuan / implementation author; renderer test)
- AC10 — Existing exact-count settings convert once to the corresponding mode and effective target, forced-on without exact count defaults to one, forced-off remains off, and later user choices survive restarts (verification: Leezehuan / implementation author; populated database seeder tests)

- AC11 — The model independently selects zero or more application-numbered user images per illustration from the current topic, branch and actual request; compressed-away and assistant images are excluded (verification: Leezehuan / implementation author; prepared-message and final-middleware tests, Electron)
- AC12 — Selected originals reach the image provider in deduplicated order with a clean prompt, using a supported mode including Seedream generate; absent or empty references preserve text-only generation (verification: Leezehuan / implementation author; intent and service tests, Electron)
- AC13 — Invalid references, unsupported inputs, excessive counts and unreadable files fail only that illustration without dropping inputs or losing the answer (verification: Leezehuan / implementation author; service and renderer tests)
- AC14 — Prompt details show selected original names and previews, and saved answers retain their file ownership after the upload message is deleted until all references are removed (verification: Leezehuan / implementation author; renderer and real-database persistence tests, Electron)
- AC15 — Explicit retries after failure or restart keep the saved prompt and image selection, use the current default painting model, and recheck capabilities, limits and file readability (verification: Leezehuan / implementation author; service persistence tests)

## Risks

Prompt instructions alone cannot guarantee that every answering model emits a valid illustration intent. Forced-on is a system-prompt requirement; it does not synthesize a missing intent with another LLM request.

Ordinary chat and Agent sessions have different request paths. Their coverage must match the scope selected by the user rather than being inferred from their shared rendering components.

The current transport-backed image job declares restart recovery as abandonment. Completed images can be durable without claiming that interrupted image requests resume after a restart. Resuming or retrying unfinished work needs an explicit lifecycle contract and must not cause unrequested duplicate generation.
