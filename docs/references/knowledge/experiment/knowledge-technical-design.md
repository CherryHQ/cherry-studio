# Cherry Studio 知识库技术方案

Date: 2026-06-09

> 本文整合自以下飞书文档：
> - 《Cherry Studio v2 知识库改造实施规划：5 个 PR 拆分》
> - 《当前 v2 知识库改造方案（通俗版）》
> - 《File Mode + RAG 未来知识库产品方案调研与多 Agent 共识报告》（仅技术落点）
> - 《企业内网 Remote File Mode 知识库调研》（仅技术落点）
> - 《本地 Embedding 与 Rerank 方案调研报告：Qwen3 + Transformers.js + AI SDK》（仅技术落点）
>
> 本文是完整技术设计，描述存储布局、`index.sqlite` 表结构、检索栈、读取/locator、迁移、实施 PR 拆分与 as-built 状态。产品口径见 [产品文档](./knowledge-product-spec.md)，算法选型与论证见 [调研报告](./knowledge-research-report.md)，本文不展开调研内容。

---

## 0. 文档状态说明（as-built 2026-06-08 基线 · 阅读约定）

本文同时承载两件事：**未来终态设计** 与 **当前 baseline as-built 现状**。除非明确标注，正文描述的是要执行的目标设计；与 baseline 现状有偏离处，用 `> as-built` 引注说明实际落地情况。

两处全局校准（适用于全文，不再逐处重复）：

1. **`index.sqlite` 已采用 `.cherry` 隐藏布局。** 索引库现在就位于 `KnowledgeBase/{baseId}/.cherry/index.sqlite`（`pathStorage.ts:8-28`，`CHERRY_META_DIR = '.cherry'`）。原计划「当前 v2 放根目录、v2.x 才移入 `.cherry/`、升级时移动索引」的两阶段区分**已作废**——移动已经发生，无需再做。
2. **主进程代码已从 `services/knowledge` 迁到 `features/knowledge`。** 知识库主进程代码已迁到 `src/main/features/knowledge/`，文件处理在 `src/main/features/fileProcessing/`。本文路径统一写 `features/`（部分历史文档与代码注释仍写 `services/knowledge`，应据此读为 `features/knowledge`）。

最重要的现状结论：**9 表 material 模型 + `KnowledgeIndexStore` 是唯一尚未开始的核心（grep 零命中）。** 运行时仍是旧单表 `libsql_vectorstores_embedding` + `external_id` API（`replaceByExternalId` / `listByExternalId` / `deleteByIdAndExternalId`，见 `packages/vectorstores/libsql`）。本文 §4/§5 的 schema 与接口为「已设计、尚未实现」。

完整偏离证据（含 `file:line`）见本地 `docs/references/knowledge/experiment/drift-report-2026-06-08.md`。

---

## 1. 范围与边界（当前 v2 必做 / 明确不做 · v2 与 v2.x 能力边界表）

当前 v2 改造的目标是：**把知识库底层数据形态先对齐未来 v2.x 文件夹型设计**，使 v2→v2.x 切换时尽量只移动/复用索引，不重复复制文件、不重新嵌入。它不是一次做完 v2.x 完整文件夹型知识库。

**当前 v2 必做：**

- 保留全局 `knowledge_base`（配置/元数据/UI 列表/DataApi 数据源）与 `knowledge_item`（UI item、状态、任务编排、chunk 详情入口）。
- 用户上传文件直接复制到 `KnowledgeBase/{baseId}/`，不再用 FileManager `file_entry` 作为材料身份。
- 每库使用 `KnowledgeBase/{baseId}/.cherry/index.sqlite`，表结构直接采用未来兼容 schema。
- URL 与 note 都落成本地 Markdown snapshot。
- 约定 `knowledge_item.id = material.material_id`。
- 搜索仍返回当前 v2 chunk-oriented `KnowledgeSearchResult`，底层按 `material/content/search_unit/search_text/embedding` 写入。
- 仍要求 `knowledge_base.embeddingModelId` 和 `dimensions` 有效（不开放 FTS-only）。

**当前 v2 明确不做：**

- 不停止使用 `knowledge_item`；不把真实目录树作为 UI 唯一事实来源。
- 不启用 watcher / scan 自动发现用户手动放入目录的文件。
- 不开放 FTS-only 知识库（embedding 仍必需）。
- 不生成/编辑 `content_index_entry`，只建表。
- 不正式维护 `material_relation`，只建表。
- 不支持单 chunk 删除（chunk/FTS/embedding 均为派生索引，删除或重建以 material 为单位）。
- 不做软删除；不推断 App 关闭期间的离线移动；不把 MinerU 中间 artifacts/assets/页面缓存纳入目录（只存最终 Markdown）。

**当前 v2 与 v2.x 能力边界表：**

| 能力 | 当前 v2 | v2.x |
| --- | --- | --- |
| 全局 `knowledge_base` | 保留 | 保留或作为元数据入口 |
| 全局 `knowledge_item` | 保留，UI 依赖 | 不作为材料唯一事实，目录 + `index.sqlite` 管理材料 |
| 用户文件位置 | `KnowledgeBase/{baseId}/` | `KnowledgeBase/{baseId}/`（同位） |
| index.sqlite 位置 | `{baseId}/.cherry/index.sqlite` | `{baseId}/.cherry/index.sqlite`（同位） |
| FileManager FileEntry | 不作为材料身份 | 不作为材料身份 |
| URL / note | Markdown 快照文件（计划目标，见 §3 as-built） | 普通 captured material |
| PDF 处理产物 | `indexedRelativePath`，不创建新 item | Markdown 是独立 visible material |
| watcher / scan | 不启用 | 启用 |
| FTS-only | 不启用 | 可启用 |
| content_index_entry | 只建表 | 生成、编辑、检索 |
| material_relation | 只建表 | 正式维护 |
| 搜索返回 | 旧 chunk result | material result + locator + read(locator) |

---

## 2. 存储与目录布局

知识库以真实文件夹为用户可见事实。目录形态：

```text
KnowledgeBase/
  {baseId}/
    .cherry/
      index.sqlite        # 每库隐藏索引库（派生索引，非文件副本）
    paper.pdf             # 用户上传源文件
    paper.md             # MinerU 等处理器产物（与源文件相邻）
    captures/
      url/
        example.md        # URL 抓取的 Markdown 快照
      note/
        meeting-note.md   # 笔记 Markdown 快照
```

**关键约定：**

- `index.sqlite` 只保存可重建的索引状态、文件→内容映射、检索单元、全文检索文本、向量和少量失败摘要。它不保存用户可见文件的副本，也不替代真实目录树。
- `.cherry` 是保留前缀：`.cherry/**`、隐藏文件、临时文件、系统文件均为 scan-level ignored，不进入 `material` 表。
- `material.relative_path` 使用 `KnowledgeBase/{baseId}/` 下真实相对路径，不使用 `items/{id}` 虚拟路径。
- `read path = KnowledgeBase/{baseId}/{relativePath}`；`source` 仅表示原始来源/展示身份，不是读取路径。

**两张全局表保留：**

| 表 | 终态职责 |
| --- | --- |
| `knowledge_base` | 名称、group、`embeddingModelId`、`dimensions`、chunk 设置、搜索模式、`fileProcessorId` 等元数据；`embeddingModelId -> user_model` FK 维护。 |
| `knowledge_item` | 当前 v2 UI item、树形容器、状态、错误、任务编排输入；leaf item 的 `id` 同步作为 per-base `material.material_id`。 |

**关键身份约定：`knowledge_item.id = material.material_id`。** 这样 `rebuildMaterial`/`deleteMaterial`/`listMaterialUnits` 都可直接按 material 操作，替代旧 `external_id` 抽象。

> as-built: `index.sqlite` 已在 `.cherry/`，用户文件已拷入 base 目录并写 `relativePath`，这些地基已具备。`knowledge_item.id = material.material_id` 等式**尚未成立**——当前迁移会重新生成 id（见 §11）；material 表本身也未建。

