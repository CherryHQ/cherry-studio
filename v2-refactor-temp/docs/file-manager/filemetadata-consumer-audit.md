# FileMetadata 消费者审计报告

> **生成日期**: 2026-04-19
> **分析范围**: 旧 `FileMetadata` 类型、旧 `FileStorage` IPC 合约、Dexie `files` 表，以及它们在 renderer / main / shared 三侧的消费路径。
>
> **不包含**：主进程 `fs` 直接调用（详见 [`fs-usage-audit.md`](./fs-usage-audit.md)）、v2 新设计的 `FileEntry / FileRef / FileHandle` 内部实现细节。
>
> **关联文档**：
> - [`docs/zh/references/file/architecture.md`](../../../docs/zh/references/file/architecture.md) — v2 文件管理架构总览
> - [`docs/zh/references/file/file-manager-architecture.md`](../../../docs/zh/references/file/file-manager-architecture.md) — FileManager 详细设计
> - [`ipc-redesign.md`](./ipc-redesign.md) — v2 IPC 接口
> - [`handler-mapping.md`](./handler-mapping.md) — v1 IPC → v2 IPC 映射

---

## 1. Executive Summary

### 1.1 规模概览

| 口径 | 数字 |
|------|------|
| 导入 `FileMetadata` 符号的文件 | **96 个** |
| 总引用次数 | **391 次** |
| 调用 `window.api.file.*` 的文件 | **66 个**（151 处调用） |
| 旧 `FileStorage` 暴露的 IPC 方法 | **~47 个**（`File_*` 通道） + 4 个（`FileService_*`） |
| 当前 preload 层 `file.*` API | **47 个方法** |
| 消费 Dexie `files` 表的文件 | **9 个**（含 `db.files.*` 或 `db.message_blocks.where('file.id')`） |

### 1.2 高层结论

1. **`FileMetadata` 是全应用的"泛文件对象"，已渗透到 8+ 个业务域。** 类型 `{id, name, origin_name, path, size, ext, type, created_at, count, tokens?, purpose?}` 被用作：消息附件、知识库条目、OCR 输入、AI SDK FilePart 的源、绘画上传/下载结果、翻译源、粘贴临时文件、笔记（少量）。每个域的"聚合 shape"都把 `FileMetadata` 直接内嵌进自己的 schema（例如 `ImageMessageBlock.file`、`KnowledgeFileItem.content`、`PaintingsState.files`、`VideoUploadResult.{videoFile,srtFile}`），**使字段删减/重命名成为全仓级事件**。迁移到 `FileEntry` 必须提供一个 renderer 侧的"视图适配层"（名字、大小、路径、类型、token 数），否则 UI 组件需要大面积改写。

2. **"物理路径 `path` 字段"是最难切换的单一依赖。** 当前 renderer 大量代码假设 `file.path` 永远存在且可读（`getSafePath`、`AttachmentPreview`、`PasteService`、`TranslatePage`、OCR、`utils/file.ts:isSupportedFile`、MCP agent 文件定位），而 v2 `FileEntry` **不含 `path`**：internal 文件的物理路径由 id+ext 推导（见 `services/FileManager.ts:getFilePath`），external 文件使用 `externalPath`。renderer 目前通过 `cacheService.get('app.path.files')` 拼 path，这条链是 v2 最需要先切换的"脚手架"。

3. **`count` 引用计数是旧架构的遗留简化，v2 改为 `file_ref` 表。** 当前 `FileManager.addFile/deleteFile` 基于 `count` 做引用计数（同一文件被多次添加→count++；delete force=false→count--）。Dexie 中 `files` 表就带 `count` 索引。v2 的 `file_ref` 表按 (sourceType, sourceId, role) 跟踪引用，**语义更精确**但迁移要求：所有"谁还在引用这个文件" 的逻辑必须重写（`store/knowledge.ts:46`、`handleDelete`、`cleanupMultipleBlocks`、`PaintingsState` 关联）。Phase 1 选择先只建表，不迁移业务，这笔债最终仍要偿还。

4. **旧 `FileStorage` IPC 是一个"超大杂货铺单例"**（2043 行、47+ 方法），混合了：受管文件 CRUD（`upload/delete/read/copy`）、外部文件 CRUD（`deleteExternalFile/readExternal/moveDir`）、特殊文件生成（`saveBase64Image/savePastedImage/download`）、格式分析（`pdfPageCount/isTextFile/isDirectory`）、对话框（`open/save/selectFolder`）、目录列表（ripgrep-based `listDirectory`、`getDirectoryStructure`）、chokidar watcher（6 个方法）、Notes 专用（`fileNameGuard/validateNotesDirectory/batchUploadMarkdown/renameDir`）和数据 URL 编解码（`base64Image/binaryImage/base64File`）。v2 新 `FileIpcApi` 只暴露 18 个方法 + `FileHandle` 多态，很多旧方法被折叠、移除或委托给 `ops/*`（详见 `handler-mapping.md`）。

5. **Knowledge 域已经有完整 migrator，其他域尚未规划。** `src/main/data/migration/v2/migrators/KnowledgeMigrator.ts` + `mappings/KnowledgeMappings.ts` 已经处理了从旧 Dexie `files` 表到新 `KnowledgeItemData.file` 的转换（保留了 `FileMetadata` 形态作为 `FileItemData.file` 的 schema）。但 **message/painting/translate/notes 的迁移均未落地**。更糟的是，新 `KnowledgeItemData.file` 仍然用 `FileMetadataSchema`（`packages/shared/data/types/knowledge.ts:42`）表示，也就是说：**v2 的 SQLite 里会保留 FileMetadata 这个旧形状的持久化痕迹**——这是"migrator-only 存量"，不是长久之计。

### 1.3 建议的迁移策略（分阶段）

| 阶段 | 目标 | 风险 |
|------|------|------|
| **Phase 1 (进行中)** | 新 FileEntry/FileManager/FileRef/IPC 架构落地（`src/main/file/**`、`packages/shared/file/types/**`）；旧 FileStorage 不动 | 低，当前 branch 已完成 |
| **Phase 2** | Dexie `files` 表 + 旧 `FileStorage` 双读双写 shim；renderer 侧 `services/FileManager.ts` 改为同时操作两侧 | 中，双写期需测试一致性 |
| **Phase 3** | 按域切换：**Messages 优先**（影响最大但数据结构最规整），其次 Knowledge（已有 migrator），然后 Painting，最后 Translate/Paste/Video | 高，业务域的 `FileMetadata` 字段内嵌需要全域 UI 改造 |
| **Phase 4** | 删除 Dexie `files` 表、`FileStorage.ts`、`services/FileManager.ts`；清理 `FileMetadata` 类型；OCR/remotefile 域独立迁移 | 中，清理期需全回归 |

---

## 2. FileMetadata 字段级使用统计

旧 `FileMetadata`（定义在 `packages/shared/data/types/file/file.ts:17` 与 `src/renderer/src/types/file.ts:83`，两份完全同形）：

