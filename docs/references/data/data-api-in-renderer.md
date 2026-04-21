# DataApi in Renderer

This guide covers how to use the DataApi system in React components and the renderer process.

## React Hooks

### useQuery (GET Requests)

Fetch data with automatic caching and revalidation via SWR.

```typescript
import { useQuery } from '@data/hooks/useDataApi'

// Basic usage
const { data, isLoading, error } = useQuery('/topics')

// With query parameters
const { data: messages } = useQuery('/messages', {
  query: { topicId: 'abc123', page: 1, limit: 20 }
})

// With path parameters (inferred from path)
const { data: topic } = useQuery('/topics/abc123')

// Conditional fetching
const { data } = useQuery('/topics', { enabled: !!topicId })

// With refresh callback
const { data, mutate, refetch } = useQuery('/topics')
// Refresh data
refetch() // or await mutate()
```

### useMutation (POST/PUT/PATCH/DELETE)

Perform data modifications with loading states.

```typescript
import { useMutation } from '@data/hooks/useDataApi'

// Create (POST)
const { trigger: createTopic, isLoading } = useMutation('POST', '/topics')
const newTopic = await createTopic({ body: { name: 'New Topic' } })

// Update (PUT - full replacement)
const { trigger: replaceTopic } = useMutation('PUT', '/topics/abc123')
await replaceTopic({ body: { name: 'Updated Name', description: '...' } })

// Partial Update (PATCH)
const { trigger: updateTopic } = useMutation('PATCH', '/topics/abc123')
await updateTopic({ body: { name: 'New Name' } })

// Delete
const { trigger: deleteTopic } = useMutation('DELETE', '/topics/abc123')
await deleteTopic()

// With auto-refresh of other queries
const { trigger } = useMutation('POST', '/topics', {
  refresh: ['/topics'],  // Refresh these keys on success
  onSuccess: (data) => logger.info('Created:', data)
})
```

### useInfiniteQuery (Cursor-based Infinite Scroll)

For infinite scroll UIs with "Load More" pattern.

```typescript
import { useInfiniteQuery } from '@data/hooks/useDataApi'

const { items, isLoading, hasNext, loadNext } = useInfiniteQuery('/messages', {
  query: { topicId: 'abc123' },
  limit: 20
})

// items: all loaded items flattened
// loadNext(): load next page
// hasNext: true if more pages available
```

### usePaginatedQuery (Offset-based Pagination)

For page-by-page navigation with previous/next controls.

```typescript
import { usePaginatedQuery } from '@data/hooks/useDataApi'

const { items, page, total, hasNext, hasPrev, nextPage, prevPage } =
  usePaginatedQuery('/topics', { limit: 10 })

// items: current page items
// page/total: current page number and total count
// nextPage()/prevPage(): navigate between pages
```

### Choosing Pagination Hooks

| Use Case | Hook |
|----------|------|
| Infinite scroll, chat, feeds | `useInfiniteQuery` |
| Page navigation, tables | `usePaginatedQuery` |
| Manual control | `useQuery` |

## Dynamic Paths

Hooks accept either a **concrete path** (id already inlined, e.g. `/providers/abc123`) or a **template path** with `:placeholders` and a separate `params` option.

```typescript
// Concrete path — use when the id is stable in the caller (props, hook arg, etc.)
const { data } = useQuery(`/providers/${providerId}`)
const { data } = useQuery(providerPath(providerId)) // helper producing the same string

// Template path — use when one hook instance operates on different ids over time
// (sidebar list, command palette, URL handler, row-level actions in a loop)
const { data } = useQuery('/providers/:providerId', { params: { providerId } })
const { trigger } = useMutation('DELETE', '/providers/:providerId/api-keys/:keyId', {
  refresh: ({ args }) => [
    `/providers/${args.params.providerId}`,
    `/providers/${args.params.providerId}/api-keys`
  ]
})
await trigger({ params: { providerId, keyId } })
```

Both forms produce **byte-for-byte identical SWR cache keys**, so reading with one form and refreshing with the other stays consistent.

### When to use which

| Scenario | Form |
|---|---|
| `<ProviderSettings providerId={id}>` (stable id from props) | Concrete path |
| Sidebar "Delete any provider" action | Template path |
| Command palette / URL handler operating on arbitrary ids | Template path |
| Row action inside `.map()` — one hook per row | Concrete path |