---

## 3. 数据模型与 item data 形态（persisted data shape · relativePath validator）

所有创建入口可传外部 path、URL 或 note content 作为 **command input**，但持久化后的 `knowledge_item.data` 必须是本地 `relativePath` 形态——外部 path 和 note content 是命令输入，不是持久化索引事实。

**共享字段：** 所有 item 保留 `source: string`（原始来源/展示身份，非读取路径）。

**file leaf：**

```ts
type FileItemData = {
  source: string             // e.g. "/Users/me/Downloads/paper.pdf"
  relativePath: string       // "paper.pdf" —— 复制到 base 目录后的最终相对路径
  indexedRelativePath?: string // "paper.md" —— 处理器产物路径
}
```

索引读取路径为 `indexedRelativePath ?? relativePath`；UI 仍显示 `relativePath` 对应的源文件 item。

**url leaf：**

```ts
type UrlItemData = {
  source: string
  url: string                // 用于展示/刷新/重新抓取，不是读取路径
  relativePath: string       // "captures/url/example-post.md"
}
```

规则：URL 导入时抓取正文生成 Markdown 快照；普通 reindex 读本地 Markdown，**不联网**；刷新 URL 是另一个显式动作。

> as-built: url Markdown 快照模型**仍待执行**。当前 `UrlItemData = { source, url }`（无 `relativePath`），每次 reindex 都联网抓取（`KnowledgeUrlReader.ts:13` 调 `fetchKnowledgeWebPage`）；`captures/url` 零命中。

**note leaf：**

```ts
type NoteItemData = {
  source: string
  relativePath: string       // "captures/note/meeting-note.md"
  sourceUrl?: string         // 仅保留外部来源关系
}
```

规则：note 内容写成 Markdown 文件；reindex **不读** `data.content`。

> as-built: note Markdown 快照模型**仍待执行**。当前 `NoteItemData = { source, content, sourceUrl }`（inline），reindex 读 `data.content`（`KnowledgeNoteReader.ts`）；`captures/note` 零命中。

**directory container：**

```ts
type DirectoryItemData = { source: string; path: string }
```

directory 是 UI/Job 容器，不创建 `material`；展开出的 leaf file item 各自写 `relativePath`。

> as-built: **sitemap 已移除**，不再作为独立 item 类型（`KNOWLEDGE_ITEM_TYPES = ['file','url','note','directory']`），v1 sitemap 迁移为 `url`。本文不再把 sitemap 当容器或 material 来源。

**相对路径校验（`relativePath` / `indexedRelativePath` 必须满足）：** 非空、非绝对路径、不含 `..` 逃逸、不指向 `.cherry` 或 `.cherry/**`、无空字节、由统一 helper 规范化为 POSIX 风格存储。任何 reader/delete/restore 都不能用未经校验的 relative path 直接拼接文件系统路径。

> as-built: 已具备。校验由主进程 helper `assertSafeKnowledgeRelativePath` 实现（`pathStorage.ts:98-111`），`getKnowledgeBaseFilePath` 等拼接入口在拼路径前调用它。**zod schema 只做形状校验**（`relativePath: z.string().min(1)`），不承担路径安全；安全校验在主进程 helper 层，不在 zod。

**路径服务（`features/knowledge/utils/storage/pathStorage.ts` 函数模块，非 class）：**

- `getKnowledgeBaseDir(baseId)` / `getKnowledgeBaseMetaDir(baseId)`
- `getKnowledgeVectorStoreFilePath[Sync](baseId)` → `{baseId}/.cherry/index.sqlite`
- `getKnowledgeBaseFilePath(baseId, relativePath)` —— 校验并解析到绝对路径（即早期 plan 设想的 `resolveMaterialPath`）
- `getKnowledgeSourceRelativePath` / `toKnowledgeRelativePath` / `getProcessedMarkdownRelativePath`
- `copyFileIntoKnowledgeBase[At]` / `deleteKnowledgeItemFiles` / `deleteKnowledgeBaseDir`
- `assertSafeKnowledgeRelativePath`

路径获取遵循项目规则：根目录由 `application.getPath('feature.knowledgebase.data')` 提供，嵌套路径在模块内 `path.join` 维护——不要把 `baseId/.cherry/index.sqlite` 作为 `application.getPath` 的第二参数传入。

---

## 4. index.sqlite 表结构（9 张表设计）

> **状态横幅：整套 9 表 material 模型「已设计、尚未实现」。已建 0 张。** 当前运行时仍是旧单表 `libsql_vectorstores_embedding`（`packages/vectorstores/libsql`）。本节为终态设计，是要执行的计划。`usage_event` 等自适应增强结构是更未来的工作，论证见 [调研报告 §4](./knowledge-research-report.md)，本节不展开。

| 表 | 当前 v2 用法 | 用途 |
| --- | --- | --- |
| `index_meta` | 使用 | 单行索引库元信息和版本快照 |
| `material` | 使用 | 可见文件材料的稳定身份、路径和持久失败摘要 |
| `material_relation` | 只建表 | 材料来源关系（v2.x 记录 PDF→Markdown） |
| `content` | 使用 | 规范化后的索引文本，按内容哈希保存 |
| `search_unit` | 使用 | Agent 可读取的检索单元（chunk、heading section），带 offset |
| `content_index_entry` | 只建表 | 可编辑内容索引条目（问题/摘要/关键词/标签） |
| `search_text` | 使用 | 统一检索文本投影，供 FTS 和 embedding 共用 |
| `embedding` | 使用 | 当前 embedding 文本的向量 |
| `search_text_fts` | 创建并同步 | FTS5 虚表 |

不建议创建（及原因）：`knowledge_item`（材料由目录 + `index.sqlite` 管理）、`job`（进度复用 JobManager）、`embedding_target`（`search_text.embedding_text_hash` 已连接文本与向量）、`schema_migration`（用 `index_meta.schema_version`）、`ignore_rule`（规则由代码侧维护，仅记 `ignore_rules_version`）、`material_link`（缺明确维护方）。

### 4.1 index_meta

固定单行表，不做 key-value。

```sql
CREATE TABLE index_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  base_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_scanned_at INTEGER,
  embedding_model_id_snapshot TEXT,
  dimensions_snapshot INTEGER,
  normalization_version INTEGER NOT NULL,
  chunker_version INTEGER NOT NULL,
  chunker_config_hash TEXT NOT NULL,
  ignore_rules_version INTEGER NOT NULL,
  CHECK (dimensions_snapshot IS NULL OR dimensions_snapshot > 0)
);
```

- `base_id` 必须等于文件夹 `{baseId}`；打开 `index.sqlite` 时校验，不一致则拒绝打开或进入修复流程，避免误挂载另一个知识库的索引。
- `embedding_model_id_snapshot` / `dimensions_snapshot` 是向量契约快照。真正配置以全局 `knowledge_base.embeddingModelId` / `dimensions` 为准；两者不一致说明需要清空向量并全量重嵌入。

> as-built: `index_meta` snapshot + 契约比对 + 选择性重嵌的设计**保留为未来计划目标**。baseline 过渡手段：embedding 配置**每库不可变**，改模型/维度会触发把整库 restore 进一个新库（`KnowledgeVectorStoreService.ts:37-39` + `RagConfigPanel` restore 流程），而非 snapshot 选择性重嵌。restore 仅是过渡，终态仍以本节 snapshot 机制为准。

### 4.2 material

只记录文件材料，不记录目录。

