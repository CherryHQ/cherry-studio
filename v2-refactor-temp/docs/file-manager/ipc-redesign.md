# File Module IPC Redesign

> **v1→v2 方法映射参考**（2026-05-26 同步）
>
> 本文档记录 v1 File IPC 方法如何被 v2 替代，不包含纯新增的 v2 方法。
>
> 自初版以来的关键设计变更：
>
> - `createEntry({origin})` → 拆分为 `createInternalEntry` + `ensureExternalEntry`
> - External entry 不再进入 trash 生命周期（`fe_external_no_delete` CHECK）
> - `permanentDelete` 对 external 只删 DB 行，不触碰物理文件
> - v1 `FileEntryId | FilePath` 参数统一为 `FileHandle` tagged union
> - `select`/`save` → `openSelectDialog`/`openSaveDialog`
> - `move`/`rename` 合并为 `rename(handle, newTarget)`
> - `read` 返回 `ReadResult<T>`（content + mime + version）
> - `write` 返回 `FileVersion`
> - `BatchOperationResult` 拆为 `BatchMutationResult` + `BatchCreateResult`
>
> **实现准绳**：
>
> - [`ipc-wiring-spec.md`](./ipc-wiring-spec.md) — IPC wiring 实现指南
> - [`ipc.ts`](../../../packages/shared/file/types/ipc.ts) — `FileIpcApi` 类型合约
> - [`docs/references/file/architecture.md`](../../../docs/references/file/architecture.md)
> - [`rfc-file-manager.md`](./rfc-file-manager.md)

---

v1 有 52 个文件相关 IPC（44 File + 2 Fs + 1 Open_Path + 5 App 路径工具），v2 由 FileManager 统一管理。

## 架构

### 设计动机

Renderer 需要统一的文件操作入口（一个 `read` 既能读 entry 也能读外部路径），但 main process 内部 entry 管理（DB + FS 协调）和纯路径操作（直接 FS）是两种完全不同的职责。既要统一调用又要关注点分离，直接实现是矛盾的。

解法：**统一调用入口 + handler 层分派**。FileManager 作为唯一 lifecycle service 统管所有 IPC handler 注册，handler 内部按 `FileHandle` 类型分派到不同实现：

- `{ kind: 'entry', entryId }` → FileManager 自身方法（entry 协调: resolve → DB + FS）
- `{ kind: 'path', path }` → 内部模块纯函数（直接 FS/路径操作）

**Tradeoff**：纯路径操作（`canWrite`、`toAbsolutePath` 等）也交由 entry + FS 协调层管理，FileManager 承担了超出 entry 管理的 IPC 注册职责。但 handler 层只是 thin routing，其 public 方法签名仍然只认 FileEntryId，纯 path 操作不污染 public API。相比引入第二个 lifecycle service，这个代价更小。

```
Renderer
  → FileManager.registerIpcHandlers() (统一入口, handler 层分派)
    ├── handle: { kind: 'entry' } → this.read / this.write / ... (entry 方法)
    └── handle: { kind: 'path' }  → readByPath / writeByPath / ... (直接委托)
```

**Main process 内部**：其他 service 可根据实际需求直接调用内部模块或 FileManager，不需要经过 IPC。

## 设计原则

- **迁移保持语义不变**：v1 → v2 迁移过程中保持已有行为不变，不改变调用方语义。例如 v1 的 `deleteFile` 是永久删除，v2 仍映射到 `permanentDelete`，不主动改为 `trash`。行为改进（如引入 trash）由后续需求驱动，不在迁移中混入
- **统一入口，handler 分派**：Renderer 只有一个 File IPC 入口，handler 按 `FileHandle` 的 `kind` 分派到 FileManager 或内部模块
- **不按 file/dir 拆分方法**：v1 的 `move` / `moveDir` 等冗余合并
- **Renderer 只传必要信息**：service 层推导元数据，不要求 renderer 预先获取
- **FileManager public API 只认 FileEntryId**：纯路径操作在 handler 层直接委托内部模块，不经过 FileManager 方法

## v1 清单与 v2 方案

状态标记：

- ✅ 保留（可能改签名）
- 🔀 合并到其他方法
- ❌ 移除
- ❓ 待定

### A. 文件选择 / 对话框

