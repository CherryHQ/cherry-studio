# 知识库 v2 — E2E 功能测试计划

> 环境、启动、定位策略见 [../README.md](../README.md)（通用规范）；数据模型 / API / 文案附录见 [reference.md](./reference.md)。
> 全部用例在 **zh-CN** 界面、**隔离实例**（`MAIN_VITE_USER_DATA_DEV_SUFFIX`）下执行。涉及索引的用例需要**真实 embedding 接口**。

## 功能地图

| 域 | 覆盖用例 |
| --- | --- |
| A. 导航与空状态 | KB-A-* |
| B. 知识库生命周期（建/改名/移动/删除/重建） | KB-B-* |
| C. 分组管理 | KB-C-* |
| D. 数据源添加（文件/目录/URL/笔记） | KB-D-* |
| E. 数据源处理状态、单项操作、Chunks | KB-E-* |
| F. 数据源删除与批量操作 | KB-F-* |
| G. 数据源搜索与过滤 | KB-G-* |
| H. RAG 配置 — 文件处理 / 分块 / 嵌入 | KB-H-* |
| I. RAG 配置 — 检索（检索模式 / Top K / 阈值 / Hybrid / 重排） | KB-I-* |
| J. RAG 配置 — 保存 / 重建 / 恢复默认逻辑 | KB-J-* |
| K. 召回测试（检索 / 结果 / 历史） | KB-K-* |
| L. HTTP API 网关 | KB-L-* |
| M. 边界与校验 | KB-M-* |

三个详情 Tab：`数据源`（data）/ `RAG 配置`（rag）/ `召回测试`（recall）。来源：`DetailTabs.tsx`。

---

## A. 导航与空状态

### KB-A-1 进入知识库页
- 目标：从侧边栏进入知识库页。
- 前置：应用已启动。
- 步骤：
  1. 点击侧边栏「知识库」图标。
- 预期：
  - URL hash 含 `/app/knowledge`（`src/renderer/components/app/Sidebar.tsx:41`）。
  - 显示左侧知识库导航区 + 右侧内容区。

### KB-A-2 无知识库时的空状态
- 目标：未创建任何知识库时的引导。
- 前置：当前 profile 无知识库。
- 步骤：进入知识库页。
- 预期：
  - 左侧列表为空（文案「暂无知识库」`knowledge.empty`）。
  - 右侧为空状态区（`KnowledgePageEmptyStateSection.tsx`），提供创建入口。

### KB-A-3 左侧导航宽度可拖拽
- 目标：导航区可调宽。
- 步骤：拖拽 `data-testid="base-navigator-resize-handle"` 手柄。
- 预期：导航区宽度随拖拽变化并保持。

---

## B. 知识库生命周期

### KB-B-1 创建知识库（自动获取维度）
- 目标：用最小必填项创建知识库。
- 前置：已配置可用 embedding 模型。
- 步骤：
  1. 点击创建入口（导航区「+」/ 空状态创建按钮），打开创建对话框（标题「添加」`knowledge.add.title`）。
  2. 「名称」输入 `E2E-KB-1`（`common.name`）。
  3. 「嵌入模型」选择一个可用模型（`knowledge.embedding_model`）。
  4. 点击「确定」提交（`knowledge.add.submit`）。
- 预期：
  - 自动调用 `fetchDimensions` 获取维度并创建成功（`CreateKnowledgeBaseDialog.tsx:196`）。
  - 对话框关闭，新知识库出现在左侧并被选中，右侧显示其详情（默认 `数据源` Tab）。
  - 状态为「就绪」（`knowledge.status.completed`）。
- 参考接口：`window.api.knowledge.createBase`（IPC `knowledge:create-base`）。

### KB-B-2 创建知识库（维度获取失败 → 手动维度）
- 目标：维度自动获取失败时回退到手动输入。
- 前置：选择一个无法自动探测维度的模型，或断网制造 `fetchDimensions` 失败。
- 步骤：
  1. 打开创建对话框，填名称、选模型，提交。
  2. 自动获取失败后，出现「嵌入维度」输入框（`knowledge.dimensions`）与错误提示。
  3. 手动输入正整数维度，再次提交。
