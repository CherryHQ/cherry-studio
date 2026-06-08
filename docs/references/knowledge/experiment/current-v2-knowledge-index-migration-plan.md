# 当前 v2 知识库改造技术方案

Date: 2026-06-06

本文从 [Knowledge index.sqlite Schema](./index-sqlite-schema-design.md) 中单独抽离当前 v2 必须落地的技术改造。它只描述当前 v2 的实现终态、改造步骤和验证范围；v2.x 文件夹型知识库的产品能力只作为兼容目标出现。

> 状态(2026-06-08): 本文仍是当前 v2 知识库改造的**目标方案**,但 baseline 已经前进,部分地基已就绪、部分前提已调整。以下据 as-built 现状校准,各节内保留尚未执行的计划项。
>
> **已具备地基**(baseline 已实现,后续在其上继续):file leaf 数据模型 `{ source, relativePath, indexedRelativePath? }`(`fileEntryId` 已从 knowledge 移除);中心化路径模块 `pathStorage.ts`(含安全校验 `assertSafeKnowledgeRelativePath`);文件拷入 base 目录的导入流程(create 不再写 knowledge `file_ref`);path-based 文件处理 + 持久化恢复;MinerU 用 `context.dataId`;job payload 去 FileEntry;渲染层去 FileEntry + add-item DTO 拆分;删除 leaf/容器/base 的顺序;`index.sqlite` 已落在 `{baseId}/.cherry/index.sqlite`。
>
> **仍待执行**(核心计划,尚未开始或前提已变):`material` 模型 + 9 表 `index.sqlite` + `KnowledgeIndexStore`(当前运行时仍是旧单表 `libsql_vectorstores_embedding` + `external_id` API);url/note 的 Markdown 快照(当前 url 每次联网抓取、note 读 inline `data.content`);`knowledge_item.id == material.material_id`;v1 迁移写入新 index.sqlite 形态。

## 1. 背景与目标

当前 v2 仍在开发阶段，向量库 schema、文件导入方式和知识库 item data 都可以调整。目标是在 v2 阶段把数据形态先对齐未来 v2.x，降低用户从 v2 切换到 v2.x 时的重建成本。

当前 v2 改造后的核心事实(`index.sqlite` 位置已统一为 `{baseId}/.cherry/index.sqlite`,见下文状态说明):

```text
KnowledgeBase/
  {baseId}/
    .cherry/
      index.sqlite
    paper.pdf
    paper.md
    captures/
      url/
        example.md
      note/
        meeting-note.md
```

> 状态(2026-06-08): baseline 已直接采用 `.cherry/` 隐藏布局(`pathStorage.ts:8-28`,`CHERRY_META_DIR = '.cherry'`)。原先"当前 v2 放在根目录、v2.x 才移进 `.cherry/`、升级时再移动"的区分已作废 —— 移动已经发生,`.cherry` 同时是材料禁止前缀。下文凡涉及 index.sqlite 位置统一为 `{baseId}/.cherry/index.sqlite`。

当前 v2 要达成的目标：

- 保留全局 `knowledge_base`，继续作为知识库元数据、模型配置、UI 列表和 DataApi 数据源。
- 保留全局 `knowledge_item`，继续作为当前 v2 UI 数据源、状态展示、任务编排和 chunk 详情入口。
- 当前 v2 起，用户上传文件直接复制到 `KnowledgeBase/{baseId}/`，不再用 FileManager `file_entry` 作为知识库材料身份。
- 当前 v2 起，每个知识库使用 `KnowledgeBase/{baseId}/.cherry/index.sqlite`，表结构直接采用未来兼容 schema。
- 当前 v2 的 `knowledge_item.id` 直接等于 `material.material_id`，避免以后 v2.x 迁移时重新建立材料身份。(仍待执行:当前 baseline 迁移会重新生成 id,该等式尚未成立。)
- 当前 v2 搜索仍返回旧的 chunk-oriented `KnowledgeSearchResult`，但底层索引按 `material/content/search_unit/search_text/embedding` 写入。
- 当前 v2 仍要求 embedding model 和 dimensions 有效，不开放 FTS-only 知识库。
- 当前 v2 不启用 watcher，不自动索引用户在 App 外手动放入知识库目录的文件。

## 2. 非目标

当前 v2 不做：

- 不停止使用 `knowledge_item`。当前 v2 UI 仍依赖它。
- 不上线 v2.x 文件夹 UI，不把真实目录树作为 UI 的唯一来源。
- 不提供 watcher / scan 自动导入。
- 不提供 FTS-only 知识库。
- 不生成或编辑 `content_index_entry`，只创建表。
- 不正式维护 `material_relation`，只创建表。
- 不支持单 chunk 删除。chunk、FTS、embedding 都是派生索引，删除或重建以 material 为单位。
- 不做软删除。
- 不推断 App 关闭期间发生的离线移动。
- 不把 MinerU 处理中间 artifacts、assets、页面缓存纳入知识库目录。当前只保存最终 Markdown。

## 3. 当前 v2 需要保留和改造的表

### 3.1 全局 App SQLite

当前 v2 全局 App SQLite 继续保留 2 张知识库业务表：

| 表 | 当前 v2 终态 |
| --- | --- |
| `knowledge_base` | 保留。继续保存名称、group、embedding 模型、dimensions、chunk 设置、搜索模式、fileProcessorId 等元数据。 |
| `knowledge_item` | 保留。继续保存当前 v2 UI item、树形容器、状态、错误、任务编排输入。leaf item 的 `id` 同步作为 per-base `material.material_id`。 |

`knowledge_base` 不需要为了 `index.sqlite` 额外保存 per-row embedding contract。当前 embedding 模型和维度仍通过 `knowledge_base.embeddingModelId`、`knowledge_base.dimensions` 读取，并且由 `embeddingModelId -> user_model` 的 FK 维护。

`knowledge_item` 的表结构可以继续使用 JSON `data` 列，但 shared zod 类型和服务写入语义必须改。关键变化是 leaf item 的读取路径从 FileManager / URL / inline note 改为知识库目录内 `relativePath`。

需要同步调整的不只是 persisted entity：

- `KnowledgeItemDataSchema`
- `KnowledgeItemSchema` / type-status union
- `CreateKnowledgeItemSchema`
- `KnowledgeRuntimeAddItemInput`
- renderer 到 main 的 add-item DTO
- preload 暴露的知识库 API 类型

所有创建入口可以传外部 path、URL 或 note content 作为导入输入，但持久化后的 `knowledge_item.data` 必须是本地 `relativePath` 形态。也就是说，外部 path 和 note content 是 command input，不是持久化索引事实。

### 3.2 每个知识库的 `index.sqlite`

> 状态(2026-06-08): 本节 9 表方案**已设计、尚未实现**,保留为要执行的计划。当前运行时仍是旧单表 `libsql_vectorstores_embedding` + `external_id` API(`packages/vectorstores/libsql`),material 模型与下列各表都还没建。下表的"是否使用"列描述的是计划终态,不是 baseline 现状。

当前 v2 每个知识库创建 9 张表：

