# Knowledge Data API 设计方案

本文档描述 Knowledge 模块从 Redux/Dexie 迁移到 v2 Data API 架构的完整设计方案。

## 目标

将 Knowledge 数据管理从 v1 架构（Redux + Dexie）迁移到 v2 三层架构（Cache / Preference / DataApi），实现：

1. **统一数据存储** - 元数据从 Redux/Dexie 迁移到 SQLite
2. **类型安全 API** - 使用 DataApi 提供完整类型推断
3. **端点化向量操作** - 向量检索/重建通过 DataApi 统一入口
4. **状态轮询更新** - 处理进度通过轮询 API 获取

## 关键决策与范围

- **不支持 `memory`/`video` 类型**：v2 DataApi 仅覆盖 `file | url | note | sitemap | directory`。
- **向量操作走 DataApi**：检索、重新嵌入、删除等操作通过 DataApi 端点发起。
- **进度不持久化**：进度通过轮询获取；表中只保存 `status` 与 `error`。

## 设计原则

参考 `message` 表的设计模式：

- 使用 `data` JSON 字段存储类型特定的内容（类似 `message.data` 存储 blocks）
- **2 表设计**：`knowledge_base` + `knowledge_item`
- Note 内容直接存储在 `item.data` 中，无需单独的 `knowledge_note` 表

## v1 → v2 存储架构对比

### v1 架构（当前）

| 数据                 | 存储位置          | 说明                                  |
| -------------------- | ----------------- | ------------------------------------- |
| KnowledgeBase 元数据 | Redux store       | `src/renderer/src/store/knowledge.ts` |
| KnowledgeNote 内容   | Dexie (IndexedDB) | `knowledge_notes` 表                  |
| 文件元数据           | Dexie             | `files` 表                            |
| 向量嵌入             | LibSQL            | `{dataPath}/KnowledgeBase/{baseId}`   |

### v2 架构（目标）

| 数据                         | 存储位置 | 说明                                     |
| ---------------------------- | -------- | ---------------------------------------- |
| KnowledgeBase 元数据         | SQLite   | `knowledge_base` 表                      |
| KnowledgeItem (含 Note 内容) | SQLite   | `knowledge_item` 表，`data` 字段存储内容 |
| 向量嵌入                     | LibSQL   | 由 DataApi 端点统一操作                  |

### KnowledgeBase 字段对比

| v1 字段                                  | v2 字段                                   | 变化说明                                      |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| `id`                                     | `id`                                      | 不变                                          |
| `name`                                   | `name`                                    | 不变                                          |
| `description`                            | `description`                             | 不变                                          |
| `model: Model`                           | `embeddingModelId` + `embeddingModelMeta` | 拆分为 ID + 元数据快照                        |
| `rerankModel: Model`                     | `rerankModelId` + `rerankModelMeta`       | 同上                                          |
| `preprocessProvider: { type, provider }` | `preprocessProviderId`                    | 简化为 ID，通过查询 preprocessProvider 表获取 |
| `dimensions`                             | 移除                                      | 可存入 `embeddingModelMeta`                   |
| `chunkSize`                              | `chunkSize`                               | 独立列（非 JSON）                             |
| `chunkOverlap`                           | `chunkOverlap`                            | 独立列（非 JSON）                             |
| `threshold`                              | `threshold`                               | 独立列（非 JSON）                             |
| `documentCount`                          | 移除                                      | 不再需要                                      |
| `items: KnowledgeItem[]`                 | **移除**                                  | 通过外键关联，不内嵌                          |
| `version`                                | **移除**                                  | 不再需要                                      |
| `created_at` / `updated_at`              | `createdAt` / `updatedAt`                 | 命名规范化                                    |

### KnowledgeItem 字段对比