```ts
interface FileMetadata {
  id: string           // uuidv4（renderer 生成 or main 通过 uploadFile 生成）
  name: string         // 存储名，等于 id + ext（对于受管文件）
  origin_name: string  // 用户看到的名字（上传/下载前的原名）
  path: string         // 绝对路径；受管时是 {userData}/files/{id}{ext}
  size: number         // bytes
  ext: string          // 含前导点（'.pdf'）
  type: FileType       // 'image'|'video'|'audio'|'text'|'document'|'other'
  created_at: string   // ISO 8601
  count: number        // 引用计数（旧 GC 模型）
  tokens?: number      // 预估 token（少数消费）
  purpose?: OpenAI.FilePurpose // OpenAI 上传 purpose
}
```

| 字段 | 典型消费者 | v2 对应 | 迁移难度 |
|------|-----------|---------|---------|
| `id` | 全域核心 key（Dexie pk、IPC 参数、FileRef） | `FileEntry.id` (UUID v7) | **XL**：v7 换 v4 要 rewrite migrator；ID 被内嵌进 message block、painting files 数组 |
| `name` | 存储名=`id+ext`，用于拼 `{storageDir}/{name}` | 已不存在（用 id+ext 动态推导） | **M**：需删除冗余字段 |
| `origin_name` | UI 显示、token service、下载时的默认文件名、message block 呈现 | `FileEntry.name`（无扩展名） + `FileEntry.ext` | **L**：全 UI 的显示逻辑要换；有 `FileManager.formatFileName` 集中格式化可利用 |
| `path` | OCR、SupportExts 判断、AttachmentPreview、PasteService、TranslatePage、MCP tool | internal：`FileManager.getFilePath`；external：`entry.externalPath` | **XL**：最多消费点；需 shim 层提供 "resolve(handle) → absPath" |
| `size` | UI 显示、大小限制（aiCore `convertFileBlockToFilePart`、knowledge ingestion）、排序（FilesPage） | `FileEntry.size`（internal 真值；external 快照） | **S** |
| `ext` | FILE_TYPE 判定、MIME 推导、path 拼接、拓展名白名单过滤 | `FileEntry.ext`（**无前导点**，新旧规则变化） | **M**：所有 `file.ext === '.pdf'` 需改为 `file.ext === 'pdf'` |
| `type` | UI 分类（FilesPage 左侧栏）、文件块 vs 图片块、OCR 支持判断、FILE_TYPE.TEXT/IMAGE 分派 | **不存在于 FileEntry**；新 `PhysicalFileMetadata.type`（kind=file 时）要 `getMetadata` 调用才能拿 | **L**：type 从"持久化字段"变为"派生字段"；UI 分类需要 JOIN 物理元信息 |
| `created_at` | UI 排序、formatFileName、Dexie 索引 | `FileEntry.createdAt`（ms epoch int，非 ISO string） | **S**：格式/类型要转 |
| `count` | 引用计数（FileManager、store/knowledge） | `file_ref` 表行数 | **L**：语义替换；删除逻辑链（handleDelete 走的是 messageBlocks.where('file.id')）要重写 |
| `tokens?` | TokenService 缓存、attachment 显示 tokens | 无；建议单独的 feature（token cache 表 或 内存计算） | **S**：少数点使用 |
| `purpose?` | OpenAI/qwen-long 上传 purpose（`fileProcessor.ts:130`） | 无；Phase 1 不做 file_upload 表（`file.ts:7-9` 注释说推迟） | **S** |

**衍生类型**：
- `ImageFileMetadata = FileMetadata & { type: 'image' }` — 定义见 `types/file.ts:130`，被 OCR 域（`SupportedOcrFile`、`TesseractService`、`SystemOcrService`、`PpocrService`、`OvOcrService`、`MistralPreprocessProvider` 等）广泛使用。
- `PdfFileMetadata = FileMetadata & { ext: '.pdf' }` — 定义见 `types/file.ts:134`，实际**没有搜到消费者**（见 §8 冗余代码）。
- `isImageFileMetadata(file): file is ImageFileMetadata` — 类型守卫，OCR + paintings 用。

---

## 3. 导入图谱（按模块分组）

### 3.1 类型定义层（4 个文件）

| 文件 | 角色 |
|------|------|
| `packages/shared/data/types/file/file.ts:17` | shared 侧定义（带"need be refactored"注释），此文件 index.ts 通过 `export *` 对外暴露 |
| `src/renderer/src/types/file.ts:83` | renderer 侧定义（重复实现，字段一致） |
| `packages/shared/data/types/knowledge.ts:42` | **v2 Schema 复用旧形状**：`FileMetadataSchema: z.ZodType<FileMetadata>` 被 `FileItemData` 引用 |
| `packages/shared/file/types/common.ts` | 新 `PhysicalFileMetadata` 类型（与旧 `FileMetadata` 完全不同，是物理层 stat 信息） |

两份定义同形但不共用，`renderer/src/types/file.ts` 额外导出 `ImageFileMetadata`、`PdfFileMetadata`、`isImageFileMetadata`。

### 3.2 Renderer Services（8 个文件）

| 文件 | 角色 | 对 FileMetadata 操作 |
|------|------|---------------------|
| `src/renderer/src/services/FileManager.ts` | **核心消费者**。18 次引用，静态类 | Dexie CRUD + IPC 调用，是所有 renderer 侧 FileMetadata 操作的入口 |
| `src/renderer/src/services/FileAction.ts` | FilesPage 的 delete/rename/sort | `handleDelete` 会清理 `db.message_blocks.where('file.id')` 和 topics.messages |
| `src/renderer/src/services/MessagesService.ts` | 消息创建时构造 FileBlock/ImageBlock | 构造 `FileMessageBlock.file` 和 `ImageMessageBlock.file` |
| `src/renderer/src/services/KnowledgeService.ts` | 知识库搜索结果附加 file 元信息 | 返回 `KnowledgeSearchResult & { file: FileMetadata \| null }` |
| `src/renderer/src/services/TokenService.ts` | 文件 tokens 计数 | 读 file，写回 `file.tokens` |
| `src/renderer/src/services/PasteService.ts` | 剪贴板粘贴文件 → FileMetadata | 通过 `file.createTempFile+get` 构造 |
| `src/renderer/src/services/db/DexieMessageDataSource.ts` | 消息 DB 旧数据源 | 包含 `db.files.get/update/delete` 做引用计数维护 |
| `src/renderer/src/services/import/utils/database.ts` | 导入数据库时处理 files 表 | Dexie 级 schema 操作 |

### 3.3 Renderer Hooks（5 个文件）

| 文件 | 用途 |
|------|------|
| `src/renderer/src/hooks/useFiles.ts` | 选择文件（Electron dialog），state 持有 `FileMetadata[]` |
| `src/renderer/src/hooks/useKnowledgeFiles.tsx` | 从 `KnowledgeBase.items` 收集 file 条目 |
| `src/renderer/src/hooks/useKnowledge.ts` | 知识库 delete（`window.api.file.delete(file.name)`） |
| `src/renderer/src/hooks/useTopic.ts` | 清空 topic messages 时暂存要删除的 files |
| `src/renderer/src/hooks/useOcr.ts` | OCR（消费 `ImageFileMetadata`） |