| 表 | 计划终态(尚未实现) | 用途 |
| --- | --- | --- |
| `index_meta` | 使用 | 保存 schema version、base_id、embedding contract 快照、chunker/normalization 版本。 |
| `material` | 使用 | 保存当前 v2 leaf `knowledge_item` 对应的材料身份和实际索引路径。 |
| `material_relation` | 只创建 | v2.x 再记录 `processed_from` 等关系。当前 v2 先不用它表达 PDF -> Markdown。 |
| `content` | 使用 | 保存整份材料的规范化文本，不保存 per-chunk 文本。 |
| `search_unit` | 使用 | 保存 chunk 等检索单元，绑定 `material_id` 和 `content_hash`，带 offset。 |
| `content_index_entry` | 只创建 | v2.x 再启用问题、摘要、关键词、标签。 |
| `search_text` | 使用 | 保存 FTS 和 embedding 共用的检索文本投影。当前 v2 写 `body`；如写 `title`，title 命中也必须回到对应 body chunk。 |
| `embedding` | 使用 | 保存当前 embedding contract 下的向量。 |
| `search_text_fts` | 创建并同步 | 当前 v2 可继续 hybrid/BM25 搜索，FTS 数据来自 `search_text`。 |

表结构以 [Knowledge index.sqlite Schema](./index-sqlite-schema-design.md) 为准。当前 v2 可以不填未来字段，但不能使用旧 `external_id` 向量表作为终态。

## 4. `knowledge_item.data` 目标形态

### 4.1 共享字段

所有 item 保留：

```ts
{
  source: string
}
```

`source` 只表示原始来源或展示身份，不是读取路径。

示例：

- 本地文件：`source = "/Users/me/Downloads/paper.pdf"`
- URL：`source = "https://example.com/post"`
- note：`source = "会议纪要"`
- directory：`source = "/Users/me/Documents/Research"`

### 4.2 file leaf

```ts
type FileItemData = {
  source: string
  relativePath: string
  indexedRelativePath?: string
}
```

规则：

- `relativePath` 是源文件复制到 `KnowledgeBase/{baseId}/` 后的最终相对路径。
- `indexedRelativePath` 是处理器产物路径，例如 PDF 由 MinerU 输出 Markdown 后写入。
- 索引读取路径为 `indexedRelativePath ?? relativePath`。
- UI 当前 v2 仍显示 `relativePath` 对应的源文件 item。

示例：

```ts
{
  source: "/Users/me/Downloads/paper.pdf",
  relativePath: "paper.pdf",
  indexedRelativePath: "paper.md"
}
```

### 4.3 url leaf

```ts
type UrlItemData = {
  source: string
  url: string
  relativePath: string
}
```

> 状态(2026-06-08): url 的 Markdown 快照模型**仍待执行**。baseline 现状是 `UrlItemData = { source, url }`(无 `relativePath`),每次 reindex 都联网抓取(`KnowledgeUrlReader.ts:13` 调 `fetchKnowledgeWebPage`)。下列规则是计划目标。

规则：

- URL 导入时抓取正文并生成 Markdown 快照。
- 当前 v2 重新索引时读取本地 Markdown，不再实时抓网络。
- `url` 用于展示、刷新或未来重新抓取，不是索引读取路径。

示例：

```ts
{
  source: "https://example.com/post",
  url: "https://example.com/post",
  relativePath: "captures/url/example-post.md"
}
```

### 4.4 note leaf

```ts
type NoteItemData = {
  source: string
  relativePath: string
  sourceUrl?: string
}
```

> 状态(2026-06-08): note 的 Markdown 快照模型**仍待执行**。baseline 现状是 `NoteItemData = { source, content, sourceUrl }`(inline),reindex 读 `data.content`(`KnowledgeNoteReader.ts`)。下列规则是计划目标。

规则：

- note 内容写成 Markdown 文件。
- 当前 v2 不再把 note 正文作为 `knowledge_item.data.content` 的索引事实。
- `sourceUrl` 只保留外部来源关系。

示例：

```ts
{
  source: "meeting-note",
  relativePath: "captures/note/meeting-note.md",
  sourceUrl: "https://example.com/meeting"
}
```

### 4.5 directory container

当前 v2 仍可保留：

```ts
type DirectoryItemData = {
  source: string
  path: string
}
```

规则：

- directory 是当前 v2 UI 和 Job 容器，不创建 `material`。
- directory 展开出的 leaf file item 写 `relativePath`。
- v2.x 中目录由真实文件夹表达。

> 状态(2026-06-08): sitemap 已不作为独立 item 类型(`KNOWLEDGE_ITEM_TYPES = ['file','url','note','directory']`),v1 sitemap 迁移为 `url`。本节移除 `SitemapItemData` 及相关容器规则。

### 4.6 相对路径校验

所有 `relativePath` / `indexedRelativePath` 必须满足：

- 非空。
- 不是绝对路径。
- 不包含 `..` 路径逃逸。
- 不指向 `.cherry` 或 `.cherry/**`。
- 不使用空字节。
- 由统一路径 helper 规范化为 POSIX 风格存储。

当前 v2 可以先忽略隐藏文件和临时文件导入，或者在目录导入时跳过它们。实现必须保证任何 reader、delete、restore 都不能用未经校验的 relative path 直接拼接文件系统路径。

> 状态(2026-06-08): 已具备。上述校验由主进程 helper `assertSafeKnowledgeRelativePath` 实现(`pathStorage.ts:98-111`,禁绝对路径/`..`/`.cherry`/`.cherry/**`/NUL),`getKnowledgeBaseFilePath` 等拼接入口在拼路径前调用它。zod schema 只做形状校验(`relativePath: z.string().min(1)`),不承担路径安全;安全校验在主进程 helper 层,不在 zod。

## 5. 知识库目录与路径服务

> 状态(2026-06-08): 已具备。路径职责已收敛到主进程**函数模块** `src/main/services/knowledge/utils/storage/pathStorage.ts`(不是 `KnowledgeBaseFileService` / `KnowledgeBasePathService` class)。下文据真实导出函数描述。

`pathStorage.ts` 的真实导出函数:

- `getKnowledgeBaseDir(baseId)`：返回知识库根目录 `KnowledgeBase/{baseId}/`。
- `getKnowledgeBaseMetaDir(baseId)`：返回 `.cherry` 元数据目录。
- `getKnowledgeVectorStoreFilePath(baseId)` / `getKnowledgeVectorStoreFilePathSync(baseId)`：返回索引库路径 `KnowledgeBase/{baseId}/.cherry/index.sqlite`(已统一,不再有"当前 v2 根目录 vs v2.x 隐藏目录"之分)。
- `getKnowledgeBaseFilePath(baseId, relativePath)`：校验并解析 `relativePath` 到绝对路径(这是 plan 早期假设的 `resolveMaterialPath`,真实名称为此)。
- `getKnowledgeSourceRelativePath` / `toKnowledgeRelativePath` / `getProcessedMarkdownRelativePath`：相对路径推导与处理产物路径推导。
- `copyFileIntoKnowledgeBase[At]`：复制文件到知识库根目录。
- `deleteKnowledgeItemFiles` / `deleteKnowledgeBaseDir`：删除 leaf item 关联文件 / 整库目录。
- `assertSafeKnowledgeRelativePath`：相对路径安全校验(见 §4.6)。

仍待执行的职责(尚未由 `pathStorage.ts` 承担):