| v1 方法        | 功能                                    | v2 方案                | 说明                                                                                                                                                              |
| -------------- | --------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select`       | 打开文件选择对话框，返回 FileMetadata[] | 🔀 `openSelectDialog`  | 与 `selectFolder` 合并，通过 `directory` 参数区分。返回路径而非 FileMetadata（入库是 `createInternalEntry` 的事）。单选返回 `string \| null`，多选返回 `string[]` |
| `selectFolder` | 打开文件夹选择对话框，返回路径          | 🔀 `openSelectDialog`  | 合并到 `openSelectDialog({ directory: true })`                                                                                                                    |
| `open`         | 打开文件对话框 + 读取内容（<2GB）       | ❌                     | 拆为 `openSelectDialog` + `read` 组合，renderer 自行组装                                                                                                          |
| `save`         | 打开保存对话框 + 写入内容               | ✅ `openSaveDialog`    | 保留，`showSaveDialog` 与 `showOpenDialog` 不同                                                                                                                   |

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
openSelectDialog(options: { directory?: never; multiple?: false; filters?: FileFilter[]; title?: string }): Promise<string | null>
// 选文件（多选）
openSelectDialog(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
// 选文件夹（只能单选）
openSelectDialog(options: { directory: true; title?: string }): Promise<string | null>
// 保存对话框
openSaveDialog(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>
```

> **v1 兼容性审查**：排查了所有 `select`/`selectFolder`/`save` 调用方，实际使用的 options 为
> `filters`、`properties`（映射为 `multiple`/`directory`）、`title`。v2 签名已全部覆盖。

### B. 文件入库（写入 storage + 生成元数据）

| v1 方法               | 功能                                   | v2 方案                         | 说明                            |
| --------------------- | -------------------------------------- | ------------------------------- | ------------------------------- |
| `upload`              | 复制文件到 storage，MD5 去重，图片压缩 | 🔀 `createInternalEntry`         | `source: 'path'`               |
| `saveBase64Image`     | base64 解码 → 写入 storage             | 🔀 `createInternalEntry`         | `source: 'base64'`             |
| `savePastedImage`     | Uint8Array → 写入 storage，图片压缩    | 🔀 `createInternalEntry`         | `source: 'bytes'`              |
| `download`            | 从 URL 下载 → 写入 storage             | 🔀 `createInternalEntry`         | `source: 'url'`，main 负责下载 |
| `batchUploadMarkdown` | 批量复制 .md 到目标目录                | 🔀 `batchCreateInternalEntries` | 泛化为批量创建，不限 markdown  |

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
// 创建 Cherry 内部条目（always inserts, no conflict resolution）
type CreateInternalEntryIpcParams =
  | { source: 'path'; path: FilePath }
  | { source: 'url'; url: URLString }
  | { source: 'base64'; data: Base64String; name?: string }
  | { source: 'bytes'; data: Uint8Array; name: string; ext: string | null }

createInternalEntry(params: CreateInternalEntryIpcParams): Promise<FileEntry>
batchCreateInternalEntries(items: CreateInternalEntryIpcParams[]): Promise<BatchCreateResult>

// 确保外部条目存在（pure upsert on externalPath）
type EnsureExternalEntryIpcParams = { externalPath: FilePath }

