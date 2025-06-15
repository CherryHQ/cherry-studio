# Memory Feature Analysis - PR #6454

## Overview

This PR introduces a comprehensive **Memory System** for Cherry Studio that allows AI assistants to store, search, and retrieve contextual information about users to provide more personalized interactions.

## What the Author is Trying to Accomplish

### 1. Core Memory System

- **Personal Memory Storage**: Store facts, preferences, and contextual information about users
- **Intelligent Retrieval**: Search and inject relevant memories into conversations
- **Memory Management**: Add, update, delete, and organize stored memories
- **Multi-Modal Support**: Handle both text-based facts and structured memory items

### 2. User Interface Components

- **Memory Page** (`/memory`): Dedicated interface for viewing and managing stored memories
- **Memory Settings**: Configure memory models, prompts, and dimensions
- **Assistant Integration**: Per-assistant memory enabling/configuration

### 3. Architecture Components

#### Frontend Components

1. **Memory Page** (`src/renderer/src/pages/memory/index.tsx`)

   - Table view of stored memories with filtering and search
   - User management and categorization
   - Feedback system with emoji reactions
   - Settings modal integration

2. **Memory Settings Modal** (`src/renderer/src/pages/memory/settings-modal.tsx`)

   - LLM model configuration for memory processing
   - Embedding model setup for semantic search
   - Custom prompt configuration for fact extraction and memory updates
   - Embedding dimensions configuration

3. **Assistant Memory Settings** (`src/renderer/src/pages/settings/AssistantSettings/AssistantMemorySettings.tsx`)
   - Per-assistant memory enabling toggle
   - Integration into assistant settings flow

#### Backend Services

1. **Memory Service** (`src/renderer/src/services/MemoryService.ts`)

   - Singleton pattern for memory management
   - Methods: `add()`, `search()`, `list()`, `delete()`
   - Returns mock data currently (implementation placeholder)

2. **API Service Integration** (`src/renderer/src/services/ApiService.ts`)
   - Automatic memory search before sending messages
   - Injection of relevant memories into conversation context
   - Integration with LLM completions flow

#### State Management

1. **Memory Redux Store** (`src/renderer/src/store/memory.ts`)

   - Central configuration management
   - Memory config with LLM/embedding models
   - Custom prompts for fact extraction and memory updates

2. **Types and Interfaces** (`src/renderer/src/types/memory.ts`)
   - `MemoryConfig`: Configuration structure
   - `MemoryItem`: Individual memory structure
   - `SearchResult`: Search response format
   - Various options interfaces for operations

#### Memory Processing

1. **Memory Prompts** (`src/renderer/src/utils/memory-prompts.ts`)
   - Sophisticated prompt engineering for fact extraction
   - Memory update logic with ADD/UPDATE/DELETE operations
   - Zod schemas for structured responses
   - Multi-language support

## Key Features

### 1. Fact Extraction

- Automated extraction of personal information from conversations
- Categories: preferences, personal details, plans, health, professional info
- Language detection and preservation
- JSON-structured output validation

### 2. Memory Operations

- **ADD**: Store new facts not present in memory
- **UPDATE**: Modify existing memories with new information
- **DELETE**: Remove outdated or incorrect information
- **SEARCH**: Semantic search through stored memories

### 3. Smart Integration

- Automatic memory search during conversations
- Context injection before LLM processing
- Per-assistant memory controls
- Configurable embedding and LLM models

### 4. User Experience

- Dedicated memory management interface
- Visual feedback system (happy/neutral/sad emotions)
- Filtering and search capabilities
- Settings for model configuration

## Technical Implementation Details

### Memory Storage Structure

```typescript
interface MemoryItem {
  id: string
  memory: string
  hash?: string
  createdAt?: string
  updatedAt?: string
  score?: number
  metadata?: Record<string, any>
}
```

### Configuration Options

```typescript
interface MemoryConfig {
  embedderModel?: Model
  embedderDimensions?: number
  llmModel?: Model
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
}
```

### Navigation Integration

- New sidebar icon (MemoryStick) for memory page
- Route: `/memory`
- Integration with existing sidebar configuration

## Implementation Plan

### Phase 1: Core Backend Infrastructure

#### 1.1 Main Process Memory Service (`src/main/services/MemoryService.ts`)