### 3.4 Renderer Pages（按子域）

**Chat / Home（8 个文件）**：
- `src/renderer/src/pages/home/Inputbar/Inputbar.tsx` — 主入口，用 `files: FileMetadata[]` state
- `src/renderer/src/pages/home/Inputbar/AttachmentPreview.tsx` — 附件预览 UI，7 次引用
- `src/renderer/src/pages/home/Inputbar/components/InputbarCore.tsx` — 核心输入组件
- `src/renderer/src/pages/home/Inputbar/context/InputbarToolsProvider.tsx` — Provider，5 次引用
- `src/renderer/src/pages/home/Inputbar/hooks/usePasteHandler.ts` / `useFileDragDrop.ts` — paste/drag 处理器
- `src/renderer/src/pages/home/Inputbar/tools/components/AttachmentButton.tsx` / `useMentionModelsPanel.tsx` / `MentionModelsButton.tsx` — 工具栏
- `src/renderer/src/pages/home/Messages/MessageEditor.tsx` — 编辑消息时复用 files

**Knowledge（8 个文件）**：
- `src/renderer/src/pages/knowledge/items/KnowledgeFiles.tsx:93,124` — 文件 ingestion 主入口
- `src/renderer/src/pages/knowledge/components/KnowledgeSearchPopup.tsx` — 搜索弹窗
- `src/renderer/src/pages/knowledge/components/KnowledgeSearchItem/{index,TextItem,VideoItem,components}.tsx` — 搜索结果子组件（均 `{...item, file: FileMetadata|null}`）

**Files（3 个文件）**：
- `src/renderer/src/pages/files/FilesPage.tsx:50` — 主页，`useLiveQuery<FileMetadata[]>`
- `src/renderer/src/pages/files/FileList.tsx` / `ContentView.tsx` — 表格与详情

**Paintings（8 个文件）**：
- `DmxapiPage.tsx`、`PpioPage.tsx`、`AihubmixPage.tsx`、`OvmsPage.tsx`、`NewApiPage.tsx`、`SiliconPage.tsx`、`ZhipuPage.tsx`（图像 provider 专用页）
- `components/ImageUploader.tsx` — 图像上传器
- `utils/TokenFluxService.ts` — 下载图像转 `FileMetadata[]`

**Translate（1 个文件）**：
- `src/renderer/src/pages/translate/TranslatePage.tsx:24` — 6 次引用，支持文件翻译

**Agents（1 个文件）**：
- `src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx` — 代理会话输入栏

### 3.5 Renderer Store & Utils（11 个文件）

| 文件 | 用途 |
|------|------|
| `src/renderer/src/store/thunk/messageThunk.ts:34,602,1764` | 消息 thunk（复制消息、清理 block） |
| `src/renderer/src/store/thunk/knowledgeThunk.ts:60,101` | 知识库 thunk（addFiles, addVideo） |
| `src/renderer/src/store/knowledge.ts:46` | knowledge slice 删除时转发给 `FileManager.deleteFiles` |
| `src/renderer/src/types/{index,file,newMessage,knowledge,ocr}.ts` | 类型层 |
| `src/renderer/src/utils/{file,knowledge,input}.ts` | 工具函数 |
| `src/renderer/src/utils/messageUtils/{create,find}.ts` | 消息块创建/查找 |
| `src/renderer/src/aiCore/prepareParams/fileProcessor.ts` | **核心**：把 FileMetadata 转 FilePart/TextPart，处理上传/读取 |
| `src/renderer/src/databases/index.ts:34,45-136` | Dexie Schema（`files: EntityTable<FileMetadata, 'id'>`） |

### 3.6 Main Process（17 个文件）

| 文件 | 角色 | 引用次数 |
|------|------|---------|
| `src/main/services/FileStorage.ts` | 旧 IPC 单例实现 | 11 |
| `src/main/services/KnowledgeService.ts` | Knowledge ingestion 主 orchestrator | 6 |
| `src/main/services/remotefile/{Base,OpenAI,Gemini,Mistral}Service.ts` | 供应商文件上传 | 2×4=8 |
| `src/main/services/ocr/builtin/{Tesseract,Ov,System,Pp}Service.ts` | OCR 实现 | 4×4=16 |
| `src/main/services/knowledge/readers/KnowledgeFileReader.ts` | Knowledge 文件 reader | 2 |
| `src/main/services/knowledge/utils/directory.ts` | Knowledge 目录遍历 | 3 |
| `src/main/knowledge/preprocess/*.ts` (10 个 Provider) | OCR/preprocess providers | 41（合计） |
| `src/main/knowledge/embedjs/loader/index.ts` | embed loader | 3 |
| `src/main/utils/file.ts:123-157,260` | 主进程工具（`getAllFiles`、`base64Image`） | 4 |
| `src/main/utils/ocr.ts` | OCR 共用工具 | 2 |
| `src/main/ipc.ts:2,34` | preload 类型 import（`FileMetadata`、`FileMetadata[]`） | 2 |
| `src/main/file/FileManager.ts` | **新 FileManager（只是接口签名中的历史 import，不是实体）** | 2 |

### 3.7 Migration（2 个文件）

| 文件 | 用途 |
|------|------|
| `src/main/data/migration/v2/migrators/KnowledgeMigrator.ts:6,337-355` | 从 Dexie `files` 表批量拉 FileMetadata |
| `src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts:4,30,35,91,148` | legacy → new schema 字段映射，含 `hasCompleteFileMetadata` 验证器 |

---

## 4. 旧 API 表面

### 4.1 `src/main/services/FileStorage.ts` 导出方法（47 个 public，注册为 IPC）