| v1 字段                                             | v2 字段                   | 变化说明                           |
| --------------------------------------------------- | ------------------------- | ---------------------------------- |
| `id`                                                | `id`                      | 使用 `uuidPrimaryKey()`            |
| `baseId?`                                           | `baseId` (必填 + FK)      | 强制关联 + 级联删除                |
| `type`                                              | `type`                    | 不变                               |
| `content: string \| FileMetadata \| FileMetadata[]` | `data: KnowledgeItemData` | 统一为类型安全的 JSON              |
| `processingStatus`                                  | `status`                  | 合并 status 和 stage               |
| `processingProgress`                                | **移除**                  | 进度通过轮询获取，不持久化         |
| —                                                   | ~~`stage`~~               | **移除**：合并到 status            |
| `uniqueId` / `uniqueIds`                            | **移除**                  | 不再需要                           |
| `remark`                                            | **移除**                  | 重构为 url 和 sitemap 的 name 字段 |
| `retryCount`                                        | **移除**                  | 不再需要                           |
| `isPreprocessed`                                    | **移除**                  | 不再需要                           |

### 类型支持对比

| v1 类型     | v2 类型     | 说明 |
| ----------- | ----------- | ---- |
| `file`      | `file`      | ✅   |
| `url`       | `url`       | ✅   |
| `note`      | `note`      | ✅   |
| `sitemap`   | `sitemap`   | ✅   |
| `directory` | `directory` | ✅   |
| `memory`    | **移除**    | ❌   |
| `video`     | **移除**    | ❌   |

## Database Schema Design

### knowledge_base table

```typescript
export const knowledgeBaseTable = sqliteTable('knowledge_base', {
  id: uuidPrimaryKey(),
  name: text().notNull(),
  description: text(),

  // Embedding model configuration
  embeddingModelId: text().notNull(),
  embeddingModelMeta: text({ mode: 'json' }).$type<EmbeddingModelMeta>(),

  // Rerank model configuration
  rerankModelId: text(),
  rerankModelMeta: text({ mode: 'json' }).$type<ModelMeta>(),

  // Preprocessing provider ID
  preprocessProviderId: text(),

  // Configuration (separate columns, not JSON)
  chunkSize: integer(),
  chunkOverlap: integer(),
  threshold: real(),

  ...createUpdateTimestamps
})
```

### knowledge_item table

```typescript
export const knowledgeItemTable = sqliteTable(
  'knowledge_item',
  {
    id: uuidPrimaryKey(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),

    // Type: 'file' | 'url' | 'note' | 'sitemap' | 'directory'
    type: text().$type<KnowledgeItemType>().notNull(),

    // Unified data field (Discriminated Union)
    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    // Processing status (progress via subscription events)
    status: text().$type<ItemStatus>().default('idle'),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    check(
      'knowledge_item_status_check',
      sql`${t.status} IN ('idle', 'pending', 'preprocessing', 'embedding', 'completed', 'failed')`
    ),
    check('knowledge_item_type_check', sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`)
  ]
)
```

### KnowledgeItemData 类型定义

使用 Discriminated Union 实现类型安全：

```typescript
// 文件类型
interface FileItemData {
  type: 'file'
  file: FileMetadata
}

// URL 类型
interface UrlItemData {
  type: 'url'
  url: string
  name: string // 用户自定义名称，如 "API 文档"
}

// 笔记类型
interface NoteItemData {
  type: 'note'
  content: string // 笔记内容
  sourceUrl?: string // 来源 URL
}

// Sitemap 类型
interface SitemapItemData {
  type: 'sitemap'
  url: string
  name: string // 用户自定义名称
}

// 目录类型
interface DirectoryItemData {
  type: 'directory'
  path: string
}

// 联合类型
export type KnowledgeItemData =
  | FileItemData
  | UrlItemData
  | NoteItemData
  | SitemapItemData
  | DirectoryItemData