- 预期：
  - 失败时展示 `message.error.get_embedding_dimensions` 前缀的错误。
  - 维度输入只接受数字（非数字被过滤，`CreateKnowledgeBaseDialog.tsx:311`）。
  - 输入合法维度后创建成功。
- 参考：`CreateKnowledgeBaseDialog.tsx:186-203`。

### KB-B-3 创建时校验：名称必填
- 步骤：打开创建对话框，名称留空，提交。
- 预期：名称框标红，提示「知识库名称为必填项」（`knowledge.name_required`），不提交。

### KB-B-4 创建时校验：嵌入模型必填
- 步骤：填名称，不选模型，提交。
- 预期：模型框标红，提示「知识库嵌入模型是必需的」（`knowledge.embedding_model_required`），不提交。

### KB-B-5 重命名知识库
- 步骤：
  1. 在左侧某知识库行打开右键 / 「更多」上下文菜单。
  2. 选择「重命名」（`knowledge.context.rename`），打开重命名对话框（标题「重命名知识库」`knowledge.rename_title`）。
  3. 改名为 `E2E-KB-renamed`，确认。
- 预期：列表与详情头部名称更新；失败时提示 `knowledge.error.failed_to_edit`。
- 参考：`NavigatorMenu.tsx:88`、`KnowledgeBaseNameDialog.tsx`。

### KB-B-6 移动知识库到分组 / 取消分组
- 前置：至少存在一个分组（见 C）。
- 步骤：
  1. 知识库上下文菜单 →「移动到」（`knowledge.context.move_to`）。
  2. 选择某个分组；再操作一次选择「默认 / 未分组」移回。
- 预期：知识库在分组间正确移动；失败时提示 `knowledge.error.failed_to_move`。
- 参考：`NavigatorMenu.tsx:94-119`。

### KB-B-7 删除知识库
- 步骤：
  1. 上下文菜单 →「删除」（`knowledge.context.delete`，destructive 样式）。
  2. 在确认对话框确认。
- 预期：
  - 知识库从列表消失；若是当前选中项，右侧回到空状态。
  - 后端级联删除其全部数据源、向量库（`KnowledgeService.deleteBase`，IPC `knowledge:delete-base`）。
  - 失败时提示 `knowledge.error.failed_to_delete`。

### KB-B-8 重建失败的知识库（Restore）
- 目标：迁移 / 配置失败（如缺失 embedding 模型）的知识库可重建。
- 前置：存在一个 `status=failed` 的知识库（可由 v1 迁移缺模型造成，错误码 `missing_embedding_model`）。
- 步骤：
  1. 选中失败知识库，进入 `RAG 配置` Tab。
  2. 看到失败提示（`data-testid="rag-failed-state"`，文案「失败」`knowledge.status.failed` + 失败原因）。
  3. 点击「重建知识库」（`knowledge.restore.action`），在重建对话框选择新的 embedding 模型并确认（`knowledge.restore.submit` =「重建」）。
- 预期：
  - 失败原因正确显示（`knowledge.error.missing_embedding_model` 等）。
  - 重建成功后知识库回到就绪态；失败时提示 `knowledge.restore.failed_to_restore`。
- 参考：`RagConfigPanel.tsx:27-48`、`RestoreKnowledgeBaseDialog.tsx`、`window.api.knowledge.restoreBase`。

---

## C. 分组管理

### KB-C-1 新建分组
- 步骤：导航区创建菜单 →「新建分组」（`knowledge.groups.add`），输入名称（占位「输入分组名称...」`knowledge.groups.name_placeholder`），确认。
- 预期：分组出现在导航区；空名校验「分组名称为必填项」（`knowledge.groups.name_required`）；失败提示 `knowledge.groups.error.failed_to_create`。
- 参考：`CreateKnowledgeGroupDialog.tsx`、`BaseNavigatorCreateMenu.tsx`。

