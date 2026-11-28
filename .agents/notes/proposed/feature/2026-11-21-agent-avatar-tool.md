# Agent Note: Generate and restore Agent avatars in conversation

Status: proposed

English | [中文](2026-11-21-agent-avatar-tool.zh.md)

## Problem

An Agent can use `generate_image` with the configured painting model, and the user can upload an image through the Agent editor. Neither entry point lets the user ask an Agent to generate and apply a new avatar to an existing Agent. The current avatar write replaces its managed file reference, so file cleanup may reclaim the old image once nothing else references it.

The Agent creation and avatar framing work provides separate user-driven flows. The [image upload PR](https://github.com/CherryHQ/cherry-studio/pull/23788) establishes the existing avatar binding, the [avatar framing Spec](https://github.com/CherryHQ/cherry-studio/pull/24618) covers manual uploads, and the [history avatar fix](https://github.com/CherryHQ/cherry-studio/pull/24478) establishes live avatar projection in past messages.

## Proposal

Add one built-in Agent tool, provisionally named `agent_avatar`, to `cherry-tools`. It accepts a generation action with a text prompt or a restore action. The current Agent is the default target and comes from the trusted session context. For another Agent, use the stable ID discovered through `agent_list`. When the user supplies an ambiguous name, ask them to identify the target before calling the tool. Eligible targets are active Agents available in the Agent library. Reject missing, trashed, and internal-only targets by ID, including at commit time.

Use the existing Agent tool visibility and approval policy in Claude Code and Pi. A write approval covers the requested action and the exact target before generation or restoration. Require interactive approval even in Full Access because this tool changes an Agent's persistent identity. A denied approval, a disabled tool, or a session without a way to collect approval performs no write and starts no generation. Enforce target eligibility in the tool handler as well as the runtime's approval policy.

Generate one avatar from the prompt with the configured painting model through the existing image generation pipeline. Reuse its model capability checks and cancellation handling, and use the existing avatar transcode and managed-file binding. Keep generation outputs that only serve as intermediate inputs eligible for normal cleanup. Restoration does not need a painting model. Keep prompt and target separate so the generation request needs only the image description.

Keep one previous avatar per target across restarts. The snapshot covers a managed image with its emoji fallback, an emoji, or the default avatar. Give any saved image a durable file reference that existing cleanup and backup mechanisms can see. Save the previous avatar and switch to the new one in a single write transaction owned by the avatar service. Snapshot the avatar that is current at commit time, after the asynchronous generation. A later successful generation replaces the previous snapshot. A successful restore consumes it. A later explicit manual avatar edit supersedes it, so restoring an old tool change cannot overwrite a manual choice. A missing or unreadable saved image produces an error and preserves the live avatar.

Reuse the existing Agent read-model invalidation after the transaction commits. Report the resulting action and target from the committed result. Generation, cancellation before commit, decoding, and binding failures preserve the live avatar and any existing snapshot. New staging files follow the existing compensation and cleanup contract. Keep any schema addition limited to Agent avatar data and reuse the existing transaction, file reference, and cleanup infrastructure.

## Alternatives considered

- Give the existing `generate_image` tool a write option. This would extend the permissions and persistence semantics of a tool shared with ordinary chat image generation.
- Ask the Agent to pass a file ID from one tool to a second write tool. This requires proving the file came from the intended generation and defining its retention when the second call is skipped or fails.
- Save the previous image ID in tool output or ordinary configuration. The file cleanup system needs a live reference to guarantee restoration after cleanup and restart.

## Acceptance criteria

- AC1 — In an Agent conversation, “Give yourself a watercolor fox avatar” generates an image with the configured painting model and updates the Agent in its editor, sidebar, open tabs, and historical message headers. (verification: Electron)
- AC2 — After the user approves an operation for a named Agent discovered through `agent_list`, only that Agent changes. An ambiguous name requires clarification, and missing, trashed, or internal-only IDs produce no write. (verification: unit | Electron)
- AC3 — In Claude Code and Pi, disabled, denied, or headless calls cannot generate or write avatars. Full Access still asks for approval and shows the exact target and action. (verification: unit | Electron)
- AC4 — “Restore the previous avatar” recovers a managed image after cleanup and restart, or restores the original emoji or default. The second restore reports no saved avatar, and restore works with no painting model configured. (verification: unit | Electron)
- AC5 — Generation, cancellation before commit, decoding, or bind failure preserves both the current avatar and its previous snapshot. A later replacement saves the avatar current at commit time. A subsequent explicit manual avatar edit supersedes the tool snapshot. (verification: unit)
- AC6 — Existing Agent avatar upload, emoji selection, and reset retain their behavior. A permanently deleted Agent releases its saved avatar reference, and an existing database upgrades without changing any live avatars. (verification: unit | Electron)

## Risks

File creation and provider calls are asynchronous. The transaction must cover the snapshot and live reference swap, and the file lifecycle must account for new staging files, superseded snapshots, and permanent Agent deletion. Approval must refer to the same stable ID the handler writes. Concurrent edits and available runtimes need verification against the real Agent entry point.