ensureExternalEntry(params: EnsureExternalEntryIpcParams): Promise<FileEntry>
batchEnsureExternalEntries(items: EnsureExternalEntryIpcParams[]): Promise<BatchCreateResult>
```

> **v1 兼容性审查**：`upload` 实际调用方全部传的是路径（`select` 返回或 `getPathForFile`），
> 对应 `source: 'path'`。
> `saveBase64Image` 用于 AI 生图（base64），对应 `source: 'base64'`。
> `savePastedImage` 用于富文本编辑器粘贴（Uint8Array），对应 `source: 'bytes'`。
> `download` 用于 AI 生图（URL），对应 `source: 'url'`。
> `batchUploadMarkdown` 唯一调用方为 `NotesService.ts`，
> 传入本地路径数组 + 目标目录，返回值中 `NotesPage` 只用 `fileCount === 0` 判断是否成功，
> 可用 `BatchCreateResult.succeeded.length === 0` 替代。`folderCount`（自动创建的目录数）
> 和 `skippedFiles`（跳过的非 markdown 文件数）在 `NotesPage` 中完全没有使用。
> `skippedFiles` 的过滤逻辑由 renderer 在调用 `batchCreateInternalEntries` 前完成。
> 全部场景被 `CreateInternalEntryIpcParams` 的 discriminated union 覆盖。

### C. 文件读取（从 storage 或外部路径）

| v1 方法        | 功能                                       | v2 方案          | 说明                                               |
| -------------- | ------------------------------------------ | ---------------- | -------------------------------------------------- |
| `read`         | 按 fileId 读内容（支持 doc/pdf/xlsx 提取） | 🔀 `read`        | 统一入口，`FileHandle` 自动区分 entry 或 path      |
| `readExternal` | 按外部路径读内容                           | 🔀 `read`        | 合并到 `read`，传 path-handle                      |
| `get`          | 按路径获取 FileMetadata                    | 🔀 `getMetadata` | v2 返回 `PhysicalFileMetadata`                     |
| `base64Image`  | 按 fileId 读图片为 base64                  | 🔀 `read`        | `encoding: 'base64'` 重载                          |
| `binaryImage`  | 按 fileId 读图片为 Buffer                  | 🔀 `read`        | `encoding: 'binary'` 重载                          |
| `base64File`   | 按 fileId 读文件为 base64                  | 🔀 `read`        | `encoding: 'base64'` 重载                          |
| `pdfInfo`      | 按 fileId 读 PDF 页数                      | 🔀 `getMetadata` | `PhysicalFileMetadata` 包含 type-specific 字段     |

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
interface FileVersion { mtime: number; size: number }
interface ReadResult<T> { content: T; mime: string; version: FileVersion }

// text（默认）
read(handle: FileHandle, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
// base64
read(handle: FileHandle, options: { encoding: 'base64' }): Promise<ReadResult<string>>
// binary
read(handle: FileHandle, options: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>

// 文件物理元信息（size, mime, timestamps, type-specific fields）
getMetadata(handle: FileHandle): Promise<PhysicalFileMetadata>
```

> **v1 兼容性审查**：
>
> - `read`：传 `file.id + file.ext` 拼接字符串（如 `"abc123.pdf"`）或配置文件名（`'custom-minapps.json'`）。
>   v2 用 entry-handle 的 `FileEntryId` 不需要拼 ext；配置文件名场景走 path-handle。
> - `readExternal`：全部传绝对路径（笔记文件、外部文件），v2 用 path-handle 覆盖。
> - `get`：返回 `FileMetadata` 用于 UI 预览（PasteService、拖拽、TranslatePage）。v2 `getMetadata` 返回 `PhysicalFileMetadata`，结构不同但信息更全面，调用方需适配。
> - `base64Image` / `binaryImage` / `base64File`：全部传 `file.id + file.ext`，v2 改传 entry-handle。
> - `pdfInfo`：renderer 中**零调用**，可安全移除。`getMetadata` 的 type-specific 字段作为备用保留。

### D. 文件删除

