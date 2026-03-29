# 文件管理说明（现有实现）

本文档描述 Cherry Studio 现有版本的文件管理机制，覆盖主进程文件存储、渲染进程文件引用、IPC 接口与 UI 行为。

## 总览

- 文件真实内容由主进程统一落地到应用资源目录。
- 渲染进程以 `FileMetadata` 作为业务载体，元信息与引用计数存于 Dexie (`db.files`)。
- 文件去重基于“大小 + 内容 MD5”，发生在主进程上传阶段。
- UI 侧文件列表与附件展示使用 `db.files` 数据，`count` 用于引用计数显示与删除策略。

## 目录与存储位置

- 文件目录：由 `getFilesDir()` 计算，主进程写入。
- 笔记目录：由 `getNotesDir()` 计算。
- 临时目录：由 `getTempDir()` 计算。

主进程初始化这些目录：`src/main/services/FileStorage.ts`。

## 数据模型（渲染进程）

`FileMetadata`（`src/renderer/src/types/file.ts`）核心字段：

- `id`: 文件 ID（UUID）
- `name`: 存储文件名（通常是 `uuid + ext`）
- `origin_name`: 原始文件名（用于展示与重命名）
- `path`: 原始路径或构造路径
- `size`: 文件大小
- `ext`: 扩展名（包含点）
- `type`: 文件类型（image/document/text/...）
- `created_at`: 创建时间
- `count`: 引用计数

Dexie 表定义：`src/renderer/src/databases/index.ts`，`files` 表包含上述字段与索引。

## 主进程文件服务（FileStorage）

文件存储与处理：`src/main/services/FileStorage.ts`。

主要能力：

- 选择/保存文件（系统对话框）
- 上传（复制到资源目录）
- 删除/移动/重命名文件与目录
- 读取文件内容（含 office/pdf 解析与编码检测）
- Base64/二进制读取
- 目录扫描与搜索（内置 ripgrep）
- 文件监听（chokidar）

### 去重策略

- 上传前先比对文件大小，再比对内容 MD5。
- MD5 输入为文件的完整字节流（`fs.createReadStream`）。
- 命中重复时返回已存文件的 `FileMetadata`，并在渲染进程侧增加 `count`。

## 渲染进程文件服务（FileManager）

文件引用与计数：`src/renderer/src/services/FileManager.ts`。

核心行为：

- `uploadFile(s)`: 调用 IPC 上传，若已有记录则 `count + 1`。
- `addFile(s)`: 直接写入 `db.files`，已有则 `count + 1`。
- `deleteFile`: 当 `count > 1` 时仅减计数，不删物理文件；否则删除 `db.files` 并调用主进程删除。
- `getFilePath` / `getFileUrl`: 基于 `app.path.files` 构造路径或 `file://` URL。
- `formatFileName`: 使用 `origin_name` 进行展示处理。

## IPC 接口（文件相关）

注册位置：`src/main/ipc.ts`；预加载暴露：`src/preload/index.ts`（`window.api.file`）。

常用接口示例：

- `File_Select` / `File_Open` / `File_Save`
- `File_Upload` / `File_Delete` / `File_Move` / `File_Rename`
- `File_Read` / `File_ReadExternal`
- `File_Base64Image` / `File_Base64File` / `File_BinaryImage`
- `File_ListDirectory` / `File_GetDirectoryStructure`
- `File_StartWatcher` / `File_StopWatcher`

## UI 与业务使用点

- 文件列表页：`src/renderer/src/pages/files/FilesPage.tsx`、`FileList.tsx`
  - 读取 `db.files`，按类型/时间/大小/名称排序。
  - 展示 `count`（引用次数）。
- 消息附件：输入框上传、消息块展示。
- 绘图与知识库：使用 `FileManager.addFiles` 或 `uploadFiles` 写入 `db.files`。

## 引用计数（count）语义

`count` 是文件被引用的次数，用于：

- 删除策略：`count > 1` 时仅减计数，不删除物理文件。
- UI 展示：文件列表显示引用次数。
- 消息/块删除时，`DexieMessageDataSource.updateFileCount` 会更新计数并在归零时删除。

## 注意事项与限制

- 去重对用户不可见，但当前实现会导致同内容文件被视为同一记录，`origin_name` 被覆盖或共享。
- `name` 与实际存储文件名绑定，用于定位文件；`origin_name` 仅用于展示与重命名。
- 文档解析（office/pdf）在主进程进行，可能受格式或编码影响。
- 文件监听仅对指定扩展名生效（默认 `md/markdown/txt`）。

## 关键文件索引

- `src/main/services/FileStorage.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/services/FileManager.ts`
- `src/renderer/src/databases/index.ts`
- `src/renderer/src/pages/files/FilesPage.tsx`
