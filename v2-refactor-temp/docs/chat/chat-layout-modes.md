# Chat Layout Modes (classic / modern)

Each chat surface — assistant conversations (Home) and agent work — has its own
layout-mode preference. The **classic layout** is a compact entity rail plus a right-side
resource panel; the **modern layout** is the single sidebar. The `classic` / `modern`
values are the persisted preference values and feed the `isClassicTopicLayout` /
`isClassicSessionLayout` flags in the pages.

## Preferences

Two independent preferences, both `'classic' | 'modern'` (`PreferenceTypes.ChatLayoutMode`),
both defaulting to `'classic'`:

- `topic.layout` — assistant chats (Home). v2-only, no v1 source.
- `agent.layout` — agent chats. v2-only, no v1 source.

Both are declared in `target-key-definitions.json` and generated into
`preferenceSchemas.ts`; the legacy v1 `topicPosition` field is deleted during
classification and is not migrated into either setting. The settings UI
(`CommonSettings`) exposes them as "Conversation view" and "Work view", each with
"Efficient" / "Classic" labels. (The i18n label strings are unchanged from the
earlier naming, so the `modern` value still shows as "Efficient"; only the stored
values and code identifiers moved to `classic` / `modern`.)

## Surface terminology

The two surfaces deliberately use different words at different layers; the mapping is
fixed, not accidental:

| Surface   | Domain entity | Resource          | Preference namespace | UI label (i18n) |
| --------- | ------------- | ----------------- | -------------------- | --------------- |
| Assistant | `assistant`   | topic             | `topic.*`            | "Conversation"  |
| Agent     | `agent`       | session ("work")  | `agent.*`            | "Work"          |

So `topic.layout` governs the assistant surface and `agent.layout` governs the agent
surface, while the shared rail/panel components stay entity-generic
(`ResourceEntityRail`, `ConversationPickerDialog`). The layout *mode* itself is always
`classic` / `modern` regardless of surface.

## Layout

When the relevant preference is `classic`:

1. Left: a compact assistant/agent entity rail.
2. Center: the existing chat surface.
3. Right: an independently toggleable resource panel for the current
   assistant/agent's conversations/works.

When the preference is `modern`, the single sidebar is used
(`HomeTabs` / `AgentSidePanel`). Its display-mode preferences and logic are kept,
though the display-mode controls are currently hidden in the UI.

## State

- `topic.layout` / `agent.layout` select the mode per surface.
- `topic.tab.show` controls whether the left entity rail is expanded/collapsed.
- `ui.chat.right_pane_open` persists the classic-layout right panel's open state
  for Home and Agent. Home uses it directly on the page-level Shell; Agent owns
  the same cached state in `AgentPage` and threads it through each `AgentChat`
  Shell mount so it survives draft → persistent remounts and page re-entry.
- Toggling a surface modern → classic → modern restores the last cached classic-layout
  right-panel open state.

## Left entity rail

`ResourceEntityRail` (presentational, generic) + `useResourceEntityRail` (shared
behavior). The per-variant adapters `AssistantResourceList` / `AgentResourceList`
own data fetching, pins, deletion, and context menus.

### Scope

- Home shows assistants; Agent shows agents.
- Only entities that already own conversations/works are shown — visibility is
  derived from the shared resource list (`getResourceParentId`), not a separate
  query.
- Newly created assistants/agents stay hidden until they have at least one
  topic/session.

### Top action

- Fixed above the sortable entity list: Home adds an assistant, Agent adds an
  agent. Entities cannot be dragged above it.
- The "+" opens a shared searchable picker (`ConversationPickerDialog`, wrapped
  per surface by `AssistantConversationPickerDialog` / `AgentConversationPickerDialog`)
  to switch to or create an entity. It has a "create new" row and pagination; for
  assistants it filters between 资源库 (the user's assistants) and 助手库 (the
  preset catalog, via `useAssistantCatalogPresets`).
- A history-records button next to "+" opens the History Records / global-history
  page (`onOpenHistoryRecords`).
- After creating a new entity the main chat enters its blank state; the entity
  still does not appear in the rail until it owns a topic/session.

### Selection and click behavior

- Selection follows the current assistantId/agentId; if the current entity has no
  resources it has no selected row.
- `handleSelect` enters the entity's first/most-recent resource (pinned then time
  order via `sortResourcesForEntity`). Because a visible entity always owns at
  least one *loaded* resource, this does **not** wait for the full load — there is
  no dead-click window. The (effectively unreachable) no-resource case falls back
  to a blank draft.
- Clicking an entity does not open the right panel if it is closed; if it is open
  it stays open and switches to the new entity.

### Pinned entities

- Pinned assistants/agents float into a "已固定" section at the top, mirroring the
  modern layout's left list (entity pins reuse `usePins('assistant'|'agent')`). The rest
  sit under a "助手" / "智能体" section below.
- Both are collapsible **section** headers (flush-left), so the entity rows keep
  their avatar and read as indented beneath. With nothing pinned the rail renders a
  single flat list with no header — same as the modern layout's single-section case.
- Pinned rows cannot be dragged and nothing can be dropped into the pinned section;
  only the entities still owning resources appear (the rail's visibility invariant
  is unchanged).

### Ordering & context menu

- Non-pinned entities are ordered by assistant/agent `orderKey`; drag reorders and
  persists the real `orderKey` (optimistic, then refetch).
- Entity rows keep the single sidebar's entity context menus (assistant grouped-row /
  agent `AgentItem` behavior). Deleting the current entity, or clearing all its
  resources, closes the right panel and leaves the main chat in that entity's
  blank state.

## Right resource panel

The right panel reuses the existing `Shell` right-pane chrome. The topic/session
list is injected as the first `resources` tab via `ResourcePaneProvider` /
`useResourcePane` (a context, so the node + label are supplied once at the page
level instead of prop-threaded).

