# FileManager IPC Redesign

v1 有 44 个细粒度文件 IPC 方法，v2 需要重新设计为统一的 FileManager lifecycle service。

## 设计原则

- 操作对象是 **node ID**，不是路径（FileManager 内部根据 mount type 处理 FS）
- Renderer 只传必要信息，service 层推导元数据
- 不按 file/dir 拆分方法（v1 的 `move` / `moveDir` 等冗余）

## v1 清单与 v2 方案

状态标记：

- ✅ 保留（可能改签名）
- 🔀 合并到其他方法
- ❌ 移除
- ❓ 待定

### A. 文件选择 / 对话框

| v1 方法        | 功能                                    | v2 方案     | 说明                                                                                                                                                     |
| -------------- | --------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select`       | 打开文件选择对话框，返回 FileMetadata[] | 🔀 `select` | 与 `selectFolder` 合并，通过 `directory` 参数区分。返回路径而非 FileMetadata（入库是 `createNode` 的事）。单选返回 `string \| null`，多选返回 `string[]` |
| `selectFolder` | 打开文件夹选择对话框，返回路径          | 🔀 `select` | 合并到 `select({ directory: true })`                                                                                                                     |
| `open`         | 打开文件对话框 + 读取内容（<2GB）       | ❌          | 拆为 `select` + `read` 组合，renderer 自行组装                                                                                                           |
| `save`         | 打开保存对话框 + 写入内容               | ✅ `save`   | 保留，`showSaveDialog` 与 `showOpenDialog` 不同                                                                                                          |

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

| v1 方法               | 功能                                   | v2 方案               | 说明                                |
| --------------------- | -------------------------------------- | --------------------- | ----------------------------------- |
| `upload`              | 复制文件到 storage，MD5 去重，图片压缩 | 🔀 `createNode`       | `content: FilePath`                 |
| `saveBase64Image`     | base64 解码 → 写入 storage             | 🔀 `createNode`       | `content: Base64String`             |
| `savePastedImage`     | Uint8Array → 写入 storage，图片压缩    | 🔀 `createNode`       | `content: Uint8Array`               |
| `download`            | 从 URL 下载 → 写入 storage             | 🔀 `createNode`       | `content: URLString`，main 负责下载 |
| `batchUploadMarkdown` | 批量复制 .md 到目标目录                | 🔀 `batchCreateNodes` | 泛化为批量创建，不限 markdown       |

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

type CreateNodeParams =
  | { type: 'file'; parentId: NodeId; name: string; content: FileContent }
  | { type: 'dir'; parentId: NodeId; name: string }

createNode(params: CreateNodeParams): Promise<FileTreeNode>
// 批量创建文件节点（仅文件，不支持目录）
batchCreateNodes(params: { parentId: NodeId; items: Array<{ name: string; content: FileContent }> }): Promise<BatchOperationResult>
```

> **v1 兼容性审查**：`upload` 实际调用方全部传的是路径（`select` 返回或 `getPathForFile`）。
> `saveBase64Image` 用于 AI 生图（base64）。`savePastedImage` 用于富文本编辑器粘贴（Uint8Array）。
> `download` 用于 AI 生图（URL）。`savePastedImage` 用于富文本编辑器粘贴（Uint8Array），
> v2 用 `createNode({ parentId: 'mount_temp', content: uint8Array })` 替代，临时文件纳入节点系统。
> `batchUploadMarkdown` 唯一调用方为 `NotesService.ts`，
> 传入本地路径数组 + 目标目录，返回值中 `NotesPage` 只用 `fileCount === 0` 判断是否成功，
> 可用 `BatchOperationResult.succeeded.length === 0` 替代。`folderCount`（自动创建的目录数）
> 和 `skippedFiles`（跳过的非 markdown 文件数）在 `NotesPage` 中完全没有使用。
> `skippedFiles` 的过滤逻辑由 renderer 在调用 `batchCreateNodes` 前完成。
> 全部场景被 `FileContent` 联合类型覆盖。

### C. 文件读取（从 storage 或外部路径）