```

## Data API 设计

### 资源模型

- **KnowledgeBase**：知识库元数据（模型、分块参数、预处理配置）
- **KnowledgeItem**：知识项记录（内容数据、处理状态）
- **Vector Operations**：搜索/重建/删除向量的操作入口

### 端点清单（核心）

| Path | Method | 说明 |
| ---- | ------ | ---- |
| `/knowledge-bases` | GET | 分页查询知识库列表 |
| `/knowledge-bases` | POST | 创建知识库 |
| `/knowledge-bases/:id` | GET | 获取知识库详情 |
| `/knowledge-bases/:id` | PATCH | 更新知识库配置 |
| `/knowledge-bases/:id` | DELETE | 删除知识库（含 items 与向量） |
| `/knowledge-bases/:id/items` | GET | 分页查询指定知识库的 items |
| `/knowledge-bases/:id/items` | POST | 创建 items（支持单个或批量，进入队列） |
| `/knowledges/:id` | GET | 获取单个 item |
| `/knowledges/:id` | PATCH | 更新 item 数据（如 note 内容） |
| `/knowledges/:id` | DELETE | 删除 item（含向量） |
| `/knowledges/:id/refresh` | POST | 重新处理（预处理 + 嵌入） |
| `/knowledges/:id/cancel` | POST | 取消队列中的处理任务 |
| `/knowledge-bases/:id/search` | POST | 向量/混合检索 |

### 端点清单（可选）

| Path | Method | 说明 |
| ---- | ------ | ---- |
| `/knowledge-bases/:id/stats` | GET | 返回基础统计（item 计数/状态分布） |
| `/knowledge-queue/status` | GET | 返回队列状态（长度、并发、负载） |

## DTO 与 Schema 草案

> 新增 `packages/shared/data/api/schemas/knowledge.ts`，并在 `schemas/index.ts` 中注册。

```typescript
import type {
  OffsetPaginationParams,
  OffsetPaginationResponse,
  SearchParams,
  SortParams
} from '@shared/data/api'
import type {
  EmbeddingModelMeta,
  ItemStatus,
  KnowledgeItemData,
  KnowledgeItemType
} from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'

export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  embeddingModelId: string
  embeddingModelMeta?: EmbeddingModelMeta
  rerankModelId?: string
  rerankModelMeta?: ModelMeta
  preprocessProviderId?: string
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeItem {
  id: string
  baseId: string
  type: KnowledgeItemType
  data: KnowledgeItemData
  status: ItemStatus
  error?: string
  createdAt: string
  updatedAt: string
}

export interface CreateKnowledgeBaseDto {
  name: string
  description?: string
  embeddingModelId: string
  embeddingModelMeta?: EmbeddingModelMeta
  rerankModelId?: string
  rerankModelMeta?: ModelMeta
  preprocessProviderId?: string
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
}

export interface UpdateKnowledgeBaseDto extends Partial<CreateKnowledgeBaseDto> {}

export interface CreateKnowledgeItemDto {
  type: KnowledgeItemType
  data: KnowledgeItemData
}

export interface UpdateKnowledgeItemDto {
  data?: KnowledgeItemData
  status?: ItemStatus // 仅供服务端内部状态更新
  error?: string | null
}

export interface CreateKnowledgeItemsDto {
  items: CreateKnowledgeItemDto[]
}

export interface KnowledgeSearchRequest {
  search: string
  mode?: 'default' | 'vector' | 'bm25' | 'hybrid'
  alpha?: number
  limit?: number
  rerank?: boolean
  filters?: {
    type?: KnowledgeItemType[]
    status?: ItemStatus[]
    createdAfter?: string
    createdBefore?: string
  }
}

export interface KnowledgeSearchResult {
  pageContent: string
  score: number
  metadata?: Record<string, unknown>
  itemId?: string
  chunkId?: string
}