### Caveat: concurrent trigger on template `useMutation`

`useSWRMutation` keys its `isMutating`/`error` state by path. A single template-path `useMutation` instance therefore **shares loading state across all params**. Triggering different ids concurrently from one hook instance will mix their states:

```typescript
// ❌ BAD: isMutating is shared; the second trigger clobbers the first
const { trigger, isLoading } = useMutation('DELETE', '/providers/:providerId')
await Promise.all([
  trigger({ params: { providerId: 'a' } }),
  trigger({ params: { providerId: 'b' } })
])

// ✅ Better: mount one hook per row with a concrete path
function ProviderRow({ id }) {
  const { trigger, isLoading } = useMutation('DELETE', providerPath(id))
  return <button onClick={() => trigger()} disabled={isLoading}>Delete</button>
}
```

In dev mode, a concurrent trigger with changed params logs a warning.

## Refresh Patterns

`refresh` declares which SWR cache keys to invalidate after a successful mutation. Three forms are supported; pick the most precise one that fits.

### Static paths (exact match)

```typescript
useMutation('POST', '/topics', { refresh: ['/topics'] })
```

Invalidates only `['/topics']`. Use when you know exactly which paths are affected and they don't depend on mutation input or output.

### `/*` suffix (prefix match)

```typescript
// Invalidates /providers, /providers/abc, /providers/abc/api-keys, /providers/abc/api-keys/k1, ...
useMutation('DELETE', '/providers/:providerId', {
  refresh: ({ args }) => ['/providers', `/providers/${args.params.providerId}/*`]
})
```

The trailing slash in the prefix (kept automatically) prevents false positives on siblings like `/providers-archived`.

`/*` is uniquely useful for invalidating **sub-path instances whose ids the mutation doesn't know**, for example `useQuery('/providers/abc/api-keys/keyId-001')` entries subscribed elsewhere in the tree. A function-form enumeration can't name these keys.

### Function form (dynamic keys)

```typescript
// Invalidation keys depend on trigger args
useMutation('DELETE', '/messages/:messageId', {
  refresh: ({ args }) => [`/topics/${args.body.topicId}/tree`]
})

// Invalidation keys depend on server response
useMutation('POST', '/messages', {
  refresh: ({ result }) => [`/topics/${result.topicId}/messages`, `/messages/${result.parentId}`]
})
```

Use when the set of keys is only known at call time (ids from args/result).

### Choosing between forms

| Need | Form |
|---|---|
| Static, known keys | Array |
| Invalidate all sub-paths of a resource | `/*` prefix in array |
| Invalidate keys computed from args / result | Function |
| Both: fan-out + precision | Function returning a mix of exact and `/*` |

### Misuse to avoid

1. **Don't use `/*` as a full-cache reset.** `['/*']` or short prefixes like `['/m*']` throw in dev. Always write a complete path segment.
2. **Don't reach for function form when a static array is enough.** Extra runtime cost and hides intent.
3. **Don't use `/*` against high-cardinality lists** (e.g., `/messages/*`). It revalidates every message-scoped query across all open windows. Use function form with a specific parent id instead (`/topics/${id}/messages`).
4. **Don't mix template paths and helper functions for the same resource in one module.** Cache keys end up identical but code review becomes harder. Pick one form per module.
5. **`refresh` is for DataApi keys only.** Non-SQLite data (Cache, Preference) has its own invalidation mechanisms.

## DataApiService Direct Usage

For non-React code or more control.

```typescript
import { dataApiService } from '@data/DataApiService'

// GET request
const topics = await dataApiService.get('/topics')
const topic = await dataApiService.get('/topics/abc123')
const messages = await dataApiService.get('/topics/abc123/messages', {
  query: { page: 1, limit: 20 }
})

// POST request
const newTopic = await dataApiService.post('/topics', {
  body: { name: 'New Topic' }
})

// PUT request (full replacement)
const updatedTopic = await dataApiService.put('/topics/abc123', {
  body: { name: 'Updated', description: 'Full update' }
})

// PATCH request (partial update)
const patchedTopic = await dataApiService.patch('/topics/abc123', {
  body: { name: 'Just update name' }
})

// DELETE request
await dataApiService.delete('/topics/abc123')
```

## Error Handling

### With Hooks

```typescript
function TopicList() {
  const { data, isLoading, error } = useQuery('/topics')

  if (isLoading) return <Loading />
  if (error) {
    if (error.code === ErrorCode.NOT_FOUND) {
      return <NotFound />
    }
    return <Error message={error.message} />
  }

  return <List items={data} />
}
```

### With Try-Catch

```typescript
import { DataApiError, ErrorCode } from '@shared/data/api'

try {
  await dataApiService.post('/topics', { body: data })
} catch (error) {
  if (error instanceof DataApiError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_ERROR:
        // Handle validation errors
        const fieldErrors = error.details?.fieldErrors
        break
      case ErrorCode.NOT_FOUND:
        // Handle not found
        break
      case ErrorCode.CONFLICT:
        // Handle conflict
        break
      default:
        // Handle other errors
    }
  }
}
```

### Retryable Errors

```typescript
if (error instanceof DataApiError && error.isRetryable) {
  // Safe to retry: SERVICE_UNAVAILABLE, TIMEOUT, etc.
  await retry(operation)
}
```

## Common Patterns

### Create Form

```typescript
function CreateTopicForm() {
  // Use refresh option to auto-refresh /topics after creation
  const { trigger: createTopic, isLoading } = useMutation('POST', '/topics', {
    refresh: ['/topics']
  })

  const handleSubmit = async (data: CreateTopicDto) => {
    try {
      await createTopic({ body: data })
      toast.success('Topic created')
    } catch (error) {
      toast.error('Failed to create topic')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create'}
      </button>
    </form>
  )
}
```

### Optimistic Updates

```typescript
function TopicItem({ topic }: { topic: Topic }) {
  // Use optimisticData for automatic optimistic updates with rollback
  const { trigger: updateTopic } = useMutation('PATCH', `/topics/${topic.id}`, {
    optimisticData: { ...topic, starred: !topic.starred }
  })

  const handleToggleStar = async () => {
    try {
      await updateTopic({ body: { starred: !topic.starred } })
    } catch (error) {
      // Rollback happens automatically when optimisticData is set
      toast.error('Failed to update')
    }
  }

  return (
    <div>
      <span>{topic.name}</span>
      <button onClick={handleToggleStar}>
        {topic.starred ? '★' : '☆'}
      </button>
    </div>
  )
}
```

### Dependent Queries

```typescript
function MessageList({ topicId }: { topicId: string }) {
  // First query: get topic
  const { data: topic } = useQuery(`/topics/${topicId}`)

  // Second query: depends on first (only runs when topic exists)
  const { data: messages } = useQuery(
    topic ? `/topics/${topicId}/messages` : null
  )

  if (!topic) return <Loading />

  return (
    <div>
      <h1>{topic.name}</h1>
      <MessageList messages={messages} />
    </div>
  )
}
```

### Polling for Updates

```typescript
function LiveTopicList() {
  const { data } = useQuery('/topics', {
    refreshInterval: 5000 // Poll every 5 seconds
  })

  return <List items={data} />
}
```

## Type Safety

The API is fully typed based on schema definitions:

```typescript
// Types are inferred from schema
const { data } = useQuery('/topics')
// data is typed as PaginatedResponse<Topic>

const { trigger } = useMutation('POST', '/topics')
// trigger expects { body: CreateTopicDto }
// returns Topic

// Path parameters are type-checked
const { data: topic } = useQuery('/topics/abc123')
// TypeScript knows this returns Topic
```

## Best Practices

1. **Use hooks for components**: `useQuery` and `useMutation` handle loading/error states
2. **Choose the right pagination hook**: Use `useInfiniteQuery` for infinite scroll, `usePaginatedQuery` for page navigation
3. **Handle loading states**: Always show feedback while data is loading
4. **Handle errors gracefully**: Provide meaningful error messages to users
5. **Revalidate after mutations**: Use `refresh` option to keep the UI in sync
6. **Use conditional fetching**: Set `enabled: false` to skip queries when dependencies aren't ready
7. **Batch related operations**: Consider using transactions for multiple updates