- 写入 URL / note Markdown 快照(url/note 快照模型整体未做,见 §4.3/§4.4)。
- 删除整库目录前关闭 index store handle(由删除流程协调,见 §10.3)。

> 状态(2026-06-08): 冲突策略**已调整**。`pathStorage.ts` 不执行 keep-both;实时 add 走 reject-on-conflict(`assertTargetAvailable` 在目标已存在时抛 "Knowledge file already exists",`pathStorage.ts:122-133`),只有 v1 迁移器去重。详见 §6.2。

路径获取必须遵循项目规则,根目录由 `application.getPath` 提供,嵌套路径在模块内 `path.join` 维护:

```ts
const root = application.getPath('feature.knowledgebase.data')
const baseDir = path.join(root, baseId)
const indexPath = path.join(baseDir, '.cherry', 'index.sqlite')
```

不要把 `baseId/.cherry/index.sqlite` 作为 `application.getPath(namespace, filename?)` 的第二个参数传入。`application.getPath` 只负责 namespace 根路径或单文件名，嵌套路径由模块内 `path.join` 维护。

## 6. 导入与创建流程

### 6.1 创建知识库

当前 v2 创建知识库时：

1. 创建全局 `knowledge_base` 行。
2. 创建 `KnowledgeBase/{baseId}/` 目录。
3. 创建 `KnowledgeBase/{baseId}/.cherry/index.sqlite`。
4. 初始化 9 张 `index.sqlite` 表。
5. 写入 `index_meta(id = 1, base_id = baseId, embedding_model_id_snapshot, dimensions_snapshot, ...)`。

> 状态(2026-06-08): step 3 的目录/路径地基已具备(`.cherry/index.sqlite`);step 4/5 的 9 表 + `index_meta` 仍待执行(见 §3.2),当前 baseline 在该路径上创建的是旧单表向量库。

打开 `index.sqlite` 时必须校验 `index_meta.base_id === baseId`。如果不一致，拒绝打开或进入明确修复流程。

### 6.2 添加文件

当前 v2 添加文件时：

1. Renderer 传入外部文件路径或选择结果，不再先调用 `ensureExternalEntry` 创建 FileEntry。
2. Main 进程复制文件到 `KnowledgeBase/{baseId}/`。
3. 如果目标路径已存在，直接 reject-on-conflict 报错 "Knowledge file already exists"(`assertTargetAvailable`,`pathStorage.ts:122-133`),不做 keep-both;落盘前还需对 reservedPaths 做预检,拒绝写入 `.cherry/**` 等保留前缀(由 `assertSafeKnowledgeRelativePath` 覆盖)。
4. 创建 `knowledge_item(type = file)`，`data.relativePath` 为最终落盘路径。

> 状态(2026-06-08): 冲突策略已从 keep-both 调整为 reject-on-conflict。只有 v1 迁移器会去重(用 `-N` 连字符后缀,`KnowledgeMigrator.ts:115-130`),实时 add 不生成 `_2`/`_3` 后缀。
5. 创建或更新 `material(material_id = knowledge_item.id, relative_path = data.relativePath, origin = user, index_policy = index)`。
6. 如果需要文件处理，进入文件处理流程；否则直接进入索引流程。

当前 v2 不创建 FileEntry，不写 `file_ref` 作为知识库材料身份。

`KnowledgeItemService` 中围绕知识库 file item 的 `file_ref` 逻辑应删除或停止被知识库调用：

- create file item 不查 `file_entry`。
- create file item 不写 knowledge source 的 `file_ref`。
- `replaceFileRef` 不再用于处理器产物回写；替代为 `updateIndexedRelativePath(itemId, relativePath)`。
- `rebuildFileRefsForItems` 不再在 indexing 前调用。
- 删除知识库 item 不需要清理 FileEntry 关系，只清理 base 目录文件和 `index.sqlite`。

如果其他业务仍需要 `file_ref`，保留在各自业务边界内，不作为 knowledge material identity。

### 6.3 添加目录

当前 v2 添加目录时：

1. 创建 `knowledge_item(type = directory)` 作为 UI 容器。
2. 复制目录树到 `KnowledgeBase/{baseId}/`。
3. 只复制可导入文件，跳过隐藏文件、临时文件、`.cherry/**`。
4. 为每个可索引 leaf 文件创建 `knowledge_item(type = file, groupId = directoryItem.id)`。
5. leaf item 的 `relativePath` 写复制后的最终相对路径。
6. leaf item 创建对应 `material` 并进入处理或索引。

目录 item 本身不创建 `material`。

现有 `prepare-root` / directory source expansion 需要同步改造：展开每个文件时不再调用 FileManager `ensureExternalEntry`，而是复制文件并返回 leaf item 的 `relativePath`。目录复制和 leaf item manifest 必须使用同一套 ignore 规则，避免复制了没有 child item 管理的隐藏文件、临时文件或 `.cherry/**`。

### 6.4 添加 URL

当前 v2 添加 URL 时：

1. 抓取 URL 内容。
2. 生成 Markdown 快照，例如 `captures/url/<slug>.md`。
3. 创建 `knowledge_item(type = url)`。
4. `data.url` 和 `data.source` 保留原始 URL，`data.relativePath` 指向 Markdown 快照。
5. 创建 `material(origin = captured, relative_path = data.relativePath, index_policy = index)`。
6. 读取本地 Markdown 进入索引。

重新索引当前 v2 URL item 时不重新抓网络，只读本地 Markdown。刷新 URL 是另一个显式动作。

### 6.5 添加 note

当前 v2 添加 note 时：

1. 把 note 内容写成 Markdown，例如 `captures/note/<slug>.md`。
2. 创建 `knowledge_item(type = note)`。
3. `data.source` 保存标题或来源描述，`data.relativePath` 指向 Markdown 文件。
4. 创建 `material(origin = captured, relative_path = data.relativePath, index_policy = index)`。
5. 读取本地 Markdown 进入索引。

重新索引当前 v2 note item 时不读 `data.content`。

> 状态(2026-06-08): 原 §6.6"添加 sitemap"已移除。sitemap 不再作为独立 item 类型,v1 sitemap 迁移为 `url`。

## 7. 文件处理改造

当前 v2 知识库不再要求材料先注册为 FileManager entry。文件处理服务应复用现有 `FileHandle`，并增加输出目标。

> 状态(2026-06-08): 已具备,且收敛得比 plan 更激进。`FileProcessingOutputTarget` 已是**单臂** `{ kind: 'path' }`(无 union),`managed_artifact` 被整个删除;`document_to_markdown` 入队前**强制要求** path output(`FileProcessingService.ts:80-82`);MinerU 只认 `context.dataId`(无 `fileEntryId` 回退,`mineru/document-to-markdown/handler.ts:88-90`)。下文据此修正。

目标接口：

```ts
type FileProcessingOutputTarget = { kind: 'path'; path: FilePath }

interface StartFileProcessingJobInput {
  feature: FileProcessorFeature
  file: FileHandle
  processorId?: FileProcessorId
  output?: FileProcessingOutputTarget
  context?: {
    dataId?: string
  }
}
```

当前 v2 知识库调用：

