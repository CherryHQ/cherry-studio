# Agent Note: Selection assistant agent window

Status: proposed

English | [中文](2026-10-27-selection-agent-window.zh.md)

## Problem

Selection actions can hand selected text only to an assistant. The [action window](../../../../src/renderer/windows/selection/action/ActionWindow.tsx) shows one answer from an in-memory temporary topic: there is no follow-up, no tool use, and nothing survives closing the window. Requests for agents, MCP tools, follow-up, and history recur in #11838, #9239, #6984, #22680, #10950, #12431, and their stale-closed duplicates.

Agent sessions already provide tools, approvals, workspaces, persistence, and background execution, but their UI is reachable only inside main-window tabs. Two pieces of the agent message list also assume a TanStack router: the provider link in [ErrorBlock](../../../../src/renderer/components/chat/messages/blocks/ErrorBlock.tsx) and fork-source navigation in [agentMessageListAdapter](../../../../src/renderer/pages/agents/messages/agentMessageListAdapter.tsx). A window without a router cannot render them safely.

## Proposal

### Product contract

- **Entries.** A new built-in toolbar action `ask-agent` opens a compose bar. A custom action may bind to an agent and workspace instead of an assistant; it skips the compose bar and sends its template-expanded prompt immediately. Assistant actions keep the current action window unchanged.
- **Sessions.** The first send creates one `conversation` session under the chosen agent and workspace through `POST /agent-sessions`. Nothing is created before that. The session is an ordinary agent session: it appears in the main session list and can be continued there.
- **Message content.** The selection enters the first message as the composer's existing `quote` token, followed by a line naming the source application (`programName` from the selection event). Custom actions reuse the assistant-action `{{text}}` template rule.
- **Shell.** There is no system title-bar band, and the whole window uses the popover surface. The 44px header is drawn by the app. macOS keeps native traffic lights inside it. Windows and Linux draw a minimize button (tooltip "Collapse to capsule") and a close button. The right side holds open in main window, pin, and opacity.
- **Compose bar → conversation.** The compose bar is 560 wide and sized to its content. It contains the selection, an instruction input, and agent and workspace selectors. On the first send it grows downward into the conversation window (default 560×620, minimum 420×480). When the space below is insufficient, it keeps its bottom edge and grows upward. The conversation area reuses the main-window message rendering, tool cards, and approval composer. A presentation tailored to this window is deferred until hands-on evaluation.
- **Follow-up while running.** In this window, sending during a running turn always steers. The message goes straight to the main process, which persists it at once and then either injects it into the current turn or schedules it as the next turn. The composer's renderer-side follow-up queue is disabled here, because closing the window would silently drop queued items. The queue returns once it has a single main-side owner (#22824).
- **Collapse.** The macOS yellow light, Cmd+M, and the Windows/Linux minimize button collapse a started window into a capsule. With auto-close on, blur collapses windows that are starting, running, or awaiting approval. The compose bar cannot collapse. Closing never stops a turn; only Stop does.
- **Capsules.** Capsules stack upward from the bottom-right of the work area of the window's display, staying clear of the Dock and taskbar. The capsule awaiting approval sits nearest the corner, followed by running, then done or failed. Each capsule shows the agent and its status: step N, needs approval, done, or failed. At most five are shown; the rest fold into "+N". Clicking a capsule restores its window to its previous bounds. Hovering reveals the session title and a close button. Approval is never answered from a capsule. Capsules exist only for the current run of the app.
- **Open in main window.** This calls the existing `navigation.focus_or_open_conversation`, closes the mini window and its capsule, and carries the unsent draft text into the main composer.

| State | Blur with auto-close | Minimize | Esc | New selection trigger |
|---|---|---|---|---|
| Compose with draft | Keep | Unavailable | Ignored | Open another window |
| Compose, empty | Close | Unavailable | Close | Replace this window |
| Starting or running | Collapse | Collapse | Stop | Open another window |
| Awaiting approval | Collapse | Collapse | Reject | Open another window |
| Done or failed, no draft | Close | Collapse | Close | Replace this window |
| Done or failed, with draft | Keep | Collapse | Ignored | Open another window |
| Collapsed | — | — | — | Open another window |

