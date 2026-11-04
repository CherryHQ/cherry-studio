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
| Mode semantics | Automatic lets the answering model decide whether to include illustrations; forced-on asks for at least one illustration per new reply; forced-off prevents new generation and preserves existing images. |
| Quantity | The per-reply maximum defaults to one and is configurable from 1 to 10. The stream parser enforces it. Exact-count mode is off by default; when enabled, the system prompt asks for the configured target count, which cannot exceed the maximum. |
| Prompt visibility | The raw image prompt stays out of the answer text. Each illustration has a disclosure button that reveals the complete prompt as plain text, including while generation is pending or after it fails. |
| Scope and default | One global setting, initially forced-off, covering ordinary assistant chat. Agent coding sessions and group conversations are outside the initial scope. |
| Image configuration | Select an existing configured image model and reuse its provider credentials. |

The three modes control the system prompt: automatic says the model may illustrate as needed, forced-on asks for at least one illustration, and forced-off injects no illustration instruction and disables marker processing. The maximum count is enforced independently of model compliance. When exact-count mode is enabled, the prompt requires the target count; no extra LLM request creates or repairs prompts if a model omits or truncates a marker. Enabled replies can contain multiple complete intents up to the configured maximum; each keeps its own identity. Stopping a reply cancels unfinished image requests; completed images remain. Individual failed or cancelled images can be retried explicitly. Image configuration reuses the existing default painting model selector.

The main process owns job identity, cancellation, file ownership and revisioned updates. Allow two concurrent image requests with a five-minute timeout per active request. Capture mode and quantity settings when admitting a reply. Restart abandons unfinished requests; only explicit retry submits another request and may incur another provider charge.

### Verification plan

Test the observable stream and message outcomes with a delayed image provider. Cover marker splits between chunks, incomplete markers, ordinary code that contains an example marker, failed image requests, repeated updates, and reopening a completed answer. Exercise the actual settings and inline placeholder in Electron after the feature is implemented. Keep checks scoped to changed modules and their consumers.

## Alternatives considered

- Retaining the standalone MCP keeps the original packaging but leaves inline parsing and rendering to a second application. The user explicitly chose integration.
- A local chat proxy can rewrite markers into image URLs but cannot reliably control the requested placeholder, retry, and message lifecycle inside Cherry Studio.
- Rendering-only marker parsing can hide text initially but leaves final storage, conversation context, and duplicate-submission ownership unresolved.
- Reimplementing image-provider configuration duplicates existing capabilities. Reuse of configured image models and credentials is confirmed.

## Acceptance criteria

- AC1 — Settings expose automatic, forced-on, and forced-off illustration modes and preserve the selected mode across application restarts (verification: Leezehuan / implementation author; renderer and main integration tests)
- AC2 — In an enabled mode, an opening illustration marker reserves its original reply position; its complete intent starts image generation while subsequent reply text continues before the image is ready (verification: Leezehuan / implementation author; stream integration tests and Electron)
- AC3 — A completed image appears at the reserved position without replacing or reordering surrounding text, and reopening the saved answer retains that image (verification: Leezehuan / implementation author; persistence integration tests and Electron)
- AC4 — Repeated stream updates and view remounts cannot submit the same illustration intent more than once (verification: Leezehuan / implementation author; stream integration tests)
- AC5 — Chunk boundaries and incomplete illustration markers do not expose hidden prompt fragments or discard ordinary answer text; example markers inside code remain ordinary code (verification: Leezehuan / implementation author; parser and renderer tests)
- AC6 — Image-generation failure preserves the written answer and gives the illustration an explicit failure state instead of an indefinite spinner (verification: Leezehuan / implementation author; stream integration tests and Electron)
- AC7 — The integrated feature operates without starting a separate MCP process or requiring the standalone loopback image server (verification: Leezehuan / implementation author; Electron)
- AC8 — Settings expose a per-reply maximum (default 1, range 1–10), an off-by-default exact-count switch, and a target count bounded by the maximum; the stream parser never admits more than the configured maximum (verification: Leezehuan / implementation author; settings, prompt, and stream parser tests)
- AC9 — Each illustration keeps its prompt hidden from answer text and offers a button to expand the complete prompt beside the image or placeholder as plain text (verification: Leezehuan / implementation author; renderer test)

## Risks

Prompt instructions alone cannot guarantee that every answering model emits a valid illustration intent. Forced-on is a system-prompt requirement; it does not synthesize a missing intent with another LLM request.

Ordinary chat and Agent sessions have different request paths. Their coverage must match the scope selected by the user rather than being inferred from their shared rendering components.

The current transport-backed image job declares restart recovery as abandonment. Completed images can be durable without claiming that interrupted image requests resume after a restart. Resuming or retrying unfinished work needs an explicit lifecycle contract and must not cause unrequested duplicate generation.