```ts
await fileProcessingService.startJob({
  feature: 'document_to_markdown',
  file: { kind: 'path', path: absoluteSourcePath },
  output: { kind: 'path', path: absoluteMarkdownPath },
  processorId: base.fileProcessorId,
  context: { dataId: item.id }
})
```

`document_to_markdown` 入队前必须携带 path output;没有 path output 的入队会被拒绝。处理器内部统一接收 resolved `FileInfo`，不关心调用方使用 entry 还是 path。当前不新增 `knowledgebase` feature；知识库文档转 Markdown 继续使用现有 `document_to_markdown` feature。如果后续要新增 feature，必须同步扩展 preset、preference、IPC schema、job registry 和 processor registry。

path output 不能只存在于内存调用栈。file-processing job input / output schema、remote-poll payload 和 JobSnapshot rehydrate 都必须持久化：

- `file: FileHandle`
- `output: FileProcessingOutputTarget`
- `context.dataId`
- 处理完成后的实际 `output.path`

否则远程处理器轮询、进程重启或 job recovery 后会丢失目标 Markdown 路径。

MinerU 当前如果依赖 `fileEntryId`，需要改为从 `context.dataId` 获取业务身份。如果 provider contract 需要 `data_id`，知识库调用传 `data_id = context.dataId`。同一个 item 的重试必须幂等地写入同一个 output target：先写临时文件，再原子 rename 到 `output.path`，避免半写入 Markdown 被索引。

处理完成后当前 v2 的行为：

1. `checkFileProcessingResult` 读取 job output 的 Markdown path。
2. 校验 Markdown path 位于 `KnowledgeBase/{baseId}/` 内。
3. 把相对路径写回 `knowledge_item.data.indexedRelativePath`。
4. 更新 `material.relative_path = indexedRelativePath`，表示实际被索引的文件。
5. 调度 `indexDocuments`。

当前 v2 不为 `paper.md` 创建新的 `knowledge_item`。删除 `paper.pdf` 这个 item 时，同时删除 `paper.pdf` 和 `paper.md`。

v2.x 升级拆分规则必须保持当前索引身份稳定：

- 当前 v2 的 `knowledge_item.id` / `material_id` 继续归属实际被索引的 Markdown material，即 `indexedRelativePath` 指向的 `paper.md`。
- 源 PDF `relativePath` 指向的 `paper.pdf` 在 v2.x 扫描时生成新的 `material_id`，通常 `index_policy = suppress`。
- 升级时补写 `material_relation(relation_type = processed_from, source_material_id = pdfMaterialId, target_material_id = markdownMaterialId)`。
- 这样现有 chunk、embedding、locator 仍绑定 Markdown material，不需要把旧索引从 PDF id 迁到 Markdown id。

如果当前 v2 file item 没有 `indexedRelativePath`，它的 `knowledge_item.id` / `material_id` 继续归属原文件 material。

对应的 knowledge job payload 也需要移除 FileEntry 语义：

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

不要再传 `sourceFileEntryId` 或 `processedFileEntryId`。轮询处理器结果时，应通过 file-processing job 的 `context.dataId === itemId` 和 output target 校验归属；索引 job 应从最新的 `knowledge_item.data.indexedRelativePath ?? relativePath` 读取实际索引文件。

## 8. 索引服务改造

### 8.1 替换旧 vectorstore 抽象

旧接口以 `external_id` 为中心：

```ts
replaceByExternalId(itemId, nodes)
listByExternalId(itemId)
deleteByIdAndExternalId(id, itemId)
```

当前 v2 应替换为知识库语义接口，建议命名为 `KnowledgeIndexStore`：

```ts
interface KnowledgeIndexStore {
  rebuildMaterial(materialId: string, input: RebuildMaterialInput): Promise<void>
  deleteMaterial(materialId: string): Promise<void>
  listMaterialUnits(materialId: string): Promise<KnowledgeSearchUnit[]>
  search(input: KnowledgeIndexSearchInput): Promise<KnowledgeIndexSearchResult[]>
  close(): Promise<void>
}
```

当前 v2 的兼容映射：

- `materialId = knowledge_item.id`
- `chunkId = search_unit.unit_id`
- 旧 `KnowledgeSearchResult.content = search_text.text`
- 旧 `KnowledgeSearchResult.itemId = material_id`

`deleteItemChunk` UI/API 应移除或返回 unsupported。它不能继续删除单条派生 chunk。

> 状态(2026-06-08): 当前 baseline 的 `deleteItemChunk` **仍全链路可用**(UI → preload → IPC → `deleteByIdAndExternalId`,`KnowledgeService.ts:295-309,543`)。其移除绑定 material 模型落地(material 模型下 chunk 是派生索引、不支持单 chunk 删),material 模型尚未实现,故此项保留为未来工作。

当前 `planKnowledgeItemSource` 一类的调度判断也要改为基于知识库内路径：

- 文件扩展名从 `data.indexedRelativePath ?? data.relativePath` 或 `data.relativePath` 推导，而不是从 `data.source` 推导。
- 如果已经存在 `indexedRelativePath`，普通 reindex 直接索引 Markdown，不再次触发文件处理。
- “重新处理 PDF” 应是显式 reprocess 动作，先生成新的 Markdown，再调度 indexing。

### 8.2 `rebuildMaterial` 写入语义

`rebuildMaterial(materialId, input)` 必须在一个写事务内完成：

1. upsert `material`。
2. upsert `content`。
3. 删除该 `material_id` 旧的 `search_unit` 和对应 `search_text`。
4. 插入新的 `search_unit`。
5. 插入新的 `search_text` 和同步 FTS。
6. 插入缺失的 `embedding`。
7. 更新 `material.current_content_hash`、`last_indexed_at`、`last_error_* = null`。

它要保持旧 `replaceByExternalId(itemId, nodes)` 的原子替换语义：不能出现旧 chunk 和新 chunk 混合可见。

`embedding` 以 `embedding_text_hash` 为主键，可能被多个 `search_text` 共享。`rebuildMaterial` 删除旧 `search_text` 后，不能直接删除旧 embedding；只能删除不再被任何 `search_text.embedding_text_hash` 引用的 embedding，或者交给后续 GC 清理。

并发写入仍需要走当前知识库 base mutation lock；如果底层使用全局 SQLite 写事务，还要遵循项目 `DbService.withWriteTx` 的写序列化原则。per-base `index.sqlite` 的 libSQL 写事务也必须避免并发写冲突。

### 8.3 chunk、offset 和 `unit_id`

当前 v2 chunker 需要从只返回文本升级为返回文本和 offset：

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

必须满足：

```ts
content.text.slice(charStart, charEnd) === bodySearchText.text
```

这个约束只适用于 `search_text.kind = body`。`title`、未来的 `question`、`summary`、`keyword`、`tag` 不一定等于 `content.text` 的某个 slice，但它们必须绑定到一个 `search_unit`，最终返回当前 v2 旧 chunk result 时仍回到该 unit 的 body 文本。

不能用从头开始的 naive `indexOf(chunkText)` 推断 offset，因为重复段落会错配。可用 cursor-based search 或让 chunker 在切分时保留 offset。

`unit_id` 稳定生成：

```text
unit_id = hash(material_id + content_hash + unit_type + unit_index + char_start + char_end)
```