Pinned windows ignore blur, matching the current action window.

### Ownership

| Piece | Owner | Contract |
|---|---|---|
| Agent window lifecycle and capsule layout | New main-process lifecycle service under `src/main/services/selection/`, started by `selection.process_action` routing | Tracks each agent window's session, state, summary, and restore bounds. Lays out capsule stacks per display from `screen` work areas. Owns collapse, restore, close, and expand-with-animation requests. |
| Agent window | `WindowType.SelectionAgent`, pooled (standby 1, eager warmup), separate from `SelectionAction` | `wm.hide()` collapses without returning the window to the idle pool; only close releases it. It does not inherit the action window's `selection.action_dismissed` hide semantics. |
| Capsule host | `WindowType.SelectionCapsule`, default lifecycle, one window per display that has capsules | Sized to its stack and anchored bottom-right, so no click-through is needed. Non-focusable, always on top, and visible over full-screen spaces, following the toolbar's level and workspace options. Destroyed when its stack is empty. |
| Agent window renderer | New entry `src/renderer/windows/selection/agent/` | Mounts `useAgentChatRuntimeState`, `AgentSessionMessages`, and `AgentComposerSlot`, but not `AgentChat`, `AgentChatMain`, or `AgentChatLayout`, which require the right-pane scope. Providers: theme, code style, file-edit session, command context and command, MCP interaction host, popup, toast, dictation, and voice playback. No `TabsProvider` and no router. |
| Capsule renderer | New entry `src/renderer/windows/selection/capsule/` | Renders the list pushed by main and reports its measured size, following the toolbar's `determine_toolbar_size` pattern. |
| Busy-send mode | `AgentComposer` | Gains an option that makes a send during a running turn steer instead of enqueue. The selection agent window enables it; the main window keeps queueing. |
| Capsule summary | The agent window renderer | Derives status from `useTopicStreamStatus` (including `awaitingApprovalAnchors`) and the step count from the current turn's tool calls, then publishes them to main. A hidden window keeps its stream attachment, so summaries continue after collapse. |
| macOS yellow light | `native/darwin/selectionPanel.mm` | Electron's `minimize` event cannot be cancelled. Tagged agent panels intercept `performMiniaturize:` / `miniaturize:` and notify JavaScript through an N-API thread-safe callback. Cmd+M on a focused agent window routes to collapse. |
| Animation | Main process | macOS uses `setBounds(bounds, true)` for expand and for collapse toward the capsule slot. Windows and Linux switch instantly. When `systemPreferences.getAnimationSettings().prefersReducedMotion` is true, every platform switches instantly. |
| Draft hand-off | `navigation.focus_or_open_conversation` | Gains an optional draft text. The receiving main-window renderer seeds that session's agent draft cache before opening it; an already mounted composer for the session appends the text. |
| Selection action data | `SelectionActionItem` and `selectionActionItemSchema` | Add `agentId?` and `agentWorkspace?` (`AgentSessionWorkspaceSource`). The model radio becomes default, assistant, or agent, and saving clears the field of the other choices. `ask-agent` with no `agentId` resolves the built-in agent whose `builtin_role` is `assistant`; with no workspace it uses the system workspace. |
| Defaults and upgrade | `classification.json` and a versioned upgrade seeder | New installs get `ask-agent` enabled. Existing stored arrays gain it once, disabled and appended, without reordering or editing user items. |
| Selection source | Toolbar renderer and `selection.process_action` input | `programName` is carried next to the selected text; today the toolbar drops it. |
| Settings | `SelectionAssistantSettings` | `ask-agent` shows its default agent beside its name and gets a settings dialog for default agent and workspace. Agent-bound custom actions show their agent's name. The custom action modal gains the agent choice, agent selector, and workspace selector. |

