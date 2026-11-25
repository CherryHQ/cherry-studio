# Agent Note: Quoting and replying to selected conversation text

Status: implemented

English | [中文](2026-11-25-conversation-selection-reply.zh.md)

## Problem

A conversation quote preserved the passage without a way back to its source message. Writing a reply to a selection also required moving to the main composer before entering any text.

## Decision

Quote uses the command registry so the selection toolbar reflects the current binding or its disabled state. A quote from a message carries an optional `sourceMessageId` in the existing composer token. Clicking it locates and highlights that message when it is available in the current list.

Reply opens a draft beside the selection. Cancel discards that draft. Save appends its quote and text to the current conversation's composer, where the user can review and send them together with any existing draft content. The quoted passage doubles as the link back to the source.

## Alternatives considered

- Sending from the selection popover would add a second send surface with its own draft and delivery behavior.
- Keeping the source only in transient toolbar state would lose navigation when the composer saves or sends a draft.

## Consequences

The optional source field survives draft serialization and message persistence. An older or external quote can still render without it. A source outside the current message list yields no navigation. The Quote keybinding uses the existing shortcut preference and reset flow.

## Verification

- Regression — `TextSelectionToolbar.test.tsx` and `useCommandShortcuts.test.tsx`: default and remapped Quote bindings, disabled hints, selection scope, source activation, and Reply Save and Cancel.
- Regression — macOS Electron with a loopback provider verified appending the quote and reply to the main draft, retaining earlier text, and sending through the main composer. Renderer tests cover the final untitled blockquote and configurable shortcut.
