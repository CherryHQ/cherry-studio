# FileManager Handler Mapping

> **⚠️ OUTDATED / SUPERSEDED（2026-04-21）**
>
> 本文档的"新 IPC"列捕获的是早期设计（`createEntry({origin})` 未拆分），已被后续评审推翻。关键调整：
>
> - `createEntry({origin:'internal',...})` → `createInternalEntry(...)`
> - `createEntry({origin:'external',...})` → `ensureExternalEntry(...)`（纯 upsert by path，无 restore 分支）
> - External entry 不进入 trash 生命周期；`permanentDelete` 对 external 只动 DB 行
>
> **实现准绳**：[`docs/references/file/file-manager-architecture.md`](../../../docs/references/file/file-manager-architecture.md)、[`rfc-file-manager.md`](./rfc-file-manager.md)、[`file-arch-problems-response.md`](./file-arch-problems-response.md)。
>
> 本文档保留用于 v1→v2 handler 迁移阶段的对照参考；**不要**据此固化新 IPC 命名。

---

v1 IPC → v2 IPC 的映射关系，以及 FileManager handler 层的分派逻辑。

相关文档：

- [ipc-redesign.md](./ipc-redesign.md) — v2 IPC 接口签名与 v1 兼容性审查
- [filestorage-redesign.md](./filestorage-redesign.md) — v1 FileStorage ~78 个方法到 v2 架构归属

## 架构

FileManager 统管所有 IPC handler 注册，handler 内部按 target 类型分派：

```
Renderer
  → FileManager.registerIpcHandlers() (统一入口)
    ├── target: FileEntryId → FileManager 方法 (entry 协调: resolve → DB + FS)
    │     ├── ops.ts
    │     ├── FileTreeService (DB)
    │     └── FileRefService (DB)
    └── target: FilePath    → ops.ts (直接 FS/路径操作)
```

FileManager 的 public 方法只认 FileEntryId，纯 path 操作在 handler 层直接委托 ops.ts，不污染 public API。

Main process 其他 service 可根据实际需求直接调 ops.ts 或 FileManager，不经过 IPC。

## 方法分类

### 一、纯 Entry 操作 → FileManager

这些方法的参数永远是 `FileEntryId`，必须经过 FileManager 协调 DB + FS。

| v2 IPC 方法                          | 替代的 v1 IPC                                                                                | 备注                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| `createEntry(params)`                | `File_Upload`, `File_SaveBase64Image`, `File_SavePastedImage`, `File_Download`, `File_Mkdir` | 按 content 类型分派不同 ops 函数     |
| `batchCreateEntries(params)`         | `File_BatchUploadMarkdown`                                                                   | 事务包裹                             |
| `trash({ id })`                      | `File_Delete`, `File_DeleteDir`                                                              |                                      |
| `restore({ id })`                    | _(v1 无)_                                                                                    | 需 ensureAncestors                   |
| `permanentDelete({ id })`            | `File_DeleteExternalFile`, `File_DeleteExternalDir`                                          | FS 删除 + DB 级联                    |
| `batchTrash/Restore/PermanentDelete` | _(v1 无)_                                                                                    | 事务包裹                             |
| `move(params)`                       | `File_Move`, `File_MoveDir`, `File_Rename`, `File_RenameDir`                                 | FS move + DB update                  |
| `batchMove(params)`                  | _(v1 无)_                                                                                    | 事务包裹                             |
| `copy(params)`                       | `File_Copy`                                                                                  | 树内复制创建新条目；导出到外部不创建 |

### 二、纯 Path 操作 → ops.ts

这些方法的参数永远是 `FilePath`，直接委托 ops.ts，不涉及 entry 系统。

