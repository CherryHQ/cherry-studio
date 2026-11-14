# Agent Note: Agent next-prompt suggestions

Status: proposed

English | [中文](2026-11-14-agent-prompt-suggestions.zh.md)

## Problem

After an Agent reply, users often type a short follow-up whose intent is already clear from the conversation. They need an optional draft suggestion, not an automatic message or another Agent execution.

## Proposal

Enable `agent.input.suggestions.enabled` by default, with an opt-out in the input settings. Only the Agent session composer supplies suggestions; ordinary chat and message editing do not. The user confirmed the default-on behavior during development.

After observing a running turn complete successfully, wait 300 ms and request at most one next prompt from the current model through cancellable `ai.text.generate`. Use only text from the last four messages, at most 2,000 characters per message; omit reasoning, attachments, tool results and system instructions. Disable tools; disable reasoning when supported, otherwise request the lowest supported effort through the shared model-selection resolver. Request no retries and a 10-second transport timeout. Do not silently choose a fallback model. An unavailable model, failure, empty response, multiline response or response longer than 120 characters produces no suggestion. Opening history alone does not generate a prediction.

Display the suggestion as muted overlay text, separate from the document and its saved draft. Unmodified Tab inserts literal editable text without sending. Escape dismisses it for that reply. User input, attachments, tokens, queued follow-ups, editing, hidden composer layers and new turns suppress suggestions. Cancel stale requests; late results cannot cross a session or model boundary. Preserve quick-panel handling, prompt-variable navigation, Shift+Tab Plan controls and IME composition. Suggestions are not persisted as messages or drafts before acceptance.

## Alternatives considered

- Append a prediction to the Agent answer: rejected because it pollutes the transcript and couples assistance to every runtime's prompt.
- Send predictions automatically: rejected because prediction is not user authorization.
- Default off: rejected by the user; requests use a small bounded text context and can be disabled.
- Separate model picker or dedicated service: deferred; use existing one-shot IPC and the selected model without new runtime ownership.

## Acceptance criteria

- AC1 — Only Agent session input predicts after a successful observed turn, with a default-on setting and an opt-out; reopening history and ordinary chat do not request predictions. (verification: renderer)
- AC2 — Tab fills literal editable text but never sends; Escape dismisses it without reappearing for that reply. (verification: renderer)
- AC3 — Existing drafts and attachments are never overwritten, and late results are ignored after cancellation, session/model changes or a new turn. (verification: renderer)
- AC4 — Quick-panel and prompt-variable Tab behavior, Shift+Tab and IME composition remain intact in the deferred and rich editor surfaces. (verification: renderer)
- AC5 — Requests use bounded recent text, disable tools, disable reasoning or select its lowest supported effort, avoid retries/fallback models, and fail without blocking the composer or changing session history. (verification: renderer)
- AC6 — The muted suggestion and Tab hint remain readable in light and dark Electron windows, and accepted text remains editable. (verification: Electron)

## Risks

Each eligible reply adds a model request and may incur provider charges. Prediction quality and latency depend on the selected model. Context is sent to the same configured provider; predictions must not be interpreted as authorization. Transport cancellation is best effort, so result identity checks remain necessary. This note stays proposed until all acceptance evidence, including provider-backed verification, is complete.
