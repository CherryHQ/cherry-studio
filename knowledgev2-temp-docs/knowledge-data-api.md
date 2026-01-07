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
| `chunkSize`                              | → `config.chunkSize`                      | 合并到 config                                 |
| `chunkOverlap`                           | → `config.chunkOverlap`                   | 合并到 config                                 |
| `threshold`                              | → `config.similarityThreshold`            | 合并到 config                                 |
| `documentCount`                          | 移除                                      | 合不再需要                                    |
| `items: KnowledgeItem[]`                 | **移除**                                  | 通过外键关联，不内嵌                          |
| `version`                                | **移除**                                  | 不再需要                                      |
| `created_at` / `updated_at`              | `createdAt` / `updatedAt`                 | 命名规范化                                    |

### KnowledgeItem 字段对比

| v1 字段                                             | v2 字段                   | 变化说明                           |
| --------------------------------------------------- | ------------------------- | ---------------------------------- |
| `id`                                                | `id`                      | 改用 `uuidPrimaryKeyOrdered()`     |
| `baseId?`                                           | `baseId` (必填 + FK)      | 强制关联 + 级联删除                |
| `type`                                              | `type`                    | 不变                               |
| `content: string \| FileMetadata \| FileMetadata[]` | `data: KnowledgeItemData` | 统一为类型安全的 JSON              |
| `processingStatus`                                  | `status`                  |                                    |
| `processingProgress`                                | `progress`                |                                    |
| `processingError`                                   | `error`                   |                                    |
| —                                                   | `stage`                   | **新增**：处理阶段                 |
| `uniqueId` / `uniqueIds`                            | **移除**                  | 不再需要                           |
| `remark`                                            | **移除**                  | 重构为 url 和 website 的 name 字段 |
| `retryCount`                                        | **移除**                  | 不再需要理                         |
| `isPreprocessed`                                    | **移除**                  | 不再需要                           |

### 类型支持对比

| v1 类型     | v2 类型     | 说明 |
| ----------- | ----------- | ---- |
| `file`      | `file`      | ✅   |
| `url`       | `url`       | ✅   |
| `note`      | `note`      | ✅   |
| `sitemap`   | `sitemap`   | ✅   |
| `directory` | `directory` | ✅   |

## 数据库 Schema 设计

### knowledge_base 表

```typescript
export const knowledgeBaseTable = sqliteTable(
  "knowledge_base",
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    description: text(),

    // 嵌入模型配置
    embeddingModelId: text().notNull(), // 嵌入模型 ID
    embeddingModelMeta: text({ mode: "json" }).$type<EmbeddingModelMeta>(), // 嵌入模型元数据

    // 重排模型配置
    rerankModelId: text(), // 重排序模型 ID
    rerankModelMeta: text({ mode: "json" }).$type<ModelMeta>(), // 重排序模型元数据

    preprocessProviderId: text(), // 预处理提供者 ID

    config: text({ mode: "json" }).$type<KnowledgeBaseConfig>(), // 配置(分块，相似度阈值等)

    ...createUpdateTimestamps,
  },
  (t) => [index("knowledge_base_updated_at_idx").on(t.updatedAt)]
);
```

### knowledge_item 表

```typescript
export const knowledgeItemTable = sqliteTable(
  "knowledge_item",
  {
    id: uuidPrimaryKeyOrdered(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: "cascade" }),

    // 类型
    type: text().$type<KnowledgeItemType>().notNull(), // 'file' | 'url' | 'note' | 'sitemap' | 'directory'

    // 统一的 data 字段
    data: text({ mode: "json" }).$type<KnowledgeItemData>().notNull(),

    // 处理状态 (混合方案：顶层状态可索引 + 阶段详情)
    status: text().$type<ItemStatus>().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
    stage: text().$type<ProcessingStage>(), // 'preprocessing' | 'embedding' | null
    progress: integer(), // 0-100, null when idle
    error: text(), // 错误信息

    ...createUpdateTimestamps,
  },
  (t) => [
    index("knowledge_item_base_id_idx").on(t.baseId),
    index("knowledge_item_status_idx").on(t.status),
    index("knowledge_item_base_updated_idx").on(t.baseId, t.updatedAt),
    check(
      "knowledge_item_status_check",
      sql`${t.status} IN ('idle', 'pending', 'processing', 'completed', 'failed')`
    ),
    check(
      "knowledge_item_type_check",
      sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`
    ),
  ]
);

// 状态类型定义
export type ItemStatus =
  | "idle"
  | "pending"
  | "processing"
  | "completed"
  | "failed";
export type ProcessingStage = "preprocessing" | "embedding";
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