| 方法 | 返回 | 作用域 | 业务 | v2 对应 |
|------|------|--------|------|--------|
| `getFileType(filePath)` | `FileType` | 内部+暴露 | 类型推导 | `FileIpcApi.getMetadata().type` |
| `selectFile(_, options?)` → `File_Select` | `FileMetadata[] \| null` | 全域 | Electron dialog + 构造 meta | `FileIpcApi.select(options)` → `string[]` 纯路径 |
| `uploadFile(_, file)` → `File_Upload` | `FileMetadata` | chat attach、knowledge ingestion、paintings 上传 | 去重+复制到 `{userData}/files/` | `FileIpcApi.createEntry({origin:'internal',content:FilePath})` |
| `getFile(_, filePath)` → `File_Get` | `FileMetadata \| null` | `PasteService`、`TranslatePage`、`utils/input.ts` | 外部路径→FileMetadata（不持久化） | 移除：由 `createEntry` 或 `getMetadata(unmanaged)` 替代 |
| `deleteFile(_, id)` → `File_Delete` | `void` | `FileManager.deleteFile` | 删除 `{storageDir}/{id}` | `FileIpcApi.permanentDelete({kind:'managed'})` |
| `deleteDir(_, id)` → `File_DeleteDir` | `void` | 历史/Notes | rm -rf 目录 | 无直接等价；handler 归并到 `permanentDelete` |
| `deleteExternalFile(_, path)` → `File_DeleteExternalFile` | `void` | `NotesService` | 删除任意外部路径 | `FileIpcApi.permanentDelete({kind:'unmanaged'})` |
| `deleteExternalDir(_, path)` → `File_DeleteExternalDir` | `void` | `NotesService` | 同上（目录） | 同上 |
| `moveFile(_, path, newPath)` → `File_Move` | `void` | `NotesService` | fs.rename | `FileIpcApi.rename(handle, newPath)` |
| `moveDir(_, dir, newDir)` → `File_MoveDir` | `void` | `NotesService` | 同上（目录） | 同上 |
| `renameFile(_, path, newName)` → `File_Rename` | `void` | `NotesService` | fs.rename（强制 `.md`） | 合并到 `rename` |
| `renameDir(_, path, newName)` → `File_RenameDir` | `void` | `NotesService` | 目录改名 | 同上 |
| `readFile(_, id, detectEncoding?)` → `File_Read` | `string` | **4+ 个消费点**：`fileProcessor`、`TokenService`、`config/minapps`、`NotesPage` | 按 id 读受管文件内容（docx/pdf/text 统一） | `FileIpcApi.read({kind:'managed',entryId})` |
| `readExternalFile(_, path, detectEncoding?)` → `File_ReadExternal` | `string` | `TranslatePage`、`NotesSearchService`、`InputbarCore`、`SaveToKnowledgePopup`、`export.ts`、`useNotesEditing`、`NotesQuery` | 按外部路径读 | `FileIpcApi.read({kind:'unmanaged',path})` |
| `createTempFile(_, name)` → `File_CreateTempFile` | `string` | `PasteService`、`TranslatePage`、`HtmlArtifactsCard` | 返回 `{tempDir}/temp_file_{uuid}_{name}` | **移除**（见 `handler-mapping.md:78`），renderer 改用 createEntry 到 mount_temp 或自行组合 |
| `writeFile(_, path, data)` → `File_Write` | `void` | `PasteService`、`TranslatePage`、`HtmlArtifactsCard`、`NotesService`、`NotesPage`、`exportExcel`、`export.ts` | 写任意路径 | `FileIpcApi.write({kind:'unmanaged',path}, data)` |
| `writeFileWithId(_, id, content)` → `File_WriteWithId` | `void` | `config/minapps`、`NewAppButton`、`MinApp` | 写 `{storageDir}/{id}` | `FileIpcApi.write({kind:'managed',...}, data)` |
| `fileNameGuard(_, dir, name, isFile)` → `File_CheckFileName` | `{safeName, exists}` | `NotesService`、`NotesPage` | 安全文件名+冲突检查 | **移除**：sanitize 转 shared 纯函数 |
| `mkdir(_, path)` → `File_Mkdir` | `string` | `NotesService` | 创建目录 | **移除**：不在 v2 IPC 中（`createEntry` 不建目录） |
| `base64Image(_, id)` → `File_Base64Image` | `{mime, base64, data}` | `aiCore/messageConverter`、`aiCore/fileProcessor` | 读受管图片转 data URL | `FileIpcApi.read(handle, {encoding:'base64'})` |
| `saveBase64Image(_, base64)` → `File_SaveBase64Image` | `FileMetadata` | `messageStreaming/imageCallbacks`、7 个 paintings 页 | 保存 data URL 为受管图片 | `FileIpcApi.createEntry({origin:'internal',content:Base64String})` |
| `savePastedImage(_, bytes, ext?)` → `File_SavePastedImage` | `FileMetadata` | `components/RichEditor/useRichEditor` | 剪贴板图片保存 | 同上（bytes → Uint8Array FileContent） |
| `base64File(_, id)` → `File_Base64File` | `{data, mime}` | `FileManager.readBase64File`、`FileManager.addBase64File`、`fileProcessor`（PDF） | 受管文件转 base64 | `FileIpcApi.read(handle, {encoding:'base64'})` |
| `pdfPageCount(_, id)` → `File_GetPdfInfo` | `number` | **暂无 renderer 消费点**（`window.api.file.pdfInfo`） | PDF 页数 | 通过 `getMetadata` 返回（PDF 分支带 pageCount） |
| `binaryImage(_, id)` → `File_BinaryImage` | `{data: Buffer, mime}` | `FileManager.readBinaryImage` | 受管文件读 Buffer | `FileIpcApi.read(handle, {encoding:'binary'})` |
| `clear()` → `File_Clear` | `void` | 历史 bcakup/debug | 清空整个 storage | **移除**（`handler-mapping.md:77`，危险） |
| `clearTemp()` | `void` | 内部 | 清空 temp dir | 无 IPC；file_module 生命周期处理 |
| `open(_, options)` → `File_Open` | `{fileName, filePath, content?, size} \| null` | `BackupService`、`ImportPopup`、`ImportAssistantPresetPopup` | dialog+读内容 | **移除**（renderer 自行组合 select+read） |
| `openPath(_, path)` → `File_OpenPath` | `void` | 全域（`CitationsList`、`ClickableFilePath`、`FilesPage`、`KnowledgeDirectories`、`useAttachment`） | `shell.openPath` | `FileIpcApi.open({kind:'unmanaged',path})` |
| `openFileWithRelativePath(_, file)` → `File_OpenWithRelativePath` | `void` | `KnowledgeFiles`、`KnowledgeVideos` | 按 `{storageDir}/{name}` 打开（跨设备） | `FileIpcApi.open({kind:'managed',entryId})` |
| `save(_, fileName, content, options?)` → `File_Save` | `string` | `SaveDialog` + writeFile（`MessageMenubar`、`MarkdownExportSettings`、`HtmlArtifactsCard`、`CodeBlockView`、`export.ts`、`AssistantPresetCard`、`useChatContext`） | 对话框选保存位置+写 | `FileIpcApi.save({content,filters?,defaultPath?})` |
| `saveImage(_, name, data)` → `File_SaveImage` | `boolean` | `Messages`、`MessageMenubar`、`HtmlArtifactsPopup`、`export.ts` | 保存为 PNG（对话框） | 并入 `save`（数据是 base64） |
| `selectFolder(_, options?)` → `File_SelectFolder` | `string \| null` | `BackupService`、`useCodeCli`、`KnowledgeDirectories`、`AgentModal`、`AccessibleDirsSetting`、`MarkdownExportSettings`、`NotesSettings`、`exportExcel` | Folder 对话框 | `FileIpcApi.select({directory:true})` |
| `downloadFile(_, url)` → `File_Download` | `FileMetadata` | 6 个 paintings 页、`TokenFluxService` | 下载 URL 为受管文件 | `FileIpcApi.createEntry({origin:'internal',content:URLString})` |
| `copyFile(_, id, destPath)` → `File_Copy` | `void` | 目前**没有搜到明确 renderer 调用**（preload 暴露为 `file.copy`） | 受管文件导出到外部 | `FileIpcApi.copy` 语义不同（新建 internal entry），导出需要 `read + save` 组合 |
| `getDirectoryStructure(_, path)` → `File_GetDirectoryStructure` | `NotesTreeNode[]` | `NotesService`、`NotesPage` | Notes 专用递归目录树 | **移除**（`handler-mapping.md:79`），DataApi 替代 |
| `listDirectory(_, path, options?)` → `File_ListDirectory` | `string[]` | `useResourcePanel` (@-mention 资源面板) | ripgrep fuzzy 搜索 | `FileIpcApi.listDirectory(path, options)` |
| `validateNotesDirectory(_, path)` → `File_ValidateNotesDirectory` | `boolean` | `NotesService`、`NotesSettings` | 笔记目录可写性/黑名单 | `FileIpcApi.validateNotesPath` |
| `startFileWatcher`/`stopFileWatcher`/`pauseFileWatcher`/`resumeFileWatcher` | `void` | Notes 专用 | chokidar 监视 | 不在 `FileIpcApi`；建议移到 NotesService 独立通道（现 Notes 功能在 v2 中也待重构） |
| `getWatcherStatus()` | `{isActive, watchPath, hasValidSender}` | 暂无 IPC 消费 | — | 同上 |
| `getFilePathById(file)` | `string` | 仅内部 | — | Internal |
| `isTextFile(_, path)` → `File_IsTextFile` | `boolean` | `utils/file.ts:isSupportedFile`、`AttachmentPreview`、`SkillsSettings` | binary vs text 判断 | `FileIpcApi.getMetadata(handle).type === 'text'` |
| `isDirectory(_, path)` → `File_IsDirectory` | `boolean` | `SkillsSettings` | stat.isDirectory | `FileIpcApi.getMetadata(handle).kind === 'directory'` |
| `showInFolder(_, path)` → `File_ShowInFolder` | `void` | `ClickableFilePath` | `shell.showItemInFolder` | `FileIpcApi.showInFolder(handle)` |
| `batchUploadMarkdownFiles(_, paths, target)` → `File_BatchUploadMarkdown` | `{fileCount, folderCount, skippedFiles}` | `NotesService` | 批量上传 md 到 notes dir | `FileIpcApi.batchCreateEntries` 或 Notes 专用 |
| `onFileChange(callback)` | event subscribe | Notes | watcher 回调订阅 | 同上 |

