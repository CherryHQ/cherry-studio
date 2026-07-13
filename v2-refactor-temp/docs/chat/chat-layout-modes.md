# Chat Layout Modes

Home and Agent no longer persist a separate manual `classic` / `modern` layout
preference. The layout is derived from the resource-list display mode.

## Home

- `topic.tab.display_mode = 'assistant'` uses the classic layout: assistant rail
  on the left, chat in the center, topic list either in the left rail or the
  right pane depending on `topic.tab.position`.
- `topic.tab.display_mode = 'time'` uses the modern single-sidebar layout.

## Agent

- `agent.session.display_mode = 'agent'` uses the classic layout: agent rail on
  the left, chat in the center, session list either in the left rail or the right
  pane depending on `agent.session.position`.
- `agent.session.display_mode = 'time'` or `'workdir'` uses the modern
  single-sidebar layout.

## State

- Display mode, topic/session position, and topic/session item sort are stored as
  Preference data.
- `topic.sort_type` defaults to `createdAt` and
  `agent.session.sort_type` defaults to `orderKey`. Changing display mode does
  not change either sort preference.
- `topic.tab.show` controls whether the left resource list is expanded.
- Classic-layout right-pane state is persisted independently per surface via
  `useClassicLayoutRightPaneOpen(surface, { enabled, defaultOpen })`:
  `ui.chat.right_pane_open_override` for Home and
  `ui.agent.right_pane_open_override` for Agent. A `null` override delegates to
  the page default: the pane opens when the topic/session list is positioned on
  the right in a main window. Explicit open/closed choices persist across page
  re-entry.
- Resource-list collapsed groups are stored only for business grouping modes
  (`assistant`, `agent`, and `workdir`) in renderer persist cache. The flat
  time views have no collapsible date groups.

## Left Entity Rail

`ResourceEntityRail` (presentational, generic) + `useResourceEntityRail` (shared
behavior) power the classic left rail. `AssistantResourceList` and
`AgentResourceList` own data fetching, pins, deletion, icon display, and context
menus.

- Home shows assistants; Agent shows agents.
- Only entities that already own topics/sessions are shown.
- The top action creates or selects an assistant/agent through the shared picker.
- Management entries live in the display/options menu, not as extra top rail
  entries.
- Pinned entities float into a pinned section; non-pinned entities are ordered by
  assistant/agent `orderKey`.

## Right Resource Panel

When the topic/session position is `right`, the topic/session list is injected as
the first resource tab through `ResourcePaneProvider` / `useResourcePane`.

- Home lists topics; Agent lists sessions.
- Lists are scoped to the current assistant/agent.
- When no explicit pane override exists, placing the topic/session list on the
  right opens both the left owner rail and the right resource list by default.
- Manually closing the right pane stores an explicit override, matching the left
  rail's re-entry behavior.
- The right panel shares the existing RightPanel chrome with branch, trace,
  files, status, and flow panels.
- Right-panel topic/session lists use the corresponding selected topic/session
  sort. Older rows load as the list is scrolled; there is no date grouping or
  collapse state.

## Composer Entity Controls

In classic layout the left rail owns entity switching, so the composer hides the
assistant/agent switcher while the classic entity rail is active.

- `ChatComposer` hides the assistant trigger when the assistant display mode is
  active.
- `AgentComposer` hides the agent trigger when the agent display mode is active.
- Classic layout adds a new conversation/work action to the composer controls
  when `onCreateEmptyTopic` / `onCreateEmptySession` is available.

## Agent Workspace Control

Classic-layout agent chats keep the workspace control visible in the composer.

- Draft sessions keep the editable workspace selector.
- Persistent sessions can switch workspace only while the visible session is
  still empty.
- The data service rejects workspace updates once the session has messages.

## Data Flow

Topic and session list endpoints expose cursor-paginated sort profiles and
record filters.

- The list options menu separates display mode from item sorting. Topics and
  sessions can use `updatedAt DESC, id ASC`, `createdAt DESC, id ASC`, or
  `orderKey ASC, id ASC`.
- Time views request separate pinned and unpinned streams with the selected
  sort. Pin state selects the top band but does not define an independent order.
- Assistant, agent, and work-directory modes keep independent per-group cursor
  windows with the same selected topic/session sort. The assistant, agent, or
  workspace group rank is applied before sorting items within each group, so
  changing item sort never changes the outer entity order.
- Changing sort changes the grouped query key, clears the existing cursor
  windows, and starts each group again from its first page.
- Topic/session item drag is enabled only for `orderKey`; timestamp sorts are
  read-only. Assistant, agent, and workspace group drag remains independent and
  available where the display mode already supports it.
- Right panels apply the current assistant/agent scope on the server instead of
  loading a global list and filtering it in the renderer.
- Create/delete/rename/clear/move reset the affected cursor windows inside the
  current Renderer after the local mutation succeeds.
- History records keep their own updated-time order and do not read these list
  sort preferences.

## Key Files

- `src/renderer/components/chat/resourceList/ResourceEntityRail.tsx`
- `src/renderer/components/chat/resourceList/useResourceEntityRail.ts`
- `src/renderer/components/chat/resourceList/AssistantResourceList.tsx`
- `src/renderer/components/chat/resourceList/AgentResourceList.tsx`
- `src/renderer/components/chat/panes/Shell/resourcePane.tsx`
- `src/renderer/pages/home/HomePage.tsx`
- `src/renderer/pages/home/Tabs/components/Topics.tsx`
- `src/renderer/pages/agents/AgentPage.tsx`
- `src/renderer/pages/agents/AgentChat.tsx`
- `src/renderer/pages/agents/components/Sessions.tsx`
- `src/main/data/services/TopicService.ts`
- `src/main/data/services/AgentSessionService.ts`