### Navigation decoupling (bottom implementation layer)

- `ErrorBlock` replaces the TanStack `<Link>` with `openRoute('/settings/provider', { id })`. In the main window this opens or focuses the settings tab instead of replacing the conversation tab, which matches `openSettingsTab` elsewhere. In other windows the existing IPC fallback opens it in the main window.
- Fork-source navigation becomes an optional host action of `AgentSessionMessages` and its adapter. The agents page supplies its current in-place TanStack `navigate`, so its behavior is unchanged. A host that supplies nothing hides the fork-source link. Sessions created from the selection window are never forks.
- `openRoute` stays a module function. Its local DOM-event bridge with IPC fallback already lets each window decide whether it handles routes. Converting its 40 call sites to injection would not change this feature.

### Delivery layers

1. Spec (this note).
2. Navigation decoupling.
3. Selection action data, defaults and upgrade seeder, settings UI, and `programName` plumbing.
4. Agent window: compose bar, session creation, conversation view, state rules, open in main window, and draft hand-off.
5. Capsules and collapse: capsule window type and layout, macOS native interception, and animation. This layer moves the note to implemented.

## Alternatives considered

- **Mount the whole agents page with tabs and a router in the selection window.** Rejected. `AgentChatMain` and the layout require the right-pane scope, the page reads tab and route state, and the selection window would carry main-window chrome it cannot use.
- **Wrap the selection window in a memory router.** Rejected. It hides broken navigation: links would navigate an invisible router and do nothing.
- **Convert `openRoute` to dependency injection everywhere.** Deferred. It is already window-injectable through its event bridge. Only in-place view navigation needs a host, and that has one call site today.
- **Reuse the `SelectionAction` pooled window type.** Rejected. Its hide event means "dismissed", and its pool assumes one-shot results. Agent windows must survive hidden as capsules.
- **Keep temporary in-memory topics.** Rejected by the product decision that agent work persists as sessions.
- **Create sessions with `ai.agent.session.reuse_or_create`.** Rejected. It can reuse an empty session the main window is showing as a draft, including Cherry Assistant's seeded empty session.
- **One full-display transparent capsule overlay with click-through.** Rejected. `setIgnoreMouseEvents` forwarding is unavailable on Linux, and toggling hit regions is fragile. One window per capsule was also rejected, because it costs a renderer per pill.
- **Capsules at the top-right.** Rejected. macOS notifications slide in there, and maximized Windows and GNOME windows keep their close buttons there.
- **Listen to Electron `minimize` and restore the window.** Rejected. The event is not cancellable, and the Dock animation would flash first.
- **Hide native traffic lights and draw imitations by default.** Kept only as the fallback if native interception proves infeasible.
- **Frame-stepped animation on Windows and Linux.** Deferred until hands-on evaluation. Resizing transparent windows frame by frame risks flicker.
- **A selection-specific message presentation (title-style first message, compact step rows).** Deferred until hands-on evaluation of the reused rendering.
- **Keep the renderer follow-up queue in this window.** Rejected until #22824. Closing the window would drop queued items silently, and flushing them during close or asking for confirmation would add an asynchronous close path to work around a queue that lives in the wrong owner.
- **Make agent drafts a shared cache tier for the hand-off.** Rejected. It would change draft synchronization for every window to serve one transfer.

## Acceptance criteria

