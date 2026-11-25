# Agent Note: Scroll-to-latest on send is a preference

Status: implemented

English | [中文](2026-11-15-send-scroll-preference.zh.md)

## Problem

Opening a conversation turn used to move the message list to the newest message unconditionally: `useChatRuntimeState.sendMessage` called the list's public `scrollToBottom()` after `send()` reported success. A user who scrolled up to read history and then sent a message lost the reading position, which is the interruption reported in #24594. The behaviour had no user-visible switch, so nothing could opt out of it without changing the code.

The repository already tracks a separate follow-to-bottom behaviour in #23531; this change must not replace, duplicate, or revert that work.

## Decision

`chat.message.scroll_to_bottom_on_send` is a boolean desktop preference defined in `scripts/data-classify/data/target-key-definitions.json` and generated into `src/shared/data/preference/preferenceSchemas.ts` with a default of `true`. The default keeps the current behaviour for every existing profile: no migration, no write on upgrade, and no change for users who never open the setting.

The preference gates exactly one call site, the explicit `scrollToBottom()` that follows a successful send in `useChatRuntimeState.sendMessage`. When it is disabled, a successful send still seeds the turn, returns `sent: true`, and streams normally; only the forced return to the newest message is skipped, so the list keeps the reader's position.

Everything else keeps its own ownership of the scroll position: the public `scrollToBottom` helper, `useChatWriteActions` (`startNewContext`, `forkAndResend`, `resend`), the manual return-to-bottom button, message locating, conversation initialisation, and the virtualizer's streaming follow. A user who is already following the bottom continues to follow the stream while the preference is disabled; the switch only removes the takeover caused by sending, it does not freeze the viewport or acquire reading ownership.

The setting is exposed as an Appearance → Messages switch whose row id (`setting-appearance-scroll-to-bottom-on-send`) is registered in the settings search index, and all seventeen locales carry a real translation of the label and hint.

## Alternatives considered

- Only branching in the write actions (`useChatWriteActions`) was rejected because those paths also cover resend, fork, and new-context sends, where returning to the newest message stays desirable and is not part of the reported interruption.
- Freezing the viewport while reading (a "reading lock") was rejected as a larger behavioural change: it would also stop the stream follow for a user who is at the bottom, and it would need its own ownership model.
- Reusing #23531's follow-to-bottom state as the switch was rejected because that work decides where the list follows during streaming, not whether a send may steal the position.
- Adding a per-conversation or per-assistant override was rejected as unnecessary for the reported case; the interruption is a global reading habit.

## Consequences

Sending with the preference disabled no longer reveals the newly appended turn; the user finds it through the manual return-to-bottom control or by scrolling, which is the intended trade. The preference is stored like every other `chat.message.*` key, so it survives restarts and profile switches without extra persistence code. Because the gate sits on the shared send path, queued or drained turns follow the same rule; that is deliberate, since a drained turn is still a send initiated by the user.

## Verification

- Regression — `src/renderer/pages/home/__tests__/useChatRuntimeState.test.tsx`: with the preference enabled a successful send calls the list `scrollToBottom` once; disabled, zero times; an unsuccessful or throwing send never scrolls.
- Regression — `src/renderer/components/chat/settings/__tests__/ChatPreferenceSections.test.tsx`: the switch reflects the stored value and persists a toggle through the preference setter.
- Regression — `src/renderer/pages/settings/settingsSearch/__tests__/settingsSearchIndex.test.ts`: the new entry is searchable and resolves to the Appearance section row.
- Electron — `tests/e2e/smoke/sendScrollPreference.test.ts`: real Electron runs cover the default return-to-latest send, the disabled reading anchor while sending and while streaming, Enter-sent multiline drafts, follow-when-already-at-bottom, queue hold and drain, re-enabling the switch, restart persistence with the same profile, and the manual return-to-bottom control with the preference disabled.