- Home lists topics ("topic" / "话题"); Agent lists works ("work" / "工作").
- Lists only the current entity's resources. With no current entity the panel
  opens to an empty list.
- The toggle lives in the chat top-right tool area; the same button toggles
  open/closed. The panel is mutually exclusive with branch/trace/files/status/flow
  (scoped to the current chat instance).
- Fixed time grouping, groups expanded by default; does not read/write the
  single sidebar's group-collapsed state or display options. Header keeps only search,
  scoped to the current entity; creating a topic/session stays on the left rail
  and single sidebar entry points. Drag/group movement is disabled (the list is
  fixed time-grouped).
- Switching assistant/agent clears the right-list search; switching topic/session
  within the same entity does not.

## Composer entity controls (classic layout)

In classic layout the left rail owns entity switching, so the composer's assistant/agent
switcher is hidden rather than repurposed:

- `ChatComposer` passes `showAssistantTrigger: topicLayout !== 'classic'`.
- `AgentComposer` passes `showAgentTrigger: sessionLayout !== 'classic'`. The
  `agentTriggerMode="edit"` code path still exists for toolbar-bound contexts, but
  it is not the classic-layout entry point because the trigger is hidden by
  `showAgentTrigger`.
- Classic layout adds a new conversation/work action to the composer controls when
  `onCreateEmptyTopic` / `onCreateEmptySession` is available.
- The agent composer's inline model selector remains available for changing the
  active agent model. The agent switcher is hidden inside active sessions (an
  active session is bound to its agent).

## Agent workspace control (classic layout)

Classic-layout agent chats keep the workspace control visible in the composer because
the classic left sidebar is no longer present:

- Draft sessions keep the existing editable workspace selector.
- Persistent sessions can switch workspace only while the visible session is still
  empty: messages are loaded, there are no older pages, and the UI message list is
  empty. After any message exists, the same control remains visible as a read-only
  workspace display.
- Switching patches the current session's workspace source (`user` workspace id or
  `system` / no-project) instead of replacing the draft state. The data service
  rejects workspace updates once the session has messages.
- The no-project / system workspace is not a user filesystem workspace. It is shown
  as the no-project option, but it does not run directory accessibility preflight
  and is not passed to skills or tool accessible paths. Only `user` workspaces expose
  their path to those checks.

## Data flow

No DataApi endpoint filters topics/sessions by entity — both panes derive from one
shared full list and filter in the frontend.

- The entity rail and the right panel read the **same** source through
  `useAssistantTopicsSource` / `useAgentSessionsSource`
  (`src/renderer/hooks/resourceViewSources.ts`). These wrap
  `useTopics({ loadAll: true })` / `useSessions(undefined, { loadAll: true,
  pageSize })` so both sides resolve to one SWR key — one fetch, and the load
  options can never drift between the two call sites.
- `loadAll` is intentional and unavoidable: the rail must know which entities own
  resources, and the panel filters the same list by the current entity. A single
  fetch feeds both.
- Create/delete/rename/clear/move use the existing mutation/invalidate
  flow; after a mutation the shared source is refreshed once and both sides
  re-derive. No local shadow copies.
- Assistant/agent metadata supplies display data + operations (name, emoji/avatar,
  `orderKey`, context-menu actions); topic/session data determines visibility.
- `PATCH /agent-sessions/:sessionId` accepts a normalized `workspace` source for
  empty-session workspace switches. The main service maps it to the backing
  `workspaceId`, creates or removes system workspaces as needed, and refuses the
  update after messages exist.

## Agent pane persistence across the draft→persistent handoff

Home keeps a single page-level `Shell` (via `renderWithRightPane`), so its right
pane stays open across the draft → persistent topic handoff. The agent chat mounts
a fresh `AgentRightPane` (= a fresh `Shell`) per conversation branch
(initializing / draft / missing-agent / persistent), so sending the first message
in a draft session would otherwise remount the Shell and snap the work panel shut.

To match Home, the `Shell` exposes an additive `onOpenChange` callback;
`AgentPage` owns the open state (`sessionPaneOpen`) and threads
`defaultOpen` + `onOpenChange` through `AgentChat` to every `AgentRightPane` mount
site, so the open state survives the remount. This is scoped to the classic session
layout (`isClassicSessionLayout`); modern layout passes `undefined` and is byte-for-byte unchanged.

## Key files

- `components/chat/resources/variants/ResourceEntityRail.tsx`,
  `useResourceEntityRail.ts` — rail component + shared behavior.
- `components/chat/resources/variants/AssistantResourceList.tsx`,
  `AgentResourceList.tsx` — per-variant data adapters.
- `components/chat/panes/Shell/resourcePane.tsx` — `resources` tab injection.
- `components/resource/ConversationPickerDialog.tsx` — shared entity/conversation
  picker; wrapped by `pages/home/components/AssistantConversationPickerDialog.tsx`
  and `pages/agents/components/AgentConversationPickerDialog.tsx`.
- `components/composer/variants/ChatComposer.tsx`,
  `AgentComposer.tsx` — classic-layout entity trigger visibility and new conversation/work
  composer actions.
- `hooks/useAssistantCatalogPresets.ts` — preset catalog feeding the assistant picker.
- `hooks/resourceViewSources.ts` — shared full-list sources.
- `pages/home/HomePage.tsx`, `pages/agents/AgentPage.tsx`,
  `pages/agents/AgentChat.tsx`, `pages/agents/AgentComposerSlot.tsx` — page wiring,
  agent pane persistence, and classic-layout workspace switching.
- `main/data/services/AgentSessionService.ts`,
  `shared/data/api/schemas/agentSessions.ts` — empty-session workspace update
  validation and persistence.