### 4.2 `FileService_*` IPC（AI Provider 上传）

实现：`src/main/services/remotefile/{Base,OpenAI,Gemini,Mistral}Service.ts`。

| IPC | 签名 | 消费 |
|-----|-----|------|
| `FileService_Upload` | `(provider, file: FileMetadata) → FileUploadResponse` | `aiCore/fileProcessor:handleGeminiFileUpload/handleOpenAILargeFileUpload` |
| `FileService_List` | `(provider) → FileListResponse` | 未搜到 renderer 消费 |
| `FileService_Delete` | `(provider, fileId) → void` | 未搜到 renderer 消费 |
| `FileService_Retrieve` | `(provider, fileId) → FileUploadResponse` | 同 Upload 路径 |

v2 建议：AI SDK Files Upload API **Phase 1 暂不做**（`src/main/data/db/schemas/file.ts:7-9` 注释）。

### 4.3 Preload 层 (`src/preload/index.ts:218-286`)

`window.api.file.*` 47 个方法（名字有改写，见上面表的列 2-3）。`window.api.fileService.*` 4 个方法。

---

## 5. DB / 持久化 / 迁移

### 5.1 Dexie `files` 表

定义：`src/renderer/src/databases/index.ts`。`files` 从 v1~v10 每一版都存在，schema 全程未变：

```
files: 'id, name, origin_name, path, size, ext, type, created_at, count'
```

字段与 `FileMetadata` 一一对应（除了 tokens/purpose 不索引，仍被 Dexie 当 arbitrary 字段储存）。

**消费点**：
- `services/FileManager.ts:17,20,24,47,50,54,64,67,71,81,107,112,133,156`
- `pages/files/FilesPage.tsx:52,54`
- `services/db/DexieMessageDataSource.ts:400,412,416`
- `services/import/utils/database.ts`（导入旧备份时）

**跨表引用**：
- `message_blocks` 表（v7+）有复合索引 `file.id`，即 `MessageBlock.file.id` 被 Dexie 扁平化索引。`FileAction.handleDelete` 依赖它：`db.message_blocks.where('file.id').equals(fileId)`。**这是 Dexie→SQLite 迁移的一个关键复杂度**。

### 5.2 Main SQLite

新表：`src/main/data/db/schemas/file.ts`：
- `file_entry`（见 §1 Schema）
- `file_ref`（polymorphic association）
- **没有** `file_upload`（延期至 AI SDK Files API 稳定）
- **没有** 旧 `files` 表（旧 FileMetadata 没有落到 SQLite）

旧版本一度存在 `fileEntrySeeding.ts`（见 git status 中的 `D src/main/data/db/seeding/fileEntrySeeding.ts`，本 branch 删除了它）。

### 5.3 现有 Migration

`src/main/data/migration/v2/migrators/`：

- `KnowledgeMigrator.ts`：从 Dexie `files` 表批量读取 FileMetadata，建 `Map<id, FileMetadata>`（`loadFileLookup`），然后把知识库 item.content 里的 legacy 形状（string id / 部分对象 / 完整对象）**resolve 回完整 FileMetadata**（见 `mappings/KnowledgeMappings.ts:148`）。**注意：目标表 `knowledge_item.data` 以 JSON 存储 FileMetadata 整体**（即 `KnowledgeItemData.file: FileMetadata`），这等同于"FileMetadata 在 v2 SQLite 中作为 JSON 外嵌存活"。
- **Message / Painting / Translate / Paste / Video** 尚无 migrator。迁移需要：把 `message_blocks.file` 和 `PaintingsState.files` 的 `FileMetadata` 转换为 `FileEntry` + 正确的 `file_ref` 行。最大风险是 `file.id`（uuidv4）与 `FileEntry.id`（uuidv7）不一致，需要同时重写跨表引用。

---

## 6. 按业务域的详细分析

### 6.1 Chat Messages（最重度消费者）

**数据模型**：
- `ImageMessageBlock.file?: FileMetadata`（`types/newMessage.ts:105`）
- `FileMessageBlock.file: FileMetadata`（`types/newMessage.ts:136`）
- Dexie `message_blocks` 表（v7+）有 `file.id` 复合索引用于反查

**关键入口点**：
- 输入：`Inputbar.tsx` → `InputbarCore.tsx` → 通过 `useFiles` / `usePasteHandler` / `useFileDragDrop` 收集 `FileMetadata[]`
- 发送：`MessagesService.getUserMessage` 把 files 转成 blocks（`createFileBlock` / `createImageBlock`，见 `utils/messageUtils/create.ts:182`）
- 存储：blocks 存入 Dexie `message_blocks`，file 对象内嵌
- 渲染：`Messages.tsx`、`MessageEditor.tsx`
- 删除链：`FileAction.handleDelete` → 清理 `message_blocks.where('file.id')` + 遍历 `topics.messages` 删 block id 引用
- 批删：`store/thunk/messageThunk.ts:592 cleanupMultipleBlocks` 删 block 时反查 files 减引用
- 清空 topic：`hooks/useTopic.ts:231 clearTopicMessages` 暂存 files 后调 FileManager.deleteFiles

