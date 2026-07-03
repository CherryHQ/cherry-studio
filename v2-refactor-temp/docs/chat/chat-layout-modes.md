# Chat Layout Modes

Home and Agent no longer persist a separate manual `classic` / `modern` layout
preference. The layout is derived from the resource-list display mode.

## Home

- `topic.tab.display_mode = 'assistant'` uses the classic layout:
  assistant rail on the left, chat in the center, topic list in the right pane.
- `topic.tab.display_mode = 'time'` uses the modern single-sidebar layout.

## Agent

- `agent.session.display_mode = 'agent'` uses the classic layout:
  agent rail on the left, chat in the center, session list in the right pane.
- `agent.session.display_mode = 'time'` or `'workdir'` uses the modern
  single-sidebar layout.

## State

- Display mode is stored as Preference data.
- Classic-layout right pane open state is stored per surface in renderer
  persist cache: `ui.chat.right_pane_open` for Home and
  `ui.agent.right_pane_open` for Agent.
- Resource-list collapsed groups are also stored per display mode in renderer
  persist cache.
