# Cherry Studio 知识库技术方案

## 1. 范围

当前 v2 的目标：把知识库底层数据形态对齐未来文件夹型设计——每库一个引擎可移植的 `KnowledgeBase/{baseId}/.cherry/index.sqlite`（9 表 material 模型），v2→v2.x 切换时只移动/复用索引。保留全局 `knowledge_base` / `knowledge_item` 两张表；embedding 仍必需（不开放 FTS-only，BM25-only 降级属 v2.x）。

**状态（2026-06-10）**：PR A 已落地——9 表 + `KnowledgeIndexStore` 已建，`search()` 与索引 job 已切新 store，旧单表 `libsql_vectorstores_embedding` 与 `external_id` API、`deleteItemChunk` 全链路已移除（迁移器仍读旧表作来源）。仍待做：PR B（迁移终态 + url/note `.md` 快照 + 冲突保留副本）与 PR C（Agent-first 检索面 + locator/read）。

## 2. 存储布局

```text
KnowledgeBase/{baseId}/
  .cherry/index.sqlite   # 每库隐藏索引库（派生索引，可重建）
  paper.pdf              # 用户上传源文件
  paper.md               # 处理器产物（与源文件相邻）
  captures/{url,note}/   # URL / 笔记 Markdown 快照（PR B）
```

- `.cherry/**` 为保留前缀，不进 `material` 表。
- `material.relative_path` 是 base 目录下真实相对路径；路径安全由主进程 `assertSafeKnowledgeRelativePath` 把关（zod 只做形状校验）。
- 关键身份约定：`knowledge_item.id = material.material_id`（leaf item 直接作为 material id）。

## 3. 数据模型

`knowledge_item.data` 持久化本地 `relativePath` 形态；外部 path / URL / note 内容只是命令输入。file 索引读取路径为 `indexedRelativePath ?? relativePath`。url/note 的 `.md` 快照模型属 PR B（当前 url 仍联网抓取、note 仍 inline content）。

## 4. index.sqlite 表结构（9 张表）

| 表 | 当前用法 | 做什么 |
| --- | --- | --- |
| `index_meta` | 使用 | 索引库的「身份证 + 契约」固定单行：记录此索引属于哪个 base、当前向量 / chunk 是按哪个 embedding 模型·维度·chunker 配置建的；打开时校验 base_id，契约变化触发重建 |
| `material` | 使用 | 每条材料（文件 / URL / 笔记）的稳定身份行：相对路径、状态（active/missing）、来源、索引策略；其余表都按 `material_id` 关联到它 |
| `material_relation` | 只建表 | 材料间的派生关系（如 PDF → 生成的 Markdown）；当前只建表，v2.x 启用 |
| `content` | 使用 | 每份材料规范化后的整份正文，按内容哈希存一份（相同正文跨材料复用）；是 chunk 切片的源文本 |
| `search_unit` | 使用 | 由 `content` 切出的检索单元（chunk），用 `char_start/char_end` 标记它在正文中的位置；`unit_id` 稳定 |
| `content_index_entry` | 只建表 | 可人工编辑 / 校正的索引条目；当前只建表，是 v2.x「越用越准」的增强层 |
| `search_text` | 使用 | 真正进入检索的文本投影：FTS 与 embedding 都从这里取文本，与原始 `content` 解耦 |
| `embedding` | 使用 | 检索文本的向量，按文本哈希存（裸 BLOB）；同一段文字只嵌一次、可被多条 `search_text` 复用 |
| `search_text_fts` | 创建并同步 | `search_text` 的 FTS5 全文索引（trigram）；关键词 / BM25 检索走这条 lane |

数据流：`material`（材料）→ `content`（整份正文）→ `search_unit`（切出的 chunk）→ `search_text`（每个 chunk 实际入索引的文本）→ `embedding`（向量）+ `search_text_fts`（全文索引）两条检索 lane；`index_meta` 锚定这套索引建立时的契约，`material_relation` / `content_index_entry` 为 v2.x 预留。

DDL 在 `indexStore/schema.ts`（per-base 库，不进主 DB drizzle 迁移链）。

### 4.1 index_meta

