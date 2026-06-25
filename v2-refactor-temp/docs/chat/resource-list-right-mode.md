# Resource List Right Mode Design

**Status:** implemented on the current `jd/resource-list-config` branch.

This note records the agreed behavior for `chat.resource_list.position = right`.
The current WIP direction that recreates a v1-style assistant/agent list is
considered the wrong direction.

## Goal

When the resource list position is `right`, the layout becomes:

1. Left: a compact assistant/agent entity rail.
2. Center: the existing chat surface.
3. Right: an independently toggleable ResourceList panel for the current
   assistant/agent's conversations or works.

When the resource list position is `left`, the existing behavior remains
unchanged.

## Non-goals

- Do not recreate the v1 full assistant/agent manager in the left pane.
- Do not add new preference keys.
- Do not add new DataApi query semantics for this feature.
- Do not make the right panel share the branch/trace/files/status/flow content
  shell. It may reuse the right panel chrome and layout mechanics only.
- Do not change the startup selection strategy.

## Preferences and state

- `chat.resource_list.position` continues to select `left` or `right`.
- `topic.tab.show` controls whether the left entity rail is expanded/collapsed in
  right mode.
- The right conversation/work panel is tab-scoped component state.
- The right panel is closed by default.
- Switching from `right` to `left`, then back to `right`, does not restore the old
  right panel open state.
- No new persisted setting is introduced for this design.

## Left entity rail

The left rail is an entity index, not a full resource list.

### Scope

- Home shows assistants.
- Agent shows agents.
- Only entities that already have conversations/works are shown.
- Assistants/agents with no topic/session are not shown.
- Newly created assistants/agents are not temporarily shown until they have at
  least one topic/session.

### Top action

- The top action stays in the left rail:
  - Home: add assistant.
  - Agent: add agent.
- The top action is fixed above the sortable entity list.
- Entities cannot be dragged above the top action.
- After creating a new assistant/agent, the main chat enters that entity's blank
  state.
- The new entity still does not appear in the left rail until it has a
  topic/session.

### Visual shape

- No search in the left rail.
- No count badges.
- No tag/group sections.
- Use the existing left-mode visual language:
  - emoji/avatar + name,
  - hover state,
  - selected state,
  - comparable width, row height, spacing, and typography.
- Prefer reusing existing left-mode assistant/agent row behavior. If the current
  rows are too tightly coupled to the old structure, extract a thinner shared row
  instead of copying v1 structure.

### Selection and click behavior

- Selection is determined by the current assistantId/agentId.
- If the current entity is not visible because it has no resources, the left rail
  has no selected row.
- Clicking an entity enters the first topic/session under that entity according
  to the right panel's time ordering:
  - pinned items follow the existing time-mode rule if the current ResourceList
    already prioritizes them,
  - then most recent time order.
- Clicking an entity does not open the right panel if it is currently closed.
- If the right panel is already open, it stays open and switches to the newly
  selected entity.

### Ordering

- The visible entity list is ordered by assistant/agent `orderKey`.
- Drag sorting is supported.
- Drag sorting updates the real assistant/agent `orderKey`.
- The drag behavior should follow the existing left-mode ResourceList ordering
  behavior.

### Context menu

- Entity rows keep entity-level context menus.
- Home follows the assistant context menu behavior from the left-mode grouped
  assistant list.
- Agent follows the existing left-mode `AgentItem` context menu behavior.
- If an entity-level action deletes the current assistant/agent, the right panel
  closes.
- If an entity-level action clears all resources for the current entity, the
  entity disappears from the left rail, the right panel closes, and the main chat
  remains in that entity's blank state.

### Empty, loading, and error states

- If no entities have resources, show only the top add action; no extra empty
  explanation is needed.
- During loading, do not temporarily show all assistants/agents. The rail must
  only show confirmed entities with resources.
- Do not add a new skeleton unless the existing left-mode behavior already
  provides one.
- Loading and error handling should follow the existing left-mode behavior.

## Right ResourceList panel

The right panel is the full resource list for the current entity.

### Scope and labels

- Home: topic list.
- Agent: work list.
- The Home top-right entry uses the existing product word "topic" / "话题";
  Agent uses "work" / "工作".
- The panel lists only resources under the current assistant/agent.
- When there is no current assistant/agent context, the tool button is disabled
  and its tooltip explains that an assistant/agent must be selected first.
- In a newly created blank entity context, the button is enabled and the panel
  can open to an empty list.

### Entry and chrome