```sql
CREATE TABLE material (
  material_id TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'missing')),
  origin TEXT NOT NULL CHECK (origin IN ('user', 'processor', 'agent', 'captured', 'discovered')),
  index_policy TEXT NOT NULL CHECK (index_policy IN ('index', 'suppress', 'ignore')),
  current_content_hash TEXT,
  title TEXT,
  file_ext TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  mtime_ms INTEGER,
  last_seen_at INTEGER,
  missing_since INTEGER,
  last_indexed_at INTEGER,
  last_error_stage TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  last_failed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (current_content_hash) REFERENCES content(content_hash),
  CHECK (relative_path <> ''),
  CHECK (relative_path NOT LIKE '/%'),
  CHECK (relative_path <> '.cherry' AND relative_path NOT LIKE '.cherry/%'),
  CHECK (status != 'active' OR missing_since IS NULL),
  CHECK (status != 'missing' OR missing_since IS NOT NULL)
);

CREATE INDEX material_status_idx ON material(status);
CREATE INDEX material_content_idx ON material(current_content_hash);
CREATE INDEX material_indexable_idx ON material(status, index_policy, relative_path);
```

**枚举：**

- `status`：`active`（文件存在可用）/ `missing`（之前存在现在找不到）。不做软删除——删除文件后清理索引与材料记录；仅在表达「之前存在但暂时找不到」时保留 `missing`。
- `origin`：`user`（上传/拖入/手动）/ `processor`（MinerU Markdown 等）/ `agent`（Agent 写入）/ `captured`（URL/Note/云文档快照）/ `discovered`（watcher 或扫描发现）。
- `index_policy`：`index`（进入搜索）/ `suppress`（保留为材料但不直接索引，常见于已生成 Markdown 的 PDF）/ `ignore`（可见材料但明确排除出搜索；与 scan-level ignored 不同，后者根本不进 `material` 表）。

**`material_id` 生成规则：** v1 迁移时旧 `knowledge_item.id` 合法不冲突则保留为 `material_id`；当前 v2 中 leaf `knowledge_item.id` 直接作为 `material.material_id`；新增材料用 UUID；App 运行期可观察的移动保留 `material_id` 更新 `relative_path`；App 关闭期外部移动不推断（旧路径可变 missing，新路径作为新发现处理）。

`current_content_hash` 指向当前文件规范化内容；内容变化后生成新 `content_hash` 并重建相关 `search_unit`/`search_text`/embedding。`mtime_ms`/`size_bytes` 只是快速判断线索，不作强一致身份、不用于离线移动推断。第一版不保存 `file_hash`/`fingerprint_hash`。

### 4.3 material_relation

记录材料来源关系，不绑定生命周期。

```sql
CREATE TABLE material_relation (
  relation_id TEXT PRIMARY KEY,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN ('processed_from', 'summarized_from', 'captured_from', 'refreshed_from')
  ),
  source_material_id TEXT,
  target_material_id TEXT NOT NULL,
  source_ref_json TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (source_material_id) REFERENCES material(material_id) ON DELETE SET NULL,
  FOREIGN KEY (target_material_id) REFERENCES material(material_id) ON DELETE CASCADE
);

CREATE INDEX material_relation_source_idx ON material_relation(source_material_id);
CREATE INDEX material_relation_target_idx ON material_relation(target_material_id);
CREATE INDEX material_relation_type_idx ON material_relation(relation_type);
```

示例 `paper.pdf --processed_from--> paper.md`：`paper.pdf.index_policy = suppress`、`paper.md.index_policy = index`，处理器名称/版本/参数/源页范围写 `metadata_json`，外部来源刷新身份用 `source_ref_json`。`content` 表不保存 source/generated-by 信息（属 material provenance）。当前 v2 **只创建表**，不作为处理器流程必需写入——PDF→Markdown 关系当前由 `knowledge_item.data.relativePath`/`indexedRelativePath` 表达。

### 4.4 content

保存规范化后的索引文本，而非用户文件副本。

```sql
CREATE TABLE content (
  content_hash TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  text_format TEXT NOT NULL CHECK (text_format IN ('markdown', 'plain', 'extracted_text')),
  normalization_version INTEGER NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (token_count IS NULL OR token_count >= 0)
);
```

`content_hash` 由规范化文本与 normalization contract 生成，相同内容可被多个 material 复用；内容历史按 hash 保留，后续 GC 删除不可达旧内容。**`content.text` 保存整份 material 的规范化文本（不是每个 chunk 的文本）**；chunk 在整份文本中的范围由 `search_unit.char_start/char_end` 标记。

### 4.5 search_unit

直接绑定 `material_id`，同时记录 `content_hash`。

```sql
CREATE TABLE search_unit (
  unit_id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK (
    unit_type IN ('chunk', 'heading_section', 'page', 'paragraph', 'manual')
  ),
  unit_index INTEGER NOT NULL,
  title TEXT,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  locator_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (material_id) REFERENCES material(material_id) ON DELETE CASCADE,
  FOREIGN KEY (content_hash) REFERENCES content(content_hash) ON DELETE CASCADE,
  CHECK (unit_index >= 0),
  CHECK (char_start >= 0),
  CHECK (char_end >= char_start)
);

CREATE UNIQUE INDEX search_unit_material_index_idx ON search_unit(material_id, unit_type, unit_index);
CREATE INDEX search_unit_content_idx ON search_unit(content_hash);
CREATE INDEX search_unit_material_idx ON search_unit(material_id);
```

`unit_type`：`chunk`（第一版必需）/ `heading_section`（Markdown 标题段落）/ `page` / `paragraph` / `manual`（后三者第一版可只留 schema）。

当前 v2 中 `search_unit.material_id = knowledge_item.id = material.material_id`。chunker 须从「只返回文本」升级为「返回文本和 offset」——`search_text.text` 仍写 chunk 文本、embedding 仍对 chunk 文本生成，但 `read(locator)` 和 chunk 详情通过 `content.text + char_start/char_end` 找回原文位置。

**`unit_id` 稳定生成（不依赖随机 UUID）：**

```text
unit_id = hash(material_id + content_hash + unit_type + unit_index + char_start + char_end)
```

同一 material/content/chunker 结果重复重建时 `unit_id` 不变。`unit_id` **不包含** `chunker_config_hash`（chunker contract 变化由 `index_meta.chunker_config_hash` 触发全量重建）。

**primary material 选择规则**（识别重复内容时）：`status = active`、`index_policy = index`，`relative_path ASC`，其余作为 duplicate paths。

### 4.6 content_index_entry

FastGPT-like 的可编辑内容索引条目。

```sql
CREATE TABLE content_index_entry (
  entry_id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'summary', 'keyword', 'tag')),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'agent', 'imported', 'system')),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (unit_id) REFERENCES search_unit(unit_id) ON DELETE CASCADE
);

CREATE INDEX content_index_entry_unit_idx ON content_index_entry(unit_id);
CREATE INDEX content_index_entry_kind_idx ON content_index_entry(kind);
```

一个 `search_unit` 可有多个条目（question/summary/keyword/tag）。第一版不加 `edited_at`/`sort_order`/`enabled`，不想要的条目直接删除。当前 v2 **只创建表**，不生成、不写入、不展示——搜索文本只来自 `search_unit` 的 `body`/`title`。其作为越用越准增强层的论证见 [调研报告 §4](./knowledge-research-report.md)。

### 4.7 search_text

统一检索文本投影，供 FTS 和 embedding 共用。

```sql
CREATE TABLE search_text (
  search_text_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('search_unit', 'content_index_entry')),
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('body', 'title', 'question', 'summary', 'keyword', 'tag')),
  text TEXT NOT NULL,
  embedding_text_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX search_text_target_kind_idx ON search_text(target_type, target_id, kind);
CREATE INDEX search_text_embedding_hash_idx ON search_text(embedding_text_hash);
CREATE INDEX search_text_kind_idx ON search_text(kind);
```

唯一约束是 `(target_type, target_id, kind)`——同一 target 可有 `body` 和 `title` 多种文本。`embedding_text_hash` 由实际 embedding 输入文本生成；FTS 和向量搜索都以 `search_text.text` 为入口，避免「全文文本」与「向量文本」不一致。同一 `embedding_text_hash` 可被多条 `search_text` 复用，因此 `embedding` 不能通过外键引用它，向量可达性由 `EXISTS (SELECT 1 FROM search_text WHERE embedding_text_hash = ...)` 判断。当前 v2 写 `body`；如写 `title`，title 命中也必须回到对应 body chunk。

