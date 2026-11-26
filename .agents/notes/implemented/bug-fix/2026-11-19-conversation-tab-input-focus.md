# Agent Note: Focus inputs when switching conversations and tabs

Status: implemented

English | [中文](2026-11-19-conversation-tab-input-focus.zh.md)

## Problem

Switching to an existing chat, Agent session, translation tab, or painting tab left keyboard focus on the navigation control. A one-time focus call on activation can miss the input. React Activity disconnects editor effects while a tab is hidden, so Tiptap can recreate its view after reactivation. The source input can also be disabled while translation work is in progress.

## Decision

Keep one pending focus request for the active input. Fulfill it once a mounted, editable target can take focus. Drop it when the tab becomes inactive or the user moves focus to another control. For the composer, use the fallback textarea or the mounted Tiptap view directly and place the caret at the end. This complements the [fallback handoff](2026-11-07-composer-deferred-intent-replay.md).

Chat and Agent already remount the composer when the conversation changes, so session keys do not need to travel through a second focus path. Translation registers its voice target before focusing the source. The painting page owns the activation request across history selections and expands the collapsed prompt dock on tab activation.

## Alternatives considered

- A fixed delay or a single call from the navigation handler cannot tell whether the editor has mounted or the input has become editable.
- Focusing whenever an editor is created gives draft hydration, painting history selection, or a background render a chance to take focus away from the current control.

## Consequences

Users can type when the selected surface is ready. Painting history selection keeps its own keyboard focus. Explicit requests such as focusing a reused conversation after the new-conversation action still have a dedicated path.

## Verification

- Regression — `TranslateInputPane.test.tsx` verifies readiness, voice target registration, and that another control keeps focus.
- Regression — `PaintingPage.test.tsx` verifies that activating the page restores and focuses a collapsed prompt dock.
- Regression — Electron verifies the first key in all four surfaces, fast tab switches, restored rich editors, and retained focus on painting history.
