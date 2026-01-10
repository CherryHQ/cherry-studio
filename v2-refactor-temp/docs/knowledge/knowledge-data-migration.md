# 知识库 V1 → V2 数据迁移方案

本文档描述知识库从 V1 架构迁移到 V2 架构的完整方案。

## 概述

知识库数据迁移分为两个主要部分：

1. **元数据迁移**: 将 Redux/Dexie 中的 knowledge 数据迁移到 SQLite 的 `knowledge_base` 和 `knowledge_item` 表
2. **向量数据迁移**: 将 embedjs 的向量数据迁移为 vectorstores 格式

## 一、元数据迁移 (Redux/Dexie → SQLite)

### 1.1 V1 数据存储位置

| 数据                 | 存储位置          | 说明                                  |
| -------------------- | ----------------- | ------------------------------------- |
| KnowledgeBase 元数据 | Redux store       | `src/renderer/src/store/knowledge.ts` |
| KnowledgeNote 内容   | Dexie (IndexedDB) | `knowledge_notes` 表                  |
| 文件元数据           | Dexie             | `files` 表                            |

### 1.2 V2 数据存储位置

| 数据                         | 存储位置 | 说明                                     |
| ---------------------------- | -------- | ---------------------------------------- |
| KnowledgeBase 元数据         | SQLite   | `knowledge_base` 表                      |
| KnowledgeItem (含 Note 内容) | SQLite   | `knowledge_item` 表，`data` 字段存储内容 |

### 1.3 KnowledgeBase 字段映射

| V1 字段                                  | V2 字段                                   | 变化说明                                      |
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

### 1.4 KnowledgeItem 字段映射

| V1 字段                                             | V2 字段                   | 变化说明                        |
| --------------------------------------------------- | ------------------------- | ------------------------------- |
| `id`                                                | `id`                      | 使用 `uuidPrimaryKey()`         |
| `baseId?`                                           | `baseId` (必填 + FK)      | 强制关联 + 级联删除             |
| `type`                                              | `type`                    | 不变                            |
| `content: string \| FileMetadata \| FileMetadata[]` | `data: KnowledgeItemData` | 统一为类型安全的 JSON           |
| `processingStatus`                                  | `status`                  | 合并 status 和 stage            |
| `processingProgress`                                | **移除**                  | 进度通过轮询获取，不持久化      |
| `uniqueId` / `uniqueIds`                            | **移除**                  | 不再需要                        |
| `remark`                                            | **移除**                  | 重构为 url/sitemap 的 name 字段 |
| `retryCount`                                        | **移除**                  | 不再需要                        |
| `isPreprocessed`                                    | **移除**                  | 不再需要                        |

### 1.5 KnowledgeItemData 类型转换

V1 的 `content` 字段根据 `type` 存储不同类型的数据，V2 使用 Discriminated Union 实现类型安全：

```typescript
// V1: content 字段类型不明确
content: string | FileMetadata | FileMetadata[]

// V2: data 字段使用 Discriminated Union
type KnowledgeItemData =
  | { type: 'file'; file: FileMetadata }
  | { type: 'url'; url: string; name: string }
  | { type: 'note'; content: string; sourceUrl?: string }
  | { type: 'sitemap'; url: string; name: string }
  | { type: 'directory'; path: string }
```

### 1.6 元数据迁移流程

```
1. 读取 Redux store 中的 knowledge.bases 数组
2. 对于每个 KnowledgeBase:
   a. 转换字段格式，写入 knowledge_base 表
   b. 遍历 base.items，转换并写入 knowledge_item 表
3. 对于 note 类型的 item:
   a. 从 Dexie knowledge_notes 表读取完整内容
   b. 合并到 knowledge_item.data 字段
4. 验证迁移数据完整性
5. 标记迁移完成
```

### 1.7 元数据迁移实现

**相关文件**:

- `src/main/data/migration/v2/migrators/KnowledgeMigrator.ts` - 迁移器实现（待完成）

**迁移器需要处理的数据源**:

- Redux knowledge slice (`knowledge.bases` 元数据)
- Dexie `knowledge_notes` 表（笔记内容）
- Dexie `files` 表（文件引用）

**目标表**:

- `knowledge_base`
- `knowledge_item`

---

## 二、向量数据迁移 (embedjs → vectorstores)

详细设计参考 [Knowledge SDK 设计方案](./knowledge-sdk.md)

### 2.1 数据结构对比

#### embedjs (V1 当前格式)

```sql
-- vectors 表
CREATE TABLE vectors (
    id              TEXT PRIMARY KEY,        -- {loaderUniqueId}-{incrementId}
    pageContent     TEXT UNIQUE,
    uniqueLoaderId  TEXT NOT NULL,
    source          TEXT NOT NULL,
    vector          F32_BLOB(dimensions),
    metadata        TEXT                     -- JSON
);

-- loaders 表
CREATE TABLE loaders (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    chunksProcessed INTEGER,
    metadata        TEXT
);
```