### 4.8 embedding

只保存当前 embedding contract 下的向量。

```sql
CREATE TABLE embedding (
  embedding_text_hash TEXT PRIMARY KEY,
  vector_blob BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
```

- **不保存** per-row `model_id` 或 `dimensions`。改模型/维度时历史行不能保留旧维度，需清空 embedding 并全量重嵌入。`model_id`/`dimensions` 从全局 `knowledge_base` 读取，`index_meta` 只保存快照用于校验。
- 实现侧校验 `vector_blob` 长度等于当前 `dimensions * 4`，但不把维度写进每行。
- 第一版继续用 libSQL 的 Float32 blob；未来迁移到 `better-sqlite3 + sqlite-vec` 时只需替换向量存储层（虚表/shadow table）。

> as-built: 同 §4.1——baseline 过渡用整库 restore 进新库（每库 embedding 配置不可变），终态仍以 `index_meta` snapshot 选择性重嵌为目标。

### 4.9 search_text_fts

FTS5 虚表基于 `search_text` 构建：

```sql
CREATE VIRTUAL TABLE search_text_fts
USING fts5(
  text,
  kind UNINDEXED,
  content='search_text',
  content_rowid='rowid'
);
```

FTS 维护可选触发器（AFTER INSERT/DELETE/UPDATE），或由索引服务在同一写事务中维护。**关键约束：因为 `search_text_id` 是 TEXT 业务主键、不一定是 SQLite rowid，FTS 命中时必须通过 `search_text.rowid = search_text_fts.rowid` 回表，或实现时改用 INTEGER rowid 作为 FTS content rowid。** 两者二选一，避免把 TEXT 主键误当 FTS rowid。FTS tokenizer 是否使用 trigram/unicode61，或应用层 CJK 分词后写入 `search_text`，仍需确认（见 §17）；CJK bigram 分词论证见 [调研报告 §2](./knowledge-research-report.md)。

---

## 5. 索引接口（KnowledgeIndexStore）与现状 external_id API

> **状态：接口为未来目标（grep 零命中）。** 运行时仍走 `replaceByExternalId` / `listByExternalId` / `deleteByIdAndExternalId`。

### 5.1 接口定义

旧接口以 `external_id` 为中心：`replaceByExternalId(itemId, nodes)` / `listByExternalId(itemId)` / `deleteByIdAndExternalId(id, itemId)`。当前 v2 应替换为知识库语义接口 `KnowledgeIndexStore`：

```ts
interface KnowledgeIndexStore {
  rebuildMaterial(materialId: string, input: RebuildMaterialInput): Promise<void>
  deleteMaterial(materialId: string): Promise<void>
  listMaterialUnits(materialId: string): Promise<KnowledgeSearchUnit[]>
  search(input: KnowledgeIndexSearchInput): Promise<KnowledgeIndexSearchResult[]>
  close(): Promise<void>
}
```

兼容映射：`materialId = knowledge_item.id`、`chunkId = search_unit.unit_id`、旧 `KnowledgeSearchResult.content = search_text.text`、旧 `KnowledgeSearchResult.itemId = material_id`。`deleteItemChunk` UI/API 应移除或返回 unsupported（不能继续删除单条派生 chunk）。

> as-built: `deleteItemChunk` **仍全链路可用**（UI → preload `preload/index.ts:358` → IPC → `deleteByIdAndExternalId`，`KnowledgeService.ts:295-309,543`；`KnowledgeItemChunkDetailPanel.tsx:186`）。其移除绑定 material 模型落地，故保留为未来工作。grep gate 应把它标为「待移除残留」（见 §16）。

`planKnowledgeItemSource` 一类调度判断改为基于知识库内路径：文件扩展名从 `indexedRelativePath ?? relativePath` 推导（不从 `source`）；已有 `indexedRelativePath` 时普通 reindex 直接索引 Markdown；「重新处理 PDF」是显式 reprocess 动作。

### 5.2 rebuildMaterial 写入语义

`rebuildMaterial(materialId, input)` 必须在一个写事务内完成，保持旧 `replaceByExternalId` 的**原子替换语义**（不能出现旧 chunk 和新 chunk 混合可见）：

1. upsert `material`；2. upsert `content`；3. 删除该 `material_id` 旧的 `search_unit` 和对应 `search_text`；4. 插入新 `search_unit`；5. 插入新 `search_text` 并同步 FTS；6. 插入缺失 `embedding`；7. 更新 `material.current_content_hash`、`last_indexed_at`、`last_error_* = null`。

`embedding` 以 `embedding_text_hash` 为主键、可能被多个 `search_text` 共享。删除旧 `search_text` 后**不能直接删旧 embedding**，只能删除不再被任何 `search_text.embedding_text_hash` 引用的 embedding，或交后续 GC（见 §10）。

### 5.3 chunk、offset 与 unit_id

```ts
type ChunkWithOffset = {
  text: string
  charStart: number
  charEnd: number
  unitIndex: number
  title?: string
  locator?: unknown
}
```

必须满足约束（仅适用于 `search_text.kind = body`）：

```ts
content.text.slice(charStart, charEnd) === bodySearchText.text
```

`title`/`question`/`summary`/`keyword`/`tag` 不一定等于 `content.text` 的某个 slice，但都必须绑定到一个 `search_unit`，返回旧 chunk result 时回到该 unit 的 body 文本。**不能用从头开始的 naive `indexOf(chunkText)` 推断 offset**（重复段落会错配），可用 cursor-based search 或让 chunker 切分时保留 offset。

### 5.4 embedding contract

当前 v2 仍要求 `knowledge_base.embeddingModelId` 和 `dimensions` 有值。打开 index store 时：从全局 `knowledge_base` 读当前模型/维度 → 从 `index_meta` 读 snapshot → snapshot 为空则写入 → snapshot 与全局配置不一致则标记需全量重嵌入（不混用旧维度向量）。改模型/维度时必须清空旧 embedding 并重建所有 material。

### 5.5 embedding/rerank 本地接入（接口与服务边界）

本地 embedding/rerank 的目标是把「选模型/配模型」降级为「一键下载默认模型」。模型选型（仅文本 embedding `Qwen3-Embedding-0.6B-ONNX`；本地 cross-encoder reranker `Qwen3-Reranker-0.6B-ONNX` 经实测过慢已 Pass，本地精排默认不启用）、实现代码、被 Pass 方案与风险验证见 [调研报告 §3](./knowledge-research-report.md)，本文只写落地接口与服务边界：

- **AI SDK 封装：** AI SDK 6 原生支持 `EmbeddingModelV3` / `RerankingModelV3`，用 `customProvider({ embeddingModels, rerankingModels })` 封装，经 `embedMany` / `rerank` 调用，无需 OpenAI-compatible HTTP 伪装。服务层区分 `embedQuery` / `embedDocuments`。`RerankingModelV3` 封装能力保留，但默认**不内置本地重排模型**（待更轻量 reranker / WebGPU 加速 / 云端 rerank API 再启用）。
- **模型下载/缓存/加载服务：** 不写死 HF URL；定义 `LocalModelManifest`（`id/revision/files[]`）+ `ModelFile`（`name/path/size/sha256/sources[]`，source type 含 `huggingface/mirror/cdn/modelscope`），支持多源下载、完整性校验、失败重试、取消、版本锁定。下载/校验/加载/释放拆为四阶段。
- **本地缓存路径：** `env.allowRemoteModels = false`、`env.allowLocalModels = true`、`env.localModelPath = application.getPath('models.transformers')`（走集中式 path 命名空间）。
- **资源控制：** embedding 模型懒加载 + 空闲释放 + 限并发；默认 WASM，可配 WebGPU 并失败自动 fallback。（同样的资源控制策略适用于未来启用的可选 reranker。）

---

## 6. 检索栈落地（FTS5 BM25 + 向量 + RRF hybrid + 可选 rerank · 无向量库降级）