Based on mem0-ts patterns, implement a robust storage layer using libsql:

```typescript
interface MainMemoryService {
  // Core Operations
  init(): Promise<void>
  add(messages: string | AssistantMessage[], config: AddMemoryOptions): Promise<SearchResult>
  search(query: string, config: SearchMemoryOptions): Promise<SearchResult>
  list(config?: GetAllMemoryOptions): Promise<SearchResult>
  delete(id: string): Promise<void>

  // Advanced Operations
  update(id: string, memory: string, metadata?: Record<string, any>): Promise<void>
  getHistory(memoryId: string): Promise<MemoryHistoryItem[]>
  generateEmbedding(text: string): Promise<number[]>

  // Cleanup and maintenance
  reset(): Promise<void>
  close(): Promise<void>
}
```

**Database Schema (LibSQL):**

```sql
-- Core memories table with native vector support
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    memory TEXT NOT NULL,
    hash TEXT UNIQUE,
    embedding F32_BLOB(1536), -- Native vector column (1536 dimensions for OpenAI embeddings)
    metadata TEXT, -- JSON string
    user_id TEXT,
    agent_id TEXT,
    run_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0
);

-- Memory history for change tracking
CREATE TABLE IF NOT EXISTS memory_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    action TEXT NOT NULL, -- ADD, UPDATE, DELETE
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    FOREIGN KEY (memory_id) REFERENCES memories (id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(hash);
CREATE INDEX IF NOT EXISTS idx_memory_history_memory_id ON memory_history(memory_id);

-- Vector index for similarity search (libsql native)
CREATE INDEX IF NOT EXISTS idx_memories_vector ON memories (libsql_vector_idx(embedding));
```

**Key Implementation Components:**

1. **Vector Storage Manager**

   - Store embeddings using libsql native F32_BLOB vector columns
   - Use libsql native vector_distance_cos() function for cosine similarity
   - Leverage libsql vector_top_k() for efficient nearest neighbor search
   - Cache frequently accessed embeddings in memory

2. **Memory History Manager**

   - Track all changes (ADD/UPDATE/DELETE operations)
   - Implement rollback capabilities
   - Audit trail for memory modifications

3. **Embedding Generator**
   - Interface with configured embedding models
   - Batch processing for multiple memories
   - Caching to avoid redundant API calls

#### 1.2 IPC Communication Layer

**Add to `packages/shared/IpcChannel.ts`:**

```typescript
// Memory channels
Memory_Add = 'memory:add',
Memory_Search = 'memory:search',
Memory_List = 'memory:list',
Memory_Delete = 'memory:delete',
Memory_Update = 'memory:update',
Memory_GetHistory = 'memory:get-history',
Memory_Reset = 'memory:reset',
```

**Add to `src/preload/index.ts`:**

```typescript
memory: {
  add: (messages: string | AssistantMessage[], config: AddMemoryOptions) =>
    ipcRenderer.invoke(IpcChannel.Memory_Add, messages, config),
  search: (query: string, config: SearchMemoryOptions) =>
    ipcRenderer.invoke(IpcChannel.Memory_Search, query, config),
  list: (config?: GetAllMemoryOptions) =>
    ipcRenderer.invoke(IpcChannel.Memory_List, config),
  delete: (id: string) =>
    ipcRenderer.invoke(IpcChannel.Memory_Delete, id),
  update: (id: string, memory: string, metadata?: Record<string, any>) =>
    ipcRenderer.invoke(IpcChannel.Memory_Update, id, memory, metadata),
  getHistory: (memoryId: string) =>
    ipcRenderer.invoke(IpcChannel.Memory_GetHistory, memoryId),
  reset: () =>
    ipcRenderer.invoke(IpcChannel.Memory_Reset)
}
```

#### 1.3 Renderer Service Integration

**Update `src/renderer/src/services/MemoryService.ts`:**

```typescript
class MemoryService {
  private static instance: MemoryService | null = null

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
    }
    return MemoryService.instance
  }

  // Delegate all operations to main process via IPC
  public async add(messages: string | AssistantMessage[], config: AddMemoryOptions): Promise<SearchResult> {
    return window.api.memory.add(messages, config)
  }

  public async search(query: string, config: SearchMemoryOptions): Promise<SearchResult> {
    return window.api.memory.search(query, config)
  }

  public async list(config?: GetAllMemoryOptions): Promise<SearchResult> {
    return window.api.memory.list(config)
  }

  public async delete(id: string): Promise<void> {
    return window.api.memory.delete(id)
  }
}
```

