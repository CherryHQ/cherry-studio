# 知识库 v2 — E2E 参考附录

供 [test-plan.md](./test-plan.md) 引用的稳定事实。所有结论均核对自源码（路径见各节）。

---

## 1. 数据模型

来源：`src/shared/data/types/knowledge.ts`、`src/main/data/db/schemas/knowledge.ts`。

### 知识库 KnowledgeBase（表 `knowledge_base`）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid v4 | 主键 |
| `name` | text | 非空 |
| `groupId` | text \| null | 所属分组 |
| `dimensions` | int \| null | 嵌入维度（completed 必为正整数） |
| `embeddingModelId` | text \| null | 嵌入模型（completed 必填） |
| `status` | `'completed' \| 'failed'` | 生命周期 |
| `error` | `'missing_embedding_model' \| null` | failed 必填、completed 必为 null |
| `rerankModelId` | text \| null | 重排模型，可选 |
| `fileProcessorId` | text \| null | 文件处理器 |
| `chunkSize` | int | 默认 1024 |
| `chunkOverlap` | int ≥0 | 默认 200，且必须 < chunkSize |
| `threshold` | real [0,1] | 相似度阈值 |
| `documentCount` | int >0 | Top K |
| `searchMode` | `'default' \| 'bm25' \| 'hybrid'` | 默认 hybrid |
| `hybridAlpha` | real [0,1] | 仅 hybrid 可设 |
| `createdAt/updatedAt` | ISO | |

### 知识项 KnowledgeItem（表 `knowledge_item`）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid v7（有序） | 主键 |
| `baseId` | uuid v4 | 所属库（级联删除） |
| `groupId` | uuid v7 \| null | 父容器项（目录展开用）；null=根项 |
| `type` | `'file' \| 'url' \| 'note' \| 'directory'` | 来源类型 |
| `data` | json | 见下 |
| `status` | 见状态机 | |
| `error` | string \| null | failed 必为非空 |
| `createdAt/updatedAt` | ISO | |

`data` 按 type：
- `file`：`{ source, relativePath, indexedRelativePath? }`（持久化）；运行时输入用 `{ source, path(绝对路径) }`
- `url`：`{ source, url }`
- `note`：`{ source, content, sourceUrl? }`
- `directory`：`{ source, path }`

### 状态机（`types/knowledge.ts:22-61`）
```
file/url/note:  idle → processing → reading → embedding → completed
                          ↘            ↘          ↘
                                         → failed
                idle … → deleting
directory:      idle → preparing → processing → completed
                          ↘            ↘
                                         → failed
                idle … → deleting
```
- `deleting` 项默认从列表 / 检索 / RAG 读取中隐藏。
- `failed` 项 `error` 为非空字符串。

### 常量（`types/knowledge.ts:18-92`）
- `KNOWLEDGE_ITEM_TYPES = ['file','url','note','directory']`
- `KNOWLEDGE_SEARCH_MODES = ['default','bm25','hybrid']`，`DEFAULT_KNOWLEDGE_SEARCH_MODE = 'hybrid'`
- `KNOWLEDGE_BASE_STATUSES = ['completed','failed']`，`DEFAULT = 'completed'`
- `KNOWLEDGE_BASE_ERROR_CODES = ['missing_embedding_model']`
- `DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE = 1024`，`DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP = 200`
- `KNOWLEDGE_RUNTIME_ITEMS_MAX = 100`（单次添加上限）
- `KNOWLEDGE_NOTE_CONTENT_MAX = 1_000_000`

---

## 2. preload API（渲染进程 `window.api.knowledge.*`）

来源：`src/preload/index.ts:341-359`。可在 agent browser 的渲染进程 console 直接调用，用于断言与数据准备 / 清理。

| 方法 | 签名 | IPC 通道 |
| --- | --- | --- |
| `createBase` | `(base: CreateKnowledgeBaseDto) => Promise<KnowledgeBase>` | `knowledge:create-base` |
| `restoreBase` | `(dto: RestoreKnowledgeBaseDto) => Promise<KnowledgeBase>` | `knowledge:restore-base` |
| `deleteBase` | `(baseId) => Promise<void>` | `knowledge:delete-base` |
| `addItems` | `(baseId, items: KnowledgeAddItemInput[]) => Promise<void>` | `knowledge:add-items` |
| `deleteItems` | `(baseId, itemIds[]) => Promise<void>` | `knowledge:delete-items` |
| `reindexItems` | `(baseId, itemIds[]) => Promise<void>` | `knowledge:reindex-items` |
| `search` | `(baseId, query) => Promise<KnowledgeSearchResult[]>` | `knowledge:search` |
| `listItemChunks` | `(baseId, itemId) => Promise<KnowledgeItemChunk[]>` | `knowledge:list-item-chunks` |
| `deleteItemChunk` | `(baseId, itemId, chunkId) => Promise<void>` | `knowledge:delete-item-chunk` |

