# Agent Note: Reusable context handoff note

Status: proposed

English | [中文](2026-11-19-context-handoff-note.zh.md)

## Problem

Long conversations eventually lose early constraints and decisions. Automatic compaction preserves the active conversation, but it is destructive and it does not produce a portable artifact. Users who want to continue work in a new conversation must reconstruct the state by hand. Issue [#19820](https://github.com/CherryHQ/cherry-studio/issues/19820) asks for a reviewable Markdown handoff, generated before truncation, that a new conversation can consume without the original transcript.

This proposal is complementary to the compaction correctness work in [the native compaction proposal](../simplification/2026-11-12-native-agent-compaction.md) and to the overflow handling in [the chat context-overflow bug note](../bug-fix/2026-11-13-chat-context-overflow.md). It does not change how compaction summarizes history, and it does not own context-usage reporting, which stays with [the harness-owned context usage proposal](../architecture/2026-10-30-agent-context-usage.md).

## Proposal

The user can request a handoff at any time from a conversation with at least one message. The product also offers one handoff when the used context reaches 80% of the full context window. The offer is advisory: it does not generate a note, save a file, or start a new conversation by itself.

Generation reads the unmodified transcript and produces a Markdown draft with these sections, in this order: Goals, Confirmed decisions, Constraints, Pending questions, Relevant files, Next steps. Confirmed decisions and pending work are separate sections so that a reader can tell settled facts from open items.

The user reviews the draft in an editable preview. Cancel writes nothing. Confirm saves the Markdown and creates a new topic in the same assistant with that file attached. The new conversation's first request carries the file and not the original transcript.

While a handoff offer is unresolved, automatic compaction for that conversation does not start. The offer resolves when the user completes, dismisses, or cancels it, or when generation fails. This keeps the source transcript intact until the draft exists.

No handoff content is written to disk, attached to a conversation, or exported without the user's explicit confirmation. There is no automatic-save setting in this proposal.

## Alternatives considered

- Generate a handoff automatically at every threshold crossing: this costs a model request and stores sensitive content without user intent.
- Summarize after compaction runs: the destructive truncation has already removed the source detail the note needs.
- Let compaction proceed while the offer is open: the draft could then be generated from a truncated transcript, which violates the requirement that the handoff precede truncation. The cost is that compaction is delayed while the user decides, so the offer must be non-blocking and dismissible.
- Store the handoff as a new database entity: a Markdown attachment reuses the existing file and topic paths and needs no new schema.

## Acceptance criteria

- AC1 — A manual "create handoff" action is available in any conversation with at least one message and leaves the transcript unchanged. (verification: renderer)
- AC2 — When used context reaches 80% of the full window, one non-blocking offer appears per conversation until it is dismissed, and no note is generated or saved without user action. (verification: renderer)
- AC3 — While a handoff offer is unresolved, automatic compaction for that conversation does not start, and generation reads the unmodified transcript. (verification: unit)
- AC4 — The generated Markdown contains the sections Goals, Confirmed decisions, Constraints, Pending questions, Relevant files, and Next steps, in that order, with settled facts and pending work in separate sections. (verification: unit)
- AC5 — The user can edit the draft in a preview before saving, and cancelling writes no file. (verification: renderer)
- AC6 — Confirming creates a new topic in the same assistant with the Markdown attached, and that topic's first request includes the file without the original transcript. (verification: Electron)
- AC7 — Handoff content is not written to disk, attached, or exported without explicit user confirmation. (verification: unit)
- AC8 — If generation fails, the source conversation and its compaction state are unchanged, and the user sees a retryable error. (verification: unit)
- AC9 — Reference documentation for the feature describes the offer threshold, the review step, and the attachment behavior in English and Chinese. (verification: docs gate)

## Risks

The 80% threshold is a fixed default in this proposal; users with very long context windows may see the offer earlier than they expect. Delaying compaction while an offer is open can let a conversation grow further if the user ignores it, so the offer must not block sending. The handoff is only as complete as the model's extraction; the review step is the control for missed or incorrect items, and this proposal does not claim the draft is exhaustive.
