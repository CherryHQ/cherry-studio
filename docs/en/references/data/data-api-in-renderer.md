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
  onSuccess: (data) => console.log('Created:', data)
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