> `window.api.knowledgeBase.delete(id)` 是 v1 遗留桥接（`KnowledgeBase_Delete`），v2 不用。

`CreateKnowledgeBaseDto` 关键字段：`{ name, embeddingModelId, dimensions, groupId?, chunkSize?, chunkOverlap?, rerankModelId?, fileProcessorId?, threshold?, documentCount?, searchMode?, hybridAlpha? }`。
`KnowledgeAddItemInput`（运行时）按 type：`file` 用绝对路径 `data.path`；`url`/`note`/`directory` 同持久化形态。

### 控制台样例
```js
// 列出（经 DataApi，渲染侧用 hook，但可直接打 IPC 验证检索）
await window.api.knowledge.search('<baseId>', '测试问题')
await window.api.knowledge.listItemChunks('<baseId>', '<itemId>')
// 清理：删除测试库
await window.api.knowledge.deleteBase('<baseId>')
```

### 检索结果 KnowledgeSearchResult（`types/knowledge.ts:449-458`）
`{ pageContent, score, scoreKind: 'relevance'|'ranking', rank, metadata: { itemId, itemType, source, chunkIndex, tokenCount }, itemId?, chunkId }`

---

## 3. HTTP API 网关（`/v1/knowledge-bases`）

来源：`src/main/features/apiGateway/routes/knowledge/index.ts`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/knowledge-bases?limit&offset` | 列表，返回 `{ knowledge_bases, total }` |
| GET | `/v1/knowledge-bases/:id` | 单库，404 = 不存在 |
| POST | `/v1/knowledge-bases/search` | body `{ query, knowledge_base_ids?, document_count?=5 }`；按 score 降序截断；全失败 503，部分失败 200+warnings，无库 200+warnings |

> DataApi（渲染侧 useQuery/useMutation）另有 `GET/PATCH/DELETE /knowledge-bases/:id`、`GET /knowledge-bases/:id/items`、`GET /knowledge-items/:id`（`src/main/data/api/handlers/knowledges.ts`）。`PATCH` 不允许改 `embeddingModelId/dimensions`（需走 restore 重建）。

---

## 4. 真实 data-testid（生产组件，运行时存在）

仅以下 5 个；其余 `*-dialog`、`*-panel` 等出现在 `__tests__` mock，**运行时没有**。

| testid | 用途 |
| --- | --- |
| `base-navigator-resize-handle` | 左侧导航宽度拖拽手柄 |
| `knowledge-source-file-list` | 添加对话框-文件列表 |
| `knowledge-source-directory-select` | 添加对话框-选择目录按钮 |
| `knowledge-source-directory-list` | 添加对话框-已选目录列表 |
| `rag-failed-state` | RAG 面板-失败态 |

其余靠**可见文案 + role/aria**（下表）。

---

## 5. 关键 i18n 文案（zh-CN，根键 `knowledge.*`）

来源：`src/renderer/i18n/locales/zh-cn.json`。

### 通用 / 导航 / Tab
| 键 | 文案 |
| --- | --- |
| `knowledge.title` | 知识库 |
| `knowledge.empty` | 暂无知识库 |
| `knowledge.tabs.data_source` | 数据源 |
| `knowledge.tabs.rag_config` | RAG 配置 |
| `knowledge.tabs.recall_test` | 召回测试 |
| `knowledge.status.completed` | 就绪 |
| `knowledge.status.failed` | 失败 |
| `knowledge.status.processing` | 处理中 |
| `common.more` | 更多 |
| `common.name` | 名称 |
| `common.cancel` | 取消 |

### 创建 / 编辑库
| 键 | 文案 |
| --- | --- |
| `knowledge.add.title` | 添加 |
| `knowledge.add.group` | 分组 |
| `knowledge.add.submit` | 确定 |
| `knowledge.embedding_model` | 嵌入模型 |
| `knowledge.dimensions` | 嵌入维度 |
| `knowledge.not_set` | 未设置 |
| `knowledge.name_required` | 知识库名称为必填项 |
| `knowledge.embedding_model_required` | 知识库嵌入模型是必需的 |
| `knowledge.dimensions_error_invalid` | 无效的嵌入维度 |
| `knowledge.rename_title` | 重命名知识库 |
| `knowledge.context.rename` | 重命名 |
| `knowledge.context.move_to` | 移动到 |
| `knowledge.context.delete` | 删除 |
| `knowledge.error.failed_to_create` | 知识库创建失败 |
| `knowledge.error.failed_to_delete` | 知识库删除失败 |
| `knowledge.error.failed_to_edit` | 知识库编辑失败 |
| `knowledge.error.failed_to_move` | 知识库移动失败 |
| `knowledge.error.missing_embedding_model` | 迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。 |

### 分组
| 键 | 文案 |
| --- | --- |
| `knowledge.groups.add` | 新建分组 |
| `knowledge.groups.create_base_here` | 在此分组新建 |
| `knowledge.groups.rename` / `.rename_title` | 重命名 / 重命名分组 |
| `knowledge.groups.delete` | 删除分组 |
| `knowledge.groups.delete_confirm_description` | 删除后，该分组下的知识库将移至默认分组。 |
| `knowledge.groups.name_placeholder` | 输入分组名称... |
| `knowledge.groups.name_required` | 分组名称为必填项 |
| `knowledge.groups.default` / `.ungrouped` | 默认 / 未分组 |

### 数据源
| 键 | 文案 |
| --- | --- |
| `knowledge.data_source.toolbar.add` | 添加数据源 |
| `knowledge.data_source.toolbar.search_placeholder` | 搜索数据源 |
| `knowledge.data_source.toolbar.no_search_results` | 未找到匹配的数据源 |
| `knowledge.data_source.add_dialog.title` | 添加数据源 |
| `...add_dialog.sources.file/note/directory/url` | 文件 / 笔记 / 目录 / 链接 |
| `...add_dialog.placeholder.title` | 点击选择文件或拖拽到此处 |
| `...add_dialog.placeholder.supported_formats` | 支持 PDF, DOCX, MD, XLSX, TXT, CSV |
| `...add_dialog.directory.title` | 点击选择文件夹 |
| `...add_dialog.directory.description` | 将递归导入文件夹中的支持文件 |
| `...add_dialog.url.input_label` | 网页地址 |
| `...add_dialog.url.placeholder` | https://example.com |
| `...add_dialog.url.help` | 将自动抓取页面文本并分块索引 |
| `...add_dialog.note.empty_title` | 暂未接入笔记数据源 |
| `...add_dialog.footer.selected_files/_directories/_notes` | 已选 N 个文件 / 目录 / 笔记 |
| `...add_dialog.submit.success` | 数据源已添加到知识库 |
| `...add_dialog.submit.error` | 添加数据源失败 |
| `knowledge.data_source.actions.preview_source` | 预览原文 |
| `knowledge.data_source.actions.view_chunks` | 查看 Chunks |
| `knowledge.data_source.actions.reindex` | 重新索引 |
| `knowledge.data_source.actions.delete` | 删除 |
| `knowledge.data_source.status.pending/chunking/embedding/ready/error` | 等待中 / 分块中 / 嵌入中 / 就绪 / 错误 |
| `knowledge.data_source.ready_summary` | {ready}/{total} 就绪 |
| `knowledge.data_source.filters.all/file/note/directory/url` | 全部 / 文件 / 笔记 / 目录 / 链接 |
| `knowledge.data_source.chunks_count` | {count} chunks |
| `knowledge.data_source.chunk_delete_confirm_title` | 确认删除 Chunk |
| `knowledge.data_source.delete_confirm_title` | 确认删除数据源 |
| `knowledge.data_source.delete_failed` | 删除数据源失败 |
| `knowledge.data_source.reindex_failed` | 数据源重新索引失败 |
| `knowledge.data_source.preview.unavailable` | 当前数据源没有可预览的原文 |
| `knowledge.data_source.table.select_all` | 全选 |
| `knowledge.data_source.table.select_row` | 选择行 |
| `knowledge.data_source.bulk.selected_count` | 已选 N 项 |
| `knowledge.data_source.bulk.reindex/delete/cancel` | 重新索引 / 删除 / 取消 |
| `knowledge.data_source.bulk.delete_confirm_title` | 确认批量删除 |

### RAG 配置
| 键 | 文案 |
| --- | --- |
| `knowledge.rag.file_processing` | 文档处理 |
| `knowledge.rag.processor` | 处理服务商 |
| `knowledge.rag.chunk_size` | 分段大小 |
| `knowledge.rag.chunk_overlap` | 重叠大小 |
| `knowledge.rag.chunk_size_change_warning` | 分段大小和重叠大小修改只针对新添加的内容有效 |
| `knowledge.rag.chunk_overlap_must_be_smaller` | 分块重叠必须小于分块大小 |
| `knowledge.rag.embedding_model` | 嵌入模型 |
| `knowledge.rag.dimensions` | 向量维度 |
| `knowledge.rag.refresh_dimensions` | 刷新向量维度 |
| `knowledge.rag.document_count` | 请求文档片段数 (Top K) |
| `knowledge.rag.threshold` | 相似度阈值 |
| `knowledge.rag.search_mode.title` | 检索模式 |
| `knowledge.rag.search_mode.default/bm25/hybrid` | 向量检索 / 全文检索 / 混合检索（推荐） |
| `knowledge.rag.hybrid_alpha` | Hybrid Alpha |
| `knowledge.rag.rerank_model` | 重排模型 (Rerank) |
| `knowledge.rag.rerank_disabled` | 不使用 |
| `knowledge.rag.save_action` | 保存 |
| `knowledge.rag.saved` | 已保存 |
| `knowledge.rag.reset_action` | 恢复默认 |

### 重建 / 失败
| 键 | 文案 |
| --- | --- |
| `knowledge.restore.action` | 重建知识库 |
| `knowledge.restore.submit` | 重建 |
| `knowledge.restore.title` | 重建知识库 |
| `knowledge.restore.default_name` | {name}_副本 |
| `knowledge.restore.failed_to_restore` | 知识库重建失败 |

### 召回测试
| 键 | 文案 |
| --- | --- |
| `knowledge.recall.placeholder` | 输入测试 Query... |
| `knowledge.recall.submit` | 检索 |
| `knowledge.recall.searching` | 正在检索... |
| `knowledge.recall.empty_title` | 输入查询语句开始检索测试 |
| `knowledge.recall.empty_description` | 结果将展示匹配的文档片段和分数 |
| `knowledge.recall.result_count` | {count} 个结果 |
| `knowledge.recall.duration` | {duration}ms |
| `knowledge.recall.result_relevance` | 相关度 {score} |
| `knowledge.recall.result_rank` | 排序 #{rank} |
| `knowledge.recall.ranking_only` | 按排序返回 |
| `knowledge.recall.top_score` | 最高: {score} |
| `knowledge.recall.expand/collapse/copy` | 展开片段 / 收起片段 / 复制片段 |
| `knowledge.recall.history_title/history_remove/history_clear` | 搜索历史 / 删除历史 / 清空 |
| `knowledge.recall.search_failed` | 召回测试检索失败 |

---

## 6. 关键源码位置速查

| 功能 | 文件 |
| --- | --- |
| 页面入口 / 路由 | `src/renderer/pages/knowledge/KnowledgePage.tsx`、`src/renderer/routes/app/knowledge.tsx`、Sidebar `/app/knowledge` |
| 详情 Tab | `components/DetailTabs.tsx` |
| 创建库对话框 | `components/CreateKnowledgeBaseDialog.tsx` |
| 重建对话框 | `components/RestoreKnowledgeBaseDialog.tsx` |
| 导航 / 右键菜单 | `components/navigator/NavigatorMenu.tsx`、`BaseNavigator*.tsx` |
| 添加数据源对话框 | `components/AddKnowledgeItemDialog.tsx` + `addKnowledgeItemDialog/`（`constants.ts`、`sources/*`） |
| 数据源面板 | `panels/dataSource/`（`DataSourcePanel.tsx`、`DataSourcePanelHeader.tsx`、`KnowledgeItemRow.tsx`、`KnowledgeItemChunkDetailPanel.tsx`） |
| RAG 配置面板 | `panels/ragConfig/`（`RagConfigPanel.tsx`、`FileProcessingSection/ChunkingSection/EmbeddingSection/RetrievalSection.tsx`） |
| 召回测试 | `panels/recallTest/`（`RecallTestProvider.tsx`、`RecallSearchBar.tsx`、`RecallResultCard.tsx`、`RecallHistoryList.tsx`） |
| 主进程编排 | `src/main/features/knowledge/KnowledgeService.ts`、`KnowledgeWorkflowService.ts`、`KnowledgeLockManager.ts` |
| 索引流水线 | `src/main/features/knowledge/jobs/*`、`utils/indexing/{chunk,embed,rerank}.ts`、`utils/search.ts` |
| Readers | `readers/{KnowledgeFileReader,KnowledgeUrlReader,KnowledgeNoteReader}.ts`、`readers/files/EpubReader.ts` |
| 向量库 | `vectorstore/KnowledgeVectorStoreService.ts`、`providers/LibSqlVectorStoreProvider.ts` |
| 数据服务 | `src/main/data/services/{KnowledgeBaseService,KnowledgeItemService}.ts` |
| HTTP 网关 | `src/main/features/apiGateway/routes/knowledge/index.ts` |
| 类型 / 常量 | `src/shared/data/types/knowledge.ts` |
| DB schema | `src/main/data/db/schemas/knowledge.ts` |

---

## 7. 已知未完成 / 不一致项（测试时注意，非缺陷）

1. **笔记（note）数据源 UI 未接入**：添加对话框「笔记」Tab 为占位空状态，提交对 note 恒不可用（`AddKnowledgeItemDialog.tsx:147-149`、`NoteSourceContent.tsx` `TODO`）。底层类型 / Reader 已就绪。
2. **支持格式文案缺 EPUB**：UI 占位写「PDF, DOCX, MD, XLSX, TXT, CSV」，但常量 `KNOWLEDGE_SUPPORTED_FILE_TYPES` 与 `EpubReader` 含 EPUB。
3. **v1 桥接**：`window.api.knowledgeBase.delete` / `KnowledgeBase_Delete` 仍存在，仅为 v1 Redux 残留，v2 流程不经过。

---

## 8. 测试前置：嵌入模型（从根 README 下沉）

知识库的创建与索引依赖**真实的嵌入模型（embedding model）**，部分检索用例还依赖**重排模型（rerank model）**。测试前需在「设置 → 模型服务」配置好至少一个可用的 embedding provider（例如 `.env.example` 里示意的 SiliconFlow `BASE_URL` / `API_KEY`，模型如 `Qwen/Qwen3-Embedding` 系列）：

- 创建知识库时必须能选到 embedding 模型，且能成功获取维度（`fetchDimensions`）。
- 没有可用 embedding 模型时，创建对话框的模型下拉为空（显示「未设置」），无法完成创建——这本身也是一条校验用例。
- 涉及索引（添加文件 / URL / 目录）的用例需要**真实联网调用** embedding 接口，请预留时间并准备好小体积测试样本。

## 9. 供应商「类型」覆盖矩阵（嵌入 / 重排）—— 已核对 adapterFamily

嵌入 / 重排经 AiService → aiCore 按 provider 的 `adapterFamily` 派发（#15796）。每个 family 对应不同的 `create` SDK（`packages/aiCore/.../core/initialization.ts`）。

**重排：Cherry 全局只有一种实现** `OpenAICompatibleRerankingModel`（`/v1/rerank`）。只有 `openai-compatible` family 定义 `createRerankingModel`；cherryin 在自身代码里 new 同一个类。**所以重排协议只有 1 种**，任一带 rerank 模型的 provider 即可覆盖，不存在第二种重排协议。

**嵌入：按 adapterFamily 的真实类型**（每种 SDK 不同）：

| 嵌入 family | 代表 provider | 嵌入 | 重排 | Key | 优先级 |
|---|---|---|---|---|---|
| `ollama` | `ollama` (`localhost:11434`) | ✓ `bge-m3` / `qwen3-embedding:0.6b` | ✗ | 无需 | **P0 已就绪** |
| `cherryin` | `cherryin` (`open.cherryin.net`) | ✓ | ✓（代码封装，实测确认模型） | 1 个 | **P0** |
| `openai-compatible` | **`silicon`**（或 jina，二选一） | ✓ | ✓ `/v1/rerank`（silicon 有 bce-reranker，重排最稳） | 1 个 | P1（此类只测 1 个） |
| `google` | `gemini` | ✓ | ✗ | 1 个 | P1 |
| `openai` | `openai` | ✓ | ✗ | 1 个 | P2 |
| `mistral` | `mistral` | ✓ | ✗ | 1 个 | P2 |
| `voyage` | `voyageai` | ✓ | ✗ | 1 个 | P3（可选） |

**勘误**：Cherry **不内置 Cohere** provider（`cohere/*` 仅是聚合商内部模型 id，按聚合商 family 派发）；**Jina 不是独立协议**，其 `adapterFamily='openai-compatible'`，与 silicon 同一套代码路径。

- 最小起步集：**Ollama（已就绪）+ CherryIN（1 key，覆盖 cherryin 嵌入 + 重排）**；每多 1 个 key 多覆盖一种嵌入 family。
- 重排测试建议用 **siliconflow（bce-reranker）** 或 cherryin。
- PDF 文档处理器：从 `paddleocr / mineru / doc2x / mistral` 选 1 个并提供 key（不用 open-mineru）。