- The open/close entry lives in the chat page's top-right tool area.
- Do not add a separate outer topic/work entry button.
- The existing right panel toggle opens the right panel.
- In right mode, the first right panel tab is the topic/work ResourceList.
- The same tool button toggles the panel open and closed.
- The panel itself does not add a second close button.
- The panel is mutually exclusive with existing right-side panels such as
  branch/trace/files/status/flow.
- Mutual exclusion is scoped to the current page/chat instance only; it does not
  affect other pages, windows, or tabs.
- Clicking the chat area or sending a message does not close the panel.
- No new Escape-key close behavior is added.
- The panel reuses the existing rightPanel chrome:
  - border,
  - background,
  - resize handle,
  - resize behavior,
  - width state,
  - min/max constraints,
  - existing push/overlay layout behavior.
- The inner content structure is a dedicated ResourceList composition, not the
  existing branch/trace/files/status/flow shell.

### List behavior

- Fixed time grouping.
- Groups are expanded by default.
- Right mode does not read or write the left-mode group collapsed state.
- Right mode does not follow existing group/section display options.
- The header keeps only the new conversation/work item.
- The header does not keep display options, history, or sidebar toggle controls.
- Search is kept in the right list.
- Search is scoped to the current assistant/agent's resources.
- Switching assistant/agent clears right-list search and temporary UI state.
- Switching topic/session within the same assistant/agent does not clear search.
- Search empty state follows the existing ResourceList behavior.
- Resource item context menus are kept.
- Drag sorting and group movement are explicitly disabled in right mode, because
  the right list is fixed time-grouped.
- Clicking a topic/session keeps the panel open.

### Deletion and disappearance

- If deleting/moving/clearing resources causes the current entity to have no
  conversations/works:
  - the entity disappears from the left rail,
  - the right panel closes,
  - the main chat remains in the current entity's blank state.
- If a new topic/session is later created for that blank entity:
  - the entity reappears in the left rail,
  - the right panel remains closed.

## Data flow

Do not add a new DataApi endpoint for filtering topics by assistantId.

The intended data flow is:

1. Lift the topics/sessions data source to the page or chat-instance level.
2. Let the left entity rail and the right ResourceList derive from the same
   shared data source.
3. Filter by assistant/agent in the frontend.
4. Avoid repeated fetches while switching entities.

Notes:

- Sessions may already support agent-scoped querying, but right mode should
  still be designed around shared page-level data so the left and right panes do
  not independently refetch or diverge.
- Topic/session create, delete, rename, clear, and move operations should use
  the existing left-mode mutation/invalidate/update flow.
- After a mutation, refresh/update the shared data source once and rederive both
  sides from it.
- Do not maintain local shadow copies of resources for the left or right panes.
- Assistant/agent metadata supplies display data and operations:
  - name,
  - emoji/avatar,
  - `orderKey`,
  - context-menu actions.
- Topic/session data determines entity visibility.

## Current WIP correction

The following current-branch files represent the wrong direction and should be
removed or heavily reworked:

- `src/renderer/components/chat/resources/variants/AssistantResourceList.tsx`
- `src/renderer/components/chat/resources/variants/AgentResourceList.tsx`
- `src/renderer/components/chat/resources/variants/ResourceEntityList.tsx`

Why:

- They make right mode behave like a left-side v1-style assistant/agent list.
- They do not introduce the agreed separate right ResourceList panel.
- They do not preserve the required split between a compact entity rail and a
  full current-entity resource panel.

The existing changes in `HomePage.tsx` and `AgentPage.tsx` that map right mode
to `AssistantResourceList` / `AgentResourceList` should also be replaced.

Expected direction:

- Left mode keeps using the current left-mode Topics/Sessions behavior.
- Right mode renders the new entity rail on the left.
- Right mode mounts the current-entity ResourceList into the existing rightPanel
  container.
- Shared ResourceList behavior should be factored out only where needed:
  - row interactions,
  - context menus,
  - fixed time grouping,
  - search,
  - header new item,
  - mutation refresh behavior.

## Implementation checks

Implementation verified the exact current code paths for:

- assistant grouped row context menu behavior in left mode,
- agent `AgentItem` context menu behavior,
- assistant/agent reorder APIs and orderKey persistence,
- existing rightPanel width/resize state ownership,
- current ResourceList time-group sorting, especially pinned-item precedence,
- current ResourceList search composition and how to scope it to one entity,
- mutation invalidation/update paths for topic/session operations.