#### vectorstores (V2 目标格式)

```sql
CREATE TABLE libsql_vectorstores_embedding (
  id TEXT PRIMARY KEY,
  external_id TEXT,              -- 对应 Redux item.id
  collection TEXT,               -- 使用空字符串
  document TEXT,                 -- 文本内容
  metadata JSON DEFAULT '{}',
  embeddings F32_BLOB(dimensions)
);

-- 索引
CREATE INDEX idx_..._external_id ON ... (external_id);
CREATE INDEX idx_..._collection ON ... (collection);
CREATE INDEX idx_..._vector ON ... (libsql_vector_idx(embeddings, 'metric=cosine'));

-- FTS5 全文搜索表
CREATE VIRTUAL TABLE ..._fts USING fts5(id, document, content='...', content_rowid='rowid');
```

### 2.2 字段映射关系

| embedjs.vectors     | vectorstores  | 数据来源                  |
| ------------------- | ------------- | ------------------------- |
| `id`                | `id`          | chunk 唯一 ID，直接复用   |
| `uniqueLoaderId`    | -             | 用于查找对应的 Redux item |
| -                   | `external_id` | Redux 中的 `item.id`      |
| `pageContent`       | `document`    | 文本内容                  |
| `vector`            | `embeddings`  | F32_BLOB 向量             |
| `source`+`metadata` | `metadata`    | 合并元数据                |
| -                   | `collection`  | 空字符串                  |

### 2.3 数据关系映射

```
Redux KnowledgeItem:
  item.id          → vectorstores.external_id (用于删除 item 的所有 chunks)
  item.uniqueId    → embedjs.vectors.uniqueLoaderId (迁移时查找映射)
  item.uniqueIds[] → embedjs.vectors.uniqueLoaderId (一个 item 可能有多个 loader)
```

### 2.4 向量数据迁移流程

```
1. 前端调用 - 传递整个 base 对象到 main 进程
2. 建立映射 - 从 base.items 构建 uniqueLoaderId → item.id 映射
3. 读取 embedjs - 查询 vectors 和 loaders 表
4. 推断维度 - 从第一条向量获取实际维度
5. 转换写入 - 批量插入 vectorstores（每批 100 条）
6. 备份原库 - 重命名为 .bak
```

### 2.5 向量数据迁移实现

**相关文件**:

- `src/main/services/KnowledgeServiceV2.ts` - 迁移服务实现

**关键方法**:

```typescript
// 迁移入口
public async migrate(base: KnowledgeBase): Promise<MigrationResult>

// 构建 uniqueLoaderId → item.id 映射
private buildLoaderIdToItemIdMap(items: KnowledgeItem[]): Map<string, string>

// 从向量数据推断维度
private inferDimensions(db: Database): number

// 读取 embedjs 数据库中的所有向量
private readEmbedjsVectors(db: Database): EmbedjsVector[]

// 检查是否为 embedjs 格式
private isEmbedjsDatabase(db: Database): boolean

// 备份原数据库
private backupDatabase(dbPath: string): void
```

### 2.6 关键设计决策

- **备份策略**: 迁移成功后将原数据库重命名为 `.bak`
- **迁移范围**: 支持逐个知识库迁移
- **collection**: 使用空字符串（每个知识库独立数据库文件）
- **external_id**: 使用 Redux `item.id`，便于按 item 删除所有 chunks
- **dimensions**: 从现有向量数据推断，读取第一条向量获取实际长度
- **后续优化**: 可考虑将 `item.id` 与 `file.id` 统一，减少映射/传参成本

---

## 三、迁移架构设计

向量数据迁移在 `src/renderer/src/windows/migrationV2/` 中实现，作为独立的迁移阶段。

### 3.1 迁移阶段设计

迁移窗口的完整阶段流程：

```
┌─────────────────────────────────────────────────────────────────┐
│                    MigrationV2 Window                           │
├─────────────────────────────────────────────────────────────────┤
│  Stage 1: introduction        - 介绍迁移内容                     │
│  Stage 2: backup              - 备份确认                         │
│  Stage 3: migration           - 元数据迁移 (Redux/Dexie → SQLite)│
│  Stage 4: vector_migration    - 向量数据迁移 (embedjs → vectorstores) ← 新增 │
│  Stage 5: completed           - 迁移完成                         │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 向量迁移阶段详细设计

#### 3.2.1 阶段状态

```typescript
// 扩展 MigrationStage 类型
type MigrationStage =
  | "introduction"
  | "backup_required"
  | "backup_progress"
  | "backup_confirmed"
  | "migration" // 元数据迁移
  | "migration_completed"
  | "vector_migration" // 向量数据迁移 (新增)
  | "vector_migration_completed" // (新增)
  | "completed"
  | "error";