### KB-C-2 在分组内新建知识库
- 步骤：分组行上下文菜单 →「在此分组新建」（`knowledge.groups.create_base_here`），完成创建对话框。
- 预期：新知识库归属该分组（创建对话框中「分组」预选该分组）。
- 参考：`NavigatorMenu.tsx:150-154`。

### KB-C-3 重命名分组
- 步骤：分组上下文菜单 →「重命名」（标题「重命名分组」`knowledge.groups.rename_title`），改名确认。
- 预期：分组名更新；失败提示 `knowledge.groups.error.failed_to_update`。

### KB-C-4 删除分组（库回落到默认）
- 步骤：分组上下文菜单 →「删除分组」（`knowledge.groups.delete`），确认（提示「删除后，该分组下的知识库将移至默认分组」`knowledge.groups.delete_confirm_description`）。
- 预期：分组消失，其下知识库移动到默认 / 未分组，**不被删除**；失败提示 `knowledge.groups.error.failed_to_delete`。

---

## D. 数据源添加

> 添加入口：`数据源` Tab → 底部 / 头部「添加数据源」（`knowledge.data_source.toolbar.add`）弹出来源菜单。来源 Tab 顺序固定为 **文件 / 笔记 / 目录 / 链接**（`constants.ts` `KNOWLEDGE_DATA_SOURCE_TYPES`）。对话框标题「添加数据源」（`knowledge.data_source.add_dialog.title`）。

### KB-D-1 添加文件数据源
- 前置：选中一个就绪知识库；准备小体积样本（如 `.md` / `.txt` / `.pdf`）。
- 步骤：
  1. 「添加数据源」→ 选「文件」。
  2. 拖拽文件到拖拽区（`data-testid="file-dropzone"` 区域，文案「点击选择文件或拖拽到此处」）或点击选择。
  3. 文件出现在已选列表（`data-testid="knowledge-source-file-list"`），底部显示「已选 N 个文件」（`...footer.selected_files`）。
  4. 点击提交。
- 预期：
  - 对话框关闭，数据源出现在列表，状态依次流转 `等待中 → 分块中 → 嵌入中 → 就绪`（见 E）。
  - 成功 toast「数据源已添加到知识库」（`...add_dialog.submit.success`）。
- 参考接口：`window.api.knowledge.addItems`（IPC `knowledge:add-items`），类型 `file`。

### KB-D-2 添加多个文件
- 步骤：一次拖入多个文件后提交。
- 预期：批量创建多条 `file` 数据源；单次最多 100 项（`KNOWLEDGE_RUNTIME_ITEMS_MAX`，见 KB-M-5）。

### KB-D-3 支持的文件类型提示
- 目标：核对支持格式文案。
- 预期：
  - 占位文案显示「支持 PDF, DOCX, MD, XLSX, TXT, CSV」（`...add_dialog.placeholder.supported_formats`）。
  - 代码常量 `KNOWLEDGE_SUPPORTED_FILE_TYPES` = `PDF, DOCX, MD, XLSX, TXT, CSV, EPUB`，且存在 `EpubReader`。
  - ⚠️ **已知不一致**：UI 文案缺少 `EPUB`，但底层支持 EPUB。记录为待澄清项（不阻塞，验证 EPUB 能否实际索引可作为补充用例）。
- 参考：`constants.ts:7`、`readers/files/EpubReader.ts`、`zh-cn.json` `...placeholder.supported_formats`。

### KB-D-4 添加目录数据源（递归导入）
- 步骤：
  1. 「添加数据源」→ 选「目录」。
  2. 点击选择目录（`data-testid="knowledge-source-directory-select"`，文案「点击选择文件夹」），通过系统目录选择器选一个含若干支持文件的文件夹。
  3. 目录出现在已选列表（`data-testid="knowledge-source-directory-list"`），底部「已选 N 个目录」。
  4. 提交。
- 预期：
  - 创建一条 `directory` 数据源，状态经 `准备中(preparing)` 展开为多个子文件项，逐个索引（`prepareRootJobHandler` → `indexDocumentsJobHandler`）。
  - 文案说明「将递归导入文件夹中的支持文件」（`...add_dialog.directory.description`）。