`unit_id` 不包含 `chunker_config_hash`。chunker contract 变化由 `index_meta.chunker_config_hash` 触发全量重建。

### 8.4 embedding contract

当前 v2 仍要求 `knowledge_base.embeddingModelId` 和 `knowledge_base.dimensions` 有值。

`embedding` 表不保存 per-row `model_id` 或 `dimensions`。打开 index store 时：

1. 从全局 `knowledge_base` 读取当前模型和维度。
2. 从 `index_meta` 读取 snapshot。
3. 如果 snapshot 为空，写入当前模型和维度。
4. 如果 snapshot 与全局配置不一致，标记需要全量重嵌入；不能混用旧维度向量。

如果用户修改 embedding 模型或维度，当前 v2 必须清空旧 embedding 并重建所有 material。

> 状态(2026-06-08): 本节 `index_meta` snapshot + 选择性重嵌的设计**保留为未来计划目标**(随 §3.2 的 9 表方案一起落地)。baseline 当前用过渡手段:embedding 配置每库不可变,改模型/维度会触发把整库 restore 进一个新库(`KnowledgeVectorStoreService.ts:37-39`),而不是 snapshot 比对 + 选择性重嵌。restore 只是过渡;未来计划目标仍是这里的 index_meta snapshot 机制。

### 8.5 搜索行为

当前 v2 搜索仍以旧 UI 和旧调用方为目标：

1. 读取 `knowledge_base` 获取搜索模式、threshold、documentCount、hybridAlpha。
2. `KnowledgeIndexStore.search()` 在 `search_text`、`search_text_fts`、`embedding` 上执行 BM25 / vector / hybrid。
3. 搜索结果 join `search_unit -> material`。
4. 过滤 `material.status = active` 且 `material.index_policy = index`。
5. 再过滤当前 v2 `knowledge_item.status = completed` 且非 deleting，确保 UI 删除或失败 item 不返回。
6. 映射成当前 v2 `KnowledgeSearchResult`。

当前 v2 的旧 result shape 必须返回 chunk 正文。最简单的规则是当前 v2 搜索只使用 `search_text.kind = body`；如果实现同时索引 title，title 命中也要回表找到同一 `search_unit` 的 body search_text，不能把标题字符串当作 chunk content 返回。

`snippets`、`matchedKinds`、material-level result 和 `read(locator)` 是 v2.x Agent-first 搜索结果的一部分。当前 v2 不计算、不返回这些字段，只保证底层 `search_unit` / `locator_json` / offset 足够以后升级。

v2.x 后再把搜索结果升级为 material result + locator + `read(locator)`。

FTS 实现注意：不要把 TEXT `search_text_id` 当作 FTS rowid。应使用 `search_text.rowid` 与 `search_text_fts.rowid` 对齐。

## 9. Reader 改造

当前 v2 的 `loadKnowledgeItemDocuments` 应统一按知识库目录读取：

```ts
const relativePath = item.data.indexedRelativePath ?? item.data.relativePath
const absolutePath = getKnowledgeBaseFilePath(baseId, relativePath)
```

file item(已具备):

- 不调用 `FileManager.getPhysicalPath(fileEntryId)`。
- 读取 `KnowledgeBase/{baseId}/{indexedRelativePath ?? relativePath}`。

url item(仍待执行,当前 baseline 仍联网):

- 不在重新索引时 fetch 网络。
- 读取 `relativePath` 指向的 Markdown 快照。

note item(仍待执行,当前 baseline 仍读 inline content):

- 不读取 `data.content`。
- 读取 `relativePath` 指向的 Markdown 快照。

directory(sitemap 已不作为 item 类型,见 §4.5)：

- 不直接读取。
- 只负责展开 child item 或作为 UI 容器。

如果当前 v2 读取 `relativePath` / `indexedRelativePath` 时发现文件缺失，应在 base mutation lock 内把对应 `material.status` 标记为 `missing`、写入 `missing_since` 和错误摘要，并把 `knowledge_item` 置为 `failed` 或保持可重试失败态。搜索必须过滤 `material.status != active`，不能继续返回旧索引内容。

## 10. 删除、重建、恢复与复制

### 10.1 删除 leaf item

当前 v2 删除 file/url/note leaf item：

1. 取消该 item 的相关 jobs。
2. 将 `knowledge_item.status` 标记为 `deleting`，让搜索和 UI 默认隐藏。
3. 在 base mutation lock 内调用 `KnowledgeIndexStore.deleteMaterial(item.id)`。
4. 删除 `KnowledgeBase/{baseId}/{relativePath}`。
5. 如果存在 `indexedRelativePath`，也删除对应文件。
6. 删除全局 `knowledge_item` 行。

删除全局 row 必须最后执行。否则崩溃后会丢失需要清理的 relative path。

### 10.2 删除 directory container

当前 v2 删除 container：

1. 找到子树所有 leaf item。
2. 取消相关 jobs。
3. 子 leaf 按 leaf 删除流程清理 material/index/files。
4. 删除 container `knowledge_item` 行。

如果目录导入时复制了真实目录树，但树内文件都由 child item 管理，删除 container 可以按 child item manifest 清理。不要盲目删除整个 base 根目录。

### 10.3 删除 knowledge base

当前 v2 删除整库：

1. 取消该 base 下所有 jobs。
2. 关闭并释放该 base 的 `KnowledgeIndexStore` / libSQL client handle。
3. 删除 `KnowledgeBase/{baseId}/` 整个目录。
4. 删除全局 `knowledge_item` 行。
5. 删除全局 `knowledge_base` 行。

关闭 index store 必须在删除目录前完成，尤其要避免 Windows 文件句柄导致删除失败。

### 10.4 重建 item

当前 v2 重建 leaf item：

1. 不重新复制外部 `source`。
2. 读取知识库目录内 `indexedRelativePath ?? relativePath`。
3. 重新生成 content、search_unit、search_text、embedding。
4. 使用 `rebuildMaterial(item.id, input)` 原子替换。

如果用户希望重新抓取 URL 或重新处理 PDF，那是 refresh / reprocess 动作，不是普通 reindex。

> 状态(2026-06-08): file item 的 reindex 已从 base 目录读取(`indexedRelativePath ?? relativePath`),这部分地基已具备。

实现上要避免旧 `indexDocuments` 的 completed 快路径吞掉用户触发的重建。普通重复 job 可以在 item 已 `completed` 时跳过，但 reindex flow 必须在 enqueue 前把目标 leaf 重置为 `processing` / `reading`，或携带明确的 force 标记，让索引 job 执行完整 rebuild。

### 10.5 恢复和复制 knowledge base

当前 v2 restore / duplicate base：

1. 创建新的 `knowledge_base`。
2. 复制旧 `KnowledgeBase/{oldBaseId}/` 中用户可见材料文件到新 `KnowledgeBase/{newBaseId}/`。
3. 创建新的 `knowledge_item` rows，`relativePath` 和 `indexedRelativePath` 都指向复制后的路径。
4. 初始化新的 `index.sqlite`。
5. 重建所有 leaf material 索引。

不能复用旧 base 的外部 `source` 重新抓取或重新复制原始文件。`source` 只是展示和刷新身份。

