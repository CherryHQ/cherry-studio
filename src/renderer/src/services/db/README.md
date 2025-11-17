# Unified Data Access Layer

This module provides a unified interface for accessing message data from different sources:
- **DexieMessageDataSource**: Local IndexedDB storage for regular chat messages
- **AgentMessageDataSource**: Backend IPC storage for agent session messages

## Architecture

```
dbService (Facade)
    ├── Determines data source based on topicId
    ├── Routes to DexieMessageDataSource (regular chats)
    └── Routes to AgentMessageDataSource (agent sessions)
```

## Usage

```typescript
import { dbService } from '@renderer/services/db'

// Fetch messages (automatically routes to correct source)
const { messages, blocks } = await dbService.fetchMessages(topicId)

// Save a message exchange
await dbService.persistExchange(topicId, {
  user: { message: userMsg, blocks: userBlocks },
  assistant: { message: assistantMsg, blocks: assistantBlocks }
})

// Append a single message
await dbService.appendMessage(topicId, message, blocks)

// Check if topic exists
const exists = await dbService.topicExists(topicId)
```

## Topic ID Convention

- Regular chat topics: Any string ID (e.g., "uuid-1234-5678")
- Agent session topics: Prefixed with "agent-session:" (e.g., "agent-session:session-123")

## Key Features

1. **Transparent Routing**: The facade automatically routes to the appropriate data source
2. **Consistent API**: Same methods work for both regular chats and agent sessions
3. **Type Safety**: Full TypeScript support with proper interfaces
4. **Error Handling**: Comprehensive error logging and propagation
5. **Extensibility**: Easy to add new data sources (e.g., cloud storage)

## Implementation Status

### DexieMessageDataSource ✅
- Full CRUD operations for messages and blocks
- Transaction support
- File cleanup on deletion
- Redux state updates

### AgentMessageDataSource ✅
- Fetch messages from backend
- Persist message exchanges
- Limited update/delete operations (by design)
- IPC communication with backend

## Migration Guide

### Before (Direct DB access):
```typescript
// In thunks
if (isAgentSessionTopicId(topicId)) {
  // Special handling for agent sessions
  const messages = await window.electron.ipcRenderer.invoke(...)
} else {
  // Regular DB access
  const topic = await db.topics.get(topicId)
}
```

### After (Unified access):
```typescript
// In thunks
const { messages, blocks } = await dbService.fetchMessages(topicId)
// No need to check topic type!
```

## Next Steps

Phase 2: Update Redux thunks to use dbService
Phase 3: Update components to use unified hooks
Phase 4: Remove AgentSessionMessages component