固定单行。`base_id` 必须等于目录 `{baseId}`——打开时由 `ensureIndexMeta` 校验，不一致拒绝挂载（防误挂另一库的索引）。`embedding_model_id_snapshot` / `dimensions_snapshot` / `chunker_config_hash` 是契约快照；快照比对驱动的选择性重嵌属未来工作（当前改模型/维度走整库 restore）。`schema_version` 是未来 forward-only 演进迁移的版本游标（runner 未实现，开发期改 schema 直接删库重建）。

### 4.2 material

- `status`：`active` / `missing`（不做软删除）。
- `origin`（材料来源）：`user`（上传）/ `processor`（MinerU Markdown 等产物）/ `agent` / `captured`（URL/Note 快照）/ `discovered`（watcher，v2.x）。文件经处理器产物索引（有 `indexedRelativePath`）即 `processor`，直接索引为 `user`；url/note 为 `captured`。
- `index_policy`：`index` / `suppress`（保留但不索引，如已生成 md 的 PDF）/ `ignore`。
- `title` / `mime_type` / `size_bytes` / `mtime_ms` 等描述性字段当前留空——无消费方，待 v2.x 材料扫描器（watcher/scan）落地时统一回填（backfill）。

### 4.3 material_relation

只建表；PDF→Markdown 关系当前由 `knowledge_item.data` 的 `relativePath`/`indexedRelativePath` 表达。

### 4.4 content

`content_hash` 由规范化文本生成，相同内容可被多个 material 复用；chunk 范围由 `search_unit.char_start/char_end` 标记。

### 4.5 search_unit 与稳定 unit_id

```text
unit_id = hash(material_id + content_hash + unit_type + unit_index + char_start + char_end)
```

同一 material/content/chunker 结果重复重建时 `unit_id` 不变。`unit_id` **不包含** `chunker_config_hash`——chunker 契约变化由 `index_meta.chunker_config_hash` 触发全量重建，而不是把配置烤进每个 unit id。

### 4.6 content_index_entry

只建表（v2.x 的越用越准增强层）。

### 4.7 search_text

唯一约束 `(target_type, target_id, kind)`；FTS 与向量都以 `search_text.text` 为入口。`embedding_text_hash` 可被多条 `search_text` 复用，因此 `embedding` 无外键，向量可达性按 `EXISTS` 判断。

### 4.8 embedding

`embedding_text_hash` 为主键；**不存** per-row model/dimensions（改模型/维度必须清空重嵌，不混用旧维度向量）。落盘为中性裸 BLOB（见 §5.6 / 决议 A1）。

### 4.9 search_text_fts

external-content FTS5（trigram）。**FTS 命中必须经 `search_text.rowid = search_text_fts.rowid` 回表**——`search_text_id` 是 TEXT 业务主键，不是 FTS rowid。

## 5. 索引接口与实现要点

### 5.1 KnowledgeIndexStore 接口

```ts
interface KnowledgeIndexStore {
  rebuildMaterial(materialId: string, input: RebuildMaterialInput): Promise<void>
  deleteMaterial(materialId: string): Promise<void>
  listMaterialUnits(materialId: string): Promise<KnowledgeSearchUnit[]>
  listExistingEmbeddingHashes(hashes: string[]): Promise<Set<string>>
  search(input: KnowledgeIndexSearchInput): Promise<KnowledgeIndexSearchResult[]>
  close(): Promise<void>
}
```

兼容映射：`materialId = knowledge_item.id`、`chunkId = search_unit.unit_id`、旧 result `content = search_text.text`、`itemId = material_id`。

### 5.2 rebuildMaterial 原子替换

单写事务内完成：upsert material/content → 删旧 `search_unit`/`search_text` → 插新 → 同步 FTS → 插缺失 embedding → 更新 material 元数据。不能出现旧新 chunk 混合可见。删除旧 `search_text` 后**不能直接删 embedding**（可能被共享），孤儿向量交后续 GC（PR B/C，须在 base mutation lock 内）。

**决议 A4（embedding 复用）**：按「文字指纹（`embedding_text_hash`）+ 模型 + 维度」全等复用已存向量，只 embed 索引中缺失的 hash——重索引未变内容不再花 embedding API 钱。

### 5.3 chunk offset 不变量

