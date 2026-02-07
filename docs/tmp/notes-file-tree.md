# 笔记功能的文件树处理方式（现有实现）

本文档说明当前版本笔记功能如何管理文件树，包括存储位置、树结构加载、文件监听与文件操作路径。

## 存储位置与路径来源

- 笔记根目录来自 `window.api.getAppInfo().notesPath`。
- `notesPath` 存在于 Redux（`store/note`），通过 `useNotesSettings` 读写。
- main 侧默认目录由 `getNotesDir()` 创建。

## 文件树的构建与刷新

- 页面加载后调用 `loadTree(notesPath)` 获取目录结构。
- `loadTree` 通过 `window.api.file.getDirectoryStructure` 读取真实文件系统树。
- `sortTree` 按用户设置排序（A-Z、更新时间等）。
- `mergeTreeState` 会把 `starredPaths` 与 `expandedPaths` 合并回树节点状态。

相关实现：

- `src/renderer/src/pages/notes/NotesPage.tsx`
- `src/renderer/src/services/NotesService.ts`
- `src/renderer/src/services/NotesTreeService.ts`

## 文件监听与同步

- 进入笔记页后，通过 `window.api.file.startFileWatcher(notesPath)` 启动监听。
- 监听事件来自 main 进程 `FileStorage` 的 chokidar watcher。
- 发生变更时触发 tree refresh，并更新 starred/expanded 状态。

## 文件与目录操作

- 新建目录：`addDir` -> `window.api.file.mkdir`。
- 新建笔记：`addNote` -> `window.api.file.write`（写入 `.md`）。
- 删除节点：`delNode` -> `deleteExternalFile` / `deleteExternalDir`。
- 重命名：`renameNode` -> `file.rename` / `file.renameDir`。

所有操作直接作用于文件系统，不经过 `db.files`。

## 上传处理

笔记只接受 Markdown 文件（`.md`, `.markdown`）。

上传路径：

- 拖拽或选择文件 -> `useNotesFileUpload` 收集文件列表。
- `uploadNotes` 优先使用 main 侧批量上传：
  - `window.api.file.batchUploadMarkdown(filePaths, targetPath)`
  - 上传前暂停 watcher，上传后恢复并刷新。
- 若文件没有路径（浏览器 File API），回退到 renderer 逐个写入（`uploadNotesLegacy`）。

## 内容保存策略

- 编辑器内容通过防抖写入：`window.api.file.write(targetPath, content)`。
- 写入后刷新缓存，确保下次读取到最新内容。

## 与文件页面的关系

- 笔记文件树完全基于文件系统，不写入 `db.files`。
- 文件页面（`/files`）仅展示 `db.files` 中的记录，因此不会显示笔记文件。

## 限制与现状

- 笔记文件树依赖文件系统扫描与 watcher，同步逻辑分散在页面内。
- 与 `db.files` 的文件引用体系割裂，难以统一检索或跨业务归档。
