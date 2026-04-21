# File Module IPC Redesign

> **⚠️ OUTDATED / SUPERSEDED（2026-04-21）**
>
> 本文档捕获的是早期设计，关键术语/决策已被后续评审推翻：
>
> - `FileManager.createEntry({origin})` 已拆分为 `createInternalEntry` + `ensureExternalEntry`（A-7）
> - External entry 不再进入 trash 生命周期（`fe_external_no_trash` CHECK）
> - `externalPath` 唯一性由 partial unique 升级为 global unique
> - `permanentDelete` 对 external 只删 DB 行，不触碰物理文件
>
> **实现准绳请以以下文档为准**：
>
> - [`docs/references/file/architecture.md`](../../../docs/references/file/architecture.md)
> - [`docs/references/file/file-manager-architecture.md`](../../../docs/references/file/file-manager-architecture.md)
> - [`rfc-file-manager.md`](./rfc-file-manager.md)
> - [`file-arch-problems-response.md`](./file-arch-problems-response.md)
>
> 本文档保留用于追溯设计演进，**不要**据此指导实现。

---

v1 有 52 个文件相关 IPC（44 File + 2 Fs + 1 Open_Path + 5 App 路径工具），v2 由 FileManager 统一管理。

## 架构

### 设计动机

Renderer 需要统一的文件操作入口（一个 `read` 既能读 entry 也能读外部路径），但 main process 内部 entry 管理（DB + FS 协调）和纯路径操作（直接 FS）是两种完全不同的职责。既要统一调用又要关注点分离，直接实现是矛盾的。

解法：**统一调用入口 + handler 层分派**。FileManager 作为唯一 lifecycle service 统管所有 IPC handler 注册，handler 内部按 target 类型分派到不同实现：

- `FileEntryId` → FileManager 自身方法（entry 协调: resolve → DB + FS）
- `FilePath` → ops.ts 纯函数（直接 FS/路径操作）

**Tradeoff**：纯路径操作（`canWrite`、`resolvePath` 等）也交由 entry + FS 协调层管理，FileManager 承担了超出 entry 管理的 IPC 注册职责。但 handler 层只是 thin routing，其 public 方法签名仍然只认 FileEntryId，纯 path 操作不污染 public API。相比引入第二个 lifecycle service，这个代价更小。

```
Renderer
  → FileManager.registerIpcHandlers() (统一入口, handler 层分派)
    ├── target: FileEntryId → this.read / this.write / ... (entry 方法)
    └── target: FilePath    → ops.read / ops.write / ... (直接委托)
```

**Main process 内部**：其他 service 可根据实际需求直接调用 ops.ts 或 FileManager，不需要经过 IPC。

## 设计原则

- **迁移保持语义不变**：v1 → v2 迁移过程中保持已有行为不变，不改变调用方语义。例如 v1 的 `deleteFile` 是永久删除，v2 仍映射到 `permanentDelete`，不主动改为 `trash`。行为改进（如引入 trash）由后续需求驱动，不在迁移中混入
- **统一入口，handler 分派**：Renderer 只有一个 File IPC 入口，handler 按 `FileEntryId` / `FilePath` 分派到 FileManager 或 ops.ts
- **不按 file/dir 拆分方法**：v1 的 `move` / `moveDir` 等冗余合并
- **Renderer 只传必要信息**：service 层推导元数据，不要求 renderer 预先获取
- **FileManager public API 只认 FileEntryId**：纯路径操作在 handler 层直接委托 ops.ts，不经过 FileManager 方法

## v1 清单与 v2 方案

状态标记：

- ✅ 保留（可能改签名）
- 🔀 合并到其他方法
- ❌ 移除
- ❓ 待定

### A. 文件选择 / 对话框

