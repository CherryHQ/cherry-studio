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
- Show message background, one display choice for user messages and one for assistant messages. Each background preference has three stored states: `null` means follow the current message style, `true` explicitly shows fill, and `false` explicitly removes fill. The schema default is `null`, not a boolean; changing style never writes a background preference. With `null`, Plain has no user or assistant fill; Bubble keeps the existing user fill and no assistant fill. A saved `true` or `false` overrides that side's style-derived fill across style changes and relaunch. The preview shows the effective state and provides a "Use message style" action that saves `null`. Background choices do not alter layout, padding or alignment.
- An explicit user fill uses `--chat-user`. There is no existing assistant-message fill token, so implementation may add `--chat-assistant` in the shared product-token registry, theme definitions and variable catalog, defaulting to `var(--chat-user)` in both light and dark themes. This gives explicit assistant fill the established message-surface contrast without reusing the recessed `--chat-message-well` as a raised message surface. Keep the assistant's existing semantic foreground. The new token is used only for explicit assistant `true`; it must not introduce fill for an unset assistant choice. Both tokens remain overridable by custom CSS.
- Show message timestamp, one display choice for user messages and one for assistant messages.

Avatar, provider-name and timestamp choices are stored as booleans; the two background choices are nullable booleans as defined above. All use the existing display settings state and default to current behavior, including the currently absent provider label and assistant background, with immediate effect and no restart. Settings copy is added in all 18 locales at implementation time. Keep existing DOM hooks for custom CSS. CSS can override presentation properties such as fill, but a hidden element that is not rendered cannot be restored by CSS. Do not promise unconditional CSS precedence over visibility choices.

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
- AC5 — Background preferences default to `null` and follow current per-style rendering: user fill only in Bubble, no assistant fill in either style. Explicit `true`/`false` wins across Plain/Bubble changes and relaunch; resetting to `null` restores inheritance. User fill uses `--chat-user`; explicit assistant fill uses new `--chat-assistant` defaulting to `var(--chat-user)` in both themes, with its token registry and catalog entries. Verify all three preference states for each side in both styles, style switching without preference writes, reset, persistence and unchanged layout (verification: renderer)
- AC6 — All new settings copy is present in the 18 locale files (verification: unit)

## Risks

- Setting sprawl: seven independent choices add interaction complexity. A single message preview with clearly labeled, reversible choices keeps their effects visible; item 6 of the issue is deliberately out of scope to avoid a growing pile.
- Interaction with custom CSS: a user stylesheet targeting the old DOM may override or conflict with a display choice. Keep DOM hooks stable where possible; document that CSS presentation overrides do not restore an element omitted by a visibility toggle.
- Per-surface drift: Agent and chat surfaces share the message frame components, so the display choices apply to both; a surface that forks its message chrome later must respect the same settings.
