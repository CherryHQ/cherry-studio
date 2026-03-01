# 知识库迁移：embedjs → vectorstores

> **最后更新**: 2026-01-18

本文档描述知识库从 embedjs libsql 迁移到 vectorstores libsql 的数据结构和流程。

## 数据结构对比

### embedjs (当前)

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

### vectorstores (目标)

```sql
CREATE TABLE libsql_vectorstores_embedding (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  collection TEXT,
  document TEXT,
  metadata JSON DEFAULT '{}',
  embeddings F32_BLOB(dimensions)
);
-- + FTS5 表用于全文搜索
```

## 字段映射

| embedjs.vectors       | vectorstores  | 数据来源                  |
| --------------------- | ------------- | ------------------------- |
| `id`                  | `id`          | chunk 唯一 ID，直接复用   |
| `uniqueLoaderId`      | -             | 用于查找对应的 Redux item |
| -                     | `external_id` | Redux 中的 `item.id`      |
| `pageContent`         | `document`    | 文本内容                  |
| `vector`              | `embeddings`  | F32_BLOB 向量             |
| `source` + `metadata` | `metadata`    | 合并元数据                |
| -                     | `collection`  | 空字符串                  |

## 数据关系

```
Redux KnowledgeItem:
  item.id          → vectorstores.external_id (用于删除 item 的所有 chunks)
  item.uniqueId    → embedjs.vectors.uniqueLoaderId (迁移时查找映射)
  item.uniqueIds[] → embedjs.vectors.uniqueLoaderId (一个 item 可能有多个 loader)
```

## 迁移流程

1. **前端调用** - 传递整个 `base` 对象到 main 进程
2. **建立映射** - 从 `base.items` 构建 `uniqueLoaderId → item.id` 映射
3. **读取 embedjs** - 查询 `vectors` 和 `loaders` 表
4. **转换写入** - 批量插入 vectorstores
5. **备份原库** - 重命名为 `.bak`

## 关键设计决策

- **备份策略**: 迁移成功后将原数据库重命名为 `.bak`
- **迁移范围**: 支持逐个知识库迁移
- **collection**: 使用空字符串（每个知识库独立数据库文件）
- **external_id**: 使用 Redux `item.id`，便于按 item 删除所有 chunks
- **后续优化**: 可考虑将 `item.id` 与 `file.id` 统一，减少映射/传参成本
- **dimensions**: 从现有向量数据推断，读取第一条向量获取实际长度

## 支持的 Reader 类型

- [x] CSVReader
- [x] DocxReader
- [x] HTMLReader
- [x] JSONReader
- [x] MarkdownReader
- [x] PDFReader
- [x] TextFileReader (除了特殊的 reader 以外都是通用的文本文件读取器)
- [x] SitemapReader
- [x] URLReader
- [x] EPUBReader
- [x] DirectoryReader
- [ ] ObsidianReader

> 详细的 Reader 实现见 `src/main/services/knowledge/readers/` 目录。
> Reader 注册模式见 [knowledge-service.md](./knowledge-service.md#6-readerregistry-内容读取器)

## 重要 tips

- 创建知识库时需要先确定嵌入维度，以保证向量数据正确存储