- 参考：`window.api.file.selectFolder`、`utils/sources/directory.ts`、状态机 `directory: idle→preparing→processing→completed`。

### KB-D-5 添加 URL 数据源
- 步骤：
  1. 「添加数据源」→ 选「链接」。
  2. 在输入框（`knowledge.data_source.add_dialog.url.input_label`「网页地址」，占位 `https://example.com`）填入一个可访问网页。
  3. 提交。
- 预期：
  - 创建一条 `url` 数据源，抓取网页正文 → 分块 → 嵌入（`KnowledgeUrlReader`、`utils/sources/url.ts`）。
  - 帮助文案「将自动抓取页面文本并分块索引」（`...url.help`）。
- 参考接口：`addItems` type `url`，data `{ url, source }`。

### KB-D-6 笔记来源当前不可用（占位）
- 目标：确认 note 来源在 UI 上**尚未接入**。
- 步骤：「添加数据源」→ 选「笔记」。
- 预期：
  - 显示占位空状态：标题「暂未接入笔记数据源」（`...add_dialog.note.empty_title`）、说明「真实笔记列表接入后…当前可先使用文件、目录或链接。」。
  - **提交按钮对 note 恒不可用**（`AddKnowledgeItemDialog.tsx:147-149` `canSubmit` 对 note 返回 `false`；`NoteSourceContent.tsx` 有 `TODO(knowledge)` 占位）。
- 备注：底层类型 / Reader（`KnowledgeNoteReader`）已就绪，仅 UI 未接入。属**已知未完成功能**，记录但不算缺陷。

### KB-D-7 添加时无选择不可提交
- 步骤：在文件 / 目录 / URL Tab 未选择任何内容时观察提交按钮。
- 预期：提交按钮禁用（`canSubmit`：file 需 ≥1 文件、directory 需 ≥1 目录、url 需非空）。

### KB-D-8 从来源菜单直达指定来源 Tab
- 步骤：点击「添加数据源」展开来源菜单，分别点「文件 / 目录 / 链接」。
- 预期：对话框打开并定位到对应来源 Tab（`pendingAddSource` 驱动，`AddKnowledgeItemDialog.tsx:119-121`）。

---

## E. 数据源处理状态、单项操作、Chunks

### KB-E-1 状态流转可见
- 目标：观察数据源从入队到就绪的状态。
- 步骤：添加一个文件 / URL 后观察该行状态徽标。
- 预期：依次出现 `等待中(pending) → 分块中(chunking) → 嵌入中(embedding) → 就绪(ready)`（`...data_source.status.*`）。失败显示「错误」（`...status.error`）并带失败原因（行 `aria-label` = failureReason，`KnowledgeItemRow.tsx:62`）。
- 后端状态机：`file/url/note: idle→processing→reading→embedding→completed`，失败 → `failed`（`types/knowledge.ts:50-61`）。

### KB-E-2 就绪计数摘要
- 预期：头部显示「{ready}/{total} 就绪」（`...data_source.ready_summary`），随索引完成更新。详情头部条目计数 `detail-header-item-count`。

### KB-E-3 查看 Chunks
- 步骤：在某就绪数据源行打开「更多」菜单（`aria-label="更多"`）→「查看 Chunks」（`...actions.view_chunks`）。
- 预期：
  - 打开 Chunk 详情面板（侧栏），列出该数据源所有分块（`KnowledgeItemChunkDetailPanel.tsx`）。
  - 每个 chunk 显示内容与元数据；计数「{n} chunks」（`...data_source.chunks_count`）。
- 参考接口：`window.api.knowledge.listItemChunks(baseId, itemId)`。

### KB-E-4 删除单个 Chunk
- 步骤：在 Chunk 详情面板删除某个 chunk，确认（标题「确认删除 Chunk」`...chunk_delete_confirm_title`，说明「删除后该 Chunk 将不再参与召回，重新索引数据源后会重新生成」）。
- 预期：该 chunk 从列表与向量库移除；后续召回不再命中。
- 参考接口：`window.api.knowledge.deleteItemChunk(baseId, itemId, chunkId)`。

