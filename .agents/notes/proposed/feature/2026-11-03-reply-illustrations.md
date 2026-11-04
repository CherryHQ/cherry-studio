# Agent Note: Generate illustrations within assistant replies

Status: proposed

English | [中文](2026-11-03-reply-illustrations.zh.md)

## Problem

The standalone image MCP waits for image generation before returning a Markdown image to the answering model. It cannot observe an ordinary assistant reply or control a placeholder inside Cherry Studio. The requested experience puts the illustration intent in the same text-model reply, reserves its position immediately, continues displaying text, and replaces the placeholder when image generation completes.

The user has chosen integration into Cherry Studio instead of coordinating a separately launched MCP server. The feature must expose automatic, forced-on, and forced-off modes in settings. The [glossary](../../../../GLOSSARY.md) distinguishes reply illustrations from the existing painting feature.

## Proposal

### Established direction

Add the feature to this checkout. Teach the answering model to include delimited illustration intents in its ordinary reply. Consume those intents without exposing their raw text in the rendered answer. Image generation must not block subsequent text output.

Reuse the existing [image-generation entry point](../../../../src/main/ai/AiService.ts) and [image IPC contracts](../../../../src/shared/ipc/schemas/ai.ts) where appropriate. Generated images should use the application's managed file system and durable message ownership. An external stdio process and loopback image server are unnecessary for this integrated feature.

Interpret the stream before live rendering and final message persistence diverge. Keep illustration identity stable across repeated stream updates and view remounts so displaying an answer cannot itself create another paid request. Preserve text and illustration order.

The user approved these decisions in the implementation conversation on 2026-11-03. This note remains in the proposed directory for the repository's normal review workflow; local implementation is authorized.

### Accepted product decisions

| Decision | Accepted behavior |
| --- | --- |
| Mode semantics | Automatic lets the answering model decide whether to include illustrations; forced-on asks for at least one illustration per new reply; forced-off prevents new generation and preserves existing images. |
| Quantity | The per-reply maximum defaults to one and is configurable from 1 to 10. The stream parser enforces it. Exact-count mode is off by default; when enabled, the system prompt asks for the configured target count, which cannot exceed the maximum. |
| Prompt visibility | The raw image prompt stays out of the answer text. Each illustration has a disclosure button that reveals the complete prompt as plain text, including while generation is pending or after it fails. |
| Scope and default | One global setting, initially forced-off, covering ordinary assistant chat. Agent coding sessions and group conversations are outside the initial scope. |
| Image configuration | Select an existing configured image model and reuse its provider credentials. |

The three modes control the system prompt: automatic says the model may illustrate as needed, forced-on asks for at least one illustration, and forced-off injects no illustration instruction and disables marker processing. The maximum count is enforced independently of model compliance. When exact-count mode is enabled, the prompt requires the target count; no extra LLM request creates or repairs prompts if a model omits or truncates a marker. Enabled replies can contain multiple complete intents up to the configured maximum; each keeps its own identity. Stopping a reply cancels unfinished image requests; completed images remain. Individual failed or cancelled images can be retried explicitly. Image configuration reuses the existing default painting model selector.

### Verification plan

Test the observable stream and message outcomes with a delayed image provider. Cover marker splits between chunks, incomplete markers, ordinary code that contains an example marker, failed image requests, repeated updates, and reopening a completed answer. Exercise the actual settings and inline placeholder in Electron after the feature is implemented. Keep checks scoped to changed modules and their consumers.

### Local implementation and evidence

The checkout implements the prompt section, pre-tee stream parser, background image service, persisted illustration parts, file ownership, revisioned IPC updates, settings and inline renderer. No change to the standalone MCP is needed. Image work has two concurrent slots and a five-minute timeout. Mode selection is captured at admission; adding another model to an already-running reply does not rewrite that reply's existing prompt.