**当前走的 API**：
- `file.select` / `file.upload`（`FileManager.uploadFile`）
- `file.base64Image` / `file.base64File` / `file.read`（`aiCore/fileProcessor`）
- `file.delete`（`FileManager.deleteFile`，基于 count 判断）

**新模型映射建议**：
- chat attach 均为 **origin='internal'**（复制到 Cherry 私有目录，避免用户移动原文件时消息坏掉）
- `file_ref` 新增行：`sourceType='chat_message'`, `sourceId=blockId`, `role='attachment' \| 'image'`
- Block.file 字段去除，只留 fileEntryId；UI 渲染时通过 `useQuery('/files/entries/:id')` lazy 拿

**迁移复杂度**：**XL**
- 涉及 Dexie→SQLite 的 `message_blocks` 迁移（本地数据迁移是 v2 重点）
- UI 组件改动面巨大（attach preview / chat 消息气泡 / 编辑消息 / 复制消息）
- `count` 引用计数替换为 `file_ref`

### 6.2 Knowledge Base

**数据模型**：
- `KnowledgeItem.content: string \| FileMetadata \| FileMetadata[]`（`types/knowledge.ts:13`）
- `KnowledgeFileItem.content: FileMetadata`（`types/knowledge.ts:26`）
- `KnowledgeVideoItem.content: FileMetadata[]`（`types/knowledge.ts:35`）
- `KnowledgeReference.file?: FileMetadata`（`types/knowledge.ts:150`）
- v2 目标 schema：`FileItemData.file: FileMetadata`（`packages/shared/data/types/knowledge.ts:60`）— **仍保留 FileMetadata 形状**

**关键入口点**：
- 添加：`KnowledgeFiles.tsx:124 processFiles(FileMetadata[])` → `addFilesThunk` → main `KnowledgeService.add`
- 删除：`useKnowledge.ts:134` 调 `window.api.file.delete(file.name)`，`store/knowledge.ts:46` 调 `FileManager.deleteFiles`
- 搜索：`KnowledgeService.ts:searchKnowledgeBase` 返回 `(KnowledgeSearchResult & {file: FileMetadata|null})[]`
- 视频：`KnowledgeVideos.tsx:125 openFileWithRelativePath(videoFile)`

**主进程消费**：
- `KnowledgeService.ts:325 add({item.content as FileMetadata})` → `preprocessing` → 10+ preprocess provider（Mineru / Doc2x / Paddleocr / Mistral / Default / OpenMineru / PP-OCR）
- `KnowledgeFileReader`、`knowledge/embedjs/loader/index.ts`：逐文件处理

**新模型映射建议**：
- 用户提供的文件通常是 **origin='external'**（尊重用户 "我的文件不要被复制" 的意图）；但对于 PDF 预处理产生的中间文件应该是 **origin='internal'**
- `file_ref` 新增：`sourceType='knowledge_item'`, `sourceId=itemId`, `role='source'`

**迁移复杂度**：**L**（已有 migrator 底子）
- migrator 已有（`KnowledgeMappings.ts`），但需要改：从 inline FileMetadata JSON → FileEntry + fileRef 行
- preprocess providers 会接收 `FileMetadata` 对象并读 `file.path`（见 `BasePreprocessProvider.ts:22`），需要全部改为接收 entry 或 handle

### 6.3 Painting

**数据模型**：
- `PaintingsState.{provider}.files: FileMetadata[]`（见 `types/index.ts:346`，各 painting 页面 state）
- 每个 provider 有不同的 shape（有的是 `FileMap<string, FileMetadata>`，有的是 `{imageFiles, paths}`）
- 面具/reference：`mask: FileMetadata`（`types/index.ts:390`）

**关键入口点**：
- 上传参考图：`ImageUploader.tsx`（多 provider 共用） → `FileManager.uploadFile` → 更新 state
- AI 生成：`Dmxapi/Aihubmix/Ppio/Ovms/NewApi/Silicon/Zhipu/TokenFlux` Page → `window.api.file.{download,saveBase64Image}` → `FileManager.addFile`
- 删除保护：`FilesPage:63-77 handleBatchDelete` 和 `FileAction.handleDelete` 检查 `paintings` 里是否引用，引用时拒绝删

**新模型映射建议**：
- 生成图: **origin='internal'**
- 参考图: 取决于 UX，若要支持 user 随时重用原图则 **internal**
- `file_ref`: `sourceType='painting'`, `sourceId=paintingId`, `role='input' \| 'output'`
- Redux store 的 files 数组改为 entryIds；UI 通过 `useQuery` 按需解析

**迁移复杂度**：**L**
- Redux state 结构调整涉及 8 个 paintings page 同步改
- 引用检查从 "filter by file.id" 变为 "查 file_ref"（更精确）
- 迁移时间点：每个 provider 页面改动独立，可并行

### 6.4 Translate

**数据模型**：
- TranslatePage 内部 state + `CustomTranslateLanguage` 不含 FileMetadata，但 `TranslatePage.tsx` 接收文件翻译

**关键入口点**：
- `TranslatePage.tsx:488 readFile(file)` 读文本内容翻译
- `TranslatePage.tsx:672-689` 处理 drag+paste，通过 `file.createTempFile+write+get` 构造 FileMetadata

**当前 API**：`file.get`、`file.createTempFile`、`file.write`、`file.readExternal`、`file.getPathForFile`

**新模型映射**：临时文件 → `createEntry({origin:'internal'})`（放到 mount_temp/ 概念下）或者干脆不持久化（只读取内容）

**迁移复杂度**：**S**
- 单页面、内部 state 简单
- 主要是把 temp file 逻辑换成新 createEntry

### 6.5 Paste / Clipboard

**关键入口点**：
- `services/PasteService.ts:handlePaste` 处理剪贴板：
  - 长文本 → 存为临时 txt 文件（通过 `createTempFile + write + get`）
  - 图片 → `components/RichEditor/useRichEditor:518 savePastedImage(buffer, ext)`
- `pages/home/Inputbar/hooks/usePasteHandler.ts` 对接输入框

**新模型映射**：
- 临时文本/粘贴图片应作为 `origin='internal'`（Cherry 全权管理），并通过 `tempSessionFileRef`（`packages/shared/data/types/file/ref/tempSession.ts`）持有引用，session 结束或真正挂到 message 时 promote 为 `chat_message` ref

**迁移复杂度**：**M**
- 流程本身清晰，但要引入 tempSessionFileRef 的生命周期管理

### 6.6 Notes

**当前与 FileMetadata 几乎无耦合**：`NotesTreeNode` 是独立类型（`src/main/utils/file.ts:128` 附近定义），只有 `MessagesService.ts` 和 `SaveToKnowledgePopup` 用 external path 读 markdown。`SaveToKnowledgePopup.tsx:275 readExternal(note.externalPath)` 是 FileMetadata 的边界点。

