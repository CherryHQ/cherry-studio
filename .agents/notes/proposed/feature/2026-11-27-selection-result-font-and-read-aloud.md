# Agent Note: Result font size and read aloud in the selection assistant

Status: proposed

English | [中文](2026-11-27-selection-result-font-and-read-aloud.zh.md)

## Problem

The selection assistant does not let users adjust the result font independently of main chat, and reading a selection aloud requires leaving the toolbar. Translation already has a control for reading its result; reading the source is a separate action.

## Proposal

Reuse one compact minus/plus control in translation and general text results. Persist the translation size separately from the shared size for general tools, retaining each window’s current default until it is adjusted. Provide an explicit toolbar action to read the selected source through the existing manual speech pipeline. Acknowledge receipt before dismissing the toolbar; system-mode speech must fail locally if no suitable local voice is available. Keep packaged-build paths, profile migrations and update policy out of the contribution.

## Alternatives considered

- Using the main-chat font setting would be simpler, but it would also resize unrelated messages.
- Silently falling back to another speech engine might improve availability, but it would violate the user’s explicit local or cloud choice.

## Acceptance criteria

- AC1 — Translation and general result sizes persist independently across close and restart; other text keeps its current sizing (verification: Electron)
- AC2 — The size control is keyboard-accessible, reports an unsuccessful save and closes on Escape before the result window closes (verification: renderer and Electron)
- AC3 — Selecting text does not speak it; clicking the toolbar action submits one request, and a failed or unavailable receiver does not masquerade as success (verification: renderer and Electron)
- AC4 — System-mode speech never invokes a cloud adapter, including on local-voice failure; cancellation of long-text confirmation prevents synthesis (verification: unit and Electron)

## Risks

The speech action crosses a window lifecycle boundary and requires explicit receipt tracking. Persistent font preferences must be declared in the owning schema or generation input, and unsupported platforms must not imply successful synthesis. Screenshot and playback evidence should identify the tested operating systems; untested platforms must not be presented as verified.
