# Message Components Design Rules

This directory contains the shared message display component family for Home, Agents, History, Quick Assistant, and other chat-like surfaces.

The goal is one reusable message UI implementation with page-specific data and capabilities injected through adapters and providers.

## Scope

This directory owns message display only:

- message list orchestration
- virtual scrolling and scroll anchors
- message grouping and multi-message layout
- message frame, header, content, footer, and actions
- message block rendering
- tool call rendering
- markdown rendering used by messages
- message-list provider contracts

This directory must not own page shell concerns:

- input/composer UI
- top navigation
- left resource lists
- right panes
- settings panels
- Home topic tabs
- Agent session sidebars

Page-only UI should stay in the page directory. If a component is only a Home or Agent adapter, keep it in `adapters/` or move it back to the page side.

## Directory Layout

- `MessageList.tsx` and `MessageListProvider.tsx`: public list entry and context provider.
- `types.ts`: stable contract for `state / actions / meta`.
- `list/`: list behavior such as grouping, virtual list, anchors, selection, sibling navigation.
- `frame/`: message skeleton such as frame, header, content, editor, footer actions, tokens, attachments.
- `blocks/`: message parts and content blocks.
- `tools/`: tool call rendering, split by source or capability.
- `markdown/`: markdown renderer and markdown-only support components/plugins.
- `stream/`: message stream collectors and stream-specific plumbing.
- `layout/`: message-list local layout helpers.
- `adapters/`: thin provider-value assembly for page variants when keeping them near the message contract is useful.

Directory names stay lowercase. React component files stay PascalCase.

## Provider Contract

Complex UI must consume `MessageListProviderValue` rather than directly reaching into page state.

Use the standard shape:

```ts
type MessageListProviderValue = {
  state: MessageListState
  actions: MessageListActions
  meta: MessageListMeta
}
```

- `state`: renderable data and UI configuration, such as messages, topic, loading state, list key, navigation mode, sizing.
- `actions`: executable capabilities, such as loading older messages, selecting an active branch, deleting a message group, or regenerating a message.
- `meta`: environment and non-command display metadata, such as assistant profile or export filename.

Shared UI components should treat missing actions as unavailable capabilities. Do not add `isAgent`, `isHome`, `mode`, or other page-mode booleans to shared components.

## Adapter Rules

Adapters are the boundary between page/business data and this component family.

Adapters may:

- call page or data hooks
- map topic/session/agent/message data into `MessageListProviderValue`
- register page-specific actions
- provide display metadata such as agent avatar/name

Adapters must not:

- render a second list implementation
- duplicate message block or tool rendering
- store business data as a second source of truth
- make Agent session messages call Home topic write APIs

Home and Agents may have separate adapters, but both must render the same `MessageList`.

## Action Rules

Message actions should be injected through provider actions or an action registry.

Shared UI should not directly call page-specific hooks such as `useV2Chat` unless that file is explicitly an adapter. If a shared component needs a capability, add it to `MessageListActions` or the message action registry and let the relevant adapter provide it.

Action visibility should be capability-driven:

- if the action exists, render the related affordance
- if the action is absent, hide or disable the affordance

Avoid separate booleans that mirror action availability.

## Variant Rules

Differences between Home and Agents should be expressed through provider values, actions, metadata, and explicit adapter composition.

Do not add page-mode props such as:

- `isAgent`
- `isHome`
- `mode`
- `showPrompt`

If the layout or behavior is truly different, create an explicit variant adapter or component around the shared pieces instead of branching inside the shared core.

## Business Data Boundaries

The message UI may own transient UI state:

- hover and open states
- temporary selection rectangles
- scroll runtime state
- measurement cache
- local expanded/collapsed state when it is purely visual

Business data stays outside:

- topics
- sessions
- agents
- persisted messages
- tool executions
- artifacts
- references

The virtual list must not become a second source of truth for messages.

## Naming Rules

- Do not use `V2` in component names in this directory.
- Use `MessageParts` for parts-based message data.
- Use `MessageMenuBar`, not `MessageMenubar`.
- Use `Message*` for shared message components.
- Use `Agent*` only for agent-specific tool renderers or adapter code.
- Do not use `Chat*` for message-list internals unless the component is outside this shared message family.

## Import Rules

Shared message components should not import from page-private paths such as:

- `@renderer/pages/home/...`
- `@renderer/pages/agents/...`

If a shared component needs UI from a page-private module, extract a smaller shared primitive or inject the capability through an adapter.

Public entry files should export shared contracts and shared UI. Avoid exporting page adapter hooks from public barrels unless there is a deliberate package-level API decision.

## Testing Expectations

For changes in this directory, prefer focused tests around the affected component family:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/__tests__/MessageGroup.test.tsx \
  src/renderer/src/pages/home/__tests__/ChatContent.test.tsx
```

When touching blocks, markdown, stream collectors, or tool renderers, include their local tests as well.

Before handing off implementation work, run:

```bash
npm run typecheck:web
```

Run broader project validation when the change reaches outside the message-list vertical slice.