- AC1 — In the main window, the ErrorBlock provider link opens or focuses the settings tab at that provider without replacing the conversation tab. In a window without a router it opens the main window's settings. Fork-source navigation on the agents page is unchanged. (verification: renderer)
- AC2 — Fresh installs list `ask-agent` enabled. Existing installs gain it once, disabled, without reordering or altering their items. (verification: unit)
- AC3 — The custom action modal offers default model, assistant, and agent. Choosing agent saves the agent id and workspace and clears the assistant id, and the reverse holds. Existing assistant actions behave as before. (verification: renderer)
- AC4 — `ask-agent` opens a focused compose bar that shows the selected text and its source application, without sending or creating a session. Closing it leaves the session list unchanged. (verification: renderer + Electron)
- AC5 — The first send creates exactly one conversation session under the chosen agent and workspace. Its first user message contains the instruction, the quoted selection, and the source application, and the compose bar expands into the conversation window. (verification: renderer + Electron)
- AC6 — An agent-bound custom action opens the conversation window and immediately sends its prompt expanded by the `{{text}}` rule. (verification: renderer)
- AC7 — The conversation window streams replies and tool calls, shows the approval composer for pending approvals, steers input sent while running without queueing it in the window, and continues the same session after completion, using the main-window message rendering. (verification: Electron)
- AC8 — The window has no system title-bar band and one surface color in both themes. macOS traffic lights sit centred in the 44px header, and Windows and Linux expose collapse and close buttons. (verification: Electron)
- AC9 — On a started window, the yellow light, Cmd+M, and the Windows/Linux minimize button collapse it into a capsule instead of minimizing to the Dock or taskbar. The compose bar cannot collapse. (verification: Electron)
- AC10 — With auto-close on, blur collapses starting, running, and awaiting-approval windows, closes done, failed, and empty compose windows that hold no draft, and keeps every window that holds a draft. Pinned windows ignore blur. (verification: renderer)
- AC11 — Capsules stack upward from the bottom-right of the work area of their window's display without covering the Dock or taskbar. They are ordered approval, running, done or failed, show live status and step count, cap at five plus "+N", and restore the window to its previous bounds on click. (verification: Electron)
- AC12 — Closing a window or a capsule never stops the turn. The main session list shows running or awaiting approval, approval works from the main window, and only Stop aborts. (verification: Electron)
- AC13 — "Open in main window" focuses or opens the session in the main window, closes the mini window and its capsule, and the main composer shows the unsent draft. (verification: Electron)
- AC14 — A new selection trigger while a window is starting, running, awaiting approval, holding a draft, or collapsed opens another window and leaves the existing one intact. (verification: Electron)
- AC15 — Expand and collapse animate on macOS and switch instantly on Windows and Linux, and on every platform when the OS prefers reduced motion. (verification: Electron)
- AC16 — An agent without a model, a missing runtime, and an unavailable bound agent or workspace each show a targeted action inside the window. (verification: renderer)
- AC17 — Translate, explain, summary, refine, and assistant-bound custom actions keep their current window and behavior. (verification: renderer + Electron)

## Risks

- **macOS interception may be infeasible or fragile.** Electron's panel class and its button actions are internal and may change across Electron upgrades. A spike comes first. The fallback hides the native buttons (`setWindowButtonVisibility(false)`) and draws lookalike traffic lights in the same position.
- **Hidden windows may be throttled.** Chromium may throttle hidden renderers, which would delay capsule summaries. Measure, and disable background throttling for this window type if needed.
- **MCP interaction prompts may land in a hidden window.** They go to the first live listener window. If a collapsed agent window is that listener, the prompt could be invisible. Route it to a visible window, or surface it on the capsule.
- **Ownership must stay with the main window.** `navigation.focus_or_open_conversation` asks renderers about ownership. Agent windows must not claim it, so the main window remains the destination.
- **Steered follow-ups cannot be withdrawn.** Unlike queued items in the main window, a follow-up sent from this window cannot be edited, reordered, or removed after sending. This is accepted until #22824.
- **Each agent window costs a renderer.** Pool caps bound idle windows, but many simultaneous collapsed sessions each keep one alive.
- **The first turn pays runtime start-up.** Claude Code prewarms per existing session (`ai.agent.session.prewarm`), but this window creates its session on the first send, so that turn cannot be prewarmed. Pi's connection first waits for the agent's MCP tool catalogs. The window therefore shows a starting state. Agent actions are for doing work, not for instant results.
- **Built-in Cherry Assistant ships without a model.** New users hit the "no model configured" path until agent onboarding assigns one.
