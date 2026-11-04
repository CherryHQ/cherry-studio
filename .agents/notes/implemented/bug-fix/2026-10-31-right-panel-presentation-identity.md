# Agent Note: Bind right-panel presentation to its instance

Status: implemented

English | [中文](2026-10-31-right-panel-presentation-identity.zh.md)

## Problem

The shared right-panel provider retained its open flag and selected panel ID when an Agent task changed. A new browser instance inherited the previous task's visibility. If Files became unavailable in a new empty workspace, the provider selected the first ready capability, often Browser. Both paths opened the browser without a tool request, so disabling browser auto-open did not prevent them. See [issue #23185](https://github.com/CherryHQ/cherry-studio/issues/23185).

## Decision

An open request belongs to the selected panel's existing `instanceKey`. Changing that identity, removing the panel, or making it unavailable consumes the open intent and closes the pane. The provider does not select an unrelated capability to preserve an open layout.

A pending panel with the same identity retains its intent until ready. Temporary environmental hiding also retains intent while that identity remains valid. Explicit open actions bind to the current resolved instance; dynamic panels can still be created and requested in the same React batch. Initial defaults and explicit default-panel actions continue to select an available default.

Existing identity ownership determines continuity: Browser belongs to a session, Files to a workspace, and the classic resource navigator keeps its stable identity. This change belongs in the shared provider and also applies to Chat panes. Tool-driven browser opening continues to follow the existing preference.

## Alternatives considered

- Reset the entire provider on every session change: discards valid workspace file state and collapses the classic task navigator.
- Disable browser auto-open or special-case Browser: does not address stale presentation intent or fallback between other capabilities.
- Remember open state for every session: adds a separate restoration policy that is unnecessary for this repair.

## Consequences

Switching sessions closes a session-owned pane; returning does not automatically replay its old open intent. Files stays open when the workspace identity remains the same. A capability becoming unavailable closes the pane even when another capability is ready. Users can explicitly open the next pane. No new preference, persisted state, or browser-runtime lifecycle is introduced.

## Verification

- Regression — `src/renderer/components/chat/panes/Shell/__tests__/RightPanel.test.tsx`: identity replacement and unavailability close the pane without fallback or later automatic reopening; stable identities preserve content; pending and dynamic entries retain their intended behavior.
- Regression — `src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx` and `src/renderer/pages/home/components/__tests__/TopicRightPane.test.tsx`: session browser state, stale results, file editing, resource navigation, and unavailable resource-pane behavior.
- Regression — `tests/e2e/ondemand/specs/agent-panel-intent.ts`: exercised through the actual Electron New Task button with browser auto-open disabled; a browser closes on a new task, Files in a previous system workspace does not fall back to Browser, and Files in a shared user workspace stays open.