### KB-E-5 预览原文
- 步骤：数据源行「更多」→「预览原文」（`...actions.preview_source`）。
- 预期：展示原始内容；无可预览原文时提示「当前数据源没有可预览的原文」（`...preview.unavailable`），失败提示 `...preview.failed`。
- 参考：`usePreviewKnowledgeSource.ts`。

### KB-E-6 重新索引单个数据源
- 步骤：数据源行「更多」→「重新索引」（`...actions.reindex`）。
- 预期：
  - 该项清空原向量并重新走 读取→分块→嵌入，状态回到处理中再到就绪。
  - 失败提示「数据源重新索引失败」（`...reindex_failed`）。
- 参考接口：`window.api.knowledge.reindexItems(baseId, [itemId])`（IPC `knowledge:reindex-items`），`reindexSubtreeJobHandler`。

---

## F. 数据源删除与批量操作

### KB-F-1 删除单个数据源
- 步骤：数据源行「更多」→「删除」（`...actions.delete`），确认（标题「确认删除数据源」`...delete_confirm_title`，说明「删除后将无法恢复该数据源及其索引数据」）。
- 预期：该项标记 `deleting` 并在清理后从列表消失，向量被清除（`deleteSubtreeJobHandler`，级联子项）；失败提示「删除数据源失败」（`...delete_failed`）。
- 参考接口：`window.api.knowledge.deleteItems(baseId, [itemId])`。

### KB-F-2 进入批量选择
- 步骤：勾选某行复选框（`aria-label="选择行"` / 表头「全选」`...table.select_all`）。
- 预期：头部切换为批量栏，显示「已选 N 项」（`...bulk.selected_count`），出现「重新索引 / 删除 / 取消」（`...bulk.*`）。
- 参考：`DataSourcePanelHeader.tsx:63-86`。

### KB-F-3 批量重新索引
- 步骤：多选后点「重新索引」（`...bulk.reindex`）。
- 预期：所选项全部重新索引。

### KB-F-4 批量删除
- 步骤：多选后点「删除」（`...bulk.delete`），确认（标题「确认批量删除」`...bulk.delete_confirm_title`，说明含「确认删除选中的 N 个数据源？删除后无法恢复」）。
- 预期：所选项全部删除并清向量。

### KB-F-5 取消批量
- 步骤：批量栏点「取消」（`...bulk.cancel`）。
- 预期：退出批量模式，选择清空，恢复普通头部。

---

## G. 数据源搜索与过滤

### KB-G-1 列表内搜索
- 步骤：在数据源工具栏搜索框（占位「搜索数据源」`...toolbar.search_placeholder`）输入关键字。
- 预期：列表按名称过滤；无匹配显示「未找到匹配的数据源」（`...toolbar.no_search_results`）。

### KB-G-2 按类型过滤
- 步骤：使用类型过滤（`...filters.*`：全部 / 文件 / 笔记 / 目录 / 链接）。
- 预期：仅显示对应类型数据源。
- 参考：`utils/selectors.ts`。

---

## H. RAG 配置 — 文件处理 / 分块 / 嵌入

> 进入某知识库 → `RAG 配置` Tab（`data` 之外）。面板自上而下分区：**文档处理 → 分块 → 嵌入 → 检索**（`RagConfigPanel.tsx:140-190`）。底部「恢复默认」+「保存 / 重建」。

### KB-H-1 文件处理器选择
- 步骤：在「文档处理」区切换处理服务商（`knowledge.rag.file_processing` / `processor`）。
- 预期：可选「处理服务商」（`knowledge.rag.processor`），提示文案 `...file_processing_hint`；选择被标记为脏（dirty），可保存。仅对新导入内容生效。
- 参考：`FileProcessingSection.tsx`。

### KB-H-2 分块大小 / 重叠
- 步骤：在「Chunking」区修改「分段大小」（`knowledge.rag.chunk_size`）与「重叠大小」（`knowledge.rag.chunk_overlap`）。
- 预期：
  - 仅接受数字（非数字被过滤）。
  - 默认值 chunkSize=1024、chunkOverlap=200。
  - 警告文案「分段大小和重叠大小修改只针对新添加的内容有效」（`...chunk_size_change_warning`）。