| v1 方法              | 功能                      | v2 方案                        | 说明                                        |
| -------------------- | ------------------------- | ------------------------------ | ------------------------------------------- |
| `delete`             | 按 fileId 删 storage 文件 | 🔀 `trash` / `permanentDelete` | 通过 FileEntryId / FileHandle 操作          |
| `deleteDir`          | 按 ID 删 storage 目录     | 🔀 `trash` / `permanentDelete` | renderer 零调用，合并                       |
| `deleteExternalFile` | 删外部路径文件            | 🔀 `permanentDelete`           | 笔记纳入条目系统后由 service 按 origin 处理 |
| `deleteExternalDir`  | 删外部路径目录            | 🔀 `permanentDelete`           | 同上                                        |
| `clear`              | 清空整个 storage 目录     | ❌                             | renderer 零调用，移除                       |

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
// 单条操作
trash(params: { id: FileEntryId }): Promise<void>
restore(params: { id: FileEntryId }): Promise<FileEntry>
permanentDelete(handle: FileHandle): Promise<void>
// 批量操作
batchTrash(params: { ids: FileEntryId[] }): Promise<BatchMutationResult>
batchRestore(params: { ids: FileEntryId[] }): Promise<BatchMutationResult>
batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchMutationResult>
```

`permanentDelete` 按 handle 类型分派：

- Entry handle, internal origin: 删物理文件 + 删 DB 行
- Entry handle, external origin: **仅删 DB 行**，不触碰用户物理文件
- Path handle: 直接删除路径指向的文件

> **v1 兼容性审查**：
>
> - `delete`：`useKnowledge.ts` 和 `FileManager.ts` 使用，传 `file.name` 或 `id + ext`。v2 改传 entry-handle。
> - `deleteDir`：renderer 零调用。
> - `deleteExternalFile`/`deleteExternalDir`：仅 `NotesService.ts` 使用，传 `entry.externalPath`。v2 笔记纳入条目系统后统一走 `permanentDelete(entry-handle)`。
> - `clear`：renderer 零调用，仅在 preload/ipc.ts 注册。安全移除。

### E. 文件移动 / 重命名

| v1 方法     | 功能                       | v2 方案     | 说明     |
| ----------- | -------------------------- | ----------- | -------- |
| `move`      | 按路径移动文件             | 🔀 `rename` | 统一用 FileHandle |
| `moveDir`   | 按路径移动目录             | 🔀 `rename` | 合并     |
| `rename`    | 按路径重命名文件（加 .md） | 🔀 `rename` | 合并     |
| `renameDir` | 按路径重命名目录           | 🔀 `rename` | 合并     |

**v1 签名：**

```typescript
move(path: string, newPath: string): Promise<void>
moveDir(dirPath: string, newDirPath: string): Promise<void>
rename(path: string, newName: string): Promise<void>
renameDir(dirPath: string, newName: string): Promise<void>
```

**v2 签名：**

```typescript
// rename 按 handle 类型分派：
// - Entry handle: newTarget 是新显示名（不含路径分隔符）
//   external-origin 在磁盘上也会重命名；internal-origin 仅改 DB name
// - Path handle: newTarget 是完整的新绝对路径（等价于 fs.rename）
rename(handle: FileHandle, newTarget: string): Promise<FileEntry | void>
```

> **v1 兼容性审查**：
>
> - `move`/`moveDir`：仅 `NotesPage.tsx` 使用，按 `entry.type` 分别调用，传 `externalPath`。v2 统一 `rename(entry-handle, newName)` 或 `rename(path-handle, newAbsPath)`。
> - `rename`/`renameDir`：仅 `NotesService.ts` 使用，按 `isFile` 分别调用，传 `externalPath` + `safeName`。v2 统一 `rename(entry-handle, newName)`。
>
> 注：v1 的 `move`（跨目录移动）在 v2 中由 `rename` 的 path-handle 分支覆盖（传完整新路径）。Entry-handle 分支仅支持同目录重命名。

### F. 底层 FS 操作

| v1 方法          | 功能                           | v2 方案                  | 说明                                                        |
| ---------------- | ------------------------------ | ------------------------ | ----------------------------------------------------------- |
| `write`          | 按外部路径写入 bytes/string    | ✅ `write`               | 笔记保存、导出等场景仍需直接写外部路径                      |
| `writeWithId`    | 按 fileId 写入 storage         | 🔀 `write`               | 合并到 `write`，传 entry-handle                             |
| `mkdir`          | 创建目录                       | 🔀 `createInternalEntry` | v2 创建内部目录走 entry 系统                                |
| `copy`           | 从 storage 复制到外部路径      | ✅ `copy`                | 当前零调用，v2 简化为仅复制到新内部条目                     |
| `createTempFile` | 生成临时文件路径（不创建文件） | ❌                       | 粘贴场景被 `createInternalEntry({ source: 'bytes' })` 替代  |

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
// 写内容到指定目标，返回写入后的 FileVersion
write(handle: FileHandle, data: string | Uint8Array): Promise<FileVersion>
// 复制内容到新的内部条目
copy(params: { source: FileHandle; newName?: string }): Promise<FileEntry>
```

