# Knowledge Data API 设计方案

本文档描述 Knowledge 模块从 Redux/Dexie 迁移到 v2 Data API 架构的完整设计方案。

## 目标

将 Knowledge 数据管理从 v1 架构（Redux + Dexie）迁移到 v2 三层架构（Cache / Preference / DataApi），实现：

1. **统一数据存储** - 元数据从 Redux/Dexie 迁移到 SQLite
2. **类型安全 API** - 使用 DataApi 提供完整类型推断
3. **渐进式迁移** - 向量操作暂时保持 IPC 调用

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
| 向量嵌入                     | LibSQL   | 保持不变                                 |

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
| `chunkSize`                              | `chunkSize`                               | Separate column (not JSON)                    |
| `chunkOverlap`                           | `chunkOverlap`                            | Separate column (not JSON)                    |
| `threshold`                              | `threshold`                               | Separate column (not JSON)                    |
| `documentCount`                          | 移除                                      | 合不再需要                                    |
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
| `processingProgress`                                | **移除**                  | 进度通过 IPC 事件推送，不持久化    |
| —                                                   | ~~`stage`~~               | **移除**：合并到 status            |
| `uniqueId` / `uniqueIds`                            | **移除**                  | 不再需要                           |
| `remark`                                            | **移除**                  | 重构为 url 和 website 的 name 字段 |
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

## Database Schema Design

### knowledge_base table

```typescript
export const knowledgeBaseTable = sqliteTable("knowledge_base", {
  id: uuidPrimaryKey(),
  name: text().notNull(),
  description: text(),

  // Embedding model configuration
  embeddingModelId: text().notNull(),
  embeddingModelMeta: text({ mode: "json" }).$type<EmbeddingModelMeta>(),

  // Rerank model configuration
  rerankModelId: text(),
  rerankModelMeta: text({ mode: "json" }).$type<ModelMeta>(),

  // Preprocessing provider ID
  preprocessProviderId: text(),

  // Configuration (separate columns, not JSON)
  chunkSize: integer(),
  chunkOverlap: integer(),
  threshold: real(),

  ...createUpdateTimestamps,
});
```

### knowledge_item table

```typescript
export const knowledgeItemTable = sqliteTable(
  "knowledge_item",
  {
    id: uuidPrimaryKey(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: "cascade" }),

    // Type: 'file' | 'url' | 'note' | 'sitemap' | 'directory'
    type: text().$type<KnowledgeItemType>().notNull(),

    // Unified data field (Discriminated Union)
    data: text({ mode: "json" }).$type<KnowledgeItemData>().notNull(),

    // Processing status (merged with stage, progress via IPC events)
    status: text().$type<ItemStatus>().default("idle"),
    error: text(),

    ...createUpdateTimestamps,
  },
  (t) => [
    check(
      "knowledge_item_status_check",
      sql`${t.status} IN ('idle', 'pending', 'preprocessing', 'embedding', 'completed', 'failed')`
    ),
    check(
      "knowledge_item_type_check",
      sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`
    ),
  ]
);

// Status type definition
export type ItemStatus =
  | "idle"
  | "pending"
  | "preprocessing"
  | "embedding"
  | "completed"
  | "failed";
```

### KnowledgeItemData 类型定义

使用 Discriminated Union 实现类型安全：

```typescript
// 文件类型
interface FileItemData {
  type: "file";
  file: FileMetadata;
}

// URL 类型
interface UrlItemData {
  type: "url";
  url: string;
  name: string; // 用户自定义名称，如 "API 文档"
}

// 笔记类型 (原 knowledge_note 表的内容合并到这里)
interface NoteItemData {
  type: "note";
  content: string; // 笔记内容
  sourceUrl?: string; // 来源 URL
}

// Sitemap 类型
interface SitemapItemData {
  type: "sitemap";
  url: string;
  name: string; // 用户自定义名称
}

// 目录类型
interface DirectoryItemData {
  type: "directory";
  path: string;
}

// 联合类型
export type KnowledgeItemData =
  | FileItemData
  | UrlItemData
  | NoteItemData
  | SitemapItemData
  | DirectoryItemData;
```
