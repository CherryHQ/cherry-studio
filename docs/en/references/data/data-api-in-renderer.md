# DataApi in Renderer

This guide covers how to use the DataApi system in React components and the renderer process.

## React Hooks

### useQuery (GET Requests)

Fetch data with automatic caching and revalidation via SWR.

```typescript
import { useQuery } from '@data/hooks/useDataApi'

// Basic usage
const { data, loading, error } = useQuery('/topics')

// With query parameters
const { data: messages } = useQuery('/messages', {
  query: { topicId: 'abc123', page: 1, limit: 20 }
})

// With path parameters (inferred from path)
const { data: topic } = useQuery('/topics/abc123')

// Conditional fetching
const { data } = useQuery(topicId ? `/topics/${topicId}` : null)

// With refresh callback
const { data, mutate } = useQuery('/topics')
// Refresh data
await mutate()
```

### useMutation (POST/PUT/PATCH/DELETE)

Perform data modifications with loading states.

```typescript
import { useMutation } from '@data/hooks/useDataApi'

// Create (POST)
const { trigger: createTopic, isMutating } = useMutation('/topics', 'POST')
const newTopic = await createTopic({ body: { name: 'New Topic' } })

// Update (PUT - full replacement)
const { trigger: replaceTopic } = useMutation('/topics/abc123', 'PUT')
await replaceTopic({ body: { name: 'Updated Name', description: '...' } })

// Partial Update (PATCH)
const { trigger: updateTopic } = useMutation('/topics/abc123', 'PATCH')
await updateTopic({ body: { name: 'New Name' } })

// Delete
const { trigger: deleteTopic } = useMutation('/topics/abc123', 'DELETE')
await deleteTopic()
```

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
  const { data, loading, error } = useQuery('/topics')

  if (loading) return <Loading />
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

### List with Pagination

```typescript
function TopicListWithPagination() {
  const [page, setPage] = useState(1)
  const { data, loading } = useQuery('/topics', {
    query: { page, limit: 20 }
  })

  return (
    <>
      <List items={data?.items ?? []} />
      <Pagination
        current={page}
        total={data?.total ?? 0}
        onChange={setPage}
      />
    </>
  )
}
```

### Create Form

```typescript
function CreateTopicForm() {
  const { trigger: createTopic, isMutating } = useMutation('/topics', 'POST')
  const { mutate } = useQuery('/topics') // For revalidation

  const handleSubmit = async (data: CreateTopicDto) => {
    try {
      await createTopic({ body: data })
      await mutate() // Refresh list
      toast.success('Topic created')
    } catch (error) {
      toast.error('Failed to create topic')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button disabled={isMutating}>
        {isMutating ? 'Creating...' : 'Create'}
      </button>
    </form>
  )
}
```

### Optimistic Updates

```typescript
function TopicItem({ topic }: { topic: Topic }) {
  const { trigger: updateTopic } = useMutation(`/topics/${topic.id}`, 'PATCH')
  const { mutate } = useQuery('/topics')

  const handleToggleStar = async () => {
    // Optimistically update the cache
    await mutate(
      current => ({
        ...current,
        items: current.items.map(t =>
          t.id === topic.id ? { ...t, starred: !t.starred } : t
        )
      }),
      { revalidate: false }
    )

    try {
      await updateTopic({ body: { starred: !topic.starred } })
    } catch (error) {
      // Revert on failure
      await mutate()
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

const { trigger } = useMutation('/topics', 'POST')
// trigger expects { body: CreateTopicDto }
// returns Topic

// Path parameters are type-checked
const { data: topic } = useQuery('/topics/abc123')
// TypeScript knows this returns Topic
```

## Best Practices

1. **Use hooks for components**: `useQuery` and `useMutation` handle loading/error states
2. **Handle loading states**: Always show feedback while data is loading
3. **Handle errors gracefully**: Provide meaningful error messages to users
4. **Revalidate after mutations**: Keep the UI in sync with the database
5. **Use conditional fetching**: Pass `null` to skip queries when dependencies aren't ready
6. **Batch related operations**: Consider using transactions for multiple updates