- 参考：`ChunkingSection.tsx`、`DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE/OVERLAP`。

### KB-H-3 分块校验：重叠 < 大小
- 步骤：将重叠设为 ≥ 分段大小。
- 预期：报错「分块重叠必须小于分块大小」（`...chunk_overlap_must_be_smaller`）；重叠为空但大小有值时「分块重叠依赖分块大小」（`...chunk_overlap_requires_chunk_size`）；大小 ≤0「分块大小必须大于 0」。保存按钮不可用。
- 参考：`types/knowledge.ts:156-161, 485-501`、`utils` 校验。

### KB-H-4 嵌入模型展示与刷新维度
- 步骤：「嵌入」区查看当前模型（`knowledge.rag.embedding_model`）与「向量维度」（`knowledge.rag.dimensions`），点「刷新向量维度」（`knowledge.rag.refresh_dimensions`）。
- 预期：维度重新探测并填入；无模型时 toast「知识库嵌入模型是必需的」；失败 toast `message.error.get_embedding_dimensions`。
- 参考：`EmbeddingSection.tsx`、`RagConfigPanel.tsx:88-100`。

### KB-H-5 修改嵌入模型 / 维度触发「重建」而非「保存」
- 目标：验证改 embedding 配置走 restore 流程（需重建索引）。
- 步骤：在「嵌入」区切换为另一个 embedding 模型（或改维度）。
- 预期：
  - 底部主按钮文案从「保存」变为「重建」（`RagConfigPanel.tsx:206`，`embeddingConfigChanged` 为真时用 `knowledge.restore.submit`）。
  - 点击后进入重建对话框（携带新 embedding 模型 / 维度初值），而非静默保存。
  - 仅切换模型、维度留空且分块合法时可「自动维度重建」（`canRestoreWithAutoDimensions`，`RagConfigPanel.tsx:78-86`）。
- 参考：`RagConfigPanel.tsx:102-126`。

---

## I. RAG 配置 — 检索

> 「检索」区（`RetrievalSection.tsx`）。

### KB-I-1 请求文档片段数（Top K）
- 步骤：拖动「请求文档片段数 (Top K)」滑块（`knowledge.rag.document_count`）。
- 预期：范围 **1–50**，步长 1（`RetrievalSection.tsx:45-56`）。

### KB-I-2 检索模式切换
- 步骤：切换「检索模式」（`knowledge.rag.search_mode.title`）：向量检索(default) / 全文检索(bm25) / 混合检索(hybrid，标「推荐」)。
- 预期：
  - 默认模式为 **hybrid（混合检索）**（`DEFAULT_KNOWLEDGE_SEARCH_MODE`）。
  - 选项文案：`向量检索 / 全文检索 / 混合检索（推荐）`（`...search_mode.default/bm25/hybrid`）。

### KB-I-3 相似度阈值（条件显示）
- 目标：阈值仅在特定条件出现。
- 步骤：分别在 default 模式、设置了 rerank 模型、以及 bm25/hybrid 无 rerank 三种情况查看「相似度阈值」（`knowledge.rag.threshold`）。
- 预期：
  - **仅当** `searchMode === 'default'` **或**已选 rerank 模型时显示阈值滑块（`RetrievalSection.tsx:41,58`，`usesRelevanceThreshold`）。
  - 范围 0.0–1.0，步长 0.1。
  - 其它情况按排序返回，不显示阈值（提示 `...hints.threshold_disabled`）。

### KB-I-4 Hybrid Alpha（仅混合模式）
- 步骤：在 hybrid 模式查看「Hybrid Alpha」滑块（`knowledge.rag.hybrid_alpha`）。
- 预期：
  - **仅** hybrid 模式显示（`isHybridMode`，`RetrievalSection.tsx:82`），默认 0.5，范围 0–1 步长 0.1。
  - 切到非 hybrid 后该项隐藏；校验：非 hybrid 不允许带 hybridAlpha（`types/knowledge.ts:164-170`）。