> 算法选型、论文依据、单一 search 自适应裁决、分数语义裁决见 [调研报告 §2](./knowledge-research-report.md)。本节只写落地形态与参数。

### 6.1 search 落地

`KnowledgeIndexStore.search()` 在 `search_text`、`search_text_fts`、`embedding` 上执行 BM25 / vector / hybrid，并映射到 v2 `KnowledgeSearchResult`：

1. 读取 `knowledge_base` 获取搜索模式、threshold、documentCount、hybridAlpha。
2. `search()` 在 `search_text_fts` 跑 BM25、在 `embedding` 跑向量相似度，hybrid 用 RRF（或归一化加权）融合；rerank 为可选阶段，本地 cross-encoder 默认不启用（见 §5.5 与调研报告 §3）。
3. 结果 join `search_unit -> material`。
4. 过滤 `material.status = active` 且 `material.index_policy = index`。
5. 再过滤 `knowledge_item.status = completed` 且非 deleting（确保 UI 删除/失败 item 不返回）。
6. 映射成当前 v2 `KnowledgeSearchResult`。

**无向量库降级：** 单一 `search` 后端自适应——有向量库走 hybrid，无向量/未配 embedding/索引未完成走纯 BM25，实际模式作为返回值回传。当前 v2 仍要求 embedding 必需，但底层 schema 已为 v2.x「无 embedding 也能用」预埋。

### 6.2 当前 v2 旧 result shape 映射

```text
pageContent = chunk 文本 (search_text.kind = body)
itemId = search_unit.material_id
chunkId = search_unit.unit_id
metadata.chunkIndex = search_unit.unit_index
```

最简单规则是当前 v2 搜索只用 `search_text.kind = body`；如同时索引 title，title 命中也要回表找到同一 `search_unit` 的 body search_text，不能把标题字符串当作 chunk content 返回。`snippets`、`matchedKinds`、material-level result 和 `read(locator)` 是 v2.x Agent-first 搜索结果的一部分——当前 v2 不计算、不返回，只保证底层 `search_unit`/`locator_json`/offset 足够以后升级。

**FTS 注意：** 不要把 TEXT `search_text_id` 当 FTS rowid，应使用 `search_text.rowid` 与 `search_text_fts.rowid` 对齐。

### 6.3 检索参数建议

| 参数 | 建议值 | 说明 |
| --- | --- | --- |
| 向量召回 topK | 30–100 | 控开销；若未来启用可选 rerank，也用于备足候选 |
| dtype | q4 优先，必要时 q8 | 本地 WASM/WebGPU 用低并发队列 |
| rerank topN（可选） | 5–12 | 仅在启用可选 rerank 时适用；本地默认不启用 |
| rerank max_length（可选） | 4096 或 8192 | 仅在启用可选 rerank 时适用；不要默认 32K |

> as-built: search 仍走旧 vectorstore（`replaceByExternalId` / `external_id` API），阻塞于 §5 的 9 表 material 模型。

---

## 7. 读取 / locator（read(locator)）

搜索返回材料级结果（v2.x 终态）：

```ts
type KnowledgeSearchResult = {
  baseId: string
  materialId: string
  path: string
  title?: string
  bestLocator: KnowledgeLocator
  snippets: string[]
  matchedKinds: Array<'body' | 'title' | 'question' | 'summary' | 'keyword' | 'tag'>
  duplicatePaths?: string[]
}
```

Agent 拿到结果后调用 `read(locator)` 读取邻近上下文。`read(locator)` 必须校验：`material.status = active`、`material.current_content_hash = locator.contentHash`、`material.index_policy = index`、文件路径仍在当前知识库内。任一不满足返回 stale / missing，让 Agent 重新搜索，而不是读旧内容。

如果命中来自 `content_index_entry`，`bestLocator` 仍指向它绑定的 `search_unit`，Agent 读取的是原始 chunk 附近上下文（不只是问题/摘要/标签文本）。

locator 在本地↔企业云端等价契约中是**不透明令牌**（本地编码字符位移、云端编码块号/页码/版本），同一 `read` 签名走不同取数实现——契约不变量论证见 [调研报告 §4](./knowledge-research-report.md)。`locator_json` 的具体格式（Markdown heading path / page number / block id / char range 如何组合）仍需确认（见 §17）。

> as-built: material-level result、`bestLocator`、`read(locator)` 均未实现（属 v2.x Agent-first）。

---

## 8. 文件处理与 MinerU（path-based fileProcessing）

文件处理服务复用现有 `FileHandle`，并增加输出目标。MinerU 等处理器输出的 Markdown 是普通可见文件，保存到源文件相邻目录（`paper.pdf` → `paper.md`）；第一版只保存最终 Markdown，不保存 artifacts/assets/页面缓存。

```ts
type FileHandle =
  | { kind: 'entry'; entryId: FileEntryId }
  | { kind: 'path'; path: FilePath }

type FileProcessingOutputTarget = { kind: 'path'; path: FilePath }

interface StartFileProcessingJobInput {
  feature: FileProcessorFeature
  file: FileHandle
  processorId?: FileProcessorId
  output?: FileProcessingOutputTarget
  context?: { dataId?: string }
}
```

知识库调用 `file.kind = path` + `output.kind = path` + `context.dataId = item.id`，继续使用现有 `document_to_markdown` feature（不新增 `knowledgebase` feature）。`document_to_markdown` 入队前必须携带 path output（没有则拒绝）。

**持久化要求：** path output 不能只存在内存调用栈，job input/output schema、remote-poll payload 和 JobSnapshot rehydrate 都必须持久化 `file`、`output`、`context.dataId` 与处理完成后的实际 `output.path`，否则远程轮询/进程重启/job recovery 后会丢失目标 Markdown 路径。同一 item 重试必须幂等写入同一 output target：先写临时文件，再原子 rename 到 `output.path`（避免半写入 Markdown 被索引）。MinerU `data_id = context.dataId`。

**处理完成后：** `checkFileProcessingResult` 读 job output Markdown path → 校验位于 `KnowledgeBase/{baseId}/` 内 → 写回 `knowledge_item.data.indexedRelativePath` → 更新 `material.relative_path = indexedRelativePath` → 调度 `indexDocuments`。当前 v2 不为 `paper.md` 创建新 item；删除 `paper.pdf` item 时同删 `paper.pdf` 和 `paper.md`。

**v2.x 升级拆分规则（保持索引身份稳定）：** 当前 v2 的 `knowledge_item.id` / `material_id` 归属实际被索引的 Markdown（`paper.md`）；源 PDF 在 v2.x 扫描时生成新 `material_id`（通常 `index_policy = suppress`）；升级时补写 `material_relation(processed_from, source = pdfMaterialId, target = markdownMaterialId)`。这样现有 chunk/embedding/locator 仍绑定 Markdown material，无需从 PDF id 迁到 Markdown id。

> as-built: 已具备，且比计划更激进——`FileProcessingOutputTarget` 已收敛为**单臂** `{kind:'path'}`，`managed_artifact` 被整体删除（不是保留作默认，`fileProcessing.ts:28`）；`document_to_markdown` 入队前强制要求 path output（`FileProcessingService.ts:80-82`）；MinerU 只认 `context.dataId`，无 `fileEntryId` 回退（`mineru/document-to-markdown/handler.ts:88-90`）。

---

## 9. 运行时接入

`loadKnowledgeItemDocuments` 统一按知识库目录读取：

```ts
const relativePath = item.data.indexedRelativePath ?? item.data.relativePath
const absolutePath = getKnowledgeBaseFilePath(baseId, relativePath)
```

- **file item（已具备）：** 不调用 `FileManager.getPhysicalPath(fileEntryId)`，读 `{baseId}/{indexedRelativePath ?? relativePath}`。
- **url item（仍待执行，当前联网）：** 不在 reindex 时 fetch 网络，读 `relativePath` 指向的 Markdown 快照。
- **note item（仍待执行，当前读 inline）：** 不读 `data.content`，读 `relativePath` 指向的 Markdown 快照。
- **directory：** 不直接读取，只负责展开 child item 或作 UI 容器。