| Criteria | Evidence run |
| --- | --- |
| AC1 | The real settings Select and Preference hook persist all three modes; Electron also verifies SQLite-backed settings after a renderer reload. |
| AC2, AC3 | The actual stream manager, parser, image service and SQLite backend preserve text/image/text order with delayed completion. Electron verifies later text remains visible during generation, a managed image loads at that position, and reloading retains it. |
| AC4 | Repeated state reads and stale events do not generate again; Electron observes exactly one local image HTTP request across the saved-answer reload. |
| AC5 | Parser tests cover every delimiter split, one-character chunks, multiple images, fenced/inline/indented code, truncated prompts and prompt-length boundaries. Seven additional regressions verify multiline code spans, matching backtick lengths, escaping and subsequent real illustration intents. |
| AC6 | Service and renderer tests cover provider failure, cancellation, explicit retry and ignoring a late cancelled result. |
| AC7 | Electron runs against local OpenAI-compatible text/image fixtures through the application's existing model dispatch, without this repository's standalone MCP or loopback image server. |
| AC8, AC9 | Scoped tests cover saved count controls, reducing the target with the maximum, system-prompt quantity rules, rejecting excess intents, and expanding or collapsing plain-text prompts beside illustrations. |

The repeatable desktop scenario is [replyIllustrations.test.ts](../../../../tests/e2e/smoke/replyIllustrations.test.ts). The scoped Vitest runs also include the existing stream-manager, persistence-listener, temporary-chat, message-service, message-rendering and settings-search consumers. The Electron application bundles and utility-process entries build successfully. No live paid provider was used; the desktop image fixture returns an existing repository PNG.

Node, web and E2E project typechecks report diagnostics in unchanged files (including Bun/Node `fetch` and stream type incompatibilities), with no diagnostics in the modified feature files. The full project typecheck gate is therefore not claimed as passing.

## Alternatives considered

- Retaining the standalone MCP keeps the original packaging but leaves inline parsing and rendering to a second application. The user explicitly chose integration.
- A local chat proxy can rewrite markers into image URLs but cannot reliably control the requested placeholder, retry, and message lifecycle inside Cherry Studio.
- Rendering-only marker parsing can hide text initially but leaves final storage, conversation context, and duplicate-submission ownership unresolved.
- Reimplementing image-provider configuration duplicates existing capabilities. Reuse of configured image models and credentials is confirmed.

## Acceptance criteria

- AC1 — Settings expose automatic, forced-on, and forced-off illustration modes and preserve the selected mode across application restarts (verification: renderer and main integration tests)
- AC2 — In an enabled mode, an opening illustration marker reserves its original reply position; its complete intent starts image generation while subsequent reply text continues before the image is ready (verification: stream integration tests and Electron)
- AC3 — A completed image appears at the reserved position without replacing or reordering surrounding text, and reopening the saved answer retains that image (verification: persistence integration tests and Electron)
- AC4 — Repeated stream updates and view remounts cannot submit the same illustration intent more than once (verification: stream integration tests)
- AC5 — Chunk boundaries and incomplete illustration markers do not expose hidden prompt fragments or discard ordinary answer text; example markers inside code remain ordinary code (verification: parser and renderer tests)
- AC6 — Image-generation failure preserves the written answer and gives the illustration an explicit failure state instead of an indefinite spinner (verification: stream integration tests and Electron)
- AC7 — The integrated feature operates without starting a separate MCP process or requiring the standalone loopback image server (verification: Electron)
- AC8 — Settings expose a per-reply maximum (default 1, range 1–10), an off-by-default exact-count switch, and a target count bounded by the maximum; the stream parser never admits more than the configured maximum (verification: settings, prompt, and stream parser tests)
- AC9 — Each illustration keeps its prompt hidden from answer text and offers a button to expand the complete prompt beside the image or placeholder as plain text (verification: renderer test)

## Risks

Prompt instructions alone cannot guarantee that every answering model emits a valid illustration intent. Forced-on is a system-prompt requirement; it does not synthesize a missing intent with another LLM request.

Ordinary chat and Agent sessions have different request paths. Their coverage must match the scope selected by the user rather than being inferred from their shared rendering components.

The current transport-backed image job declares restart recovery as abandonment. Completed images can be durable without claiming that interrupted image requests resume after a restart. Resuming or retrying unfinished work needs an explicit lifecycle contract and must not cause unrequested duplicate generation.
