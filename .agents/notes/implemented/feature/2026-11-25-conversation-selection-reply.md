# Agent Note: Quoting and replying to selected conversation text

Status: implemented

English | [中文](2026-11-25-conversation-selection-reply.zh.md)

## Problem

A conversation quote preserved the passage without a way back to its source message. Writing a reply to a selection also required moving to the main composer before entering any text.

## Decision

Quote uses the command registry so the selection toolbar reflects the current binding or its disabled state. A quote from a message carries an optional `sourceMessageId` in the existing composer token. Clicking it locates and highlights that message when it is available in the current list.

Reply opens a draft beside the selection. Cancel discards that draft. Save appends its quote and text to the current conversation's composer, where the user can review and send them together with any existing draft content. Save is available while an active normal draft can receive the reply. The popover closes once that draft accepts the original text, including indentation. The quoted passage doubles as the link back to the source.

## Alternatives considered

- Sending from the selection popover would add a second send surface with its own draft and delivery behavior.
- Keeping the source only in transient toolbar state would lose navigation when the composer saves or sends a draft.

## Consequences

The optional source field survives draft serialization, message persistence, a private clipboard round trip in the same renderer session, and conversation handoff between windows. An older or external quote can still render without it. A source outside the current message list yields no navigation. The Quote keybinding uses the existing shortcut preference and reset flow.

## Verification

- Regression — `TextSelectionToolbar.test.tsx` and `useCommandShortcuts.test.tsx`: default and remapped Quote bindings, disabled hints, selection scope, source activation, preservation of Reply indentation, and keeping the reply open during sent-message editing, a composer override, or a rejected save.
- Regression — `composerPaste.test.ts` and `navigation.test.ts`: quote provenance survives the private clipboard and the conversation handoff request.
- Regression — macOS Electron with a loopback provider verified appending the quote and reply to the main draft, retaining earlier text, and sending through the main composer. Renderer tests cover the final untitled blockquote and configurable shortcut.