**迁移复杂度**：**M**（主要与 `FileStorage.getDirectoryStructure/batchUploadMarkdown/fileNameGuard/watcher` 相关，这些是 FileStorage 边缘 API，v2 中将移除或迁移到 NotesService 私有通道）

### 6.7 Agent Workspace / MCP

- `ClickableFilePath.tsx:37 openPath / 62 showInFolder` — MCP tool output 点击文件时调用，不构造 FileMetadata
- `AgentSessionInputbar.tsx` — 用 FileMetadata 但目前只是 Inputbar 复用
- `AgentModal.tsx`、`AccessibleDirsSetting.tsx`、`useCodeCli.ts` — 都只用 `selectFolder`

**迁移复杂度**：**S**（agent 侧基本是路径，很少构造 FileMetadata）

### 6.8 OCR / Preprocess

**数据模型**：`SupportedOcrFile = ImageFileMetadata`（`types/ocr.ts:130`）。OCR services 都用 `file.path` 直接读图像。

**关键入口点**：
- `useOcr.ts` (renderer) → `OcrService.ocr(image, provider)` — 每个 provider 独立走 IPC
- main 侧 OCR service：`TesseractService`、`SystemOcrService`、`OvOcrService`、`PpocrService` + 10 个 Preprocess Provider

**新模型映射**：
- OCR input 应接 `FileEntryId` 或 `FileHandle`，由 main 侧用 `FileManager.read(id, {encoding:'binary'})` 或 `withTempCopy(id, fn)` 拿物理文件
- OCR 中间产物（抽出的 txt/pdf）作为 **origin='internal'** 新 entry

**迁移复杂度**：**L**
- OCR 接口签名变更影响全部 10+ provider
- `ImageFileMetadata` 类型要重构为某种新的"带图像尺寸的 entry view"

### 6.9 AI Provider 文件上传（remotefile）

`remotefile/` 4 个 service（OpenAI/Gemini/Mistral/Base）接收 `FileMetadata`，用 `file.path` 创建 read stream。Phase 1 根据 `src/main/data/db/schemas/file.ts:7-9` 注释**暂不做 file_upload 表**，因此这部分保持现状，但签名迁移到 `FileEntry` + `withTempCopy` 是 Phase 2 以后的事。

**迁移复杂度**：**M**（延期）

### 6.10 Settings / Backup / Export

- `BackupService.ts`：用 `selectFolder / open` — 与 FileMetadata 基本解耦
- `utils/export.ts`（1113 行附近）：多处调用 `file.save`、`file.saveImage`、`file.readExternal`、`file.write` — 都是纯路径操作
- `MarkdownExportSettings.tsx`、`AssistantPresetCard`：`selectFolder` + `save`
- **迁移复杂度**：**S**（纯 IPC 改名即可）

---

## 7. 迁移复杂度矩阵

| 业务域 | FileMetadata 内嵌度 | 消费点数 | 独立 migrator? | 复杂度 | 主要风险 |
|--------|-------------------|--------|--------------|------|---------|
| Chat Messages | 极高（block.file） | 20+ | 无 | **XL** | Dexie→SQLite message_blocks 迁移；id v4→v7；UI 面积大 |
| Knowledge Base | 高（item.content） | 15+ | 已有（部分） | **L** | migrator 要扩展写 file_ref；preprocess provider 签名大改 |
| Painting | 高（state.files） | 8 页面 | 无 | **L** | Redux state 扁平化；引用检查从 filter 变成 join |
| Translate | 中（临时 FileMetadata） | 6 处 | 无 | **S** | 基本只涉及 temp file 新 API |
| Paste / Temp | 中（临时 FileMetadata） | 3 处 | 无 | **M** | 需要 tempSessionFileRef 机制打通 |
| Notes | 低（主要外部路径） | 2 处 | 无 | **M** | 与 FileStorage 的 Notes 专用 API 绑定紧 |
| Agent / MCP | 极低（只路径） | 5 处 | 无 | **S** | IPC 改名 |
| OCR | 高（ImageFileMetadata） | 10+ | 无 | **L** | OCR provider 接口大改；types/ocr.ts 重构 |
| AI Remote Upload | 中（file.path 直用） | 4 个 service | 无（延期） | **M (延期)** | Phase 1 暂不做 |
| Settings / Export | 低（IPC 调用为主） | 10+ | 无 | **S** | 纯改名 |

**总体 risk ranking**（值得单独拉 issue 追踪的最大风险）：
1. **`file.path` 的"resolve 层"缺失** — 这是 renderer 侧对 FileMetadata 的最深依赖。v2 不再有 `path` 字段，需要 `FileManager.getFilePath(entry)` 或类似的 shim，否则 UI 组件（尤其 AttachmentPreview / TranslatePage / MCP）全线崩溃。
2. **`count` → `file_ref` 的语义替换** — handleDelete、cleanupMultipleBlocks、清空 topic、batch delete 都依赖 count 机制；换成 file_ref 查询需要重写且要确保**写路径**（新增引用时也要插 file_ref）。
3. **id 从 uuidv4 → uuidv7** — 所有跨表持久化引用都要通过 migrator 映射（包括 Redux-persist 的 paintings state）。
4. **`ext` 前导点变化** — `.pdf` 变 `pdf`。此变化若没有 codemod 会在 renderer 中引爆（`file.ext === '.pdf'` 全 false）。
5. **Dexie `message_blocks` 上的复合索引 `file.id`** — 所有 `db.message_blocks.where('file.id').equals(fileId)` 必须在 SQLite 侧替换为 `file_ref` 查询。
6. **Painting 的引用检查反向查** — 目前 `FilesPage.handleBatchDelete` 遍历整个 paintings state 的 files 数组查引用，v2 后应通过 `file_ref` 查（更快），但迁移期需保证双写/双读一致性。

---

## 8. 冗余代码清单

重构完成后可删的代码候选（按置信度排序）：

### 8.1 可以立刻移除（高置信）

| 代码位置 | 原因 |
|---------|------|
| `packages/shared/data/types/file/file.ts` | 新类型替换后整份文件删除；index.ts 中 `export * from './file'` 改为 `export * from './fileEntry'`（已经有） |
| `src/renderer/src/types/file.ts` 中的 `FileMetadata`/`ImageFileMetadata`/`PdfFileMetadata`/`isImageFileMetadata` | 全 renderer 切换后删除 |
| `src/renderer/src/types/file.ts:134 PdfFileMetadata` | **已经是死代码**（grep 未发现任何消费点） |
| `src/renderer/src/databases/index.ts` 中的 `files: EntityTable<FileMetadata, 'id'>` 和所有版本的 `files: 'id, name, origin_name, ...'` | Dexie files 表废弃 |
| `src/renderer/src/services/FileManager.ts` 整个文件 | 用 `useQuery('/files/entries/:id')` + FileIpc 替代 |
| `src/renderer/src/services/FileAction.ts:handleDelete` 中遍历 topics/messages 删 block 的部分 | v2 由 file_ref 级联删除 |
| `src/main/services/FileStorage.ts` 整个文件 | 2043 行全删；功能拆分到 `src/main/file/{FileManager,ops/*}` |
| `src/main/services/remotefile/*` 的 `FileMetadata` 参数 | Phase 2+ 切为 FileEntryId |
| `src/renderer/src/services/db/DexieMessageDataSource.ts:400-416`（引用计数维护） | file_ref 取代 |
| `src/preload/index.ts:218-286` 的 `file: {...}` 47 个方法 | 改用新 FileIpcApi（接口已在 `packages/shared/file/types/ipc.ts`） |