export interface KnowledgeSchemas {
  '/knowledge-bases': {
    GET: {
      query?: OffsetPaginationParams & SortParams & SearchParams
      response: OffsetPaginationResponse<KnowledgeBase>
    }
    POST: {
      body: CreateKnowledgeBaseDto
      response: KnowledgeBase
    }
  }
  '/knowledge-bases/:id': {
    GET: {
      params: { id: string }
      response: KnowledgeBase
    }
    PATCH: {
      params: { id: string }
      body: UpdateKnowledgeBaseDto
      response: KnowledgeBase
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }
  '/knowledge-bases/:id/items': {
    GET: {
      params: { id: string }
      query?: OffsetPaginationParams &
        SortParams & {
          type?: KnowledgeItemType
          status?: ItemStatus
          search?: string
        }
      response: OffsetPaginationResponse<KnowledgeItem>
    }
    POST: {
      params: { id: string }
      body: CreateKnowledgeItemsDto
      response: { items: KnowledgeItem[] }
    }
  }
  '/knowledges/:id': {
    GET: {
      params: { id: string }
      response: KnowledgeItem
    }
    PATCH: {
      params: { id: string }
      body: UpdateKnowledgeItemDto
      response: KnowledgeItem
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }
  '/knowledges/:id/refresh': {
    POST: {
      params: { id: string }
      response: KnowledgeItem
    }
  }
  '/knowledges/:id/cancel': {
    POST: {
      params: { id: string }
      response: { status: 'cancelled' | 'ignored' }
    }
  }
  '/knowledge-bases/:id/search': {
    POST: {
      params: { id: string }
      body: KnowledgeSearchRequest
      response: KnowledgeSearchResult[]
    }
  }
}
```

说明：搜索结果的 `itemId/chunkId` 可由向量存储 metadata 推导（例如 `external_id`），若暂未补齐可仅依赖 `pageContent` + `metadata` 保持兼容。

## 状态更新机制

采用 **轮询机制** 而非订阅推送，原因：

1. **实现简单** - 无需 WebSocket/SSE 基础设施
2. **延迟可接受** - 知识库处理通常需要数秒到数分钟，5 秒轮询延迟对用户感知影响不大
3. **资源可控** - 仅在有活动任务时轮询，无活动任务时停止
4. **可靠性高** - 无需处理断连重连等复杂场景

### 轮询实现（Renderer）

```typescript
// 初始加载
useEffect(() => {
  void syncItemsFromApi()
}, [baseId])

// 有活动任务时轮询
useEffect(() => {
  const hasActiveItems = base?.items.some(
    (item) => item.processingStatus === 'pending' || item.processingStatus === 'processing'
  )

  if (!hasActiveItems) return

  const intervalId = setInterval(() => {
    void syncItemsFromApi()
  }, 5000) // 每 5 秒轮询

  return () => clearInterval(intervalId)
}, [base?.items, baseId])
```

### 状态字段

- `status`: 持久化到数据库（idle | pending | preprocessing | embedding | completed | failed）
- `error`: 持久化到数据库（失败时的错误信息）
- `progress`: **不持久化**，UI 可根据 status 显示简化进度

## 处理状态与队列协作

- **创建/刷新 item**：进入处理队列，初始 `status = pending`
- **处理中**：状态依次更新为 `preprocessing` / `embedding`
- **完成**：`status = completed`
- **失败**：`status = failed` 且写入 `error`
- **进度**：UI 通过轮询 API 获取最新状态

## 错误处理约定

使用 `DataApiErrorFactory` 统一错误：

- `NOT_FOUND`：base/item 不存在
- `VALIDATION_ERROR`：DTO 校验失败（空 name、无 search 等）
- `INVALID_OPERATION`：不允许的状态变更（例如处理中被删除）
- `DATABASE_ERROR`：SQLite 读写失败
- `SERVICE_UNAVAILABLE`：向量服务不可用
- `TIMEOUT`：检索或嵌入超时

## 相关文档

- [Knowledge 数据迁移方案](./knowledge-data-migration.md)
- [Knowledge SDK 设计方案](./knowledge-sdk.md)
- [Knowledge 队列系统设计方案](./knowledge-queue.md)
- [Data System 设计规范](../../../docs/en/references/data/README.md)