读取时若文件缺失，应在 base mutation lock 内把 `material.status` 标记 `missing`、写 `missing_since` 和错误摘要，并把 `knowledge_item` 置 `failed` 或可重试失败态；搜索必须过滤 `material.status != active`。

**job payload 去 FileEntry：**

```ts
type KnowledgeCheckFileProcessingResultPayload = {
  baseId: string
  itemId: string
  fileProcessingJobId: string
  pollRound: number
  firstScheduledAt: number
  parentJobId: string | null
}

type KnowledgeIndexDocumentsPayload = {
  baseId: string
  itemId: string
  parentJobId: string | null
}
```

不再传 `sourceFileEntryId` / `processedFileEntryId`。`checkFileProcessingResultJobHandler` 通过 file-processing job 的 `context.dataId === itemId` 和 path-inside-base 校验归属；索引 job 从最新的 `indexedRelativePath ?? relativePath` 读取实际索引文件；`sourcePlanning` 从 `indexedRelativePath ?? relativePath` 推断扩展名。

> as-built: 编排服务/path workflow 已落地，job payload 已去 FileEntry，`checkFileProcessingResultJobHandler` 已用 path output 回写 `indexedRelativePath`。但索引/搜索仍走旧 vectorstore（`replaceByExternalId`），阻塞于 §5 的 PR1A。

---

## 10. 破坏性操作与并发写

**并发写原则：** 所有 destructive/index writes 在 `KnowledgeLockManager.withBaseMutationLock` + `DbService.withWriteTx` 短事务内执行；长耗时 copy/snapshot/fetch 不放 DB write lock 内。per-base `index.sqlite` 的 libSQL 写事务也必须避免并发写冲突。用 staged manifest + 失败清理处理 crash 中途状态。

### 10.1 删除 leaf item

1. 取消该 item 相关 jobs；2. `knowledge_item.status` 标 `deleting`（搜索和 UI 默认隐藏）；3. base mutation lock 内 `KnowledgeIndexStore.deleteMaterial(item.id)`；4. 删 `{baseId}/{relativePath}`；5. 若有 `indexedRelativePath` 也删对应文件；6. **最后**删全局 `knowledge_item` row。

最后删 row 是关键：否则崩溃后会丢失需要清理的 relative path。崩溃重试须凭 `knowledge_item.data.relativePath/indexedRelativePath` 幂等清理。

### 10.2 删除 directory container

找到子树所有 leaf item → 取消相关 jobs → 子 leaf 按 leaf 删除流程清理 material/index/files → 删 container row。目录树内文件由 child item 管理时按 child item manifest 清理，**不要盲目删除整个 base 根目录**。

### 10.3 删除 knowledge base

1. 取消该 base 下所有 jobs；2. 关闭并释放该 base 的 `KnowledgeIndexStore` / libSQL client handle；3. 删 `{baseId}/` 整个目录；4. 删全局 `knowledge_item` rows；5. 删全局 `knowledge_base` row。

**关闭 index store 必须在删目录前完成**，尤其避免 Windows 文件句柄导致删除失败。base delete crash recovery（目录删成功但 row 删失败）需 base-level deleting intent 或幂等清理路径（见 §17）。

### 10.4 重建 item

不重新复制外部 `source` → 读 `{indexedRelativePath ?? relativePath}` → 重新生成 content/search_unit/search_text/embedding → `rebuildMaterial(item.id, input)` 原子替换。重新抓取 URL / 重新处理 PDF 是 refresh / reprocess 显式动作，不是普通 reindex。实现上 reindex flow 必须在 enqueue 前把目标 leaf 重置为 `processing`/`reading` 或携带 force 标记，避免被 `indexDocuments` 的 completed 快路径吞掉。

### 10.5 恢复和复制 knowledge base

创建新 `knowledge_base` → 复制旧目录可见材料文件到新目录 → 创建新 `knowledge_item` rows（`relativePath`/`indexedRelativePath` 都指向复制后路径）→ 初始化新 `index.sqlite` → 重建所有 leaf material 索引。**不能复用旧 base 外部 `source` 重新抓取/复制。** 已处理 PDF 的 restore/duplicate 必须同时复制源文件和 Markdown 产物（新 base item 仍显示源 PDF，索引读复制后的 `indexedRelativePath`）。

> as-built: 删除/恢复顺序已落地，向量孤立 bug 已修复（`a6128a6da9`）。但 restore **只复制源文件、不复制已处理 Markdown**（改为重新处理，`KnowledgeService.ts:484-508`）；`duplicateBase` 不存在。两项标 TODO。

---

## 11. 迁移（v1 → 当前 v2）

v1 迁移到当前 v2 的稳定终态应直接写入新的目录和索引形态。**迁移终态是新目录 + 新索引**，旧向量不直接迁表（除非文本 hash/模型/维度完全一致）。

迁移步骤：

1. 为每个 v1 knowledge base 创建当前 v2 `knowledge_base`；2. 创建 `{baseId}/`；3. 初始化 `{baseId}/.cherry/index.sqlite`；4. 每个 v1 文件材料复制实际文件到 base 目录、创建 `knowledge_item(type=file)`、写 `relativePath`；5. 每个 v1 URL/note 生成 Markdown 快照、创建 `knowledge_item(type=url|note)`、写 `relativePath`；6. 每个 leaf item 创建 `material(material_id = knowledge_item.id)`；7. 重建索引写入 `content/search_unit/search_text/embedding`。

**id 保留规则（计划目标）：** v1 旧 `knowledge_item.id` 合法且不冲突时保留为当前 v2 的 id，从而满足 `knowledge_item.id = material.material_id`；不合法或冲突则记录新旧 id 映射，保证 container `groupId`、job 输入和 UI 引用一致。

**向量复用判定：** 只有在新旧 `embedding_text_hash` 完全一致，且 embedding 模型/维度契约一致时才复用旧 embedding；不能按路径、chunk index、loader id 或猜测移动来复用向量。缺失 embedding 排队重嵌入，FTS 可先可用。缺文件时 → material `status = missing` / item failed（终态），失败 missing-model bases 仍须可 restore。

v1 sitemap 迁移为 `url`（sitemap 不再是独立 item 类型）。

> as-built: 部分已具备 + 一处已修复 bug + 一处残留。
> - 已具备：已把 v1 上传文件拷入 `{newBaseId}/`、写 `relativePath`、不写 knowledge `file_ref`（`KnowledgeMigrator.ts:767`）。
> - **legacy id 全部重新生成**（只留 `legacy → new` remap，`KnowledgeMappings.ts:253,400`），「保留合法旧 id」「`id == material_id` 等式」尚未成立。
> - 缺文件 → item failed（**无 `material.status = missing`**，因 material 模型未建）。
> - **✅ 已修复（`a6128a6da9`）**：此前 `KnowledgeVectorMigrator` 把重建向量 DB 写到 legacy 扁平路径 `{root}/{legacyBaseId}`，而运行时读 `{newBaseId}/.cherry/index.sqlite`（id 与布局两维度都不一致），导致迁移向量被孤立、运行时读到空库。修复把读源（legacy，仅用于 `.embedjs.bak` 备份）与写目标（`getRuntimeVectorStorePath` = `{newBaseId}/.cherry/index.sqlite`）分离，`execute()` 先 `mkdir .cherry`、rename 前删运行时自建空库，`validate()` 改读运行时路径，回归测试断言运行时路径可读、legacy 扁平路径不再有 live 库。
> - **残留（仍待执行）**：迁移器仍写旧单表 `libsql_vectorstores_embedding` 格式（只修了写入位置，未改表结构；9 表 material 终态仍是未来工作，`KnowledgeVectorMigrator.ts:23`）。详见 drift-report §4。

---

## 12. UI / Preload / IPC