对已经处理过的 PDF，restore / duplicate 必须同时复制源文件和 Markdown 产物。新 base 里的 item 仍显示源 PDF，但索引读取复制后的 `indexedRelativePath`。

> 状态(2026-06-08): 仍待执行。当前 baseline 的 restore 只复制源文件,**不复制 `indexedRelativePath` 指向的已处理 Markdown 产物**,而是重新处理(`KnowledgeService.ts:484-508`);`duplicateBase` 尚不存在。"复制源文件 + Markdown 产物 + duplicate base" 保留为待办。

## 11. v1 迁移到当前 v2

v1 迁移到当前 v2 的稳定终态应直接写入新的目录和索引形态。

> 状态(2026-06-08): 部分已具备 + 含已确认 bug。baseline 现状:已把 v1 上传文件拷入 `{newBaseId}/`、写 `relativePath`、不写 knowledge `file_ref`(`KnowledgeMigrator.ts:767`);但向量迁移仍写旧表(见下)、`knowledge_item.id` 当前全部重新生成(只留 legacy → new remap,`KnowledgeMappings.ts:253,400`)。下列步骤 3/6/7 的"新 index.sqlite 形态 + material"仍待执行。

迁移步骤：

1. 为每个 v1 knowledge base 创建当前 v2 `knowledge_base`。
2. 创建 `KnowledgeBase/{baseId}/`。
3. 初始化 `KnowledgeBase/{baseId}/.cherry/index.sqlite`。
4. 对每个 v1 文件材料，复制实际文件到 base 目录，创建 `knowledge_item(type = file)`，写 `relativePath`。
5. 对每个 v1 URL / note，生成 Markdown 快照，创建 `knowledge_item(type = url | note)`，写 `relativePath`。
6. 对每个 leaf item 创建 `material(material_id = knowledge_item.id)`。
7. 重建索引，写入 `content/search_unit/search_text/embedding`。

> ✅ 已修复(`a6128a6da9`): 此前 `KnowledgeVectorMigrator` 把重建的向量 DB 写到 **legacy 扁平路径** `{root}/{legacyBaseId}`,而运行时读的是 `{newBaseId}/.cherry/index.sqlite`(id 与布局两维度都不一致),中间无桥接、迁移后无 reindex,导致迁移后的向量被孤立、运行时读到一个自动新建的空库、迁移库搜索返回空。修复把**读源**(legacy,仅用于 `.embedjs.bak` 备份)与**写目标**(`getRuntimeVectorStorePath` = `{newBaseId}/.cherry/index.sqlite`,按新 base id)分离,`execute()` 先 `mkdir .cherry`、rename 前删掉运行时自建的空库(跨平台),`validate()` 改读运行时路径;回归测试断言运行时路径可读、legacy 扁平路径不再有 live 库。**残留(仍待执行)**:迁移器仍写旧单表 `libsql_vectorstores_embedding` 格式(只修了写入位置,未改表结构;9 表 material 终态仍是未来工作)。详见 drift-report §4。

`knowledge_item.id == material.material_id` 等式与"保留合法旧 id 作 `material_id`"保留为**未来计划目标**:如果 v1 的旧 `knowledge_item.id` 合法且不冲突，迁移时应保留为当前 v2 的 `knowledge_item.id`，从而继续满足 `knowledge_item.id = material.material_id`。如果旧 id 不合法或冲突，必须记录新旧 id 映射，保证 container `groupId`、job 输入和 UI 引用一致。(当前 baseline 全部重新生成 id、只留 remap,该等式尚未成立。)

如果 v1 已有旧向量库数据，不建议直接尝试迁移旧 chunk 行到新 schema，除非可以可靠恢复 content、offset、embedding contract 和 `unit_id`。当前更稳妥的 v1 -> v2 终态是复制材料文件后按新 schema 重建。

当前开发中的 v2 旧 vectorstore 数据可以视为开发期数据；最终只需要保证 v1 迁移到当前 v2 的终态稳定。

因此现有 v1 migration 代码也要同步改造(各项当前状态见括注)：

- `KnowledgeMappings` 不能继续生成持久化 `fileEntryId` / inline `content` 形态。(file 形态已具备;note 仍 inline,随 url/note 快照模型一起落地。)
- `KnowledgeMigrator` 不能为 knowledge item 写 knowledge source 的 `file_ref`。(已具备。)
- `KnowledgeVectorMigrator` 不能继续把旧 chunk 迁到 `libsql_vectorstores_embedding` 旧表。(仍待执行:当前仍写旧表;写到运行时读不到的 legacy 路径这一孤立 bug 已修复 `a6128a6da9` —— 见上文 ✅。)
- 如果要复用旧 embedding，必须满足 `embedding_text_hash` 完全一致、模型一致、维度一致；否则按新 schema 重嵌入。

## 12. UI 与 API 改造点

当前 v2 UI 继续展示 `knowledge_item`，但要移除 FileEntry 依赖。

> 状态(2026-06-08): FileEntry 去除已具备(渲染层无 `/files/entries/:id`、add-items DTO 已拆分、`fileProcessing.startJob` 用 `FileHandle`)。仍待执行:删除单 chunk 的按钮/API(`deleteItemChunk` 仍全链路可用,绑定 material 模型落地,见 §8.1);note content 改为提交后写 Markdown snapshot(当前仍持久化为 `data.content`)。

需要改：

- 新增文件入口不再调用 `ensureExternalEntry`。
- `SaveToKnowledgePopup` 从消息、主题或附件保存到知识库时，也不再调用 `resolveKnowledgeFileMetadataEntryData` 生成 FileEntry；它应把外部可读路径或已落盘临时文件作为导入 command input 传给 main，由 main 复制到 base 目录。
- note 保存入口仍可提交 note content 作为 command input，但落库后必须写 Markdown snapshot，并把 `knowledge_item.data.relativePath` 作为事实；不要继续把正文持久化为 `data.content`。
- 文件 item 行不再请求 `/files/entries/:id`。
- chunk detail 不再依赖 FileEntry 查询。
- 附件按钮如果需要引用知识库文件，应改为读取知识库目录内文件或走新的 knowledge material handle，不能假设 completed file item 有 `fileEntryId`。
- 删除单 chunk 的按钮或 API 移除。
- item 标题、文件后缀、预览路径从 `relativePath` 或 `source` 推导。
- 导入进度仍复用现有 JobManager。导入时显示解析进度，完成后不显示持久“已索引”状态。

API 可保留当前路由形态：

- `/knowledge-bases/:id/items`
- `/knowledge-items/:id`
- reindex item / subtree
- delete item / subtree
- list chunks
- search

但 payload 的 `data` 形状和底层实现必须按新目录语义调整。

preload / IPC 契约也要同步：

- knowledge add-items 接收导入 command input，而不是要求 renderer 先产出持久化 `knowledge_item.data`。
- fileProcessing preload 不再强制 `fileEntryId`，改为 `FileHandle` + output target + context。
- knowledge job payload types 移除 `processedFileEntryId` / `sourceFileEntryId`。
- `deleteItemChunk` 从 preload 移除，或保留为明确 unsupported 的兼容 stub。

## 13. 代码改造清单

建议按以下模块推进("状态"列为 2026-06-08 现状)：

