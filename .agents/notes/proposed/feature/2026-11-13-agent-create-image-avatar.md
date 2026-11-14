# Agent Note: Image avatars during Agent creation

Status: proposed

English | [中文](2026-11-13-agent-create-image-avatar.zh.md)

## Problem

The shared creation wizard collects an emoji string, while the existing Agent editor supports uploaded images through `agent.set_avatar`. The editor needs an existing Agent ID and persists immediately, so mounting it in a creation draft would require creating an Agent before the user submits.

The inspected baseline is `9952477297bea3deba0122ab496b0060c6909f47`. It includes `b1d344c50e1fdf3caed717e512820a59d8789448` (#24474), which prevents portaled file-input clicks from focusing the name field through React bubbling. That fix must remain in effect; its inclusion does not prove native file selection works in the new flow.

## Proposal

Offer image upload alongside emoji selection in the Agent creation wizard, including every existing caller of that wizard. Keep the selected image in the in-memory draft until submission. Reuse `prepareAvatarImage` for the 10 MB original-file limit, decoding and 128 by 128 WebP normalization. Display the prepared image as a local preview. Choosing an emoji or resetting the avatar clears the draft image. Closing and reopening starts a fresh draft; leaving and returning to the basic step preserves it. Release preview resources when replaced or discarded.

Extend only the existing `ai.agent.create` command with optional image bytes validated by `ImageBytesSchema`. Do not accept a renderer-supplied file ID or put bytes in DataApi DTOs or persistent configuration. Keep the emoji configuration as the image's fallback. Callers without an image retain their existing behavior; Assistant creation is outside this change.

Reuse `withCreatedImageEntry` with `delete_when_unreferenced` before the synchronous Agent creation transaction. Extend the existing `AgentService.createAgentWithId` primitive with an optional main-owned avatar file ID and bind it with `setAvatarSlotTx` in the same transaction that inserts the Agent and its associations. Include the avatar in the returned entity and creation event. Publish creation notifications only after that transaction commits, preserving heartbeat provisioning as a non-fatal post-commit operation. The existing `agent.set_avatar` editing route continues to use its current service and binding code.

Image preparation or file creation failures must not create an Agent. A database or binding failure rolls back the Agent transaction, triggers the existing image-entry compensation, and removes the reserved Agent directory using the existing creation rollback. Cleanup failures are logged and reported as limitations rather than hidden. Do not create an Agent and subsequently attempt to repair it through deletion if avatar upload fails.

Use a synchronous submission guard across all creation entry points to reject repeated activation while a request is pending. Keep close protection for the entire submission. On a reported failure, retain the name, settings and prepared image for retry. Discard results of image preparation from a closed or superseded draft. Do not introduce a general idempotency protocol; recovery from a process crash or an ambiguous transport outcome is outside this bounded change.

## Alternatives considered

- Create an Agent first, then invoke `agent.set_avatar`: reuses the public editor command but leaves a created Agent when uploading fails, and a naive retry creates duplicates. Rejected in favor of reusing its underlying image and transaction primitives.
- Persist temporary managed images when choosing a file: requires draft ownership and cancellation cleanup in persistent storage. Keep the draft in memory instead.
- Store a data URL in `configuration.avatar`: bypasses managed-file references and changes the emoji contract. Rejected.
- Force-mount or delay removal of the existing editor picker: does not supply a valid Agent ID and obscures the already-fixed portal-focus root cause. Rejected.

## Acceptance criteria

- AC1 — Each Agent creation entry point offers image selection and a visible draft preview; a successful submission returns one Agent whose managed avatar loads in its list and reopened editor. (verification: renderer | Electron)
- AC2 — Native Windows file selection and cancellation work without name-field focus stealing or loss of the selected image; cancellation preserves the previous draft avatar. CDP input injection is recorded separately. (verification: Electron)
- AC3 — Invalid, undecodable and oversize files show an error, preserve the prior avatar and allow a valid retry; an older async result cannot replace a newer or reopened draft. (verification: renderer | Electron)
- AC4 — Image creation and avatar-binding failures create no Agent or avatar reference; successful retry creates exactly one Agent, and image-file compensation is exercised with a real migrated test database. (verification: unit | Electron)
- AC5 — Repeated Create activation while submitting produces one request; closing is prevented until completion; a failed submission preserves all draft fields and permits retry, while closing and reopening discards the draft. (verification: renderer | Electron)
- AC6 — Leaving and returning to the basic step preserves the image; selecting an emoji or reset removes the image; existing Agent image upload, emoji selection and reset still work. (verification: renderer | Electron)
- AC7 — Focused tests cover modified code and affected creation consumers; changed-file lint and formatting, applicable typechecks and documentation checks are reported, with baseline failures distinguished from introduced failures. A separate adversarial review covers lifecycle, atomicity, retries and duplicate creation before completion. (verification: unit | renderer | docs gate)

## Risks

The SQLite transaction cannot include asynchronous image processing, so file creation precedes it and uses compensating cleanup on failure. Compensation itself can fail and must remain observable. Existing creation events must not announce an Agent before its avatar binding commits. Preview and preparation state must survive step unmounting without leaking across dialog sessions. Native-dialog timing differs from injected input and requires separate evidence. No successful implementation, runtime test or approval is claimed by this proposed note.
