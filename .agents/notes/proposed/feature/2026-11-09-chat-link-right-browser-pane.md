# Agent Note: Opt-in Chat links open in the topic browser pane

Status: proposed

English | [中文](2026-11-09-chat-link-right-browser-pane.zh.md)

## Problem

Ordinary HTTP(S) links in main Chat messages use the generic leaf opener (`src/renderer/components/chat/messages/hooks/useMessageLeafCapabilities.ts:173`). Main dispatches them to a standalone built-in browser tab when `app.browser.open_links_in_browser` is true and to the external browser otherwise (`src/main/services/MainWindowService.ts:582`). Reading a source beside the claim it supports therefore costs a tab switch or an app switch (#21958).

A topic-owned browser pane already exists (`src/renderer/pages/home/components/TopicRightPane.tsx:147`), and Agent sessions already route eligible links into their session pane (`src/renderer/pages/agents/components/AgentRightPane/AgentRightPane.tsx:407`). The missing capability is a manual, opt-in route for ordinary main Chat links, rather than another browser implementation.

## Proposal

### Preference and precedence

Add `app.browser.open_chat_links_in_right_panel`, a boolean preference defaulting to `false`, to `scripts/data-classify/data/target-key-definitions.json`; regenerate `src/shared/data/preference/preferenceSchemas.ts`, never edit the generated schema by hand. Settings → Browser exposes an independent switch whose help text explicitly limits its scope to Chat messages. The saved choice survives reloads, restarts and upgrades.

| `app.browser.open_chat_links_in_right_panel` | `app.browser.open_links_in_browser` | Eligible main Chat activation |
|---|---|---|
| false | true | Existing standalone browser-tab route |
| false | false | Existing external-browser route |
| true | either | Topic pane when usable, otherwise the existing fallback |

Manual reading is independent of `app.browser.auto_open_panel`, `app.browser.agent_control.enabled` and `assistant.settings.enableBrowser`. It grants no automation permission and neither changes nor requires those settings. The existing global link switch, tool-driven reveal switch and automation grant all default to true (`scripts/data-classify/data/target-key-definitions.json:37`); their existing meanings remain intact.

### Renderer ownership and activation

Routing belongs in `homeMessageListAdapter.tsx`, whose provider already has `topicId` (`src/renderer/pages/home/messages/homeMessageListAdapter.tsx:114`). Override `openExternalUrl` after the leaf-action spread (`src/renderer/pages/home/messages/homeMessageListAdapter.tsx:861`). There is no main-process interception, new IPC or new DataApi endpoint: `openWebsite()` carries no topic identity (`src/main/services/MainWindowService.ts:582`), so main cannot know which topic tab owns the activation. Agent sessions and other surfaces keep their existing route.

A main Chat activation is eligible only when the new preference is true, rendering is normally interactive, the topic identity and optional panel state/actions are present, presentation is enabled, the browser pane is ready, and `resolveSafeExternalUrl()` resolves the protocol to exactly `http:` or `https:`. Legacy `http://file/` attachment URLs are excluded. Capture rendering, unavailable ownership or presentation, other protocols and every other ineligible case delegate to the existing opener exactly once. If ownership is lost while the open is in flight, the existing opener receives that activation exactly once.

Only a plain primary click or equivalent keyboard activation takes the new route. The Markdown anchor already guards modifiers and non-primary activation (`src/renderer/components/chat/messages/markdown/Link.tsx:38`). Citation hover cards and HTTP tool-result links currently ignore modifiers (`src/renderer/components/chat/citations/WebCitation.tsx:136`, `src/renderer/components/chat/messages/tools/shared/ToolResultLink.tsx:43`); those annotation surfaces pass a `preserveDefaultRouting` hint through the message action to preserve their current behaviour. Their event handling is not normalised. Anchors, app routes, workspace files and confirmation protocols retain their current handling, including confirmation and cancellation.

An accepted open settles docked, even if another pane was maximised. Explicitly activating the original URL again navigates the existing guest back to it after in-pane navigation. Today `ensure()` compares the originally requested `sourceUrl`, making that repeated request a no-op (`src/renderer/services/AgentBrowserRuntimeService.ts:53`); explicit activation must express navigation rather than merely ensuring that a resource exists.

### Close and presentation identity

Close uses the existing shell action, which clears open/maximise intent and reports closed (`src/renderer/components/chat/panes/Shell/RightPanel.tsx:294`). It neither remembers nor restores a previously selected panel. It must not call the browser runtime's `close()`: the retained guest, navigation history and page state survive closing and reopening the pane while the topic remains owned.

This proposal preserves [Bind right-panel presentation to its instance](../../implemented/bug-fix/2026-10-31-right-panel-presentation-identity.md): there is no automatic fallback to another panel when a panel identity becomes unavailable, and no per-session remembered-open map. Falling back to the existing URL opener for an unaccepted activation is distinct from selecting another panel to preserve an open layout.

Back, forward and reload reuse the existing topic browser chrome through `SessionBrowserView` (`src/renderer/components/SessionBrowserView.tsx:70`); close reuses the shell action above. No new browser chrome, webview or navigation IPC is introduced.

The topic browser shortcut currently requires `browserEnabled && browserControlEnabled` (`src/renderer/pages/home/components/TopicRightPane.tsx:281`). The new preference independently enables the shortcut: `openChatLinksInRightPanel || (browserEnabled && browserControlEnabled)`. The existing AI-control gate remains in place when the new preference is off; manual message-link routing remains independent of that gate.

### Browser width policy

Add a named `browser` width preset with its own nullable width keys, `ui.chat.browser_pane.width` and `ui.window.chat.browser_pane.width`, both `number | null` with default `null`. They follow the existing window-scoped cache policy (`src/renderer/hooks/useWindowScopedPersistCache.ts:29`). Other panes retain their current presets and stored widths; the existing `inspector` and `navigation-list` policies are separate (`src/renderer/components/chat/shell/paneLayout.ts:60`).

`null` means no user choice yet. An unset browser width requests about one third of the chat shell width: a 1200 px shell requests 400 px and a 1500 px shell requests 500 px. This request then follows the existing 255 px pane minimum, 360 px comfortable centre, 200 px centre floor and proportional yielding (`src/renderer/components/chat/shell/paneLayout.ts:2`, `src/renderer/components/chat/shell/paneLayout.ts:20`, `src/renderer/components/chat/shell/paneWidthPolicy.ts:14`).

The resolved ratio is not persisted on every shell resize. A user resize wins and persists through the existing cache policy. The same width resolution feeds rendering and sidebar auto-collapse prediction, which already shares the docked-width calculation (`src/renderer/components/chat/shell/paneWidthPolicy.ts:51`), so the two cannot disagree about the requested browser width.

## Alternatives considered

- **Reuse `app.browser.open_links_in_browser` as the switch.** It already defaults to true, so this would move existing Chat clicks into a pane without opt-in and could not express “pane, but only for chat links”.
- **Reuse `app.browser.auto_open_panel` or `app.browser.agent_control.enabled`.** These represent tool-driven reveal and an automation grant, respectively; both already default to true. Either choice gives manual reading the wrong identity and couples it to unrelated behaviour.
- **Route in the main process.** `openWebsite()` has no topic identity, risking a link being redirected into the wrong topic tab.
- **Intercept at the anchor or Markdown renderer.** That renderer is shared with Agent sessions and non-Chat surfaces, and owns the existing modifier guards. Routing there would broaden the change beyond the topic owner.
- **Reuse the `inspector` width preset and call 280 px “one third”.** The existing fallback is 280 px (`src/renderer/components/chat/shell/paneLayout.ts:22`); it is measurable but not one third at realistic shell widths, and sharing its stored width would couple unrelated panes.
- **Remember and restore the previously selected panel on close.** Rejected for this round: it changes shared shell semantics beyond the acceptance criteria, which require only that the layout return to normal.

## Acceptance criteria

- AC1 — Settings → Browser shows an independent switch, off by default, that survives a reload/restart, and its help text states that it applies to Chat messages. (verification: `BrowserSettings` renderer test + Electron)
- AC2 — With the switch on, a plain activation of an ordinary HTTP(S) Markdown link in a main Chat topic shows the URL in that topic's docked right pane, at about one third width, without changing the active conversation, composer contents or scroll position, and without a standalone tab or external dispatch. (verification: home adapter renderer test + Electron)
- AC3 — With the switch off, ineligible activations, modified or middle activation, `mailto:`, anchors, app routes, workspace files, `http://file/` URLs and confirmation protocols behave exactly as before, including the confirmation dialog and its cancellation. (verification: renderer tests for markdown, tool result and citation surfaces + Electron modifier matrix)
- AC4 — Back, forward and reload drive the real guest, and close returns the layout to normal: spacer at zero, presentation hidden and inert, composer usable, classic open override `false`, sidebar auto-collapse released when space permits; a previously selected panel is not restored. (verification: `RightPanel`, `RightPaneHost` and `useClassicLayoutRightPaneOpen` tests + Electron geometry)
- AC5 — An unset browser width requests about one third of the shell width, a user resize persists and wins, other panes' widths are untouched, and the auto-collapse prediction uses the same resolution. (verification: `paneLayout`, `RightPaneHost`, `ChatAppShell` and `useWindowScopedPersistCache` tests + Electron measurement at 1200 and 1500 px)
- AC6 — Re-activating the original link after in-pane navigation returns the guest to that URL; losing ownership mid-flight falls back to the existing opener exactly once. (verification: runtime renderer tests + Electron)
- AC7 — Every new renderer string is translated in every shipped locale and the i18n gate passes. (verification: i18n check)

## Risks

- The new persisted preference key must survive upgrades without resetting the user's opt-in choice.
- The shared shell width-policy change can disturb other panes if preset selection, nullable values or cache-key plumbing are wrong.
- Persisted browser width adds durable state, and retained guests hold memory for each open topic pane even while its presentation is closed.
- One third is an approximate visible target once window and rail widths and the existing yielding rules are taken into account.
- Routing depends on renderer-only topic identity. A surface rendered outside a topic provider deliberately keeps the old behaviour.
