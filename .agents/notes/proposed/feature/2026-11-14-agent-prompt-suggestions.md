# Agent Note: Agent next-prompt suggestions

Status: proposed

English | [中文](2026-11-14-agent-prompt-suggestions.zh.md)

## Problem

After an Agent reply, users often type a short follow-up whose intent is already clear from the conversation. They need an optional draft suggestion, not an automatic message or another Agent execution.

## Proposal

Enable `agent.input.suggestions.enabled` by default, with an opt-out in the input settings. Only the Agent session composer supplies suggestions; ordinary chat and message editing do not. The user confirmed the default-on behavior during development.

Prediction generation belongs to the active native runtime; the renderer only presents and accepts an ephemeral suggestion. The request in [the prediction research](https://mcnnox2fhjfq.feishu.cn/docx/NfzKdatIlojMa1xJ4KDcqdoInry) calls this `prompt_predict`; the pinned Claude Agent SDK 0.3.311 exposes `Options.promptSuggestions` and `SDKPromptSuggestionMessage`, not a method named `prompt_predict`.

For Claude Code, opt into native suggestions through the existing Query options, including warm Query initialization. Keep the single native reader alive after `result` and consume `prompt_suggestion` through the typed native observation. Never submit a synthetic prediction turn or fall back to `ai.text.generate`. Preserve native suppression, including first-turn, Plan-mode, error and usage-limit gates. Native generation settings, context and cache policy remain Claude's responsibility.

For pi and pi-durable, request at most one suggestion after a successful interactive root turn. Capture the runtime's effective model context at completion, including its compaction view, rather than reconstructing it from four product messages. Make a cancellable, one-response model request through the existing native model binding and Cherry gateway. Append the Claude Code suggestion instruction from the linked research verbatim to an isolated context copy, as requested by the user. The instruction is stored in `src/main/ai/runtime/promptSuggestion.ts`; do not rewrite its wording for Pi. Retain parent tool declarations for cache-prefix compatibility, never enter an agent tool loop, and abort at the first streamed tool call. Do not append this request or response to either native or product history, create a durable task or child, change the branch head, or modify goals. Patch native Pi `createQueryFork` APIs and pi-ai provider options: preserve parent reasoning and explicit cache breakpoints, add no cache breakpoint to the prediction suffix, and disable continuation writes. Do not substitute `cacheRetention: none` for `skipCacheWrite`. Automatic server-side caching remains provider-controlled. Add no prediction-specific timeout or retry override. Gateway billing remains the single accounting owner, without attributing suggestion output to an assistant reply.

Main starts generation at eligible turn end; renderer reads only consume existing state. Main owns the ephemeral result and its session, native-context generation, source reply and model identity. A result is publishable only for the same successfully completed root reply with no intervening input, reset, compaction, model/branch change, interruption or connection replacement. Invalidate and cancel owned work on those transitions and shutdown. Claude's suggestion UUID is an event identity, not a source-turn ID; if the native event cannot be associated unambiguously with the completed reply, discard it. Resident native snapshots may seed the latest suggestion until a real user message; observation gaps clear it, and archived transcripts do not generate it. Pi applies the documented two-assistant-message and 10,000-token cache gates. The first text block passes wrapper/label cleanup and candidate filters (under 100 UTF-16 units and at most 12 approximate multilingual words); display checks reject controls, command prefixes and recognized secrets without rewriting the accepted text. Unknown private feature flags, backoff and unused-streak defaults are not invented. Failure or suppression leaves the composer usable and does not change turn success.

Retain the default-on preference. Disabled suggestions must not start Pi prediction requests and must disable Claude opt-in on new and warmed connections. If the pinned SDK has no public live pause control, apply an option change through the existing safe connection-rebuild mechanism at an idle boundary; do not interrupt a running turn or send an undocumented control message. Suppress display immediately and discard already-running results. Opening history, headless runs and autonomous child-result turns do not initiate host predictions. Other runtimes retain their existing prediction behavior; this change covers only Claude Code, pi and pi-durable.

Display the suggestion as muted overlay text, separate from the document and its saved draft. Unmodified Tab or the forward arrow (Right in LTR, Left in RTL) inserts literal editable text without sending. Escape dismisses it for that reply. User input, attachments, tokens, queued follow-ups, editing, hidden composer layers and new turns suppress suggestions. Cancel stale requests; late results cannot cross a session or model boundary. Preserve quick-panel handling, prompt-variable navigation, Shift+Tab Plan controls and IME composition. Suggestions are not persisted as messages or drafts before acceptance.

## Alternatives considered

- Append a prediction to the Agent answer: rejected because it pollutes the transcript and couples assistance to every runtime's prompt.
- Send predictions automatically: rejected because prediction is not user authorization.
- Default off: rejected by the user; predictions remain optional and can be disabled.
- Keep the renderer's four-message `ai.text.generate` implementation: rejected for these runtimes because it loses native context and bypasses Claude's prediction/cache policy.
- Persist a prediction fork, durable task or child: rejected because a suggestion must not alter recovery, transcript or execution ownership.
- Separate model picker or standalone service: deferred; use the active runtime model and existing session lifecycle.

## Acceptance criteria

- AC1 — Only Agent session input predicts after a successful observed turn, with a default-on setting and an opt-out; reopening history and ordinary chat do not request predictions. (verification: renderer)
- AC2 — Tab fills literal editable text but never sends; Escape dismisses it without reappearing for that reply. (verification: renderer)
- AC3 — Existing drafts and attachments are never overwritten, and late results are ignored after cancellation, session/model changes or a new turn. (verification: renderer)
- AC4 — Quick-panel and prompt-variable Tab behavior, Shift+Tab and IME composition remain intact in the deferred and rich editor surfaces. (verification: renderer)
- AC5 — Pi predictions use a detached effective-context snapshot and the active gateway model, execute no tools, preserve reasoning and parent cache breakpoints without caching the new suffix, and leave history, branch heads and turn outcomes unchanged on success or failure. (verification: unit)
- AC6 — The muted suggestion and Tab hint remain readable in light and dark Electron windows, and accepted text remains editable. (verification: Electron)
- AC7 — Claude enables the pinned native option for cold and warm queries, consumes suggestions after `result`, preserves native suppression, and never issues a second host prediction request. (verification: unit)
- AC8 — Reset, compaction, input, model/branch changes, connection replacement and shutdown invalidate stale predictions; ambiguous Claude source identity and observation gaps produce no suggestion; resident state may seed a composer without a new query. (verification: unit)
- AC9 — Disabling the preference immediately hides suggestions and prevents future prediction generation through supported runtime controls; headless and autonomous paths do not start host prediction work in these three runtimes. (verification: unit)
- AC10 — Provider-backed runs demonstrate native Claude delivery and Pi/pi-durable suggestions without transcript writes, tool execution or duplicate billing; native suppression is recorded separately from successful delivery. (verification: Electron)

## Risks

Eligible replies may add model requests and provider charges. Native-context prediction can send system instructions, tool results and attachments already in that runtime context to its configured provider; this intentionally replaces the previous four-message text-only limit. Claude may suppress suggestions even when enabled, and its event has no explicit source-turn ID, so conservative rejection can reduce availability. Provider cancellation is best effort; identity checks remain mandatory. A preference change may take effect for native generation only after a busy Claude connection safely reaches an idle rebuild boundary. The user explicitly waived the Spec approval gate for implementation. This note stays proposed until every acceptance criterion has evidence, including provider-backed verification.