当前 v2 UI 继续展示 `knowledge_item`，但移除 FileEntry 依赖：

- 新增文件入口不调用 `ensureExternalEntry`；`SaveToKnowledgePopup` 不调 `resolveKnowledgeFileMetadataEntryData`，把外部可读路径或已落盘临时文件作为 command input 传给 main，由 main 复制到 base 目录。
- note 保存入口仍可提交 note content 作为 command input，但落库后必须写 Markdown snapshot，`relativePath` 作为事实（不再持久化 `data.content`）。
- 文件 item 行不再请求 `/files/entries/:id`；chunk detail 不依赖 FileEntry 查询。
- 附件按钮如需引用知识库文件，改为读知识库目录内文件或走新 knowledge material handle，不假设 completed file item 有 `fileEntryId`。
- 删除单 chunk 的按钮或 API 移除。
- item 标题、文件后缀、预览路径从 `relativePath` 或 `source` 派生。
- 导入进度复用 JobManager（导入时显示解析进度，完成后不显示持久「已索引」状态）。

API 路由形态可保留（`/knowledge-bases/:id/items`、`/knowledge-items/:id`、reindex/delete item|subtree、list chunks、search），但 payload 的 `data` 形状和底层实现按新目录语义调整。

preload / IPC 契约同步：knowledge add-items 接收 command input（不要求 renderer 先产出持久化 `data`）；fileProcessing preload 改为 `FileHandle` + output target + context；knowledge job payload 移除 `processedFileEntryId`/`sourceFileEntryId`；`deleteItemChunk` 从 preload 移除或保留为明确 unsupported stub。

> as-built: 渲染层去 FileEntry 已完成（无 `/files/entries/:id`、add-item DTO 已拆分、`fileProcessing.startJob` 用 `FileHandle`）。仍待执行：`deleteItemChunk` 仍全链路可用（`preload/index.ts:358`）；note 仍持久化 `data.content`；material preview/attach 未做；**chat 附件按钮被直接删除**（待 chat 管线迁移后再接 material handle，比计划更激进）。

---

## 13. Agent 工具契约（技术字段 · 远程 kb_* 接口草案）

> 工具数量/取舍论证（5 工具如何从 4 立场 / 12→5 收敛、为何不暴露通用文件工具三条红线、本地↔云端等价不变量）见 [调研报告 §4](./knowledge-research-report.md)。本节只写技术抽象与远程接口草案。

**当前内部工具基线：** `kb__list` / `kb__search` 已有，作为 v2.x 工具演进的对照起点。v2.x 目标暴露 5 个专用工具：

- `kb__list`：补能力字段——本地/云端、只读/可写、hybrid/BM25、是否已配 embedding。
- `kb__search`：唯一检索入口，回传 `score` / 检索模式 / `locator`。
- `kb__read`：凭 `locator` 取邻近上下文/整段，参数控窗口。
- `kb__tree`：受边界约束的目录浏览，依赖材料扫描器（延后）。
- `kb__manage`：`add`/`delete`/`refresh` 收口为带两段式确认 + 破坏性预览 + 云端降级的单工具（延后）。

**契约不变量（技术红线）：** `kb__read` 只接受不透明 `locator`、Agent 永不解析/构造路径、后端按身份重校验归属。无原文权限时返回「仅片段」状态（退回投影文本，含手编问题/摘要/关键词），是返回值非异常；权限拒绝用显式 `forbidden` 状态；云端只读库写操作返回 `unsupported`、版本冲突返回 `conflict`，绝不伪装成功。**坚决不暴露通用文件系统工具。**

**分数语义：** 分数必须带类型——相关度分（语义，跨查询可比、可做绝对阈值）vs 排名分（BM25/RRF，仅同查询内可比）。当前实现把两者混为一个 0~1 分是语义缺陷，需修正。

---

## 14. 企业内网 Remote File Mode 落地（未来扩展技术纲要）

> Knowledge Gateway 架构论证、不推荐方案评估、MVP1-4 路线见 [调研报告 §5](./knowledge-research-report.md)。本节为未来扩展技术设计纲要。

- **存储形态：** 知识库模型引入 `storageKind = local | remote`（或新增 `mode = remote_file`）。Local 保持本地 base root + filesystem 工具；Remote 的 source of truth 改为内网 Knowledge Gateway，文档身份仍用 base-relative path（`kb://baseId/relativePath`），不同步整库。
- **Agent handoff：** 不把 workspace 指向远程库，而是创建本地 scratch workspace 同时注入当前 remote knowledge base；主进程按 `knowledgeBaseIds` 注入 remote tools（`kb_ls/kb_search/kb_read/kb_read_page`）。
- **架构组件：** Knowledge Gateway（鉴权/路由/审计/限流/目录与读取 API/查询 API）+ Metadata DB（base/file/directory/chunk/version/hash/ACL/索引状态）+ Object Storage/NAS（原文与解析产物）+ Index Workers（异步 parse/chunk/embed）+ Search Index（BM25/向量/过滤/rerank 前召回）。
- **服务端 ACL：** 权限必须在服务端强制执行（不能只靠客户端过滤）。base/file/chunk 携带 `tenantId/baseId/owner/groupIds/userIds/securityLabels/version`；查询先解析用户身份与群组再加 ACL 过滤；读片段需对 path 二次校验可读性；预览/下载链接短期有效且绑定用户/文件/范围/用途；审计谁何时搜了什么、读了哪些片段。
- **UI 目录接口按 `storageKind` 分派：** local → 本地 path 服务，remote → Knowledge Gateway。默认先做只读，写/移/删/自动整理作为后续受控能力。

**最小接口草案（TS）：**

