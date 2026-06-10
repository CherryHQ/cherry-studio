# Chat Adapters

This directory contains the contract layer used by shared chat UI slices. These adapters are intentionally thin: they project current business entities into stable UI-facing shapes, but they do not fetch data, own cache, read preferences, or replace existing UI components.

Import from the chat package entry unless you are working inside this folder:

```ts
import { ComposerAdapter, ResourceListAdapter } from '@renderer/components/chat'
```

## Resource List

Use `ResourceListAdapter` before passing topic or session data into future `ResourceList` components. The output is `ChatResourceItem`, which only contains UI fields such as `id`, `kind`, `title`, `subtitle`, `status`, `pinned`, `active`, `disabled`, and optional `meta`.

```ts
const item = ResourceListAdapter.fromTopic(topic, {
  active: topic.id === activeTopicId,
  pinned: topic.pinned,
  status: isStreaming ? 'streaming' : undefined
})
```

Callers still own active state, pin state, streaming state, and persistence. The adapter should not call DataApi, Cache, Preference, Redux, or service hooks.

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

For messages, use the `MessageListItem` contract from `components/chat/messages`. Project once at the message-list data boundary; virtualized lists rely on stable item identity and measurement caches.

For composer contracts, wrap `ComposerAdapter.createChat()` and `ComposerAdapter.createSession()` in `useMemo`, and keep `send` / `stop` callbacks stable with the existing business hook output or `useCallback`.

Keep adapter output small. Do not place raw `topic`, `session`, or `message` objects in `meta`; that would re-couple components to private business shapes and make downstream memoization depend on raw object identity.

## Boundaries

- Do not import these adapters into data hooks to create a second source of truth.
- Do not add business reads or writes inside adapters.
- Do not replace `TopicItem`, `SessionItem`, `InputbarTools`, or context menus in this adapter layer.
- Add tests alongside adapter changes in `__tests__/adapters.test.ts`.