### KB-I-5 重排模型（Rerank）
- 步骤：在「重排模型 (Rerank)」（`knowledge.rag.rerank_model`）下拉选择 / 取消（默认「不使用」`knowledge.rag.rerank_disabled`）。
- 预期：
  - 选了 rerank 模型后，结果按 ranking 排序，且阈值滑块出现（见 KB-I-3）。
  - 取消则回「不使用」。
- 参考：`RetrievalSection.tsx:97-104`。

---

## J. RAG 配置 — 保存 / 重建 / 恢复默认

### KB-J-1 保存非嵌入类改动
- 步骤：改动分块 / 检索 / 文件处理（不动 embedding 模型与维度）后点「保存」（`knowledge.rag.save_action`）。
- 预期：成功 toast「已保存」（`knowledge.rag.saved`）；失败 toast `knowledge.error.failed_to_edit`。
- 参考接口：DataApi `PATCH /knowledge-bases/:id`（不含 embeddingModelId/dimensions）。

### KB-J-2 脏状态与保存可用性
- 步骤：未改动时观察底部按钮。
- 预期：无改动时「保存」不可用、「恢复默认」不可用（`isDirty=false`）；有合法改动后可用（`canSave`）。

### KB-J-3 恢复默认（重置表单）
- 步骤：改动若干项后点「恢复默认」（`knowledge.rag.reset_action`）。
- 预期：表单恢复到 `initialValues`（当前已保存值），未持久化（`RagConfigPanel.tsx:201`）。

### KB-J-4 改嵌入配置 → 重建（与 KB-H-5 联动）
- 步骤：改 embedding 模型后点「重建」。
- 预期：走 restore 流程；详见 KB-H-5。

---

## K. 召回测试

> 进入某知识库 → `召回测试` Tab。组件：`RecallTestProvider/RecallSearchBar/RecallResultCard/RecallHistoryList`。

### KB-K-1 空状态
- 预期：未检索时显示「输入查询语句开始检索测试」（`knowledge.recall.empty_title`）、「结果将展示匹配的文档片段和分数」（`...empty_description`）。

### KB-K-2 执行检索
- 前置：知识库已有就绪数据源。
- 步骤：在输入框（占位「输入测试 Query...」`knowledge.recall.placeholder`）输入查询，点「检索」（`knowledge.recall.submit`）或回车。
- 预期：
  - 检索中显示「正在检索...」（`...searching`）。
  - 返回结果卡片列表，显示「{n} 个结果」（`...result_count`）与耗时「{ms}ms」（`...duration`）。
  - 空查询（trim 后为空）不触发检索（`RecallTestProvider.tsx:62-65`）。
- 参考接口：`window.api.knowledge.search(baseId, query)`（IPC `knowledge:search`）。

### KB-K-3 结果分数语义（relevance vs ranking）
- 目标：核对两类分数展示。
- 预期：
  - `scoreKind=relevance`：每张卡显示「相关度 {score}」（`...result_relevance`），顶部显示「最高: {score}」（`...top_score`）。
  - `scoreKind=ranking`：显示「排序 #{rank}」（`...result_rank`）、整体「按排序返回」（`...ranking_only`）。
  - 分数类型由检索模式 / 是否 rerank 决定（结合 I 区配置交叉验证）。
- 参考：`RecallTestProvider.tsx:58-59`、`utils.ts mapRecallResult`。

### KB-K-4 结果卡展开 / 收起 / 复制
- 步骤：展开（`...recall.expand`）/ 收起（`...recall.collapse`）片段，复制（`...recall.copy`）。
- 预期：片段全文可展开；复制到剪贴板。

### KB-K-5 检索历史
- 步骤：连续检索多个不同 query；打开历史（`...recall.history_title`「搜索历史」）；点选某条；删除某条（`...history_remove`）；清空（`...history_clear`）。
- 预期：
  - 历史按 base 维度缓存（`useCache('knowledge.recall.search_queries')`，`RecallTestProvider.tsx:35`），最新在前（`prependHistoryQuery`）。
  - 点选历史回填输入框；删除 / 清空即时生效。
  - **切换知识库后历史与结果重置**（`RecallTestProvider.tsx:42-54` 对 `baseId` 变化清空）。