> **v1 兼容性审查**：
>
> - `write`：PasteService（落盘粘贴数据，v2 被 `createInternalEntry` 替代）、NotesService/NotesPage（写笔记内容）、export.ts（导出 markdown）、exportExcel.ts（写 Excel）、HtmlArtifactsCard（临时 HTML）。笔记和导出场景仍需 `write`。
> - `writeWithId`：仅 minapps 配置文件读写（`custom-minapps.json`）。v2 用 `write(entry-handle, ...)`。
> - `mkdir`：仅 NotesService 创建笔记子目录。v2 走 entry 系统。
> - `copy`：renderer 零调用。v2 简化为仅支持复制到新内部条目。
> - `createTempFile`：粘贴场景被 `createInternalEntry({ source: 'bytes' })` 替代。

### G. 文件检测 / 校验

| v1 方法                  | 功能                                     | v2 方案           | 说明                                                                                             |
| ------------------------ | ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `isTextFile`             | 检测是否文本文件                         | 🔀 `getMetadata`  | `PhysicalFileMetadata` 的 type-specific 字段判断                                                 |
| `isDirectory`            | 检测是否目录                             | 🔀 `getMetadata`  | 条目用 `entry.type`，外部路径用 `getMetadata` 判断                                               |
| `checkFileName`          | 文件名消毒（sanitize）+ 目标路径冲突检测 | ❌ (拆分)         | sanitize 提取为 shared 纯函数（不需要 IPC），冲突检测由 `createInternalEntry`/`rename` 内部处理   |
| `validateNotesDirectory` | 校验笔记目录合法性                       | ❓ 待定           | 不在当前 `FileIpcApi` 中，待笔记模块迁移时确定归属                                               |

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
getMetadata(handle: FileHandle): Promise<PhysicalFileMetadata>
```

> **v1 兼容性审查**：
>
> - `isTextFile`：`utils/file.ts` 和 `AttachmentPreview.tsx` 使用。v2 用 `getMetadata(path-handle)` 的 type-specific 字段替代。
> - `isDirectory`：仅 `SkillsSettings.tsx` 拖拽安装判断。v2 用 `getMetadata(path-handle)` 判断。
> - `checkFileName`：仅 `NotesService.ts`/`NotesPage.tsx` 使用（4 处），用于创建/重命名前校验。v2 由 `createInternalEntry`/`rename` 的 service 内部校验，冲突时抛错误，renderer 捕获并提示用户。
> - `validateNotesDirectory`：`NotesService.ts`/`NotesSettings.tsx` 使用。不在当前 `FileIpcApi` 范围内，待笔记模块迁移时确定是否归入 File IPC 或 Notes 专用 IPC。

### H. 系统操作

| v1 方法                    | 功能                                        | v2 方案           | 说明                                                            |
| -------------------------- | ------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| `openPath`                 | 用系统默认程序打开文件/目录                 | ✅ `open`         | 接收 `FileHandle`，service resolve 物理路径                     |
| `openFileWithRelativePath` | 用相对路径打开 storage 文件                 | 🔀 `open`         | 合并，v2 传 entry-handle                                       |
| `showInFolder`             | 在文件管理器中显示                          | ✅ `showInFolder` | 接收 `FileHandle`                                              |
| `getPathForFile`           | `webUtils.getPathForFile`（preload 直接调） | ✅ 保留           | 非 IPC，preload-only 同步方法，在 `FilePreloadApi` 中          |

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
open(handle: FileHandle): Promise<void>
// 在系统文件管理器中显示
showInFolder(handle: FileHandle): Promise<void>
// preload-only（FilePreloadApi），不在 FileIpcApi 中
// getPathForFile(file: File): string
```

> **v1 兼容性审查**：
>
> - `openPath`：多处使用（知识库目录、文件列表、引用链接、agent 工具路径），传外部路径。v2 `open` 的 path-handle 覆盖。
> - `openFileWithRelativePath`：仅知识库文件/视频使用，传 `FileMetadata`（内部拼 storage 路径）。v2 传 entry-handle，service resolve 物理路径。
> - `showInFolder`：仅 `ClickableFilePath.tsx` 使用，传路径。v2 `showInFolder` 支持 `FileHandle`。
> - `getPathForFile`：多处使用（PasteService、拖拽、知识库文件），preload 直接调 `webUtils`，不变。v2 移入 `FilePreloadApi`（`extends FileIpcApi`），非 IPC 方法。

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
listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>
```

> **v1 兼容性审查**：
>
> - `getDirectoryStructure`：仅 Notes 使用（加载树、检查目录内容）。v2 笔记纳入条目系统后，用 DataApi children 查询替代。
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

## v2 方法签名汇总（仅含 v1 映射）

以下仅列出有 v1 对应关系的 v2 方法。纯新增方法（如 `getDanglingState`、`getVersion`、`getContentHash`、`writeIfUnchanged`、`runSweep` 等）请参见 [`ipc.ts`](../../../packages/shared/file/types/ipc.ts)。

### 核心类型

```typescript
// ─── FileHandle: 统一入口类型 ───
type FileHandle =
  | { kind: 'entry'; entryId: FileEntryId }
  | { kind: 'path'; path: FilePath }