### 8.2 需要分阶段清理（中置信）

| 代码 | 时机 |
|------|------|
| `FileStorage` 里的 Notes 专用方法（watcher、batchUploadMarkdown、fileNameGuard、validateNotesDirectory、getDirectoryStructure、renameDir、moveDir、deleteExternalDir） | Notes 域独立重构时 |
| `remotefile/` 4 个 Service | 等 AI SDK Files Upload API 稳定；对应 `file_upload` 表延后 |
| `FileStorage.downloadFile / saveBase64Image / savePastedImage` | `createEntry` 统一 URLString/Base64String/Uint8Array 接管后删除 |
| `FileStorage.copyFile` | 当前**没有 renderer 消费点**，但 preload 仍暴露为 `file.copy`，需要确认后删除 |
| `FileStorage.pdfPageCount` | 合并到 `FileIpcApi.getMetadata`（PDF 分支带 pageCount） |
| `FileStorage.base64Image / base64File / binaryImage` | 统一由 `FileIpcApi.read(handle, {encoding})` 替代 |

### 8.3 `knowledge.ts` 中的 FileMetadataSchema

`packages/shared/data/types/knowledge.ts:42` 定义 `FileMetadataSchema: z.ZodType<FileMetadata>`，并在 `FileItemData` 里复用。这是 **最顽固的 FileMetadata 化石**，因为它同时：
- 被 SQLite `knowledge_item.data` 当 JSON 存
- 是 KnowledgeMigrator 的终点 shape

建议的方案：**迁移完成后把 `KnowledgeItemData.file` 改为 `FileEntryId`**，然后在 query handler 里 JOIN fileEntry 返回 file 对象给 renderer。这是 Phase 3 的工作。

---

## 9. 开放问题（需要产品或架构决策）

1. **Chat attach 到底是 internal 还是 external？**
   - 用户拖拽图片进对话：复制到 Cherry 目录（internal，安全）还是仅引用（external，省空间但用户移动文件会导致消息损坏）？
   - 目前旧 `FileStorage.uploadFile` 是强制 internal。v2 应该继承这个决定还是给用户一个选项？

2. **`count` 引用计数 vs `file_ref` 的一致性窗口**
   - Phase 2 如果做"双读双写"，Dexie count 和 file_ref 行数怎么保证一致？
   - 建议：Phase 2 只以 file_ref 为真值源，count 字段只读不写；删除逻辑完全走 file_ref。

3. **Knowledge Video 的 `content: FileMetadata[]`**
   - 一个视频条目可以关联多个文件（视频+字幕）。v2 要么做多条 file_ref（role=`video`/`subtitle`），要么做一个包装类型。推荐前者。

4. **`file.id + file.ext` 作为物理路径组件的约定是否继承？**
   - 旧约定：`{storageDir}/{id}{ext}`，ext 带点。这个约定在 `services/FileManager.getFilePath`、`FileStorage.storageDir`、`application.getPath('feature.files.data', '{id}{ext}')` 多处硬编码。v2 `FileEntry.ext` 是不带点的字符串，需要统一工具方法做拼接（避免每次手写 `.` + ext）。

5. **`FileStorage` 的 watcher 功能归谁？**
   - 目前与 Notes 强绑定，但实现方在 FileStorage。v2 应迁移到 NotesService 内部 watcher，不再作为通用 file IPC。确认这个方向是否正确。

6. **OCR 的 `ImageFileMetadata` 是否要保留？**
   - 新 `PhysicalFileMetadata` 里 `ImageFileMetadata` = `{kind:'file', type:'image', width, height, mime, size, ...}`，与旧的 `FileMetadata & {type:'image'}` 不同。OCR provider 接口要改签名，但 width/height 对 OCR 实际无用（只是传参方便）。建议统一用 `FileEntryId`，provider 内部 `withTempCopy` 获取实际文件。

7. **Phase 2 双写期长度**
   - 旧 Dexie `files` 表和新 SQLite `file_entry` 并存多久？建议两个发布周期（双写 → 只读旧 → 删）。

8. **临时文件（tempSessionFileRef）的 GC 策略**
   - `packages/shared/data/types/file/ref/tempSession.ts` 已经定义了 `sourceType='temp_session'`, `role='pending'`。但具体谁在什么时机清理这些 temp ref？建议：session 结束时主动清理 + 启动时扫 "无任何 ref 的 internal entry" 做 sweep。

9. **Painting state 的 Redux-persist 迁移**
   - paintings state 持久化到 electron-store 或类似，里面内嵌 FileMetadata。v2-refactor-temp 的 classification.json 是否覆盖 paintings？需要 data-classify migrator 也处理这层。

---

## 附录 A：文件清单速查

### FileMetadata 导入文件（96 个），按密度排序前 30：

| 文件 | 引用次数 |
|------|---------|
| `src/renderer/src/services/FileManager.ts` | 18 |
| `src/main/services/FileStorage.ts` | 11 |
| `src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts` | 11 |
| `src/renderer/src/components/Popups/VideoPopup.tsx` | 9 |
| `src/renderer/src/pages/home/Inputbar/AttachmentPreview.tsx` | 7 |
| `src/main/services/KnowledgeService.ts` | 6 |
| `src/renderer/src/pages/paintings/DmxapiPage.tsx` | 6 |
| `src/renderer/src/preload/index.ts` | 6 |
| `src/renderer/src/pages/home/Inputbar/context/InputbarToolsProvider.tsx` | 5 |
| `src/main/knowledge/preprocess/{Doc2x,Mistral}PreprocessProvider.ts` | 5 |
| `src/renderer/src/services/{Messages,Token}Service.ts` | 5 |
| `src/renderer/src/types/{newMessage,ocr,knowledge,file}.ts` | 4-6 |
| `src/renderer/src/store/thunk/messageThunk.ts` | 4 |
| `src/renderer/src/pages/paintings/AihubmixPage.tsx` | 4 |
| `src/renderer/src/aiCore/prepareParams/fileProcessor.ts` | 4 |
| `src/renderer/src/hooks/{useFiles,useKnowledge,useOcr,useKnowledgeFiles,useTopic}.ts` | 2-4 |
| …（省略余下 60+） | |

完整列表请 `grep "FileMetadata\\b" -r src packages`。

### v1 → v2 IPC 映射

详见 [`v2-refactor-temp/docs/file-manager/handler-mapping.md`](./handler-mapping.md)。
