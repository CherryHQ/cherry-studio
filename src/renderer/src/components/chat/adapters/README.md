# Chat Adapters

PR-03 establishes the contract layer used by the next chat UI slices. These adapters are intentionally thin: they project current business entities into stable UI-facing shapes, but they do not fetch data, own cache, read preferences, or replace existing UI components.

Import from the chat package entry unless you are working inside this folder:

```ts
import { ComposerAdapter, MessageListAdapter, ResourceListAdapter } from '@renderer/components/chat'
import { createMessageActionRegistry, createRightPaneRegistry } from '@renderer/components/chat'
```

## Resource List

Use `ResourceListAdapter` before passing topic, session, or agent data into future `ResourceList` components. The output is `ChatResourceItem`, which only contains UI fields such as `id`, `kind`, `title`, `subtitle`, `status`, `pinned`, `active`, `disabled`, and optional `meta`.

```ts
const item = ResourceListAdapter.fromTopic(topic, {
  active: topic.id === activeTopicId,
  pinned: topic.pinned,
  status: isStreaming ? 'streaming' : undefined
})
```

Callers still own active state, pin state, streaming state, and persistence. The adapter should not call DataApi, Cache, Preference, Redux, or service hooks.

## Message List

Use `MessageListAdapter` before passing renderer messages or agent session message rows into future message-list components. The output is `ChatMessageItem`, which exposes render fields only: `id`, `role`, `status`, `createdAt`, `updatedAt`, `modelId`, `parts`, and `blocks`.

```ts
const messages = rendererMessages.map(MessageListAdapter.fromRendererMessage)
const sessionMessages = sessionRows.map(MessageListAdapter.fromAgentSessionMessage)
```

The adapter preserves message parts and legacy block ids. It does not run stream collectors, load history, or mutate message state.

## Composer

Use `ComposerAdapter` to describe the minimum contract a future composer needs: target, draft, send, optional stop, streaming state, disabled state, and capability flags.

```ts
const composer = ComposerAdapter.createChat({
  assistantId,
  topicId,
  draft: { text, attachments },
  streaming: isPending,
  capabilities: { attachments: true, stop: true },
  send: ({ draft }) => sendMessage(draft.text),
  stop: () => stopStreaming()
})
```

The adapter only delegates callbacks. The existing chat/session hooks keep ownership of send, stop, attachments, tool selection, and draft state.

## Right Pane Registry

Use `createRightPaneRegistry()` when a feature needs to register pane descriptors by id. A descriptor contains `id`, `title`, and `render(payload)`.

```ts
const registry = createRightPaneRegistry()

const dispose = registry.register({
  id: 'references',
  title: 'References',
  render: (payload: { messageId: string }) => <ReferencePanel messageId={payload.messageId} />
})

const pane = registry.get<{ messageId: string }>('references')
dispose()
```

Registering the same id replaces the previous descriptor. Disposing an older registration does not remove a newer replacement.

## Message Action Registry

Use `createMessageActionRegistry()` to register message action providers. Providers receive a `MessageActionContext` and return action references. PR-04 will define the full command/action model; this registry is only the minimum extension point.

```ts
const registry = createMessageActionRegistry()

const dispose = registry.register({
  id: 'copy-message',
  resolve: ({ message }) => [{ id: `copy:${message.id}`, label: 'Copy' }]
})

const actions = registry.resolve({ message })
dispose()
```

## Render Stability

Adapters are pure projection helpers, so they do not cause rerenders by themselves. Rerender risk comes from creating fresh arrays, objects, callbacks, or registries on every React render. When these contracts are wired into real UI, keep the projection boundary stable.

Use `useMemo` for list projections:

```tsx
const items = useMemo(
  () => topics.map((topic) => ResourceListAdapter.fromTopic(topic, { active: topic.id === activeTopicId })),
  [topics, activeTopicId]
)
```

Do not map resources inline in JSX:

```tsx
<ResourceList items={topics.map((topic) => ResourceListAdapter.fromTopic(topic))} />
```

For messages, project once at the message-list data boundary. Do not call `MessageListAdapter` inside an item renderer; virtualized lists rely on stable item identity and measurement caches.

For composer contracts, wrap `ComposerAdapter.createChat()` and `ComposerAdapter.createSession()` in `useMemo`, and keep `send` / `stop` callbacks stable with the existing business hook output or `useCallback`.

Create registries at module scope, provider initialization, or in `useRef`. Register providers or pane descriptors from effects, not during render:

```tsx
const registryRef = useRef(createMessageActionRegistry())
```

Keep adapter output small. Do not place raw `topic`, `session`, `agent`, or `message` objects in `meta`; that would re-couple components to private business shapes and make downstream memoization depend on raw object identity.

## Boundaries

- Do not import these adapters into data hooks to create a second source of truth.
- Do not add business reads or writes inside adapters.
- Do not replace `TopicItem`, `SessionItem`, `InputbarTools`, or context menus in PR-03.
- Add tests alongside adapter changes in `__tests__/adapters.test.ts`.