### Phase 2: Vector Search Implementation

#### 2.1 Embedding Integration

- **Model Support**: OpenAI, Cohere, local models via Ollama
- **Batch Processing**: Process multiple texts efficiently
- **Caching Strategy**: Store embeddings to avoid recomputation
- **Dimension Validation**: Ensure consistency with configured dimensions

#### 2.2 Similarity Search

```typescript
interface VectorSearchOptions {
  limit?: number
  threshold?: number // Minimum similarity score
  filters?: SearchFilters
}

class VectorSearch {
  // Use libsql native vector search with vector_top_k
  public async searchByVector(queryEmbedding: number[], options: VectorSearchOptions): Promise<MemoryItem[]>

  // Hybrid search (text + vector) using libsql vector functions
  public async hybridSearch(query: string, options: VectorSearchOptions): Promise<MemoryItem[]>

  // Convert embedding array to libsql vector format
  private embeddingToVector32(embedding: number[]): string
}
```

### Phase 3: Advanced Features

#### 3.1 Memory Processing Pipeline

```typescript
class MemoryProcessor {
  // Extract facts from conversation
  public async extractFacts(messages: AssistantMessage[]): Promise<string[]>

  // Update existing memories with new facts
  public async updateMemories(facts: string[], existing: MemoryItem[]): Promise<MemoryUpdateResult>

  // Deduplicate similar memories
  public async deduplicateMemories(memories: MemoryItem[]): Promise<MemoryItem[]>
}
```

#### 3.2 Memory Categorization

- **Auto-categorization**: Use LLM to classify memories into categories
- **Tag System**: Support custom tags and hierarchical organization
- **Relationship Mapping**: Track connections between memories

#### 3.3 Synchronization Support

- **Export/Import**: JSON format for backup and migration
- **WebDAV Integration**: Sync memories across devices
- **Conflict Resolution**: Handle concurrent updates

### Phase 4: Performance & Optimization

#### 4.1 Caching Strategy

- **Memory LRU Cache**: Keep frequently accessed memories in memory
- **Embedding Cache**: Avoid recomputing embeddings
- **Query Result Cache**: Cache search results for common queries

#### 4.2 Database Optimization

- **Connection Pooling**: Efficient database connection management
- **Batch Operations**: Group related database operations
- **Vacuum/Cleanup**: Regular maintenance tasks

### Implementation Priority

#### High Priority (Core Functionality)

1. ✅ **Main Process Service**: Basic CRUD operations with libsql
2. ✅ **IPC Integration**: Connect renderer to main process
3. ✅ **Vector Storage**: Embedding generation and storage
4. ✅ **Basic Search**: Text-based and vector similarity search

#### Medium Priority (Enhanced Features)

5. **Memory Processing**: Fact extraction and memory updates
6. **History Tracking**: Change audit and rollback capabilities
7. **Categorization**: Auto-tagging and organization
8. **UI Integration**: Real data integration with existing UI

#### Low Priority (Advanced Features)

9. **Synchronization**: Cross-device memory sync
10. **Analytics**: Memory usage insights and statistics
11. **Export/Import**: Backup and migration tools
12. **Performance Optimization**: Advanced caching and indexing

### Technical Dependencies

#### Required Libraries

```bash
# Core dependencies - already available
# @libsql/client - already installed in project
# No additional vector operation libraries needed - libsql has native vector support
```

#### Model Integration

- Leverage existing provider integrations (OpenAI, Anthropic, etc.)
- Extend current model service for embedding generation
- Support for local embedding models via Ollama

### Testing Strategy

#### Unit Tests

- Database operations (CRUD, migrations)
- Vector similarity calculations
- Memory deduplication logic
- IPC communication

#### Integration Tests

- End-to-end memory workflows
- Multi-user memory separation
- Large dataset performance
- UI interaction flows

#### Performance Tests

- Vector search benchmarks
- Database scaling tests
- Memory usage profiling
- Concurrent operation handling

This implementation plan provides a comprehensive roadmap for building a production-ready memory system that integrates seamlessly with Cherry Studio's existing architecture while providing powerful personalization capabilities.