| 模块 | 当前 v2 改造 | 状态 |
| --- | --- | --- |
| `src/shared/data/types/knowledge.ts` | 修改 leaf item data schema，增加 `relativePath` / `indexedRelativePath`，移除 file item 必需 `fileEntryId`，note 不再以 `content` 作为索引事实。 | file 部分已做(`fileEntryId` 已移除);note 仍 inline,未做 |
| `src/main/services/knowledge/utils/storage/pathStorage.ts` | 中心化路径模块(取代 plan 早期假设的 `KnowledgeItemService` file_ref 路径职责),提供 base dir / `.cherry/index.sqlite` / 安全校验 / 拷入 / 删除等函数。 | 已做(函数模块,非 class) |
| `src/main/data/services/KnowledgeItemService.ts` | 移除知识库材料对 FileEntry / file_ref 的身份依赖，增加更新 `indexedRelativePath` 的方法。 | 已做(`updateIndexedRelativePath` 取代 `replaceFileRef`,`KnowledgeItemService.ts:492`;create 不再 `ensureExternalEntry`/写 file_ref) |
| `src/main/services/knowledge/KnowledgeWorkflowService.ts` | 添加文件时复制到 base 目录，调度 path-based file processing 或 indexing。 | 已做(rename 完成) |
| `src/main/services/knowledge/utils/sources/*` | directory expansion 不再创建 FileEntry；目录 leaf 写 `relativePath`(子树路径 `{ownerId}/<subtreePath>` 防撞名、跳过 dotfile)。 | directory 已做;sitemap 已移除(不再作 item 类型) |
| `src/main/services/knowledge/readers/*` | file/url/note reader 统一读取知识库目录内文件。 | file 已做;url 仍联网(`KnowledgeUrlReader.ts:13`)、note 仍读 inline,未做 |
| `src/main/services/fileProcessing/*` | `StartFileProcessingJobInput` 改成 `FileHandle` + 单臂 `{kind:'path'}` output target + context。 | 已做 |
| `src/main/services/fileProcessing/processors/mineru/*` | 输出 Markdown 到指定 path，业务身份使用 `context.dataId`(无 `fileEntryId` 回退)。 | 已做 |
| `src/main/services/knowledge/vectorstore/*` | 从 `BaseVectorStore` 迁移为 `KnowledgeIndexStore`，路径已是 `{baseId}/.cherry/index.sqlite`。 | 未做(仍是旧 `external_id` 抽象);路径地基已具备 |
| `packages/vectorstores/libsql/*` | 如果继续复用 libSQL 包，需要把 schema 和方法改成 knowledge index 语义，或新增 knowledge 专用 libSQL store。 | 未做(仍是单表 `libsql_vectorstores_embedding`) |
| `src/main/services/knowledge/utils/indexing/chunk.ts` | chunk DTO 增加 offset，保证 body search_text 可由 `content.text.slice` 验证。 | 未做(绑定 material 模型) |
| `src/main/services/knowledge/utils/indexing/embed.ts` | embedding 输入改为 `search_text.text`，不再依赖旧 `TextNode.sourceNode.nodeId` / external_id 语义。 | 未做(绑定 material 模型) |
| `src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts` | 读取本地 material，chunk 带 offset，调用 `rebuildMaterial`。 | 未做(仍走 external_id 路径) |
| `src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts` | 处理 path output，回写 `indexedRelativePath`，不再保存 `processedFileEntryId`。 | 已做 |
| `src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts` | 清理 material/index/files，最后删除 `knowledge_item` row。 | 顺序已做(index/files → row);material 维度待 material 模型落地 |
| `src/main/services/knowledge/jobs/reindexSubtreeJobHandler.ts` | 不再用 `replaceByExternalId(itemId, [])`，改成 material 级 delete/rebuild。 | 未做(仍用 external_id) |
| `src/main/services/knowledge/KnowledgeService.ts` | delete base / restore base 改为操作 base 目录和新 `index.sqlite`，不能只删旧 vector store 或复用旧 root item data。 | delete base 已做;restore 只复制源文件、不复制 indexed 产物,部分待办(§10.5) |
| `src/main/data/migration/v2/*` | v1 -> v2 迁移直接生成 base 目录、材料文件、`index.sqlite` 终态。 | 文件/relativePath 已做;孤立向量 bug 已修复(`a6128a6da9`,§11);向量仍写旧单表格式,material 终态未做 |
| `src/preload/index.ts` | 同步 knowledge、fileProcessing IPC 契约，移除或 unsupported 单 chunk 删除。 | fileProcessing/payload 已做;`deleteItemChunk` 仍在(`preload/index.ts:358`),未移除 |
| `src/renderer/pages/knowledge/*` | 移除 FileEntry 查询依赖，改用 `relativePath` 展示和预览。 | 已做(无 `/files/entries/:id`) |
| `src/renderer/components/Popups/SaveToKnowledgePopup.tsx` | 保存到知识库入口不再创建 FileEntry；note content 只作为导入输入。 | FileEntry 去除已做;note 写 snapshot 未做 |

## 14. 实施阶段

### 阶段 1：目录和 schema 基础

> 状态(2026-06-08): 目录与路径地基已具备(`pathStorage.ts`,index.sqlite 已在 `.cherry/`);9 张表 + `index_meta` 仍待执行。

目标：

- 建立中心化路径模块 `pathStorage.ts`(取代早期 `KnowledgeBaseFileService` 设想)。(已做)
- vector store 路径为 `KnowledgeBase/{baseId}/.cherry/index.sqlite`。(已做)
- 初始化 9 张 `index.sqlite` 表。(未做)
- 写入并校验 `index_meta`。(未做)

验证：

- 新建知识库后目录和 `index.sqlite` 存在。
- `index_meta.base_id` mismatch 会拒绝打开。
- 旧 `KnowledgeBase/{baseId}` 文件路径不再与目录冲突。

### 阶段 2：`knowledge_item.data` 和导入落盘

> 状态(2026-06-08): file/directory 部分多已具备(拷入 base 目录、写 relativePath、reject-on-conflict);url/note 快照与 `id == material_id` 仍待执行。

目标：

- 修改 shared schema。(file 已做;note 仍 inline 未做)
- 文件、目录、URL、note 导入都生成知识库目录内材料文件。(file/directory 已做;url/note 未做。sitemap 已不作为 item 类型,移出本阶段)
- leaf `knowledge_item.id = material.material_id`。(未做,当前重新生成 id)

验证：

- 添加文件不会创建 FileEntry。
- URL / note 重新索引不访问网络或 inline content。
- 文件名冲突走 reject-on-conflict 报错,不做 keep-both;只有 v1 迁移器去重(`-N`)。

### 阶段 3：file processing path mode

> 状态(2026-06-08): 已具备。

目标：

- `StartFileProcessingJobInput` 支持 `FileHandle` 和单臂 `{kind:'path'}` output target。
- MinerU 输出 Markdown 到知识库目录(业务身份用 `context.dataId`)。
- 当前 v2 写回 `indexedRelativePath`，但不创建 Markdown item。

验证：

- PDF -> Markdown 后 UI 仍显示 PDF item。
- 索引读取 Markdown。
- 删除 item 同时删除 PDF 和 Markdown。

### 阶段 4：KnowledgeIndexStore