### KB-K-6 检索失败处理
- 步骤：制造检索失败（如 embedding/向量库异常）。
- 预期：toast「召回测试检索失败」（`...recall.search_failed`）前缀的错误；结果清空。

---

## L. HTTP API 网关（可选，curl 验证）

> 路由挂载于 API Server `/v1/knowledge-bases`（`apiGateway/routes/knowledge/index.ts`）。需 API Server 开启并知道其端口 / 鉴权（参见 apiGateway 配置）。

### KB-L-1 列出知识库
- 请求：`GET /v1/knowledge-bases?limit=20&offset=0`
- 预期：返回 `{ knowledge_bases: [...], total }`，支持 offset/limit 切片。

### KB-L-2 获取单个知识库
- 请求：`GET /v1/knowledge-bases/:id`
- 预期：返回该库；不存在返回 404（`DataApiError NOT_FOUND`）。

### KB-L-3 跨库检索
- 请求：`POST /v1/knowledge-bases/search`，body `{ query, knowledge_base_ids?, document_count? }`
- 预期：
  - 指定 ids 时仅检索这些库（全部不存在 → 404）。
  - 未指定 ids 检索全部库；无任何库 → 200 + warnings「No knowledge bases configured…」。
  - 结果按 score 降序、截断到 `document_count`（默认 5）。
  - 全部库检索失败 → 503（`SERVICE_UNAVAILABLE`）；部分失败 → 200 + warnings。
- 参考：`apiGateway/routes/knowledge/index.ts:46-141`。

---

## M. 边界与校验

### KB-M-1 名称 / 模型必填
- 见 KB-B-3 / KB-B-4。

### KB-M-2 分块重叠约束
- 见 KB-H-3（overlap < size；overlap≥0；size>0）。

### KB-M-3 Hybrid Alpha 与模式一致性
- 见 KB-I-4（仅 hybrid 可设 hybridAlpha）。

### KB-M-4 阈值条件可见性
- 见 KB-I-3。

### KB-M-5 单次添加上限 100 项
- 步骤：尝试一次添加 > 100 个文件 / 项。
- 预期：受 `KNOWLEDGE_RUNTIME_ITEMS_MAX=100` 限制（`types/knowledge.ts:91`）。核对超限时的报错 / 截断行为并记录。

### KB-M-6 笔记内容上限
- 备注：`note` 内容上限 `KNOWLEDGE_NOTE_CONTENT_MAX = 1,000,000` 字符（`types/knowledge.ts:92`）。当前 note UI 未接入（KB-D-6），此项暂作底层约束记录，待 UI 接入后验证。

### KB-M-7 失败知识库的 RAG 面板
- 见 KB-B-8（`status=failed` → `rag-failed-state` + 重建入口；正常态才显示完整配置表单）。

### KB-M-8 切换知识库时召回状态隔离
- 见 KB-K-5（切库清空 query / 结果 / 历史视图）。

### KB-M-9 deleting 项对读取不可见
- 目标：正在删除的项默认从列表 / 检索 / RAG 读取中隐藏。
- 步骤：触发删除后立即观察列表与召回。
- 预期：`deleting` 状态项不出现在默认列表 / 检索结果（`types/knowledge.ts:48,314-317`）。

---

## 执行建议顺序

1. 环境 + 模型就绪（README 一）。
2. A → B（建库）→ C（分组）→ D（加数据源）→ E（等待就绪）。
3. H/I/J（RAG 配置，注意 H-5/J-4 重建会重置索引，放在召回测试前或单开一个库）。
4. K（召回测试，依赖 E 已就绪）。
5. F（删除 / 批量）、G（搜索过滤）穿插。
6. L（HTTP，可选）。
7. M（边界）随相关域执行。
8. 收尾：删除测试库（KB-B-7）或销毁隔离 profile。
