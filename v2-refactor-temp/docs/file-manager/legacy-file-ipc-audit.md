# Legacy File IPC 审计（迁移基线 + 进度）

> **本文档覆盖**：把仍搭在 **legacy Electron IPC transport**（`IpcChannel` 枚举 + `ipcMain.handle` / `this.ipcHandle` + 手写 preload `window.api.file.*` / `window.api.fs.*` / `window.api.openPath`）上的**所有 file IPC channel**，逐条列出**注册点、背后实现、renderer 消费者（file:line + 用途）**，作为迁移到 [IpcApi](../../../docs/references/ipc/ipc-overview.md) 的依据。
>
> **调研日期**：2026-07-03 · **对应分支**：`eurfelux/refactor/file-ipc`
>
> ### 📌 这是一份「迁移前基线」，不是实时代码快照
>
> 清单按 **2026-07-03 的代码** 盘点。此后的迁移**不会把条目从表中删掉**——已迁走的 channel 保留原行并标 ✅，注明去向。这样这份文档同时是**基线**和**进度表**：某条不在表里 = 调研时就不存在；标了 ✅ = 已迁移。
>
> **别拿 `IpcChannel` 枚举来"证伪"本文档**：一条 channel 在枚举里查不到，通常说明它已经迁走了（应在此处标 ✅），而不是当初记错了。迁移进度见 [§0 迁移进度清单](#0-迁移进度清单)。
>
> ⚠️ **行号是时点值**：正文中的 `file:line` 是调研时的锚点，合并 `origin/main` 后可能漂移（preload 早期误记为 `index.ts`，实际文件为 `src/preload/preload.ts`）。行号漂移**不影响**条目本身的事实性。
>
> **本文档 ≠ 目标设计**。这里只回答"**现在有哪些旧 file IPC、谁在消费**"，不定义新 channel 命名 / schema / 迁移分批。目标设计与方法签名重设计另见：
>
> - [`ipc-redesign.md`](./ipc-redesign.md) ⚠️ OUTDATED — 早期方法签名重设计
> - [`handler-mapping.md`](./handler-mapping.md) ⚠️ OUTDATED — 早期 v1→v2 handler 映射
> - [`migration-plan.md`](./migration-plan.md) — `FileMetadata` / `FileStorage` **字段级**迁移（不同维度）
> - IpcApi 架构准绳：[`docs/references/ipc/ipc-overview.md`](../../../docs/references/ipc/ipc-overview.md)
>
> **与上述文档的区别**：本文档是**迁移基线清单**——按 2026-07-03 的真实代码逐条核对了注册点与消费者行号，不带 v1→v2 语义重设计。

---

## 0. 迁移进度清单

基线 **36 条** legacy channel（Group A 6 + Group B 30）。下面只记**已完成**的，未打勾的条目在 §3 / §4 各表中原样保留。

### PR #16735 — `File_IsTextFile` / `File_IsDirectory` / `File_GetMetadata` → `file.get_metadata`

- [x] **`File_GetMetadata`**（Group A）→ IpcApi route `file.get_metadata`。基线时 entry 分支是 `throw @phase2` 的半残状态，新路由把两个分支都接通了（共用 `buildPhysicalFileMetadata`），输出改为 `PhysicalFileMetadata | null`（缺失/不可读 → `null`）。
- [x] **`File_IsDirectory`**（B1）→ 折叠进 `file.get_metadata`，消费者改判 `meta?.kind === 'directory'`。`FileStorage.isDirectory` 一并删除。
- [x] **`File_IsTextFile`**（B1）→ 折叠进 `file.get_metadata`，消费者改判 `meta.type === 'text'`。派生逻辑从"无条件嗅探内容"改为**扩展名优先、仅未知扩展名回退嗅探**（`@main/utils/file/metadata` 的 `getFileType`，契约见其 docstring）。
- [x] 三条 channel 的 preload 绑定与 `IpcChannel` 枚举项同步删除。

### 上游迁移（非本 PR）

- [x] **`Open_Path`**（B4）→ IpcApi route `system.shell.open_path`（`src/main/ipc/handlers/system.ts`）。注意与 B1 的 `File_OpenPath` 是两条不同 channel，后者**仍在**，合一的评估留待 B1 迁移时进行。

### 结余

| 分组 | 基线 | 已迁移 | 剩余 |
| --- | --- | --- | --- |
| Group A | 6 | 1 | **5** |
| Group B — B1 | 25 | 2 | **23** |
| Group B — B2 | 2 | 0 | **2** |
| Group B — B3 | 2 | 0 | **2** |
| Group B — B4 | 1 | 1 | **0** |
| **合计** | **36** | **4** | **32** |

对照用：当前 `src/shared/ipc/schemas/file.ts` 有 **14** 条 `file.*` IpcApi route（见 §2）。

---

## 1. 全景总览

旧 file IPC 分布在 **3 个注册点**，背后是 **4 套实现**；另有一部分**已经迁到 IpcApi**。channel 数为**基线值（2026-07-03）**，括号内为扣除已迁移后的剩余（见 [§0](#0-迁移进度清单)）：

| 分组 | 注册点 | 注册方式 | 背后实现 | channel 数 | 说明 |
| --- | --- | --- | --- | --- | --- |
| **已迁移** ✅ | `src/main/ipc/handlers/file.ts` | IpcApi route | v2 `FileManager` | 11 → **14** | 已在新架构，见 §2 |
| **Group A** ⚠️ | `src/main/services/file/FileManager.ts` `registerIpcHandlers()` | `this.ipcHandle(IpcChannel.*)` | v2 `FileManager` | 6（剩 **5**） | v2 实现，但仍搭 legacy transport，见 §3 |
| **Group B** ⚠️ | `src/main/ipc.ts` `registerIpc()` | `ipcMain.handle(IpcChannel.*)` | 见下（异质） | 30（剩 **27**） | 见 §4 |
| 相邻（非本次范围） | `src/main/services/file/tree/DirectoryTreeManager.ts` | `this.ipcHandle` + `sender.send` | v2 tree module | 4 | file tree，见 §6 |

**Group B 内部并非铁板一块**（迁移时不能当成一类处理）：

| Group B 子类 | 背后实现 | channel 数 | 性质 |
| --- | --- | --- | --- |
| **B1** | v1 `FileStorage`（`src/main/services/FileStorage.ts`，40KB，ipc.ts 里 import 为 `fileManager`） | 25（剩 **23**） | 纯 v1 残留 |
| **B2** | `FileSystemService`（`src/main/services/FileSystemService.ts`，918B） | 2 | `Fs_Read` / `Fs_ReadText` |
| **B3** | v2 `tree/search`（`src/main/services/file/tree/search.ts`，ripgrep） | 2 | **已是 v2 实现**，只是搭在旧 transport 上 |
| **B4** ✅ | 内联 `shell.openPath`（ipc.ts 内联，无 service） | 1（剩 **0**） | `Open_Path`，已迁至 `system.shell.open_path` |

**基线需迁移合计 = Group A(6) + Group B(30) = 36 条；已迁 4 条，当前剩 32 条。** 另有 preload-only 的 `getPathForFile`（`webUtils`，**不走 IPC**，无需迁移，但常与 file IPC 成对出现，见 §5）。

### 1.1 消费者热点（跨分组）

划线 + ✅ = 该 channel 已迁至 IpcApi，热点本身仍在（见 [§0](#0-迁移进度清单)）。

| 热点 | 消费的 channel | 位置 |
| --- | --- | --- |
| **Notes 集群**（最重） | `readExternal` `write` `mkdir` `rename` `renameDir` `deleteExternalFile` `deleteExternalDir` `move` `moveDir` `checkFileName` `validateNotesDirectory` `batchUploadMarkdown` `listDirectory` `selectFolder` | `services/NotesService.ts`、`pages/notes/NotesPage.tsx`、`services/NotesSearchService.ts`、`pages/notes/hooks/*`、`pages/notes/NotesSettings.tsx` |
| **Paintings** | `createInternalEntry` `getPhysicalPath` `binaryImage` | `pages/paintings/*` |
| **Export** | `save` `write` `saveImage` `readExternal` | `services/ExportService.ts`、`utils/exportExcel.ts` |
| **Composer / Paste** | `write` `createTempFile` `get` `getPathForFile` `fs.readText` | `components/composer/paste/pasteHandling.ts`、`components/composer/*` |
| **Artifact 预览** | `listDirectoryEntries` `listDirectory` ~~`isTextFile`~~ ~~`isDirectory`~~ ~~`getMetadata`~~ ✅ `fs.read` `fs.readText` | `components/chat/panes/*`、`components/ArtifactPreview/*` |
| **消息附件 / 引用** | `openPath` `showInFolder` ~~`getMetadata`~~ ✅ | `pages/*/messages/*Adapter`、`components/chat/*` |
| **Send-time 附件入库** | `createInternalEntry` `getPhysicalPath` ~~`getMetadata`~~ ✅ | `utils/file/buildFileParts.ts` |

### 1.2 关键交叉发现

1. **Group A 单项 channel 与已迁移的 IpcApi 批量 channel 重叠**，且其中 3 条 renderer 侧已死：
   - `File_PermanentDelete`（单项）已被 IpcApi `file.batch_permanent_delete` 取代 → renderer **零消费**
   - `File_RunSweep` 只在主进程内部调用 → renderer **零消费**
   - `File_EnsureExternalEntry` 只剩一个测试死 mock → renderer **零生产消费**
2. ✅ **~~`File_GetMetadata` handler 半残~~（已解决，#16735）**：基线时 entry 分支直接 `throw 'getMetadata(FileEntryHandle) is not yet wired (@phase 2)'`，只有 path 分支可用，反而比 IpcApi 的 `file.batch_get_metadata` 更不完整。新 route `file.get_metadata` 两个分支共用 `buildPhysicalFileMetadata`，半残状态消失。
3. **无别名 / 无 renderer 包装层**：全仓不存在 `const { file } = window.api` 解构，renderer 侧 `services/` 下也无 `FileManager`/`FileStorage`/`FileService` 包装器（该目录仅 `ImageStorage.ts`，不碰这些方法）。每个消费者都直接 `window.api.file.<method>` / `window.api.fs.<method>` 调用。`NotesService`/`ExportService` 等只是**一级 pass-through**，不是抽象层。
4. **`getPathForFile` 虽非 IPC，但几乎总与 file IPC 成对**（`file.get` / `isDirectory` / `readExternal`），建议按同一迁移单元对待。

---

## 2. 已迁移到 IpcApi 的 file 路由（参照）

`src/main/ipc/handlers/file.ts` + `src/shared/ipc/schemas/file.ts`，通过 `window.api.ipcApi.request('file.*', ...)` 调用。**已完成，不在待迁移清单内**，此处列出仅供对照（避免为它们重复造单项 channel）：

| IpcApi route | 实现 |
| --- | --- |
| `file.batch_get_metadata` | `dispatchHandle` → `FileManager.getMetadata(entryId)` / `getMetadataByPath`（**entry 分支已接通**） |
| `file.batch_get_physical_paths` | `FileManager.getPhysicalPath` |
| `file.batch_get_dangling_states` | `FileManager.batchGetDanglingStates` |
| `file.batch_create_internal_entries` | `FileManager.batchCreateInternalEntries` |
| `file.batch_trash` / `file.batch_restore` / `file.batch_permanent_delete` | `FileManager.batch*` |
| `file.empty_trash` | `FileManager.emptyTrash` |
| `file.rename` | `FileManager.rename` |
| `file.open` | `dispatchHandle` → `FileManager.open` / `safeOpen` |
| `file.show_in_folder` | `dispatchHandle` → `FileManager.showInFolder` / `showPathInFolder` |
| `file.get_metadata` 🆕 | `dispatchHandle` → `FileManager.getMetadata(entryId)` / `getMetadataByPath`；输出 `PhysicalFileMetadata \| null` |
| `file.read` 🆕 | `FileManager.read` |
| `file.write_if_unchanged` 🆕 | `FileManager.writeIfUnchanged` |

🆕 = 基线（11 条）之后新增，共 **14** 条。`file.get_metadata` 由 PR #16735 新增，见 [§0](#0-迁移进度清单)。
---

## 3. Group A — `FileManager.ts` legacy-transport channel（v2 实现）

注册于 `FileManager.registerIpcHandlers()`（`src/main/services/file/FileManager.ts:670-711`），用 `this.ipcHandle(IpcChannel.File_*)`。背后已是 v2 `FileManager`，只差把 transport 换成 IpcApi。

| Channel | Handler 实现 | Renderer 方法（`window.api.file.*`） | 生产消费者 | 测试引用 |
| --- | --- | --- | --- | --- |
| `File_CreateInternalEntry` | `this.createInternalEntry` | `createInternalEntry(params)` | **5** | 多 |
| `File_GetPhysicalPath` | `this.getPhysicalPath` | `getPhysicalPath(params)` | **3** | 多 |
| ✅ ~~`File_GetMetadata`~~ | ~~`dispatchHandle`（entry `throw @phase2`；path→`getMetadataByPath`）~~ | ~~`getMetadata(handle)`~~ | ~~**2**~~ | **已迁至 `file.get_metadata`**（#16735） |
| `File_EnsureExternalEntry` | `this.ensureExternalEntry` | `ensureExternalEntry(params)` | **0** ☠️ | 1 死 mock |
| `File_PermanentDelete` | `dispatchHandle`（entry→`permanentDelete`；path→`fsRemove`） | `permanentDelete(handle)` | **0** ☠️（被 IpcApi 批量取代） | — |
| `File_RunSweep` | `this.runSweep` | `runSweep()` | **0** ☠️（主进程内部） | — |

**生产消费者明细：**

- `createInternalEntry`（5）：
  - `src/renderer/utils/file/buildFileParts.ts:29` — send 时把 composer 附件路径升格为 internal `FileEntry`
  - `src/renderer/pages/paintings/utils/downloadImages.ts:27` — base64 生图结果入库
  - `src/renderer/pages/paintings/utils/downloadImages.ts:31` — 远程 URL 图片入库
  - `src/renderer/pages/paintings/hooks/usePaintingComposerInputFiles.ts:123` — 画板输入附件持久化
  - `src/renderer/pages/paintings/model/runPainting.ts:23` — base64 生图结果入库（适配 legacy `FileMetadata` 前）
- `getPhysicalPath`（3）：
  - `src/renderer/utils/file/buildFileParts.ts:30` — 解析新建 `FileEntry` 物理路径以拼 `file://` URL
  - `src/renderer/pages/paintings/utils/fileEntryAdapter.ts:21` — 适配 `FileEntry` → 旧 `FileMetadata` 时取路径
  - `src/renderer/pages/paintings/hooks/usePaintingComposerInputFiles.ts:77` — seed 时解析输入 `FileEntry` 路径为附件 chip
- `getMetadata`（2）：
  - `src/renderer/utils/file/buildFileParts.ts:31` — 读复制后物理文件的真实 MIME（path handle），设 `FileUIPart.mediaType`
  - `src/renderer/hooks/useFileSize.ts:29` — 按绝对路径 handle 做 `fs.stat` 显示文件大小

> **☠️ 三条死 channel（renderer 侧）**：`ensureExternalEntry` / `permanentDelete` / `runSweep` 在 preload 有绑定（`src/preload/preload.ts:185,189,190`），但 `src/renderer/` 与 `packages/` 均无生产调用。`ensureExternalEntry` 仅剩 `SaveToKnowledgePopup.test.tsx:173` 一个从不被调用的 `vi.fn()`；`permanentDelete` 的 FilesPage 删除已改走 IpcApi `file.batch_permanent_delete`（见 `FilesPage.test.tsx:550-559`）；`runSweep` renderer 无任何引用。迁移时可直接**删除这三条 legacy channel + preload 绑定**，无需在 IpcApi 补对应单项路由。

> **主进程内部直调（非本次 IPC 消费者，仅备注）**：`FileManager` 的这些方法在主进程内也被直调（不走 preload/IPC）：`createInternalEntry` @ `src/main/ai/AiService.ts:551,579`、`src/main/ai/provider/custom/tasks/imageGenerationJobHandler.ts:168`；`permanentDelete` @ `imageGenerationJobHandler.ts:198`；`getMetadata` @ `src/main/features/fileProcessing/tasks/jobExecution.ts:142`。这些不受 IPC 迁移影响。

---

## 4. Group B — `src/main/ipc.ts` legacy channel

注册于 `registerIpc()`，用 `ipcMain.handle(IpcChannel.File_*/Fs_*/Open_Path)`。按背后实现分 B1–B4。

### 4.1 B1 — v1 `FileStorage` 支撑（基线 25 条，剩 23）

ipc.ts 里 `import { fileStorage as fileManager } from './services/FileStorage'`。这是**纯 v1 残留**，迁移与 [`migration-plan.md`](./migration-plan.md) 的 `FileStorage`/`FileMetadata` 字段级退役强相关。

| Channel | `FileStorage` 方法 | Renderer 方法 | 生产消费者数 |
| --- | --- | --- | --- |
| `File_Write` | `writeFile` | `write` | 10 |
| `File_OpenPath` | `openPath` | `openPath` | 9 |
| `File_Save` | `save` | `save` | 8 |
| `File_ReadExternal` | `readExternalFile` | `readExternal` | 8 |
| `File_SelectFolder` | `selectFolder` | `selectFolder` | 8 |
| `File_Select` | `selectFile` | `select` | 7 |
| `File_Get` | `getFile` | `get` | 7 |
| `File_CheckFileName` | `fileNameGuard` | `checkFileName` | 5 |
| `File_CreateTempFile` | `createTempFile` | `createTempFile` | 4 |
| `File_SaveImage` | `saveImage` | `saveImage` | 3 |
| `File_ShowInFolder` | `showInFolder` | `showInFolder` | 3 |
| ✅ ~~`File_IsDirectory`~~ | ~~`isDirectory`~~ | ~~`isDirectory`~~ | **已折叠进 `file.get_metadata`**（`kind`，#16735） |
| `File_Open` | `open` | `open` | 2 |
| `File_Move` | `moveFile` | `move` | 2 |
| `File_MoveDir` | `moveDir` | `moveDir` | 2 |
| `File_Mkdir` | `mkdir` | `mkdir` | 2 |
| ✅ ~~`File_IsTextFile`~~ | ~~`isTextFile`~~ | ~~`isTextFile`~~ | **已折叠进 `file.get_metadata`**（`type`，#16735） |
| `File_ValidateNotesDirectory` | `validateNotesDirectory` | `validateNotesDirectory` | 2 |
| `File_Rename` | `renameFile` | `rename` | 1 |
| `File_RenameDir` | `renameDir` | `renameDir` | 1 |
| `File_DeleteExternalFile` | `deleteExternalFile` | `deleteExternalFile` | 1 |
| `File_DeleteExternalDir` | `deleteExternalDir` | `deleteExternalDir` | 1 |
| `File_BatchUploadMarkdown` | `batchUploadMarkdownFiles` | `batchUploadMarkdown` | 1 |
| `File_SavePastedImage` | `savePastedImage` | `savePastedImage` | 1 |
| `File_BinaryImage` | `binaryImage` | `binaryImage` | 1 |

**生产消费者明细（B1）：**

- `write`（10）：`utils/exportExcel.ts:92`、`components/CodeBlockView/HtmlArtifactsCard.tsx:34`、`components/composer/paste/pasteHandling.ts:49`、`components/composer/paste/pasteHandling.ts:82`、`pages/translate/TranslatePage.tsx:623`、`pages/notes/NotesPage.tsx:168`、`services/NotesService.ts:108`、`services/NotesService.ts:305`、`services/ExportService.ts:334`、`services/ExportService.ts:383`
- `openPath`（9）：`components/CodeBlockView/HtmlArtifactsCard.tsx:35`、`components/chat/panes/OpenExternalAppButton.tsx:84`、`components/chat/panes/OpenExternalAppButton.tsx:103`、`components/chat/citations/CitationsPanel.tsx:16`、`hooks/useAttachment.ts:25`、`pages/home/messages/homeMessageListAdapter.tsx:339`、`pages/agents/messages/agentMessageListAdapter.ts:143`、`pages/agents/components/Sessions.tsx:978`、`pages/knowledge/hooks/usePreviewKnowledgeSource.ts:47`
- `save`（8）：`components/ImageViewer.tsx:129`、`components/CodeBlockView/view.tsx:181`、`components/CodeBlockView/HtmlArtifactsCard.tsx:45`、`components/chat/messages/hooks/useMessageExportActions.ts:41`（`saveTextFile` 包装）、`hooks/resourceCatalog/useResourceCatalogController.ts:162`、`services/ExportService.ts:319`、`services/ExportService.ts:365`、`services/ExportService.ts:1040`
- `readExternal`（8）：`components/Popups/SaveToKnowledgePopup.tsx:319`、`hooks/useNotesQuery.ts:67`、`pages/translate/TranslatePage.tsx:478`、`pages/notes/hooks/useNotesMenu.tsx:104`、`pages/notes/hooks/useNotesEditing.ts:48`、`pages/knowledge/components/AddKnowledgeItemDialog.tsx:110`、`services/ExportService.ts:1101`、`services/NotesSearchService.ts:93`
- `selectFolder`（8）：`utils/exportExcel.ts:80`、`components/resource/WorkspaceSelector.tsx:120`、`hooks/useCodeCli.ts:150`、`pages/settings/DataSettings/MarkdownExportSettings.tsx:41`、`pages/notes/NotesSettings.tsx:40`、`pages/knowledge/components/AddKnowledgeItemDialog.tsx:211`、`services/BackupService.ts:105`、`services/BackupService.ts:115`
- `select`（7）：`components/composer/tools/components/AttachmentButton.tsx:30`、`hooks/useFiles.ts:49`、`pages/code/CodeCliPage.tsx:442`、`components/resource/dialogs/import/ImportSkillDialog.tsx:80`、`components/resource/dialogs/import/ImportSkillDialog.tsx:99`、`pages/knowledge/components/AddKnowledgeItemDialog.tsx:192`、`pages/files/FilesPage.tsx:601`
- `get`（7）：`utils/input.ts:20`、`utils/input.ts:47`、`components/composer/paste/pasteHandling.ts:50`、`components/composer/paste/pasteHandling.ts:83`、`components/composer/paste/pasteHandling.ts:98`、`pages/translate/TranslatePage.tsx:624`、`pages/translate/TranslatePage.tsx:626`
- `checkFileName`（5）：`pages/notes/NotesPage.tsx:864`、`services/NotesService.ts:93`、`services/NotesService.ts:106`、`services/NotesService.ts:196`、`services/NotesService.ts:301`
- `createTempFile`（4）：`components/CodeBlockView/HtmlArtifactsCard.tsx:33`、`components/composer/paste/pasteHandling.ts:48`、`components/composer/paste/pasteHandling.ts:79`、`pages/translate/TranslatePage.tsx:620`
- `saveImage`（3）：`components/CodeBlockView/HtmlArtifactsPopup.tsx:151`、`components/chat/messages/hooks/useMessageExportActions.ts:45`（`saveImage` 包装 → `messageMenuBarActions.tsx:238`）、`services/ExportService.ts:1090`
- `showInFolder`（3）：`components/chat/panes/OpenExternalAppButton.tsx:94`、`pages/home/messages/homeMessageListAdapter.tsx:343`、`pages/agents/messages/agentMessageListAdapter.ts:150`
- `isDirectory`（3）：`components/composer/variants/AgentComposer.tsx:677`、`components/resource/dialogs/import/ImportSkillDialog.tsx:127`、`pages/agents/messages/agentMessageListAdapter.ts:157`
- `open`（2）：`components/Popups/ImportPopup.tsx:46`、`services/BackupService.ts:130`
- `move`（2）：`pages/notes/NotesPage.tsx:496`（移动失败回滚）、`pages/notes/NotesPage.tsx:880`（拖拽移动）
- `moveDir`（2）：`pages/notes/NotesPage.tsx:493`（回滚）、`pages/notes/NotesPage.tsx:882`（拖拽移动）
- `mkdir`（2）：`services/NotesService.ts:95`、`services/NotesService.ts:394`
- `isTextFile`（2）：`utils/file.ts:93`（`isSupportedFile` 兜底）、`hooks/useIsTextFile.ts:44`
- `validateNotesDirectory`（2）：`services/NotesService.ts:155`（`resolveNotesPath`）、`pages/notes/NotesSettings.tsx:63`
- `rename`（1）：`services/NotesService.ts:203`
- `renameDir`（1）：`services/NotesService.ts:207`
- `deleteExternalFile`（1）：`services/NotesService.ts:189`
- `deleteExternalDir`（1）：`services/NotesService.ts:187`
- `batchUploadMarkdown`（1）：`services/NotesService.ts:250`
- `savePastedImage`（1）：`components/RichEditor/useRichEditor.ts:402`
- `binaryImage`（1）：`pages/paintings/model/canonicalGenerate.ts:170`

### 4.2 B2 — `FileSystemService` 支撑（2 条）

| Channel | 实现 | Renderer 方法 | 生产消费者 |
| --- | --- | --- | --- |
| `Fs_Read` | `FileService.readFile` | `fs.read(pathOrUrl, encoding?)` | 5 |
| `Fs_ReadText` | `FileService.readTextFileWithAutoEncoding` | `fs.readText(pathOrUrl)` | 4 |

**生产消费者明细（B2）：**

- `fs.read`（5）：`components/ImageViewer.tsx:75`、`components/ArtifactPreview/office/WordPreviewPanel.tsx:143`、`components/ArtifactPreview/office/PptxPreviewPanel.tsx:184`、`components/ArtifactPreview/pdf/PdfPreviewPanel.tsx:213`、`hooks/useAssistantCatalogPresets.ts:158`
- `fs.readText`（4）：`components/chat/panes/ArtifactPane.tsx:268`、`components/composer/ComposerSurface.tsx:739`、`hooks/useAttachment.ts:18`、`pages/translate/TranslatePage.tsx:479`

### 4.3 B3 — v2 `tree/search` 支撑（2 条，已是新实现）

这两条 handler 直接调 `src/main/services/file/tree/search.ts` 的 `listDirectory` / `listDirectoryEntries`（ripgrep），**实现已是 v2**，只是仍搭在 legacy transport 上——迁移只需换 transport，不涉及实现重写。

| Channel | 实现 | Renderer 方法 | 生产消费者 |
| --- | --- | --- | --- |
| `File_ListDirectory` | `search.listDirectory` | `listDirectory(dirPath, options?)` | 2 |
| `File_ListDirectoryEntries` | `search.listDirectoryEntries` | `listDirectoryEntries(dirPath, options?)` | 2 |

**生产消费者明细（B3）：**

- `listDirectory`（2）：`components/composer/variants/agent/useAgentResourceSearchProvider.tsx:106`（@-resource 搜索，深度 3）、`pages/notes/NotesPage.tsx:279`（探测默认笔记目录是否为空）
- `listDirectoryEntries`（2）：`components/chat/panes/useArtifactFileTreeModel.ts:251`（递归搜索 artifact 工作区树）、`components/chat/panes/useArtifactFileTreeModel.ts:369`（单次批量列出一层子项，替代 N+1 `isDirectory`）

> `listDirectoryEntries` 是为消除 `listDirectory` + 逐项 `isDirectory` 的 N+1 而引入的，二者 channel 独立、消费者独立，迁移时不要合并。

### 4.4 B4 — 内联 `shell.openPath`（基线 1 条，剩 0）✅

| Channel | 实现 | Renderer 方法 | 生产消费者 |
| --- | --- | --- | --- |
| ✅ ~~`Open_Path`~~ | ~~`ipc.ts` 内联 `shell.openPath(path)`~~ | ~~**`window.api.openPath(path)`**（顶层，非 `file.*`）~~ | **已迁至 IpcApi route `system.shell.open_path`**（`src/main/ipc/handlers/system.ts`），由上游完成，非本 PR |

> ⚠️ **`Open_Path` 与 `File_OpenPath`（B1）是两条不同 channel**，功能重复（都是"用系统默认程序打开路径"）。`Open_Path` 已迁走，**`File_OpenPath` 仍在 B1 待迁**——迁 B1 时评估是否直接并入 `system.shell.open_path`，而不是再造一条 `file.*` 路由。

---

## 5. Preload-only（非 IPC）：`getPathForFile`

`window.api.file.getPathForFile(file)` → `webUtils.getPathForFile(file)`（`src/preload/preload.ts:214`），**同步、无 `ipcRenderer.invoke`**。不属于 IPC 迁移范围，但**几乎总与 file IPC 成对出现**（拿到 `File` 对象的本地路径后紧接 `file.get` / `isDirectory` / `readExternal`），建议按同一迁移单元对待。

生产消费者（6）：`utils/input.ts:18`、`components/composer/paste/pasteHandling.ts:73`、`components/resource/dialogs/import/ImportSkillDialog.tsx:124`、`pages/translate/TranslatePage.tsx:612`、`pages/knowledge/components/AddKnowledgeItemDialog.tsx:43`、`pages/files/FilesPage.tsx:920`

---

## 6. 相邻但不在本次范围：File Tree channel

由 `src/main/services/file/tree/DirectoryTreeManager.ts` 用 `this.ipcHandle` 注册，**既不在 `FileManager.ts` 也不在 `ipc.ts`**——不属于你点名的两个文件，但它是 file-module 完整 legacy IPC surface 的一部分，列此备查。迁移时机与是否随本轮一起迁需另行决定。

| Channel | 方向 | Renderer 方法 |
| --- | --- | --- |
| `File_TreeCreate` | R→M | `window.api.tree.create(rootPath, options?)` |
| `File_TreeDispose` | R→M | `window.api.tree.dispose(treeId)` |
| `File_TreeRename` | R→M | `window.api.tree.rename(treeId, oldPath, newPath)` |
| `File_TreeMutation` | **M→R event**（`sender.send`） | `window.api.tree.onMutation(cb)` |

> 注意 `File_TreeMutation` 是 **M→R 推送事件**，迁移到 IpcApi 时对应 event 侧（`IpcApiService.send` + `useIpcOn`），与前三条 request 侧不同。详见 [`docs/references/file/directory-tree.md`](../../../docs/references/file/directory-tree.md)。

---

## 7. 迁移观察（事实性，不含目标设计）

> 以下是从审计事实直接推出的迁移相关观察，**非分批计划 / schema 设计**（那属于下一步）。

1. **可直接删除（renderer 零消费）**：`File_EnsureExternalEntry`、`File_PermanentDelete`、`File_RunSweep`。前二者的能力已由 IpcApi 批量路由覆盖；`runSweep` 只在主进程内部用。删 channel + 删 preload 绑定（`preload.ts:185,189,190`）即可，无需补单项 IpcApi 路由。
2. ✅ **已落地（#16735）**：`File_GetMetadata` 与 `file.batch_get_metadata` 语义重叠，2 个生产消费者（`buildFileParts`、`useFileSize`）都是**单文件按 path handle** 查询。当时的选项是改走批量路由或新增单项路由——**最终新增了单项 `file.get_metadata`**，并把 `File_IsDirectory` / `File_IsTextFile` 一并折叠进去（`kind` / `type` 字段）。同类判断今后应优先考虑复用该路由，而非再造单用途 channel。
3. **B3（`listDirectory` / `listDirectoryEntries`）实现已是 v2**，迁移成本最低（只换 transport）。
4. ✅ **B4 `Open_Path` 已迁至 `system.shell.open_path`（上游完成）**，但与之功能重复的 B1 `File_OpenPath` 仍在——迁 B1 时评估并入该 route，而非另造 `file.*` 路由。
5. **B1 是最大且最纠缠的一块**（基线 25 条、剩 23 条、v1 `FileStorage`），与 [`migration-plan.md`](./migration-plan.md) 的 `FileMetadata` 字段退役强耦合——`select`/`get` 返回 `FileMetadata`，`readExternal`/`binaryImage` 等围绕 v1 文件模型。这部分迁移不宜与字段退役割裂。
6. **测试面**：几乎每个 channel 都有对应 `vi.fn()` mock + `toHaveBeenCalledWith` 断言（IPC 被 stub），迁移时需同步更新；唯一在测试里"真实"消费的是 `AgentChatArtifactPane.test.tsx:353`（mock 按钮调 `file.openPath`）。`ArtifactPane.test.tsx` 单文件就有约 40 行 `listDirectoryEntries` 的 mock/断言。
7. **迁移单元建议按热点聚合**（见 §1.1），而非按 channel 逐条——Notes 集群、Paintings、Export、Composer/Paste、Artifact 预览各自成组，一个 PR 内一致切换，减少 v1/v2 混用窗口。