> 状态(2026-06-08): 未开始。这是核心未来工作 —— 当前运行时仍是旧单表 `libsql_vectorstores_embedding` + `external_id` API。

目标：

- 用 material 级 API 替换 `external_id` API。
- chunk 写入 `content/search_unit/search_text/embedding`。
- 搜索结果映射回当前 v2 `KnowledgeSearchResult`。

验证：

- `rebuildMaterial` 事务失败不会混合旧新 chunk。
- `listMaterialUnits(item.id)` 返回稳定 `unit_id`。
- 搜索过滤 failed/deleting item。

### 阶段 5：删除、恢复、迁移

> 状态(2026-06-08): 删除顺序已具备;restore 只复制源文件(不复制 indexed 产物、无 duplicate),部分待办;v1 迁移文件部分已做,向量迁移的孤立 bug 已修复(`a6128a6da9`,§11),但仍写旧单表格式。

目标：

- item 删除、container 删除、base 删除清理文件和索引。(顺序已做)
- restore / duplicate 复制知识库目录材料。(restore 部分待办;duplicate 未做)
- v1 迁移写入当前 v2 终态。(文件已做;向量孤立 bug 已修复 `a6128a6da9`;向量仍写旧单表格式,material 终态未做)

验证：

- 删除 leaf 后 `relativePath` 和 `indexedRelativePath` 文件都不存在。
- 删除 base 后整个 `KnowledgeBase/{baseId}/` 不存在。
- restore 后不依赖旧外部 `source`。

## 15. 测试计划

最低测试覆盖：

- shared schema：接受 `relativePath` / `indexedRelativePath`，拒绝绝对路径、`..`、`.cherry/**`。
- path service：base dir、index path(`.cherry/index.sqlite`)、resolve relative path、reject-on-conflict(目标已存在报 "Knowledge file already exists")、路径逃逸保护(`assertSafeKnowledgeRelativePath` 在主进程 helper 层,zod 仅形状)。
- file import：文件复制到 base 目录，不创建 FileEntry。
- directory import：递归复制、跳过隐藏文件、child item 写正确 `relativePath`。
- URL import：生成 Markdown 快照，reindex 不 fetch。
- note import：生成 Markdown 快照，reindex 不读 inline content。
- file processing：path input、path output、MinerU Markdown 写入、`indexedRelativePath` 回写。
- file processing recovery：remote-poll / process restart / JobSnapshot rehydrate 后仍保留 `output.path` 和 `context.dataId`，能写回同一个 Markdown target。
- index schema：9 张表初始化，`index_meta.base_id` 校验。
- rebuildMaterial：事务原子性、旧 unit 清理、新 unit 写入、embedding 写入。
- rebuildMaterial embedding GC：仍被其他 `search_text` 引用的 embedding 不能被删除；无引用 embedding 可由 GC 清理。
- offset：`content.text.slice(charStart, charEnd) === body search_text.text`。
- stable unit id：同内容重复重建 `unit_id` 不变。
- search：BM25 / vector / hybrid 能返回旧 result shape，并过滤 material 和 item 状态。
- search text kind：title 命中不能把 title 当旧 chunk content 返回，必须回到 body chunk。
- delete item：取消 job、清索引、删文件、最后删 row。
- delete crash retry：删除 leaf 时在删索引前、删文件前、删文件后崩溃，重试仍能凭 `knowledge_item.data.relativePath/indexedRelativePath` 幂等清理。
- delete base：关闭 store、删除目录、删除全局 rows。
- restore / duplicate：复制 base 目录材料和 `indexedRelativePath` 产物并重建索引。
- v1 migration：迁移后目录、item data、material、index.sqlite 终态一致，合法旧 `knowledge_item.id` 保留为 `material_id`，不产生 knowledge `file_ref`，不写旧 `libsql_vectorstores_embedding`。
- missing file：知识库内文件被外部删除后，read / reindex 标记 `material.status = missing` 或进入明确失败态，search 不返回旧索引。
- UI：列表和 chunk detail 不请求 FileEntry，删除 chunk 不可用。
- UI 保存入口：`KnowledgeItemRow`、`KnowledgeItemChunkDetailPanel`、`SaveToKnowledgePopup` 不调用 `/files/entries/:id` 或 `ensureExternalEntry`。
- IPC / preload：knowledge add-items、fileProcessing startJob、knowledge job payload 与新 DTO 一致，旧 FileEntry-only payload 被拒绝或迁移。
- path safety：file import、directory expansion、URL/note snapshot、fileProcessing output、reader、delete、restore 都拒绝绝对路径、`..`、`.cherry/**` 和空字节。

## 16. 主要风险与处理

| 风险 | 处理 |
| --- | --- |
| `KnowledgeBase/{baseId}` 旧向量库文件与新目录冲突 | 第一阶段先改路径。新索引库固定为 `{baseId}/.cherry/index.sqlite`。开发期旧 v2 数据可重建。 |
| FileEntry 依赖散落在 UI、service、workflow | 以 `knowledge_item.data.relativePath` 为唯一读取路径，逐个移除 `/files/entries/:id` 和 file_ref 依赖。 |
| URL / note 仍用旧来源重建 | 导入时必须写 Markdown 快照；普通 reindex 只读快照。 |
| chunk offset 错配 | chunker 保留 offset 或 cursor-based 匹配，禁止 naive 从头 `indexOf`。 |
| embedding 模型变更后混用旧维度 | `index_meta` snapshot mismatch 时要求清空 embedding 并全量重嵌入。 |
| 删除 row 后无法清理文件 | 删除流程最后删除 `knowledge_item` row。 |
| 删除 base 时 index store 文件句柄未关闭 | `KnowledgeVectorStoreService` / `KnowledgeIndexStore` 必须支持 close，并在 rm 目录前释放。 |
| 当前 v2 与 v2.x 语义混淆 | 当前 v2 只预埋 schema 和目录形态，不启用 watcher、FTS-only、内容索引 UI、processed Markdown 独立 item。 |

## 17. 当前 v2 与 v2.x 边界表

| 能力 | 当前 v2 | v2.x |
| --- | --- | --- |
| 全局 `knowledge_base` | 保留 | 保留或作为元数据入口继续存在 |
| 全局 `knowledge_item` | 保留，UI 依赖 | 不作为材料唯一事实，目录和 `index.sqlite` 管理材料 |
| 用户文件位置 | `KnowledgeBase/{baseId}/` | `KnowledgeBase/{baseId}/` |
| index.sqlite 位置 | `KnowledgeBase/{baseId}/.cherry/index.sqlite` | `KnowledgeBase/{baseId}/.cherry/index.sqlite` |
| FileManager FileEntry | 不作为材料身份 | 不作为材料身份 |
| URL / note | Markdown 快照文件(计划目标;baseline 当前 url 联网抓取、note inline) | 普通 captured material |
| PDF 处理产物 | `indexedRelativePath`，不创建新 item | Markdown 是独立 visible material |
| watcher / scan | 不启用 | 启用 |
| FTS-only | 不启用 | 可启用 |
| content index entry | 只建表 | 生成、编辑、检索 |
| material_relation | 只建表 | 正式维护 |
| 搜索返回 | 旧 chunk result | material result + locator + read(locator) |
