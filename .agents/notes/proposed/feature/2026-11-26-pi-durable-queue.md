# Agent Note: Pi Durable follow-up queue in the composer

Status: proposed

English | [中文](2026-11-26-pi-durable-queue.zh.md)

## Problem

Busy Pi Durable sessions accept follow-ups into a native inbox that persists through restarts. The composer queue panel does not show those inputs, so the user cannot see which inputs are still waiting or change their order.

## Proposal

Show the native pending follow-ups in the existing composer queue panel, in the order Pi Durable will take them. Refresh the panel as the inbox changes and when the session resumes. Remove an item from the panel when Pi Durable places or withdraws it.

Allow the user to edit the text of a waiting input, drag to reorder waiting inputs, and withdraw a single waiting input. Use the existing submission identities and keep the other parts of the input. Pi Durable serializes changes against placement and persists the resulting queue in its own store. The edited text must be reflected both in the model input and the conversation. When an operation races with placement or an intervening reorder, refresh the queue and report a stale operation.

Keep the existing busy send modes, Queue and Steer. Preserve the existing queue behavior of Pi and Claude Code. See [Pi Durable turn authority](../../implemented/architecture/2026-11-18-pi-durable-turn-authority.md) for the input lifecycle and recovery contract.

## Alternatives considered

A separate renderer queue could offer the same controls but would delay durable admission and lose pending inputs when the renderer or app exits. Canceling and submitting each reordered input again would change its native identity and could interleave with placement.

## Acceptance criteria

- AC1 — A waiting follow-up appears in the composer panel in native order and is restored after restarting the app while the input is still waiting. (verification: Electron)
- AC2 — Editing a waiting follow-up preserves its submission identity, and the model and conversation receive the edited text, including after reopen. (verification: Electron)
- AC3 — Reordering changes the actual execution order, and stale edits and reorders cannot change an input already placed. (verification: Electron)
- AC4 — Withdrawing a waiting follow-up prevents it from running without interrupting the active reply or withdrawing other inputs. (verification: Electron)
- AC5 — Queue and Steer remain available, and Pi and Claude Code retain their existing composer queue controls. (verification: renderer)

## Risks

The pinned SDK exposes the native inbox document but has no dedicated operation for in-place editing or ordering. Cover actual consumption order with a pinned SDK integration test. The native inbox and the Cherry conversation use separate stores. The projection must remain consistent across placement, disconnection, and restart.