```

#### 3.2.2 数据流

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Renderer Process                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ MigrationApp.tsx                                                     │ │
│  │                                                                      │ │
│  │  1. ReduxExporter 导出 knowledge.bases (含 items)                    │ │
│  │  2. 元数据迁移完成后，进入 vector_migration 阶段                      │ │
│  │  3. 遍历每个 base，调用 IPC 触发向量迁移                              │ │
│  │  4. 监听进度事件，更新 UI                                            │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                              │                                            │
│                              │ IPC                                        │
│                              ▼                                            │
├──────────────────────────────────────────────────────────────────────────┤
│                          Main Process                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ KnowledgeServiceV2.migrate(base)                                     │ │
│  │                                                                      │ │
│  │  1. 构建 uniqueLoaderId → item.id 映射                               │ │
│  │  2. 读取 embedjs 数据库                                              │ │
│  │  3. 转换并写入 vectorstores                                          │ │
│  │  4. 备份原数据库                                                     │ │
│  │  5. 发送进度事件                                                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

#### 3.2.3 IPC 通道设计

```typescript
// 新增 IPC 通道
export const KnowledgeMigrationIpcChannels = {
  // 触发单个知识库的向量迁移
  MigrateVectors: "knowledge:migrate-vectors",

  // 向量迁移进度事件
  VectorMigrationProgress: "knowledge:vector-migration-progress",

  // 检查知识库是否需要向量迁移
  CheckVectorMigrationNeeded: "knowledge:check-vector-migration-needed",
} as const;

// 进度事件类型
interface VectorMigrationProgress {
  baseId: string;
  baseName: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number; // 0-100
  totalChunks: number;
  migratedChunks: number;
  error?: string;
}
```

#### 3.2.4 迁移流程实现

```typescript
// MigrationApp.tsx 中的向量迁移处理
const handleVectorMigration = async (bases: KnowledgeBase[]) => {
  // 过滤需要迁移的知识库
  const basesToMigrate = await filterBasesNeedingMigration(bases);

  if (basesToMigrate.length === 0) {
    // 无需迁移，直接进入完成阶段
    actions.proceedToCompleted();
    return;
  }

  // 逐个迁移知识库
  for (const base of basesToMigrate) {
    try {
      await window.electron.ipcRenderer.invoke(
        KnowledgeMigrationIpcChannels.MigrateVectors,
        base // 传递完整的 base 对象（含 items）
      );
    } catch (error) {
      logger.error("Vector migration failed", { baseId: base.id, error });
      // 单个失败不阻断整体流程，记录错误继续
    }
  }
};
```

### 3.3 迁移顺序

1. **元数据迁移** (Stage 3: migration)

   - 将 Redux/Dexie 中的 knowledge 数据迁移到 SQLite
   - 此阶段需要保留原始 `base.items` 数据用于后续向量迁移

2. **向量数据迁移** (Stage 4: vector_migration)
   - 依赖元数据迁移阶段导出的 `bases` 数据
   - 使用 `base.items` 中的 `uniqueId/uniqueIds` 建立映射
   - 逐个知识库迁移，支持进度显示

### 3.4 错误处理

- **单个知识库失败不阻断整体流程** - 记录错误，继续迁移其他知识库
- **支持重试** - 失败的知识库可以单独重试
- **保留原数据** - 迁移失败时原 embedjs 数据库不受影响
- **详细日志** - 记录每个知识库的迁移状态和错误信息

---

## 四、验证与回滚

### 4.1 迁移验证

1. **数据完整性检查**

   - 验证 knowledge_base 记录数量
   - 验证 knowledge_item 记录数量
   - 验证向量数据记录数量

2. **功能验证**
   - 知识库列表正常显示
   - 知识项正常显示
   - 向量搜索功能正常

### 4.2 回滚策略

- **元数据回滚**: 删除 SQLite 中的迁移数据，恢复使用 Redux/Dexie
- **向量数据回滚**: 将 `.bak` 文件重命名回原文件名

---

## 五、相关文档

- [Knowledge Data API 设计方案](./knowledge-data-api.md) - 元数据迁移详细设计
- [Knowledge SDK 设计方案](./knowledge-sdk.md) - 向量数据迁移详细设计
- [Knowledge 队列系统设计方案](./knowledge-queue.md) - 队列架构重构
- [知识库 V2 总体设计](./knowledge-v2.md) - V2 知识库愿景
- [Data System 设计规范](../../../docs/en/references/data/README.md) - 数据系统设计规范