```ts
content.text.slice(charStart, charEnd) === bodySearchText.text
```

chunk body 必须是 `content.text` 的逐字 slice（自定义 offset splitter 在切分时保留 offset）；**禁止**事后用 naive `indexOf` 推断 offset（重复段落会错配）。

### 5.4 embedding contract

`knowledge_base.embeddingModelId` / `dimensions` 必需有效；`embedMany` 结果做严格维度校验，拒绝不匹配向量。

### 5.5 embedding / rerank 走 AiService

`utils/indexing/embed.ts` → `AiService.embedMany`、`rerank.ts` → `AiService.rerank`，复用用户在 Chat 侧配置的 provider（`provider::model` UniqueModelId）。不维护本地 ONNX 推理栈；rerank 持久性误配（401/403/404）升级 error log，瞬时错误回退「未重排结果」。

### 5.6 引擎可移植性（libsql ↔ better-sqlite3 + sqlite-vec）

`.cherry/index.sqlite` 在两引擎下共用同一套 schema，**切换零用户迁移**：

1. 关系表全用通用 SQLite DDL；FTS5 两引擎均内置；CJK 处理在应用层。
2. **决议 A1**：向量规范存储 = 普通 `BLOB` 列存 little-endian float32 字节（不用 libsql 专属 `F32_BLOB`），是 source of truth，两引擎直读同一份字节。
3. 首版向量检索 = 在规范 BLOB 上暴力扫描（libsql `vector_distance_cos` / sqlite-vec `vec_distance_cosine`），经 `VectorIndex` 适配接口暴露；**不建** vec0 / ANN 派生索引（留待性能评估后作纯增量加入）。
4. 一层薄 `SqliteDriver` 接口（execute / transaction / close），store 只写一次；libsql 驱动用 per-driver 写互斥 + WAL/busy_timeout PRAGMA 规避 libsql client-ts #288 的 SQLITE_BUSY。

## 6. 检索

`KnowledgeIndexStore.search()` 是两条 lane 的**单一检索入口**：BM25（`search_text_fts`）/ vector（`embedding`）/ hybrid（RRF 融合，rank-based 故无需归一化两种分数）。结果 join `search_unit → material`，过滤 `material.status = active` 且 `index_policy = 'index'`；caller 再过滤 `knowledge_item.status = completed`。无向量库降级（BM25-only）属 v2.x——当前缺 embedding 直接报错。

### 6.1 search 落地与检索调参

`searchMode` / `hybridAlpha` / `documentCount` / `threshold` 当前都是 **base 级配置**（`knowledge_base` 列）；`search()` 从 base 行读取（结果数上限 `documentCount ?? 10`）。

> **决策注（2026-06-10）**：`hybridAlpha` 描述「这个库的语料偏关键词还是语义」，是库的稳定属性，不该让模型每次猜——保留 base 列 + RagConfig 滑块（仅 hybrid 模式可配，`searchMode` 切走时清空）。`threshold` 只对 relevance-scored 命中生效（vector 模式或经 rerank），对 BM25/RRF ranking 分数是 no-op（`utils/search.ts` `applyRelevanceThreshold`）。已调研并决定（飞书调研报告 §4，Q1）但**推迟到后续 PR**：`topK` / `threshold` 改为逐调用旋钮（`KnowledgeSearchOptions`，经 `kb__search` 入参与 REST `top_k` 暴露），`documentCount` 整列随之移除——该重构已实现并从 PR A 剥离暂存（git stash），落地时再恢复。

### 6.2 旧 result shape 映射

`pageContent = body search_text.text`、`itemId = material_id`、`chunkId = unit_id`、`metadata.chunkIndex = unit_index`。material-level 结果 + `locator` / `read(locator)` 属 PR C。

## 7. 后续工作

- **PR B**：迁移器写 9 表终态、url/note 落 `.md` 快照、冲突「保留副本（自动改名）」、restore 复制已处理 md、孤儿 embedding/content GC。
- **PR C（v2.x）**：material-level 结果 + locator/read、`content_index_entry` 生成、kb__read / kb__tree / kb__manage 工具面、BM25-only 降级。
- 完整 PR 拆分、测试矩阵、风险清单与全部 as-built 注记见飞书完整版 §15–§17。