// ─── 版本追踪 ───
interface FileVersion { mtime: number; size: number }
interface ReadResult<T> { content: T; mime: string; version: FileVersion }

// ─── 入库参数 ───
type CreateInternalEntryIpcParams =
  | { source: 'path'; path: FilePath }
  | { source: 'url'; url: URLString }
  | { source: 'base64'; data: Base64String; name?: string }
  | { source: 'bytes'; data: Uint8Array; name: string; ext: string | null }

type EnsureExternalEntryIpcParams = { externalPath: FilePath }

// ─── 批量结果 ───
interface BatchMutationResult {
  succeeded: FileEntryId[]
  failed: Array<{ id: FileEntryId; error: string }>
}

interface BatchCreateResult {
  succeeded: Array<{ id: FileEntryId; sourceRef: string }>
  failed: Array<{ sourceRef: string; error: string }>
}
```

### 方法签名

```typescript
// ─── A. 文件选择 / 对话框 ───
openSelectDialog(options: { directory?: never; multiple?: false; filters?: FileFilter[]; title?: string }): Promise<string | null>
openSelectDialog(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
openSelectDialog(options: { directory: true; title?: string }): Promise<string | null>
openSaveDialog(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>

// ─── B. 条目创建 ───
createInternalEntry(params: CreateInternalEntryIpcParams): Promise<FileEntry>
ensureExternalEntry(params: EnsureExternalEntryIpcParams): Promise<FileEntry>
batchCreateInternalEntries(items: CreateInternalEntryIpcParams[]): Promise<BatchCreateResult>
batchEnsureExternalEntries(items: EnsureExternalEntryIpcParams[]): Promise<BatchCreateResult>

// ─── C. 文件读取 / 元信息 ───
read(handle: FileHandle, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
read(handle: FileHandle, options: { encoding: 'base64' }): Promise<ReadResult<string>>
read(handle: FileHandle, options: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>
getMetadata(handle: FileHandle): Promise<PhysicalFileMetadata>

// ─── D. 条目删除 ───
trash(params: { id: FileEntryId }): Promise<void>
restore(params: { id: FileEntryId }): Promise<FileEntry>
permanentDelete(handle: FileHandle): Promise<void>
batchTrash(params: { ids: FileEntryId[] }): Promise<BatchMutationResult>
batchRestore(params: { ids: FileEntryId[] }): Promise<BatchMutationResult>
batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchMutationResult>

// ─── E. 重命名 ───
rename(handle: FileHandle, newTarget: string): Promise<FileEntry | void>

// ─── F. 文件写入 / 复制 ───
write(handle: FileHandle, data: string | Uint8Array): Promise<FileVersion>
copy(params: { source: FileHandle; newName?: string }): Promise<FileEntry>

// ─── G. 路径工具（v1 App_* 迁入） ───
canWrite(dirPath: FilePath): Promise<boolean>
toAbsolutePath(filePath: string): Promise<FilePath>
isPathInside(childPath: string, parentPath: string): Promise<boolean>

// ─── H. 系统操作 ───
open(handle: FileHandle): Promise<void>
showInFolder(handle: FileHandle): Promise<void>

// ─── I. 目录扫描 ───
listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>
isNotEmptyDir(dirPath: FilePath): Promise<boolean>
```

> **不在 FileIpcApi 中的方法**：
>
> - `getPathForFile(file: File): string` — `FilePreloadApi` 中的 preload-only 同步方法（`webUtils.getPathForFile`）
> - File Watcher（start/stop/pause/resume/onFileChange）— v2 由 FileManager service 内部管理，不暴露 IPC
> - `getDirectoryStructure` — v2 用 DataApi children 查询替代
> - `checkFileName` — sanitize 提取为 shared 纯函数，冲突检测由 service 内部处理
> - `validateNotesDirectory` — 待笔记模块迁移时确定归属

## 非 File_ 前缀的文件相关 IPC

v1 还有一些散落在其他命名空间下的文件相关 IPC，需要统一分析归属。

### 已合并到 File Module IPC

| v1 IPC                   | v1 实现                                    | v2 方案                                      | 说明                                    |
| ------------------------ | ------------------------------------------ | -------------------------------------------- | --------------------------------------- |
| `Fs_Read`                | `FileService.readFile`                     | 🔀 `read(path-handle)`                       | → readByPath（FileHandle 的 path 分支） |
| `Fs_ReadText`            | `FileService.readTextFileWithAutoEncoding` | 🔀 `read(path-handle, { encoding: 'text' })` | 同上                                    |
| `Open_Path`              | `shell.openPath(path)`                     | 🔀 `open(path-handle)`                       | 与 `File_OpenPath` 完全重复             |
| `App_HasWritePermission` | `hasWritePermission(filePath)`             | 🔀 `canWrite(FilePath)`                       | 纯路径操作                              |
| `App_ResolvePath`        | `path.resolve(untildify(filePath))`        | 🔀 `toAbsolutePath(string)`                   | 纯路径计算                              |
| `App_IsPathInside`       | `isPathInside(childPath, parentPath)`      | 🔀 `isPathInside(child, parent)`              | 纯路径计算                              |
| `App_IsNotEmptyDir`      | `fs.readdirSync(path).length > 0`          | 🔀 `isNotEmptyDir(FilePath)`                  | 轻量 FS 检查                            |

> **v1 兼容性审查**：
>
> - `Fs_Read`：aiCore 和 renderer 中用于读取外部文件（URL 或本地路径），v2 `read(path-handle)` 覆盖。
> - `Fs_ReadText`：renderer 中用于读取文本文件并自动检测编码，v2 `read(path-handle, { encoding: 'text', detectEncoding: true })` 覆盖。
> - `Open_Path`：多处使用（知识库、导出结果等），与 `File_OpenPath` 实现完全相同（均调用 `shell.openPath`），v2 统一为 `open(path-handle)`。
> - `App_HasWritePermission`：数据迁移选择目录时校验权限。通用能力。
> - `App_ResolvePath` / `App_IsPathInside`：纯路径计算，无 FS I/O。renderer 无 `node:path`，仍需 IPC。
> - `App_IsNotEmptyDir`：数据迁移校验目录。通用能力。

### 保持独立（不属于 File Module）

| v1 IPC            | v1 实现                                                     | v2 方案         | 说明                                                 |
| ----------------- | ----------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| `Pdf_ExtractText` | `extractPdfText(data: Uint8Array \| ArrayBuffer \| string)` | ✅ 保持独立     | 纯内容处理（传 buffer），不依赖文件系统或 entry 系统 |
| `App_Copy`        | `fs.promises.cp` 递归复制                                   | ✅ 数据迁移模块 | userData 递归复制 + occupiedDirs 排除，专用场景      |

### 不属于 FileManager（各自业务模块）

| v1 IPC                                                           | 说明                                         | v2 归属       |
| ---------------------------------------------------------------- | -------------------------------------------- | ------------- |
| `Open_Website`                                                   | `shell.openExternal(url)` — URL 不是文件操作 | App 层        |
| `FileService_Upload/List/Delete/Retrieve`                        | AI Provider 远程文件 API（Gemini 等）        | Provider 模块 |
| `Gemini_UploadFile/Base64File/RetrieveFile/ListFiles/DeleteFile` | Gemini 专用文件操作                          | Provider 模块 |
| `Export_Word`                                                    | Word 导出                                    | Export 模块   |
| `Zip_Compress/Decompress`                                        | 压缩解压                                     | Backup 模块   |
| `Webview_PrintToPDF/SaveAsHTML`                                  | Webview 输出                                 | Webview 模块  |
| `Skill_ReadFile/ListFiles`                                       | Skill 文件读取                               | Skill 模块    |