```ts
type RemoteKnowledgeSource = { baseId; displayName; relativePath; uri: `kb://${string}/${string}` }
type KbSearchResult = { baseId; relativePath; displayName; chunkId; text; score; page?; lineStart?; lineEnd? }
type KbReadRequest = { baseId; relativePath; offset?; limit? }
type KbReadPageRequest = { baseId; relativePath; pageStart; pageLimit }
```

---

## 15. 实施 PR 拆分与路线图

5 个 PR + as-built 状态。**关键顺序：先证明 index store 和 path-based fileProcessing（POC），再改数据模型与运行时，最后做迁移和 UI 收尾。** 依赖链 PR1→PR2→PR3→PR4，PR5 依赖稳定后端 contract 可提前开发但最后合并。POC A 与 POC B 可并行。

| PR | 目标 | 主要范围 | 依赖 | as-built 状态 |
| --- | --- | --- | --- | --- |
| **PR1 Foundation POCs** | 隔离验证两个核心 | PR1A `KnowledgeIndexStore`（9 表、`rebuildMaterial` 原子替换、vector/BM25/hybrid 搜索）；PR1B path-based FileProcessing（path I/O、原子写 markdown、remote poll 恢复、MinerU dataId） | — | **PR1A 未开始**（唯一未动工核心，grep 零命中）；**PR1B 已落地且更激进**（`managed_artifact` 整体删除） |
| **PR2 Path + Data Model** | 材料身份从 FileEntry/inline 迁到 base-owned files + persisted `relativePath` | file/url/note data shape、relativePath validator、main path/file service、`createBase` 建目录与 index.sqlite | PR1 | 大部分已落地；冲突策略落地为 **reject-on-conflict**（非 keep-both）；`id == material_id` 未做；url/note 快照未做 |
| **PR3 Runtime Integration** | 接入 v2 runtime | reader 走 base path、index job 写 `rebuildMaterial`、search/listChunks 兼容旧 shape、fileProcessing workflow 写回 `indexedRelativePath`、删 FileEntry-shaped payload | PR1A, PR2 | 编排/path workflow 已落地，但索引/搜索仍走旧 vectorstore，**阻塞于 PR1A** |
| **PR4 Delete/Reindex/Restore/Migration** | 破坏性操作 + v1 迁移终态 | leaf/base 删除顺序、reindex/prepare、restore/duplicate、v1 migration 直接生成最终 layout | PR1A, PR2, PR3 | 删除/恢复顺序已落地、向量孤立 bug 已修复；迁移器仍写旧单表、restore 不复制已处理 markdown、`duplicateBase` 不存在，迁移终态**阻塞于 PR1A** |
| **PR5 UI/Preload/Rollout** | 用户可见收尾 | preload/IPC 去 FileEntry、add/save 提交 path command、DataSource 从 relativePath 展示并移除单 chunk 删除、附件用 material handle、grep gate + E2E smoke | 稳定后端 contract | 渲染层去 FileEntry 已完成；`deleteItemChunk` 仍在、note 仍持久化 content、material preview/attach 与 E2E 未做、chat 附件按钮被直接删除 |

**规模估算：** 生产代码约 4,500–8,500 LOC / 45–75 文件；测试约 6,000–11,000 LOC / 30–45 文件。最大风险 IndexStore / FileProcessing / Migration——先 POC 后实现。

**重点改动文件（按 PR，路径以 `features/` 为准）：**
- jobs：`indexDocumentsJobHandler.ts`、`checkFileProcessingResultJobHandler.ts`、`deleteSubtreeJobHandler.ts`、`reindexSubtreeJobHandler.ts`、`prepareRootJobHandler.ts`
- services：`KnowledgeService.ts`、`KnowledgeWorkflowService.ts`、`KnowledgeItemService.ts`、`vectorstore/*`、`utils/storage/pathStorage.ts`、`utils/indexing/{chunk,embed}.ts`、`readers/*`、`utils/sources/*`
- migration：`migration/v2/migrators/KnowledgeMigrator.ts`、`KnowledgeVectorMigrator.ts`、`mappings/KnowledgeMappings.ts`、`MigrationPaths.ts`
- fileProcessing：`features/fileProcessing/*`、`processors/mineru/*`、`src/shared/data/types/fileProcessing.ts`
- shared/preload/UI：`src/shared/data/types/knowledge.ts`、`src/preload/index.ts`、renderer `AddKnowledgeItemDialog.tsx`、`SaveToKnowledgePopup.tsx`、`dataSource/*`、`AttachmentButton.tsx`

---

## 16. 质量门禁与测试矩阵

**最终 grep gate**（搜索遗留标识符）：

```text
rg -n "fileEntryId|sourceFileEntryId|processedFileEntryId|replaceByExternalId|listByExternalId|deleteByIdAndExternalId|deleteItemChunk|ensureExternalEntry|/files/entries/:id"
```

范围覆盖 `src/main/features/knowledge`、`src/main/data/migration/v2`、`src/preload`、`src/renderer/pages/knowledge` 等。剩余命中须满足：unsupported compatibility stub / 非 knowledge domain / 旧 package 测试隔离 / 文档说明。**注意 `deleteItemChunk` 当前是「待移除残留」**——material 模型落地前会一直命中。

**测试矩阵（6 类）：**

- **Unit：** relativePath validator、chunk offset（`content.text.slice(charStart,charEnd) === body search_text.text`）、stable `unit_id`、sourcePlanning（`indexedRelativePath ?? relativePath`）、artifact parser、command vs persisted schema。
- **Integration：** base dir + index lifecycle、add file/url/note → index → search → list chunks → delete 垂直切片、remote poll recovery、delete/reindex race + crash retry、missing file 标记 material/item 不可用且 search 过滤 stale。
- **Migration：** v1 file copy 写 `relativePath`、note/url snapshot 写 Markdown、合法 id 保留 + 非法 id remap、无 knowledge `file_ref`、无旧 `libsql_vectorstores_embedding` 终态、failed missing-model bases 仍可 restore。
- **Workflow Recovery：** delete enqueue failure、startup recovery、crash after each cleanup step。
- **UI / IPC：** add dialog 与 SaveToKnowledge 不调 `ensureExternalEntry`、rows/chunk detail 不查 `/files/entries/:id`、chunk delete 控件缺失、attachment/preview 用 material handle、preload 校验新 command input。
- **E2E / Manual：** create base → add Markdown → search → view chunks → delete；add processed document（mock 轻量 processor）；restart during import 和 delete cleanup。

**合并前最低 gate：** `pnpm lint`、`pnpm test`、`pnpm format`、`pnpm build:check`；knowledge E2E/manual smoke 在 preview/nightly promotion 前。

**rebuildMaterial 专项测试要点：** 事务原子性（失败不混合旧新 chunk）、旧 unit 清理、新 unit 写入、embedding 写入；embedding GC（仍被其他 `search_text` 引用的 embedding 不能被删，无引用的可 GC）；FTS rowid mapping；repeated-text offset。

---

## 17. 风险与决策待办

**主要风险与处理：**

| 风险 | 处理 |
| --- | --- |
| 旧向量库文件与新目录冲突 | 第一阶段先改路径；新索引库固定 `{baseId}/.cherry/index.sqlite`；开发期旧 v2 数据可重建 |
| FileEntry 依赖散落 UI/service/workflow | 以 `relativePath` 为唯一读取路径，逐个移除 `/files/entries/:id` 和 file_ref |
| URL/note 仍用旧来源重建 | 导入时写 Markdown 快照，普通 reindex 只读快照 |
| chunk offset 错配 | chunker 保留 offset 或 cursor-based 匹配，禁止 naive 从头 `indexOf` |
| embedding 模型变更后混用旧维度 | `index_meta` snapshot mismatch 时清空 embedding 并全量重嵌入，禁止新旧向量混用 |
| 删除 row 后无法清理文件 | 删除流程最后删 `knowledge_item` row（保留待清理路径） |
| 删除 base 时 index store 句柄未关闭 | `KnowledgeIndexStore` 必须支持 close，rm 目录前释放（尤其 Windows） |
| base delete crash strands rows | base-level deleting intent 或幂等清理路径 |
| 旧向量被错误复用 | 默认 rebuild，仅在 material id/text hash/model id/dimensions 全匹配时复用 |
| KnowledgeIndexStore 原子性错误 | POC A 配 failure injection + rollback 测试 |
| migration 丢失源内容 | copy/snapshot 配可恢复失败态 |
| 当前 v2 与 v2.x 语义混淆 | 当前 v2 只预埋 schema 和目录形态，不启用 watcher/FTS-only/内容索引 UI/processed Markdown 独立 item |

**仍需拍板的开放问题（实现前确认）：**

- URL migration policy（源内容不可用时；sitemap 折叠为 `url`）。
- attachment/preview IPC shape（base-owned files）。
- `deleteItemChunk` 最终过渡行为（移除 vs unsupported stub）——需用户确认是否移除。
- legacy id 保留/重映射规则（当前全部重新生成，与「保留合法旧 id」目标冲突）。
- 文件冲突策略——产品目标为「覆盖/保留副本/跳过」三选一，当前 as-built 为 reject-on-conflict，需用户拍板是否补齐 keep-both（详见 [产品文档](./knowledge-product-spec.md) 与本文 §15 PR2）。
- restore/duplicate 是否复制已处理 Markdown、是否补 `duplicateBase`（当前缺）。
- `missing` material 保留时长，是否需用户可见恢复入口。
- 手动 `content_index_entry` 在文件内容变化后的高级保留策略。
- FTS 维护用 trigger 还是索引服务同事务写入；FTS tokenizer 是否 trigram/unicode61 或应用层 CJK 分词后写入 `search_text`。
- `locator_json` 具体格式；captured material 的 `source_ref_json` 是否统一 envelope。
- 每库 `index.sqlite` 访问层是 DataApi 扩展还是独立 lifecycle service + IPC（per-base index 更适合由 main process service 经 IPC 暴露，而非全局 DataApi 表）。
- 最终类/服务命名（`KnowledgeIndexStoreService`）。

完整 as-built 偏离证据与 5 条战略决策逐条 `file:line` 见本地 `docs/references/knowledge/experiment/drift-report-2026-06-08.md`。