| v2 IPC 方法                        | 替代的 v1 IPC                      | 备注                                       |
| ---------------------------------- | ---------------------------------- | ------------------------------------------ |
| `select(options)`                  | `File_Select`, `File_SelectFolder` | Electron dialog                            |
| `save(options)`                    | `File_Save`, `File_SaveImage`      | Electron dialog + ops.write                |
| `listDirectory(dirPath, options?)` | `File_ListDirectory`               |                                            |
| `validateNotesPath(dirPath)`       | `File_ValidateNotesDirectory`      |                                            |
| `canWrite(dirPath)`                | `App_HasWritePermission`           | ops.canWrite                               |
| `resolvePath(filePath)`            | `App_ResolvePath`                  | ops.resolvePath (path.resolve + untildify) |
| `isPathInside(child, parent)`      | `App_IsPathInside`                 | ops.isPathInside                           |
| `isNotEmptyDir(dirPath)`           | `App_IsNotEmptyDir`                | ops.isNotEmptyDir                          |

### 三、双态方法 → handler 按 target 类型分派

这些方法接受 `FileEntryId | FilePath`，handler 判断 target 类型后分派：

| v2 IPC 方法              | 替代的 v1 IPC                                                                                                         | FileEntryId →            | FilePath →             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------- |
| `read(target, options?)` | `File_Read`, `File_ReadExternal`, `Fs_Read`, `Fs_ReadText`, `File_Base64Image`, `File_BinaryImage`, `File_Base64File` | FileManager.read         | ops.read               |
| `getMetadata(target)`    | `File_Get`, `File_GetPdfInfo`, `File_IsTextFile`, `File_IsDirectory`                                                  | FileManager.getMetadata  | ops.stat + getFileType |
| `write(target, data)`    | `File_Write`, `File_WriteWithId`                                                                                      | FileManager.write        | ops.write              |
| `open(target)`           | `File_OpenPath`, `File_OpenWithRelativePath`, `Open_Path`                                                             | FileManager.open         | ops.open               |
| `showInFolder(target)`   | `File_ShowInFolder`                                                                                                   | FileManager.showInFolder | ops.showInFolder       |

## 已移除的 v1 IPC

| v1 IPC                                | 原因                                             |
| ------------------------------------- | ------------------------------------------------ |
| `File_Open`                           | renderer 自行组合 select + read                  |
| `File_Clear`                          | 危险操作                                         |
| `File_CreateTempFile`                 | → `createEntry({ parentId: 'mount_temp', ... })` |
| `File_CheckFileName`                  | sanitize → shared 纯函数，冲突 → service 内部    |
| `File_GetDirectoryStructure`          | → DataApi `GET /files/entries/:id/children`      |
| `File_StartWatcher/Stop/Pause/Resume` | FileManager 内部管理，不暴露 IPC                 |

## 不属于 File Module 的 IPC

| v1 IPC                          | v2 归属       | 说明                                    |
| ------------------------------- | ------------- | --------------------------------------- |
| `getPathForFile`                | preload utils | 同步方法，不经过 IPC                    |
| `Open_Website`                  | App 层        | `shell.openExternal(url)`               |
| `Pdf_ExtractText`               | 保持独立      | 纯内容处理（传 buffer），不依赖文件系统 |
| `App_Copy`                      | 数据迁移模块  | userData 递归复制，专用场景             |
| `FileService_*`                 | Provider 模块 | AI Provider 远程文件 API                |
| `Gemini_*File`                  | Provider 模块 | Gemini 专用                             |
| `Export_Word`                   | Export 模块   |                                         |
| `Zip_Compress/Decompress`       | Backup 模块   |                                         |
| `Webview_PrintToPDF/SaveAsHTML` | Webview 模块  |                                         |
| `Skill_ReadFile/ListFiles`      | Skill 模块    |                                         |

---

## 汇总

|                          | v1  | v2                                 |
| ------------------------ | --- | ---------------------------------- |
| 文件相关 IPC 总数        | 52  | 22                                 |
| 其中纯 Entry 操作        | —   | 9 → FileManager                    |
| 其中纯 Path 操作         | —   | 8 → ops.ts                         |
| 其中双态（handler 分派） | —   | 5 → FileManager or ops.ts          |
| 已移除                   | —   | 10                                 |
| 归属其他模块             | —   | 10                                 |
| 新增（v1 无）            | —   | 7 (trash/restore/batch + 路径工具) |
