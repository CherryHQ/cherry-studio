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

- Display mode and topic/session position are stored as Preference data.
- `topic.tab.show` controls whether the left resource list is expanded.
- Classic-layout right-pane state is persisted independently per surface via
  `useClassicLayoutRightPaneOpen(surface, { enabled, defaultOpen })`:
  `ui.chat.right_pane_open` for Home and
  `ui.agent.right_pane_open` for Agent. A `null` value delegates to
  the page default: the pane opens when the topic/session list is positioned on
  the right in a main window. Explicit open/closed choices persist across page
  re-entry.
- Resource-list collapsed groups are stored per display mode in renderer persist
  cache.

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
- The right panel shares the existing Shell right-pane chrome with branch, trace,
  files, status, and flow tabs.
- Right-panel topic/session lists stay time-grouped and do not write the left
  list's display-mode collapse state.

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

No DataApi endpoint filters topics/sessions by entity. The entity rail and right
panel read the same full-list source and filter in the frontend.

- Home uses `useAssistantTopicsSource`.
- Agent uses `useAgentSessionsSource`.
- Create/delete/rename/clear/move use the existing mutation and invalidate flow;
  after a mutation, both sides re-derive from the refreshed shared source.

## Key Files

- `src/renderer/components/chat/resourceList/ResourceEntityRail.tsx`
- `src/renderer/components/chat/resourceList/useResourceEntityRail.ts`
- `src/renderer/components/chat/resourceList/AssistantResourceList.tsx`
- `src/renderer/components/chat/resourceList/AgentResourceList.tsx`
- `src/renderer/components/chat/panes/Shell/resourcePane.tsx`
- `src/renderer/pages/home/HomePage.tsx`
- `src/renderer/pages/agents/AgentPage.tsx`
- `src/renderer/pages/agents/AgentChat.tsx`