| v1 方法        | 功能                                    | v2 方案     | 说明                                                                                                                                                      |
| -------------- | --------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select`       | 打开文件选择对话框，返回 FileMetadata[] | 🔀 `select` | 与 `selectFolder` 合并，通过 `directory` 参数区分。返回路径而非 FileMetadata（入库是 `createEntry` 的事）。单选返回 `string \| null`，多选返回 `string[]` |
| `selectFolder` | 打开文件夹选择对话框，返回路径          | 🔀 `select` | 合并到 `select({ directory: true })`                                                                                                                      |
| `open`         | 打开文件对话框 + 读取内容（<2GB）       | ❌          | 拆为 `select` + `read` 组合，renderer 自行组装                                                                                                            |
| `save`         | 打开保存对话框 + 写入内容               | ✅ `save`   | 保留，`showSaveDialog` 与 `showOpenDialog` 不同                                                                                                           |

**v1 签名：**

```typescript
select(options?: OpenDialogOptions): Promise<FileMetadata[] | null>
selectFolder(options?: OpenDialogOptions): Promise<string | null>
open(options?: OpenDialogOptions): Promise<{ content: string; metadata: FileMetadata } | null>
save(path: string, content: string | NodeJS.ArrayBufferView, options?: any): Promise<string>
```

**v2 签名：**

```typescript
// 选文件（单选）
select(options: { directory?: never; multiple?: false; filters?: FileFilter[]; title?: string }): Promise<string | null>
// 选文件（多选）
select(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
// 选文件夹（只能单选）
select(options: { directory: true; title?: string }): Promise<string | null>
// 保存对话框
save(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>
```

> **v1 兼容性审查**：排查了所有 `select`/`selectFolder`/`save` 调用方，实际使用的 options 为
> `filters`、`properties`（映射为 `multiple`/`directory`）、`title`。v2 签名已全部覆盖。

### B. 文件入库（写入 storage + 生成元数据）

| v1 方法               | 功能                                   | v2 方案                 | 说明                                |
| --------------------- | -------------------------------------- | ----------------------- | ----------------------------------- |
| `upload`              | 复制文件到 storage，MD5 去重，图片压缩 | 🔀 `createEntry`        | `content: FilePath`                 |
| `saveBase64Image`     | base64 解码 → 写入 storage             | 🔀 `createEntry`        | `content: Base64String`             |
| `savePastedImage`     | Uint8Array → 写入 storage，图片压缩    | 🔀 `createEntry`        | `content: Uint8Array`               |
| `download`            | 从 URL 下载 → 写入 storage             | 🔀 `createEntry`        | `content: URLString`，main 负责下载 |
| `batchUploadMarkdown` | 批量复制 .md 到目标目录                | 🔀 `batchCreateEntries` | 泛化为批量创建，不限 markdown       |

**v1 签名：**

```typescript
upload(file: FileMetadata): Promise<FileMetadata>
saveBase64Image(data: string): Promise<FileMetadata>
savePastedImage(imageData: Uint8Array, extension?: string): Promise<FileMetadata>
download(url: string, isUseContentType?: boolean): Promise<FileMetadata>
batchUploadMarkdown(filePaths: string[], targetPath: string): Promise<{ fileCount: number; folderCount: number; skippedFiles: string[] }>
```

**v2 签名：**

```typescript
type FilePath = `/${string}` | `${string}:${string}` | `file://${string}`
type Base64String = `data:${string};base64,${string}`
type URLString = `http://${string}` | `https://${string}`
type FileContent = FilePath | Base64String | URLString | Uint8Array

type CreateEntryParams =
  | { type: 'file'; parentId: FileEntryId; name: string; content: FileContent }
  | { type: 'dir'; parentId: FileEntryId; name: string }

createEntry(params: CreateEntryParams): Promise<FileEntry>
// 批量创建文件条目（仅文件，不支持目录）
batchCreateEntries(params: { parentId: FileEntryId; items: Array<{ name: string; content: FileContent }> }): Promise<BatchOperationResult>
```

> **v1 兼容性审查**：`upload` 实际调用方全部传的是路径（`select` 返回或 `getPathForFile`）。
> `saveBase64Image` 用于 AI 生图（base64）。`savePastedImage` 用于富文本编辑器粘贴（Uint8Array）。
> `download` 用于 AI 生图（URL）。`savePastedImage` 用于富文本编辑器粘贴（Uint8Array），
> v2 用 `createEntry({ parentId: 'mount_temp', content: uint8Array })` 替代，临时文件纳入条目系统。
> `batchUploadMarkdown` 唯一调用方为 `NotesService.ts`，
> 传入本地路径数组 + 目标目录，返回值中 `NotesPage` 只用 `fileCount === 0` 判断是否成功，
> 可用 `BatchOperationResult.succeeded.length === 0` 替代。`folderCount`（自动创建的目录数）
> 和 `skippedFiles`（跳过的非 markdown 文件数）在 `NotesPage` 中完全没有使用。
> `skippedFiles` 的过滤逻辑由 renderer 在调用 `batchCreateEntries` 前完成。
> 全部场景被 `FileContent` 联合类型覆盖。

### C. 文件读取（从 storage 或外部路径）

| v1 方法        | 功能                                       | v2 方案          | 说明                                         |
| -------------- | ------------------------------------------ | ---------------- | -------------------------------------------- |
| `read`         | 按 fileId 读内容（支持 doc/pdf/xlsx 提取） | 🔀 `read`        | 统一入口，`FileEntryId \| FilePath` 自动区分 |
| `readExternal` | 按外部路径读内容                           | 🔀 `read`        | 合并到 `read`，传 `FilePath`                 |
| `get`          | 按路径获取 FileMetadata                    | 🔀 `getMetadata` | v2 用 `getMetadata` 替代                     |
| `base64Image`  | 按 fileId 读图片为 base64                  | 🔀 `read`        | `encoding: 'base64'` 重载                    |
| `binaryImage`  | 按 fileId 读图片为 Buffer                  | 🔀 `read`        | `encoding: 'binary'` 重载                    |
| `base64File`   | 按 fileId 读文件为 base64                  | 🔀 `read`        | `encoding: 'base64'` 重载                    |
| `pdfInfo`      | 按 fileId 读 PDF 页数                      | 🔀 `getMetadata` | `PdfMetadata.pageCount`                      |

**v1 签名：**

```typescript
read(fileId: string, detectEncoding?: boolean): Promise<string>
readExternal(filePath: string, detectEncoding?: boolean): Promise<string>
get(filePath: string): Promise<FileMetadata | null>
base64Image(fileId: string): Promise<{ mime: string; base64: string; data: string }>
binaryImage(fileId: string): Promise<{ data: Buffer; mime: string }>
base64File(fileId: string): Promise<{ data: string; mime: string }>
pdfInfo(fileId: string): Promise<number>
```

**v2 签名：**

```typescript
// ─── read: 统一文件内容读取 ───

// 图片变换参数（可选，非图片文件传入时静默忽略）
// 调用方有责任确认目标文件类型，service 层不做额外校验
// 动机：#14062 — 发送图片到 LLM API 前自动压缩，避免超大 base64 payload
// 具体字段待调研 sharp API 后确定
type ImageTransform = {
  maxDimension?: number
  quality?: number
  format?: string
}

// text（默认）
read(target: FileEntryId | FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
// base64（支持图片压缩）
read(target: FileEntryId | FilePath, options: { encoding: 'base64'; imageTransform?: ImageTransform }): Promise<{ data: string; mime: string }>
// binary（支持图片压缩）
read(target: FileEntryId | FilePath, options: { encoding: 'binary'; imageTransform?: ImageTransform }): Promise<{ data: Uint8Array; mime: string }>

// ─── getMetadata: 文件元信息（按类型返回不同字段） ───
type MetadataBase = { size: number; createdAt: number; modifiedAt: number }

// 第一层：kind = 'file' | 'directory'
type DirectoryMetadata = MetadataBase & { kind: 'directory' }
type FileMetadataCommon = MetadataBase & { kind: 'file'; mime: string }

// 第二层（仅 file）：type = 'image' | 'pdf' | 'text' | 'other'
type ImageFileMetadata = FileMetadataCommon & { type: 'image'; width: number; height: number }
type PdfFileMetadata = FileMetadataCommon & { type: 'pdf'; pageCount: number }
type TextFileMetadata = FileMetadataCommon & { type: 'text'; encoding: string }
type GenericFileMetadata = FileMetadataCommon & { type: 'other' }

type FileKindMetadata = ImageFileMetadata | PdfFileMetadata | TextFileMetadata | GenericFileMetadata
type FileMetadata = DirectoryMetadata | FileKindMetadata

getMetadata(target: FileEntryId | FilePath): Promise<FileMetadata>
```

> **v1 兼容性审查**：
>
> - `read`：传 `file.id + file.ext` 拼接字符串（如 `"abc123.pdf"`）或配置文件名（`'custom-minapps.json'`）。
>   v2 用 `FileEntryId` 不需要拼 ext；配置文件名场景走 `FilePath`。
> - `readExternal`：全部传绝对路径（笔记文件、外部文件），v2 `FilePath` 覆盖。
> - `get`：返回 `FileMetadata` 用于 UI 预览（PasteService、拖拽、TranslatePage）。v2 `getMetadata` 返回结构不同但信息更全面，调用方需适配。
> - `base64Image` / `binaryImage` / `base64File`：全部传 `file.id + file.ext`，v2 改传 `FileEntryId`。
>   新增 `imageTransform` 可选参数（#14062），AI 调用层可统一传参压缩大图，
>   `sharp` 已是项目依赖，service 层直接调用。非图片文件传入 `imageTransform` 时静默忽略。
> - `pdfInfo`：renderer 中**零调用**，可安全移除。`getMetadata` 的 `PdfMetadata.pageCount` 作为备用保留。

### D. 文件删除

| v1 方法              | 功能                      | v2 方案                        | 说明                                            |
| -------------------- | ------------------------- | ------------------------------ | ----------------------------------------------- |
| `delete`             | 按 fileId 删 storage 文件 | 🔀 `trash` / `permanentDelete` | 通过 FileEntryId 操作，不区分 file/dir          |
| `deleteDir`          | 按 ID 删 storage 目录     | 🔀 `trash` / `permanentDelete` | renderer 零调用，合并                           |
| `deleteExternalFile` | 删外部路径文件            | 🔀 `permanentDelete`           | 笔记纳入条目系统后由 service 按 mount type 处理 |
| `deleteExternalDir`  | 删外部路径目录            | 🔀 `permanentDelete`           | 同上                                            |
| `clear`              | 清空整个 storage 目录     | ❌                             | renderer 零调用，移除                           |

**v1 签名：**

```typescript
delete(fileId: string): Promise<void>
deleteDir(dirPath: string): Promise<void>
deleteExternalFile(filePath: string): Promise<void>
deleteExternalDir(dirPath: string): Promise<void>
clear(spanContext?: SpanContext): Promise<void>
```

**v2 签名：**

```typescript
trash(params: { id: FileEntryId }): Promise<void>
restore(params: { id: FileEntryId }): Promise<FileEntry>
permanentDelete(params: { id: FileEntryId }): Promise<void>
batchTrash(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
batchRestore(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
```

> **v1 兼容性审查**：
>
> - `delete`：`useKnowledge.ts` 和 `FileManager.ts` 使用，传 `file.name` 或 `id + ext`。v2 改传 `FileEntryId`。
> - `deleteDir`：renderer 零调用。
> - `deleteExternalFile`/`deleteExternalDir`：仅 `NotesService.ts` 使用，传 `entry.externalPath`。v2 笔记纳入条目系统后统一走 `permanentDelete(entryId)`。
> - `clear`：renderer 零调用，仅在 preload/ipc.ts 注册。安全移除。

### E. 文件移动 / 重命名

| v1 方法     | 功能                       | v2 方案   | 说明                                |
| ----------- | -------------------------- | --------- | ----------------------------------- |
| `move`      | 按路径移动文件             | 🔀 `move` | 统一用 FileEntryId，不区分 file/dir |
| `moveDir`   | 按路径移动目录             | 🔀 `move` | 合并                                |
| `rename`    | 按路径重命名文件（加 .md） | 🔀 `move` | rename = 同目录 move + newName      |
| `renameDir` | 按路径重命名目录           | 🔀 `move` | 合并                                |

**v1 签名：**

```typescript
move(path: string, newPath: string): Promise<void>
moveDir(dirPath: string, newDirPath: string): Promise<void>
rename(path: string, newName: string): Promise<void>
renameDir(dirPath: string, newName: string): Promise<void>
```

**v2 签名：**

```typescript
// move + rename 合并：newName 可选，省略则保持原名
move(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
batchMove(params: { ids: FileEntryId[]; targetParentId: FileEntryId }): Promise<BatchOperationResult>
```

> **v1 兼容性审查**：
>
> - `move`/`moveDir`：仅 `NotesPage.tsx` 使用，按 `entry.type` 分别调用，传 `externalPath`。v2 统一 `move(entryId, targetParentId)`。
> - `rename`/`renameDir`：仅 `NotesService.ts` 使用，按 `isFile` 分别调用，传 `externalPath` + `safeName`。v2 统一 `move(entryId, 原parentId, newName)`。

### F. 底层 FS 操作

| v1 方法          | 功能                           | v2 方案          | 说明                                                   |
| ---------------- | ------------------------------ | ---------------- | ------------------------------------------------------ |
| `write`          | 按外部路径写入 bytes/string    | ✅ `write`       | 笔记保存、导出等场景仍需直接写外部路径，不经过条目系统 |
| `writeWithId`    | 按 fileId 写入 storage         | 🔀 `write`       | 合并到 `write`，传 FileEntryId 或 FilePath             |
| `mkdir`          | 创建目录                       | 🔀 `createEntry` | v2 创建目录走 `createEntry({ type: 'dir' })`           |
| `copy`           | 从 storage 复制到外部路径      | ✅ `copy`        | 当前零调用，但文件管理器基本操作，提前设计             |
| `createTempFile` | 生成临时文件路径（不创建文件） | ❌               | 粘贴场景被 `createEntry({ content: Uint8Array })` 替代 |

**v1 签名：**

```typescript
write(filePath: string, data: Uint8Array | string): Promise<void>
writeWithId(id: string, content: string): Promise<void>
mkdir(dirPath: string): Promise<string>
copy(fileId: string, destPath: string): Promise<void>
createTempFile(fileName: string): Promise<string>
```

**v2 签名：**

```typescript
// 写内容到指定目标（条目或外部路径），不创建新条目
write(target: FileEntryId | FilePath, data: string | Uint8Array): Promise<void>
// 树内复制（创建新条目 + 物理复制）
copy(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
// 导出到外部路径（不创建新条目）
copy(params: { id: FileEntryId; destPath: FilePath }): Promise<void>
```

> **v1 兼容性审查**：
>
> - `write`：PasteService（落盘粘贴数据，v2 被 `createEntry` 替代）、NotesService/NotesPage（写笔记内容）、export.ts（导出 markdown）、exportExcel.ts（写 Excel）、HtmlArtifactsCard（临时 HTML）。笔记和导出场景仍需 `write`。
> - `writeWithId`：仅 minapps 配置文件读写（`custom-minapps.json`）。v2 用 `write(FileEntryId | FilePath, ...)`。
> - `mkdir`：仅 NotesService 创建笔记子目录。v2 走 `createEntry({ type: 'dir' })`。
> - `copy`：renderer 零调用，安全移除。
> - `createTempFile`：粘贴场景被 `createEntry({ parentId: 'mount_temp', content })` 替代。
>   临时文件纳入条目系统，粘贴时创建临时 FileRef（`sourceType: 'temp_session'`），
>   `mount_temp` 兼作临时文件和缓存。ref 由调用方显式管理（发送时删临时 ref + 创建正式 ref + move，
>   取消时删 ref）。清理器只自动删除无 ref 的条目（启动时 + 定期），绝不删 ref。
>   用户通过删 ref 主动释放不需要的缓存。
>   HTML 预览可用 `write` 写 temp 路径。（？）

### G. 文件检测 / 校验

| v1 方法                  | 功能                                     | v2 方案                | 说明                                                                                  |
| ------------------------ | ---------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `isTextFile`             | 检测是否文本文件                         | 🔀 `getMetadata`       | `metadata.type === 'text'` 判断，不单独保留                                           |
| `isDirectory`            | 检测是否目录                             | 🔀 `getMetadata`       | 条目用 `entry.type`，外部路径用 `getMetadata` 判断                                    |
| `checkFileName`          | 文件名消毒（sanitize）+ 目标路径冲突检测 | ❌ (拆分)              | sanitize 提取为 shared 纯函数（不需要 IPC），冲突检测由 `createEntry`/`move` 内部处理 |
| `validateNotesDirectory` | 校验笔记目录合法性                       | ✅ `validateNotesPath` | notes 专用，暂不泛化。app 内部只允许 `Data/files/notes/`                              |

**v1 签名：**

```typescript
isTextFile(filePath: string): Promise<boolean>
isDirectory(filePath: string): Promise<boolean>
checkFileName(dirPath: string, fileName: string, isFile: boolean): Promise<{ safeName: string; exists: boolean }>
validateNotesDirectory(dirPath: string): Promise<boolean>
```

**v2 签名：**

```typescript
// 已在 C 组定义
getMetadata(target: FileEntryId | FilePath): Promise<FileMetadata>
// 验证路径是否适合作为 notes 目录
// notes 专用：app 内部只允许 Data/files/notes/，禁止指向其他 mount 目录
validateNotesPath(dirPath: FilePath): Promise<boolean>
```

> **v1 兼容性审查**：
>
> - `isTextFile`：`utils/file.ts` 和 `AttachmentPreview.tsx` 使用。v2 用 `getMetadata(path).type === 'text'` 替代。
> - `isDirectory`：仅 `SkillsSettings.tsx` 拖拽安装判断。v2 用 `getMetadata(path)` 判断。
> - `checkFileName`：仅 `NotesService.ts`/`NotesPage.tsx` 使用（4 处），用于创建/重命名前校验。v2 由 `createEntry`/`move` 的 service 内部校验，冲突时抛错误，renderer 捕获并提示用户。
> - `validateNotesDirectory`：`NotesService.ts`/`NotesSettings.tsx` 使用。v2 改为 `validateNotesPath`，
>   主要改动：将硬编码受限路径（`filesDir`/`appDataPath`）替换为"app 内部只允许 `Data/files/notes/`"，
>   新增禁止指向其他 mount basePath（`managed/`、`temp/` 等）。其余检查（存在、可写、非系统根、非当前路径）不变。
>   | `validateNotesDirectory` | 校验笔记目录合法性 | ❓ | |

### H. 系统操作

| v1 方法                    | 功能                                        | v2 方案           | 说明                                                              |
| -------------------------- | ------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `openPath`                 | 用系统默认程序打开文件/目录                 | ✅ `open`         | 接收 `FileEntryId \| FilePath`，service resolve 物理路径          |
| `openFileWithRelativePath` | 用相对路径打开 storage 文件                 | 🔀 `open`         | 合并，v2 传 FileEntryId                                           |
| `showInFolder`             | 在文件管理器中显示                          | ✅ `showInFolder` | 接收 `FileEntryId \| FilePath`                                    |
| `getPathForFile`           | `webUtils.getPathForFile`（preload 直接调） | ✅ 移出           | 非 IPC，通过 contextBridge 暴露的同步工具方法，不属于 FileManager |

**v1 签名：**

```typescript
openPath(path: string): Promise<void>
openFileWithRelativePath(file: FileMetadata): Promise<void>
showInFolder(path: string): Promise<void>
getPathForFile(file: File): string
```

**v2 签名：**

```typescript
// 用系统默认程序打开文件/目录
open(target: FileEntryId | FilePath): Promise<void>
// 在系统文件管理器中显示
showInFolder(target: FileEntryId | FilePath): Promise<void>
// 移至 preload utils，不属于 FileManager IPC
// getPathForFile(file: File): string
```

> **v1 兼容性审查**：
>
> - `openPath`：多处使用（知识库目录、文件列表、引用链接、agent 工具路径），传外部路径。v2 `open` 支持 `FilePath` 覆盖。
> - `openFileWithRelativePath`：仅知识库文件/视频使用，传 `FileMetadata`（内部拼 storage 路径）。v2 传 `FileEntryId`，service resolve 物理路径。
> - `showInFolder`：仅 `ClickableFilePath.tsx` 使用，传路径。v2 支持 `FileEntryId | FilePath`。
> - `getPathForFile`：多处使用（PasteService、拖拽、知识库文件），preload 直接调 `webUtils`，不变。

### I. 目录扫描

| v1 方法                 | 功能                 | v2 方案            | 说明                                                     |
| ----------------------- | -------------------- | ------------------ | -------------------------------------------------------- |
| `getDirectoryStructure` | 递归扫描目录树       | ❌                 | v2 笔记纳入条目系统，用 DataApi children 查询替代        |
| `listDirectory`         | ripgrep 搜索目录内容 | ✅ `listDirectory` | agent 工具面板列出外部目录文件，非条目系统管理，仍需保留 |

**v1 签名：**

```typescript
getDirectoryStructure(dirPath: string): Promise<NotesTreeNode[]>
listDirectory(dirPath: string, options?: DirectoryListOptions): Promise<string[]>
```

**v2 签名：**

```typescript
// 列出外部目录内容（非条目系统管理的目录）
listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>  // DirectoryListOptions 维持原样
```

> **v1 兼容性审查**：
>
> - `getDirectoryStructure`：仅 Notes 使用（加载树、检查目录内容）。v2 笔记纳入条目系统后，用 `GET /files/entries/:id/children` 替代。
> - `listDirectory`：仅 `useResourcePanel.tsx` 使用，列出 agent 可访问目录的文件。传外部路径 + options。v2 保留，签名基本不变。

### J. File Watcher

| v1 方法             | 功能                   | v2 方案 | 说明                                                                 |
| ------------------- | ---------------------- | ------- | -------------------------------------------------------------------- |
| `startFileWatcher`  | 启动 chokidar 监听     | ❌      | v2 由 FileManager service 内部管理 `local_external` mount 的 watcher |
| `stopFileWatcher`   | 停止监听               | ❌      | 同上，service 跟随 mount 生命周期自动管理                            |
| `pauseFileWatcher`  | 暂停监听（批量操作时） | ❌      | 同上，service 在批量操作时内部暂停                                   |
| `resumeFileWatcher` | 恢复监听               | ❌      | 同上                                                                 |
| `onFileChange`      | renderer 监听变更事件  | ❌      | v2 renderer 通过 DataApi 数据订阅感知变更，不直接监听 FS 事件        |

**v1 签名：**

```typescript
startFileWatcher(dirPath: string, config?: any): Promise<void>
stopFileWatcher(): Promise<void>
pauseFileWatcher(): Promise<void>
resumeFileWatcher(): Promise<void>
onFileChange(callback: (data: FileChangeEvent) => void): () => void
```

**v2 签名：**

无。Watcher 由 FileManager service 内部管理，不暴露 IPC。

> **v1 兼容性审查**：
>
> - 全部仅 Notes 使用（`NotesPage.tsx`、`NotesService.ts`）。
> - v2 笔记纳入条目系统后，`local_external` mount 的 watcher 由 FileManager service 内部管理：
>   FS 变更 → service 自动同步到 DB → renderer 通过 DataApi 数据订阅感知。
> - 批量操作时的 pause/resume 也由 service 内部协调，renderer 无需关心。

## v2 FileManager IPC 完整方法列表

v1 44 个方法 → v2 19 个方法（含 1 个 preload 工具方法）。

### 类型定义

```typescript
type FilePath = `/${string}` | `${string}:${string}` | `file://${string}`;
type Base64String = `data:${string};base64,${string}`;
type URLString = `http://${string}` | `https://${string}`;
type FileContent = FilePath | Base64String | URLString | Uint8Array;

type CreateEntryParams =
  | { type: "file"; parentId: FileEntryId; name: string; content: FileContent }
  | { type: "dir"; parentId: FileEntryId; name: string };

type MetadataBase = { size: number; createdAt: number; modifiedAt: number };
type DirectoryMetadata = MetadataBase & { kind: "directory" };
type FileMetadataCommon = MetadataBase & { kind: "file"; mime: string };
type ImageFileMetadata = FileMetadataCommon & {
  type: "image";
  width: number;
  height: number;
};
type PdfFileMetadata = FileMetadataCommon & { type: "pdf"; pageCount: number };
type TextFileMetadata = FileMetadataCommon & { type: "text"; encoding: string };
type GenericFileMetadata = FileMetadataCommon & { type: "other" };
type FileKindMetadata =
  | ImageFileMetadata
  | PdfFileMetadata
  | TextFileMetadata
  | GenericFileMetadata;
type FileMetadata = DirectoryMetadata | FileKindMetadata;

type BatchOperationResult = {
  succeeded: FileEntryId[];
  failed: Array<{ id: FileEntryId; error: string }>;
};

// 图片读取时可选变换（#14062），非图片文件传入时静默忽略，具体字段待调研 sharp API
type ImageTransform = {
  maxDimension?: number;
  quality?: number;
  format?: string;
};
```

### 方法签名

```typescript
// ─── A. 文件选择 / 对话框 ───
select(options: { directory?: never; multiple?: false; filters?: FileFilter[]; title?: string }): Promise<string | null>
select(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
select(options: { directory: true; title?: string }): Promise<string | null>
save(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>

// ─── B. 条目创建 ───
createEntry(params: CreateEntryParams): Promise<FileEntry>
batchCreateEntries(params: { parentId: FileEntryId; items: Array<{ name: string; content: FileContent }> }): Promise<BatchOperationResult>

// ─── C. 文件读取 / 元信息 ───
read(target: FileEntryId | FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
read(target: FileEntryId | FilePath, options: { encoding: 'base64'; imageTransform?: ImageTransform }): Promise<{ data: string; mime: string }>
read(target: FileEntryId | FilePath, options: { encoding: 'binary'; imageTransform?: ImageTransform }): Promise<{ data: Uint8Array; mime: string }>
getMetadata(target: FileEntryId | FilePath): Promise<FileMetadata>

// ─── D. 条目删除 ───
trash(params: { id: FileEntryId }): Promise<void>
restore(params: { id: FileEntryId }): Promise<FileEntry>
permanentDelete(params: { id: FileEntryId }): Promise<void>
batchTrash(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
batchRestore(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>

// ─── E. 条目移动（含重命名） ───
move(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
batchMove(params: { ids: FileEntryId[]; targetParentId: FileEntryId }): Promise<BatchOperationResult>

// ─── F. 文件写入 / 复制 ───
write(target: FileEntryId | FilePath, data: string | Uint8Array): Promise<void>
copy(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
copy(params: { id: FileEntryId; destPath: FilePath }): Promise<void>

// ─── G. 校验 / 路径工具 ───
validateNotesPath(dirPath: FilePath): Promise<boolean>
canWrite(dirPath: FilePath): Promise<boolean>
resolvePath(filePath: string): Promise<string>
isPathInside(childPath: string, parentPath: string): Promise<boolean>
isNotEmptyDir(dirPath: FilePath): Promise<boolean>

// ─── H. 系统操作 ───
open(target: FileEntryId | FilePath): Promise<void>
showInFolder(target: FileEntryId | FilePath): Promise<void>

// ─── I. 目录扫描 ───
listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>  // 维持原样
```

> **不在 FileManager IPC 中的方法**：
>
> - `getPathForFile(file: File): string` — preload 通过 contextBridge 暴露的同步工具方法，不属于 FileManager
> - File Watcher（start/stop/pause/resume/onFileChange）— v2 由 FileManager service 内部管理，不暴露 IPC
> - `getDirectoryStructure` — v2 用 DataApi `GET /files/entries/:id/children` 替代
> - `checkFileName` — sanitize 提取为 shared 纯函数，冲突检测由 service 内部处理

### 非 File\_ 前缀的文件相关 IPC

v1 还有一些散落在其他命名空间下的文件相关 IPC，需要统一分析归属。

#### 已合并到 File Module IPC

| v1 IPC                   | v1 实现                                    | v2 方案                                   | 说明                                    |
| ------------------------ | ------------------------------------------ | ----------------------------------------- | --------------------------------------- |
| `Fs_Read`                | `FileService.readFile`                     | 🔀 `read(FilePath)`                       | → ops.read（双态方法的 FilePath 路径）  |
| `Fs_ReadText`            | `FileService.readTextFileWithAutoEncoding` | 🔀 `read(FilePath, { encoding: 'text' })` | 同上                                    |
| `Open_Path`              | `shell.openPath(path)`                     | 🔀 `open(FilePath)`                       | 与 `File_OpenPath` 完全重复，→ ops.open |
| `App_HasWritePermission` | `hasWritePermission(filePath)`             | 🔀 `canWrite(FilePath)`                   | → ops.canWrite                          |
| `App_ResolvePath`        | `path.resolve(untildify(filePath))`        | 🔀 `resolvePath(FilePath)`                | → ops.resolvePath                       |
| `App_IsPathInside`       | `isPathInside(childPath, parentPath)`      | 🔀 `isPathInside(child, parent)`          | → ops.isPathInside                      |
| `App_IsNotEmptyDir`      | `fs.readdirSync(path).length > 0`          | 🔀 `isNotEmptyDir(FilePath)`              | → ops.isNotEmptyDir                     |

> **v1 兼容性审查**：
>
> - `Fs_Read`：aiCore 和 renderer 中用于读取外部文件（URL 或本地路径），v2 `read(FilePath)` 覆盖。
> - `Fs_ReadText`：renderer 中用于读取文本文件并自动检测编码，v2 `read(FilePath, { encoding: 'text', detectEncoding: true })` 覆盖。
> - `Open_Path`：多处使用（知识库、导出结果等），与 `File_OpenPath` 实现完全相同（均调用 `shell.openPath`），v2 统一为 `open(FilePath)`。
> - `App_HasWritePermission`：数据迁移选择目录时校验权限。通用能力，`validateNotesPath` 内部也需要。
> - `App_ResolvePath` / `App_IsPathInside`：纯路径计算，无 FS I/O。renderer 无 `node:path`，仍需 IPC。
> - `App_IsNotEmptyDir`：数据迁移校验目录。通用能力，归入 ops。

#### 保持独立（不属于 File Module）

| v1 IPC            | v1 实现                                                     | v2 方案         | 说明                                                 |
| ----------------- | ----------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| `Pdf_ExtractText` | `extractPdfText(data: Uint8Array \| ArrayBuffer \| string)` | ✅ 保持独立     | 纯内容处理（传 buffer），不依赖文件系统或 entry 系统 |
| `App_Copy`        | `fs.promises.cp` 递归复制                                   | ✅ 数据迁移模块 | userData 递归复制 + occupiedDirs 排除，专用场景      |

#### 不属于 FileManager（各自业务模块）

| v1 IPC                                                           | 说明                                         | v2 归属       |
| ---------------------------------------------------------------- | -------------------------------------------- | ------------- |
| `Open_Website`                                                   | `shell.openExternal(url)` — URL 不是文件操作 | App 层        |
| `FileService_Upload/List/Delete/Retrieve`                        | AI Provider 远程文件 API（Gemini 等）        | Provider 模块 |
| `Gemini_UploadFile/Base64File/RetrieveFile/ListFiles/DeleteFile` | Gemini 专用文件操作                          | Provider 模块 |
| `Export_Word`                                                    | Word 导出                                    | Export 模块   |
| `Zip_Compress/Decompress`                                        | 压缩解压                                     | Backup 模块   |
| `Webview_PrintToPDF/SaveAsHTML`                                  | Webview 输出                                 | Webview 模块  |
| `Skill_ReadFile/ListFiles`                                       | Skill 文件读取                               | Skill 模块    |
