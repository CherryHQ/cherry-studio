# Agent Note: Message chrome display options (avatar, provider name, background, timestamp)

Status: proposed

English | [中文](2026-11-28-message-chrome-display-options.zh.md)

## Problem

Users who want to tune how chat messages look beyond the existing font and message-style options must inject custom CSS ([#12917](https://github.com/CherryHQ/cherry-studio/issues/12917)). That path has a high barrier for non-technical users and breaks silently when component structure or class names change between releases, so every update can require re-debugging a personal stylesheet.

The issue lists concrete display controls that have no native setting on current main: user/model avatar visibility, provider-name visibility in the message header, user/model message background visibility, and user/model message timestamp visibility. (It also asks for adjustable spacing around the thinking and search components, and for an open-ended stream of future options; both are outside this Spec, see Alternatives.) The message chrome these controls govern is rendered by the message frame components (`src/renderer/components/chat/messages/frame/MessageFrame.tsx`, `MessageHeader.tsx`).

## Proposal

Add a "Message display" group of native toggles under Settings > Messages, one toggle per piece of message chrome, each applying to both user and assistant messages independently:

- Show user avatar / show model avatar. Hiding the avatar keeps the message layout aligned; the header row collapses rather than leaving an empty gutter.
- Show provider name. Controls the provider/model label in the message header (`MessageHeader.tsx`). Model name display stays as is; this toggle governs the provider prefix.
- Show message background, one toggle for user messages and one for assistant messages. Turning a background off renders that side's messages on the plain conversation background; the existing message-style option keeps working, and these toggles only hide or show the background fill.
- Show message timestamp, one toggle for user messages and one for assistant messages.

Each toggle is a boolean in the existing display settings state, defaults to the current behavior (everything shown exactly as today), and takes effect immediately without a restart. Settings copy is added in all 18 locales at implementation time. The toggles compose with the existing custom CSS feature: CSS still wins when both are set, because the toggles only change the default rendering.

## Alternatives considered

- Keep custom CSS as the only path: rejected, for the reasons the issue gives - high barrier, and silent breakage on component renames.
- One master "compact messages" preset instead of individual toggles: simpler, but the issue's asks are independent per element and per side (user vs model); a preset cannot express "hide only my avatar".
- Include spacing adjustment for the thinking and search components in this Spec: deferred. Spacing is a numeric control, not a visibility toggle, and its defaults and bounds need design input; mixing it in would hold the four toggle families back.
- Treat item 6 of the issue ("continuously open more options") as in scope: rejected; open-ended scope cannot be verified. New options get their own Specs.

## Acceptance criteria

- AC1 — Each of the four chrome elements (avatar, provider name, message background, message timestamp) has an independent user-side and assistant-side toggle under Settings > Messages, defaulting to current behavior (verification: renderer)
- AC2 — Toggling any option takes effect on the rendered conversation immediately, without restart, and persists across relaunch (verification: renderer)
- AC3 — Hiding an avatar collapses its gutter without shifting message text alignment (verification: renderer)
- AC4 — The provider-name toggle hides only the provider prefix; the model label remains (verification: renderer)
- AC5 — Background toggles compose with the existing message-style option and hide only the background fill (verification: renderer)
- AC6 — All new settings copy is present in the 18 locale files (verification: unit)

## Risks

- Setting sprawl: eight new toggles in one group is a visible settings-page cost. Grouping them under one "Message display" section keeps the page scannable; item 6 of the issue is deliberately out of scope to avoid a growing pile.
- Interaction with custom CSS: a user stylesheet targeting the old DOM may override or conflict with a toggle. The Spec makes CSS win on conflict so existing stylesheets do not silently invert.
- Per-surface drift: Agent and chat surfaces share the message frame components, so the toggles apply to both; a surface that forks its message chrome later must respect the same settings.
