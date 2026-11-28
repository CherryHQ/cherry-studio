# Agent Note: Message chrome display options (avatar, provider name, background, timestamp)

Status: proposed

English | [中文](2026-11-28-message-chrome-display-options.zh.md)

## Problem

Users who want to tune how chat messages look beyond the existing font and message-style options must inject custom CSS ([#12917](https://github.com/CherryHQ/cherry-studio/issues/12917)). That path has a high barrier for non-technical users and breaks silently when component structure or class names change between releases, so every update can require re-debugging a personal stylesheet.

The issue lists concrete display controls that have no native setting on current main: user/model avatar visibility, provider-name visibility in the message header, user/model message background visibility, and user/model message timestamp visibility. (It also asks for adjustable spacing around the thinking and search components, and for an open-ended stream of future options; both are outside this Spec, see Alternatives.) The message chrome these controls govern is rendered by the message frame components (`src/renderer/components/chat/messages/frame/MessageFrame.tsx`, `MessageHeader.tsx`).

## Proposal

Add a "Message display" visual preview under Settings > Messages, not a list of toggle switches. Show representative user and assistant messages and let users choose visible/hidden treatments directly in the preview. Provide seven independent display choices: separate user/assistant controls for avatar, background and timestamp, plus one assistant-only provider-name control. Preview controls have accessible labels, keyboard operation and a visible selected state; hidden elements retain a discoverable preview affordance so they can be restored:

- Show user avatar / show model avatar. Hiding the avatar removes its reserved space while keeping the remaining header and body aligned with each other. Other header content, such as the author name, remains.
- Show provider name. Applies only to assistant messages. Current `MessageHeader.tsx` renders author/model identity but no separate provider-name prefix, so this setting adds an optional provider label rather than hiding an existing one. It defaults off to preserve current rendering. Existing model and author labels remain unchanged; missing provider metadata produces no label.
- Show message background, one display choice for user messages and one for assistant messages. Turning a background off renders that side's messages on the plain conversation background; turning it on uses the existing message background design token for that side. Defaults preserve the selected message style: keep today's user bubble fill and plain assistant messages. The existing message-style option continues to control layout, not whether a fill may be shown.
- Show message timestamp, one display choice for user messages and one for assistant messages.

Each display choice is stored as a boolean in the existing display settings state, defaults to the current behavior, including the currently absent provider label and assistant background, and takes effect immediately without a restart. Settings copy is added in all 18 locales at implementation time. Keep existing DOM hooks for custom CSS. CSS can override presentation properties such as fill, but a hidden element that is not rendered cannot be restored by CSS. Do not promise unconditional CSS precedence over visibility choices.

## Alternatives considered

- Keep custom CSS as the only path: rejected, for the reasons the issue gives - high barrier, and silent breakage on component renames.
- One master "compact messages" preset instead of independent preview choices: simpler, but the issue's asks are independent per element and per side (user vs model); a preset cannot express "hide only my avatar".
- Include spacing adjustment for the thinking and search components in this Spec: deferred. Spacing is a numeric control, not a visibility toggle, and its defaults and bounds need design input; mixing it in would hold the four display families back.
- Treat item 6 of the issue ("continuously open more options") as in scope: rejected; open-ended scope cannot be verified. New options get their own Specs.

## Acceptance criteria

- AC1 — Settings > Messages uses an interactive message preview rather than toggle-switch rows, with exactly seven independent display choices: user/assistant avatar, background and timestamp plus an assistant-only provider label. Initial values preserve current rendering, including no new provider label or assistant fill (verification: renderer)
- AC2 — Changing a preview choice updates both the sample and the rendered conversation immediately, is keyboard-accessible with a discoverable way to restore hidden elements, takes effect without restart, and persists across relaunch (verification: renderer)
- AC3 — Hiding an avatar removes its reserved space; the remaining header and body stay aligned with each other, and author names remain (verification: renderer)
- AC4 — The provider-name choice controls only the new optional assistant provider label; model and author labels remain, and absent metadata produces no label (verification: renderer)
- AC5 — Background choices independently show/hide the existing background token for each side without changing the selected message-style layout; defaults match current per-style rendering (verification: renderer)
- AC6 — All new settings copy is present in the 18 locale files (verification: unit)

## Risks

- Setting sprawl: seven independent choices add interaction complexity. A single message preview with clearly labeled, reversible choices keeps their effects visible; item 6 of the issue is deliberately out of scope to avoid a growing pile.
- Interaction with custom CSS: a user stylesheet targeting the old DOM may override or conflict with a display choice. Keep DOM hooks stable where possible; document that CSS presentation overrides do not restore an element omitted by a visibility toggle.
- Per-surface drift: Agent and chat surfaces share the message frame components, so the display choices apply to both; a surface that forks its message chrome later must respect the same settings.