| v1 方法        | 功能                                       | v2 方案          | 说明                                    |
| -------------- | ------------------------------------------ | ---------------- | --------------------------------------- |
| `read`         | 按 fileId 读内容（支持 doc/pdf/xlsx 提取） | 🔀 `read` | 统一入口，`NodeId \| FilePath` 自动区分 |
| `readExternal` | 按外部路径读内容                           | 🔀 `read` | 合并到 `read`，传 `FilePath`     |
| `get`          | 按路径获取 FileMetadata                    | 🔀 `getMetadata` | v2 用 `getMetadata` 替代                |
| `base64Image`  | 按 fileId 读图片为 base64                  | 🔀 `read` | `encoding: 'base64'` 重载               |
| `binaryImage`  | 按 fileId 读图片为 Buffer                  | 🔀 `read` | `encoding: 'binary'` 重载               |
| `base64File`   | 按 fileId 读文件为 base64                  | 🔀 `read` | `encoding: 'base64'` 重载               |
| `pdfInfo`      | 按 fileId 读 PDF 页数                      | 🔀 `getMetadata` | `PdfMetadata.pageCount`                 |

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
read(target: NodeId | FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
// base64（支持图片压缩）
read(target: NodeId | FilePath, options: { encoding: 'base64'; imageTransform?: ImageTransform }): Promise<{ data: string; mime: string }>
// binary（支持图片压缩）
read(target: NodeId | FilePath, options: { encoding: 'binary'; imageTransform?: ImageTransform }): Promise<{ data: Uint8Array; mime: string }>

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

getMetadata(target: NodeId | FilePath): Promise<FileMetadata>
```

> **v1 兼容性审查**：
>
> - `read`：传 `file.id + file.ext` 拼接字符串（如 `"abc123.pdf"`）或配置文件名（`'custom-minapps.json'`）。
>   v2 用 `NodeId` 不需要拼 ext；配置文件名场景走 `FilePath`。
> - `readExternal`：全部传绝对路径（笔记文件、外部文件），v2 `FilePath` 覆盖。
> - `get`：返回 `FileMetadata` 用于 UI 预览（PasteService、拖拽、TranslatePage）。v2 `getMetadata` 返回结构不同但信息更全面，调用方需适配。
> - `base64Image` / `binaryImage` / `base64File`：全部传 `file.id + file.ext`，v2 改传 `NodeId`。
>   新增 `imageTransform` 可选参数（#14062），AI 调用层可统一传参压缩大图，
>   `sharp` 已是项目依赖，service 层直接调用。非图片文件传入 `imageTransform` 时静默忽略。
> - `pdfInfo`：renderer 中**零调用**，可安全移除。`getMetadata` 的 `PdfMetadata.pageCount` 作为备用保留。

### D. 文件删除

| v1 方法              | 功能                      | v2 方案                        | 说明                                            |
| -------------------- | ------------------------- | ------------------------------ | ----------------------------------------------- |
| `delete`             | 按 fileId 删 storage 文件 | 🔀 `trash` / `permanentDelete` | 通过 NodeId 操作，不区分 file/dir               |
| `deleteDir`          | 按 ID 删 storage 目录     | 🔀 `trash` / `permanentDelete` | renderer 零调用，合并                           |
| `deleteExternalFile` | 删外部路径文件            | 🔀 `permanentDelete`           | 笔记纳入节点系统后由 service 按 mount type 处理 |
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
trash(params: { id: NodeId }): Promise<void>
restore(params: { id: NodeId }): Promise<FileTreeNode>
permanentDelete(params: { id: NodeId }): Promise<void>
batchTrash(params: { ids: NodeId[] }): Promise<BatchOperationResult>
batchRestore(params: { ids: NodeId[] }): Promise<BatchOperationResult>
batchPermanentDelete(params: { ids: NodeId[] }): Promise<BatchOperationResult>
```

> **v1 兼容性审查**：
>
> - `delete`：`useKnowledge.ts` 和 `FileManager.ts` 使用，传 `file.name` 或 `id + ext`。v2 改传 `NodeId`。
> - `deleteDir`：renderer 零调用。
> - `deleteExternalFile`/`deleteExternalDir`：仅 `NotesService.ts` 使用，传 `node.externalPath`。v2 笔记纳入节点系统后统一走 `permanentDelete(nodeId)`。
> - `clear`：renderer 零调用，仅在 preload/ipc.ts 注册。安全移除。

### E. 文件移动 / 重命名

| v1 方法     | 功能                       | v2 方案   | 说明                           |
| ----------- | -------------------------- | --------- | ------------------------------ |
| `move`      | 按路径移动文件             | 🔀 `move` | 统一用 NodeId，不区分 file/dir |
| `moveDir`   | 按路径移动目录             | 🔀 `move` | 合并                           |
| `rename`    | 按路径重命名文件（加 .md） | 🔀 `move` | rename = 同目录 move + newName |
| `renameDir` | 按路径重命名目录           | 🔀 `move` | 合并                           |

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
move(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
batchMove(params: { ids: NodeId[]; targetParentId: NodeId }): Promise<BatchOperationResult>
```

> **v1 兼容性审查**：
>
> - `move`/`moveDir`：仅 `NotesPage.tsx` 使用，按 `node.type` 分别调用，传 `externalPath`。v2 统一 `move(nodeId, targetParentId)`。
> - `rename`/`renameDir`：仅 `NotesService.ts` 使用，按 `isFile` 分别调用，传 `externalPath` + `safeName`。v2 统一 `move(nodeId, 原parentId, newName)`。

### F. 底层 FS 操作

| v1 方法          | 功能                           | v2 方案         | 说明                                                   |
| ---------------- | ------------------------------ | --------------- | ------------------------------------------------------ |
| `write`          | 按外部路径写入 bytes/string    | ✅ `write`  | 笔记保存、导出等场景仍需直接写外部路径，不经过节点系统 |
| `writeWithId`    | 按 fileId 写入 storage         | 🔀 `write`  | 合并到 `write`，传 NodeId 或 FilePath              |
| `mkdir`          | 创建目录                       | 🔀 `createNode` | v2 创建目录走 `createNode({ type: 'dir' })`            |
| `copy`           | 从 storage 复制到外部路径      | ✅ `copy`       | 当前零调用，但文件管理器基本操作，提前设计             |
| `createTempFile` | 生成临时文件路径（不创建文件） | ❌              | 粘贴场景被 `createNode({ content: Uint8Array })` 替代  |

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
// 写内容到指定目标（节点或外部路径），不创建新节点
write(target: NodeId | FilePath, data: string | Uint8Array): Promise<void>
// 树内复制（创建新节点 + 物理复制）
copy(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
// 导出到外部路径（不创建新节点）
copy(params: { id: NodeId; destPath: FilePath }): Promise<void>
```

> **v1 兼容性审查**：
>
> - `write`：PasteService（落盘粘贴数据，v2 被 `createNode` 替代）、NotesService/NotesPage（写笔记内容）、export.ts（导出 markdown）、exportExcel.ts（写 Excel）、HtmlArtifactsCard（临时 HTML）。笔记和导出场景仍需 `write`。
> - `writeWithId`：仅 minapps 配置文件读写（`custom-minapps.json`）。v2 用 `write(NodeId | FilePath, ...)`。
> - `mkdir`：仅 NotesService 创建笔记子目录。v2 走 `createNode({ type: 'dir' })`。
> - `copy`：renderer 零调用，安全移除。
> - `createTempFile`：粘贴场景被 `createNode({ parentId: 'mount_temp', content })` 替代。
>   临时文件纳入节点系统，粘贴时创建临时 FileRef（`sourceType: 'temp_session'`），
>   `mount_temp` 兼作临时文件和缓存。ref 由调用方显式管理（发送时删临时 ref + 创建正式 ref + move，
>   取消时删 ref）。清理器只自动删除无 ref 的节点（启动时 + 定期），绝不删 ref。
>   用户通过删 ref 主动释放不需要的缓存。
>   HTML 预览可用 `write` 写 temp 路径。（？）

### G. 文件检测 / 校验

| v1 方法                  | 功能                                     | v2 方案                | 说明                                                                                 |
| ------------------------ | ---------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `isTextFile`             | 检测是否文本文件                         | 🔀 `getMetadata`       | `metadata.type === 'text'` 判断，不单独保留                                          |
| `isDirectory`            | 检测是否目录                             | 🔀 `getMetadata`       | 节点用 `node.type`，外部路径用 `getMetadata` 判断                                    |
| `checkFileName`          | 文件名消毒（sanitize）+ 目标路径冲突检测 | ❌ (拆分)              | sanitize 提取为 shared 纯函数（不需要 IPC），冲突检测由 `createNode`/`move` 内部处理 |
| `validateNotesDirectory` | 校验笔记目录合法性                       | ✅ `validateNotesPath` | notes 专用，暂不泛化。app 内部只允许 `Data/files/notes/`                             |

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
getMetadata(target: NodeId | FilePath): Promise<FileMetadata>
// 验证路径是否适合作为 notes 目录
// notes 专用：app 内部只允许 Data/files/notes/，禁止指向其他 mount 目录
validateNotesPath(dirPath: FilePath): Promise<boolean>
```

> **v1 兼容性审查**：
>
> - `isTextFile`：`utils/file.ts` 和 `AttachmentPreview.tsx` 使用。v2 用 `getMetadata(path).type === 'text'` 替代。
> - `isDirectory`：仅 `SkillsSettings.tsx` 拖拽安装判断。v2 用 `getMetadata(path)` 判断。
> - `checkFileName`：仅 `NotesService.ts`/`NotesPage.tsx` 使用（4 处），用于创建/重命名前校验。v2 由 `createNode`/`move` 的 service 内部校验，冲突时抛错误，renderer 捕获并提示用户。
> - `validateNotesDirectory`：`NotesService.ts`/`NotesSettings.tsx` 使用。v2 改为 `validateNotesPath`，
>   主要改动：将硬编码受限路径（`filesDir`/`appDataPath`）替换为"app 内部只允许 `Data/files/notes/`"，
>   新增禁止指向其他 mount basePath（`managed/`、`temp/` 等）。其余检查（存在、可写、非系统根、非当前路径）不变。
>   | `validateNotesDirectory` | 校验笔记目录合法性 | ❓ | |

### H. 系统操作

| v1 方法                    | 功能                                        | v2 方案           | 说明                                                              |
| -------------------------- | ------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `openPath`                 | 用系统默认程序打开文件/目录                 | ✅ `open`         | 接收 `NodeId \| FilePath`，service resolve 物理路径               |
| `openFileWithRelativePath` | 用相对路径打开 storage 文件                 | 🔀 `open`         | 合并，v2 传 NodeId                                                |
| `showInFolder`             | 在文件管理器中显示                          | ✅ `showInFolder` | 接收 `NodeId \| FilePath`                                         |
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
open(target: NodeId | FilePath): Promise<void>
// 在系统文件管理器中显示
showInFolder(target: NodeId | FilePath): Promise<void>
// 移至 preload utils，不属于 FileManager IPC
// getPathForFile(file: File): string
```

> **v1 兼容性审查**：
>
> - `openPath`：多处使用（知识库目录、文件列表、引用链接、agent 工具路径），传外部路径。v2 `open` 支持 `FilePath` 覆盖。
> - `openFileWithRelativePath`：仅知识库文件/视频使用，传 `FileMetadata`（内部拼 storage 路径）。v2 传 `NodeId`，service resolve 物理路径。
> - `showInFolder`：仅 `ClickableFilePath.tsx` 使用，传路径。v2 支持 `NodeId | FilePath`。
> - `getPathForFile`：多处使用（PasteService、拖拽、知识库文件），preload 直接调 `webUtils`，不变。

### I. 目录扫描

| v1 方法                 | 功能                 | v2 方案            | 说明                                                     |
| ----------------------- | -------------------- | ------------------ | -------------------------------------------------------- |
| `getDirectoryStructure` | 递归扫描目录树       | ❌                 | v2 笔记纳入节点系统，用 DataApi children 查询替代        |
| `listDirectory`         | ripgrep 搜索目录内容 | ✅ `listDirectory` | agent 工具面板列出外部目录文件，非节点系统管理，仍需保留 |

**v1 签名：**

```typescript
getDirectoryStructure(dirPath: string): Promise<NotesTreeNode[]>
listDirectory(dirPath: string, options?: DirectoryListOptions): Promise<string[]>
```

**v2 签名：**

```typescript
// 列出外部目录内容（非节点系统管理的目录）
listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>  // DirectoryListOptions 维持原样
```

> **v1 兼容性审查**：
>
> - `getDirectoryStructure`：仅 Notes 使用（加载树、检查目录内容）。v2 笔记纳入节点系统后，用 `GET /files/nodes/:id/children` 替代。
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
> - v2 笔记纳入节点系统后，`local_external` mount 的 watcher 由 FileManager service 内部管理：
>   FS 变更 → service 自动同步到 DB → renderer 通过 DataApi 数据订阅感知。
> - 批量操作时的 pause/resume 也由 service 内部协调，renderer 无需关心。

## v2 FileManager IPC 完整方法列表

v1 44 个方法 → v2 19 个方法（含 1 个 preload 工具方法）。

### 类型定义

```typescript
type FilePath = `/${string}` | `${string}:${string}` | `file://${string}`
type Base64String = `data:${string};base64,${string}`
type URLString = `http://${string}` | `https://${string}`
type FileContent = FilePath | Base64String | URLString | Uint8Array

type CreateNodeParams =
  | { type: 'file'; parentId: NodeId; name: string; content: FileContent }
  | { type: 'dir'; parentId: NodeId; name: string }

type MetadataBase = { size: number; createdAt: number; modifiedAt: number }
type DirectoryMetadata = MetadataBase & { kind: 'directory' }
type FileMetadataCommon = MetadataBase & { kind: 'file'; mime: string }
type ImageFileMetadata = FileMetadataCommon & { type: 'image'; width: number; height: number }
type PdfFileMetadata = FileMetadataCommon & { type: 'pdf'; pageCount: number }
type TextFileMetadata = FileMetadataCommon & { type: 'text'; encoding: string }
type GenericFileMetadata = FileMetadataCommon & { type: 'other' }
type FileKindMetadata = ImageFileMetadata | PdfFileMetadata | TextFileMetadata | GenericFileMetadata
type FileMetadata = DirectoryMetadata | FileKindMetadata

type BatchOperationResult = { succeeded: NodeId[]; failed: Array<{ id: NodeId; error: string }> }

// 图片读取时可选变换（#14062），非图片文件传入时静默忽略，具体字段待调研 sharp API
type ImageTransform = { maxDimension?: number; quality?: number; format?: string }
```

### 方法签名

```typescript
// ─── A. 文件选择 / 对话框 ───
select(options: { directory?: never; multiple?: false; filters?: FileFilter[]; title?: string }): Promise<string | null>
select(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
select(options: { directory: true; title?: string }): Promise<string | null>
save(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>

// ─── B. 节点创建 ───
createNode(params: CreateNodeParams): Promise<FileTreeNode>
batchCreateNodes(params: { parentId: NodeId; items: Array<{ name: string; content: FileContent }> }): Promise<BatchOperationResult>

// ─── C. 文件读取 / 元信息 ───
read(target: NodeId | FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
read(target: NodeId | FilePath, options: { encoding: 'base64'; imageTransform?: ImageTransform }): Promise<{ data: string; mime: string }>
read(target: NodeId | FilePath, options: { encoding: 'binary'; imageTransform?: ImageTransform }): Promise<{ data: Uint8Array; mime: string }>
getMetadata(target: NodeId | FilePath): Promise<FileMetadata>

// ─── D. 节点删除 ───
trash(params: { id: NodeId }): Promise<void>
restore(params: { id: NodeId }): Promise<FileTreeNode>
permanentDelete(params: { id: NodeId }): Promise<void>
batchTrash(params: { ids: NodeId[] }): Promise<BatchOperationResult>
batchRestore(params: { ids: NodeId[] }): Promise<BatchOperationResult>
batchPermanentDelete(params: { ids: NodeId[] }): Promise<BatchOperationResult>

// ─── E. 节点移动（含重命名） ───
move(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
batchMove(params: { ids: NodeId[]; targetParentId: NodeId }): Promise<BatchOperationResult>

// ─── F. 文件写入 / 复制 ───
write(target: NodeId | FilePath, data: string | Uint8Array): Promise<void>
copy(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
copy(params: { id: NodeId; destPath: FilePath }): Promise<void>

// ─── G. 校验 ───
validateNotesPath(dirPath: FilePath): Promise<boolean>

// ─── H. 系统操作 ───
open(target: NodeId | FilePath): Promise<void>
showInFolder(target: NodeId | FilePath): Promise<void>

// ─── I. 目录扫描 ───
listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>  // 维持原样
```

> **不在 FileManager IPC 中的方法**：
> - `getPathForFile(file: File): string` — preload 通过 contextBridge 暴露的同步工具方法，不属于 FileManager
> - File Watcher（start/stop/pause/resume/onFileChange）— v2 由 FileManager service 内部管理，不暴露 IPC
> - `getDirectoryStructure` — v2 用 DataApi `GET /files/nodes/:id/children` 替代
> - `checkFileName` — sanitize 提取为 shared 纯函数，冲突检测由 service 内部处理
