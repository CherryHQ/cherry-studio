# FileStorage Redesign

> **⚠️ OUTDATED / SUPERSEDED（2026-04-21）**
>
> 本文档描述的拆分目标（"🔀 FileManager.createEntry"）捕获的是早期设计，已被后续评审推翻：
>
> - `FileManager.createEntry({origin, content, ...})` → 拆分为 `createInternalEntry`（内容来源 discriminated union）+ `ensureExternalEntry`（纯 upsert by path）
> - External entry 不进入 trash 生命周期（`fe_external_no_trash` CHECK）
> - `permanentDelete` 对 external 只删 DB 行，物理文件不动
>
> **实现准绳**：[`docs/references/file/file-manager-architecture.md`](../../../docs/references/file/file-manager-architecture.md)、[`rfc-file-manager.md`](./rfc-file-manager.md)、[`file-arch-problems-response.md`](./file-arch-problems-response.md)。
>
> 本文档对 v1 FileStorage God Object 的拆分思路（搬到 ops.ts / FileManager / 移除等分类）仍有参考价值，但**具体的 v2 API 形状不要照抄**。

---

v1 的 `FileStorage.ts` 是一个 ~78 方法的 God Object，包含 FS CRUD、内容处理、元数据读取、搜索、Dialog、Shell 等所有文件相关逻辑。v2 需要拆分到新架构的各层中。

## 目标架构

```
ops.ts (纯函数, sole fs owner)
  └── 所有物理文件操作，只认 filePath，无状态

FileManager (唯一 lifecycle service)
  ├── IPC handler 注册
  ├── entry ops: entryId → filePath resolve + DB 协调 + 调用 fs 纯函数
  ├── Electron dialog
  └── chokidar 监听 (内部子模块)

FileTreeService (data repository, 纯 DB)
FileRefService (data repository, 纯 DB)
```

## FS 访问约束

**所有模块通过 ops.ts 访问文件系统，ops.ts 是唯一直接 `import node:fs` 的模块。** chokidar 作为第三方事件库不在此约束范围内，但 FileManager 内部 sync 逻辑中需要的 stat/read 等操作仍通过 ops.ts re-export 的函数执行。这样保留了将来在 ops.ts 层做拦截/缓存/日志的空间。

## 状态标记

- ✅ 保留（可能改签名或归属）
- 🔀 合并到其他方法
- ❌ 移除
- ❓ 待定

---

## A. FS CRUD（基础读写操作）

| v1 方法                    | 功能                                 | v2 归属                               | 说明                                              |
| -------------------------- | ------------------------------------ | ------------------------------------- | ------------------------------------------------- |
| `uploadFile`               | 复制外部文件到 storage，可选图片压缩 | 🔀 FileManager.createEntry            | 协调层：resolve parentId → 调 ops.copy + 图片压缩 |
| `deleteFile`               | 按 fileId 删除文件                   | 🔀 FileManager.permanentDelete        | 协调层：resolve path → ops.delete + DB 删除       |
| `deleteDir`                | 按 dirId 递归删除目录                | 🔀 FileManager.permanentDelete        | 同上，CASCADE 处理子条目                          |
| `deleteExternalFile`       | 按外部路径删除文件                   | 🔀 ops.delete                         | 纯路径操作                                        |
| `deleteExternalDir`        | 按外部路径递归删除目录               | 🔀 ops.deleteDir                      | 纯路径操作                                        |
| `moveFile`                 | 移动/重命名文件                      | 🔀 ops.move                           | 纯路径操作                                        |
| `moveDir`                  | 移动/重命名目录                      | 🔀 ops.move                           | 纯路径操作                                        |
| `renameFile`               | 重命名文件（追加 .md）               | 🔀 ops.move                           | 追加扩展名的逻辑由调用方处理                      |
| `renameDir`                | 重命名目录                           | 🔀 ops.move                           | 纯路径操作                                        |
| `copyFile`                 | 按 fileId 复制到目标路径             | 🔀 FileManager.copy({ id, destPath }) | 协调层：resolve id → path + ops.copy              |
| `writeFile`                | 写内容到路径                         | ✅ ops.write                          | 纯路径操作                                        |
| `writeFileWithId`          | 按 fileId 写内容                     | 🔀 FileManager.write                  | 协调层：resolve path → ops.write                  |
| `mkdir`                    | 创建目录                             | ✅ ops.mkdir                          | 纯路径操作                                        |
| `clear`                    | 清空整个 storage 目录                | ❌                                    | 无实际消费者，且高危，移除                        |
| `clearTemp`                | 清空临时目录                         | 🔀 FileManager.clearTemp              | 清空 mount_temp 下所有条目 + 物理文件             |
| `batchUploadMarkdownFiles` | 批量复制 md 文件                     | 🔀 FileManager.batchCreateEntries     | 已在 ipc-redesign 中覆盖                          |

## B. 内容处理（转换文件内容）

| v1 方法                    | 功能                                                         | v2 归属                                                                             | 说明                                                                |
| -------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `compressImage`            | 压缩图片（>1MB 时 sharp 压缩）                               | ✅ ops.ts `compressImage`                                                           | 纯函数，FileManager 在 createEntry 时调用                           |
| `compressImageBuffer`      | 压缩剪贴板图片 buffer                                        | 🔀 ops.ts `compressImage`                                                           | 合并到 compressImage，接受 buffer 入参                              |
| `saveBase64Image`          | base64 解码 → 生成 UUID → 写入 storage → 返回 metadata       | 🔀 FileManager.createEntry({ type: 'file', parentId, name, content: Base64String }) | 协调层：解析 data URL → 推导 ext → ops.write                        |
| `savePastedImage`          | 剪贴板 Uint8Array → 生成 UUID → 写入 storage → 返回 metadata | 🔀 FileManager.createEntry({ type: 'file', parentId, name, content: Uint8Array })   | 协调层：可选图片压缩 → ops.write                                    |
| `downloadFile`             | URL 下载 → 生成 UUID → 写入 storage → 返回 metadata          | 🔀 FileManager.createEntry({ type: 'file', parentId, name, content: URLString })    | 全部调用方为 Paintings（AI 生图）。协调层：ops.download → ops.write |
| `getExtensionFromMimeType` | MIME → 扩展名映射                                            | ✅ ops.mimeToExt                                                                    | 纯工具函数                                                          |

## C. 元数据读取

| v1 方法                      | 功能                                                 | v2 归属                            | 说明                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `getFile`                    | 获取文件元数据（大小、类型、时间）                   | 🔀 ops.stat + getFileType          | 已在 ipc-redesign 中合并为 getMetadata。main 内部无消费者，安全迁移                                                                        |
| `getFileType`                | 检测文件类型（扩展名映射 + fallback 到 buffer 检测） | ✅ ops.getFileType                 | 主路径：ext → FileType 纯映射；fallback：读文件内容判断是否文本（isBinaryFile + chardet），依赖 fs                                         |
| `getFileHash`                | 计算 MD5 hash                                        | ✅ ops.hash                        | 纯函数。fileEntryTable 增加 hash 列，createEntry 时计算并存储                                                                              |
| `findDuplicateFile`          | 按 size+hash 查找重复文件                            | 🔀 FileManager.createEntry 内部    | v1 遍历目录 O(n) → v2 改为 DB 索引查找。找到重复时复用已有 entry + 创建新 FileRef，不重复存储物理文件                                      |
| `pdfPageCount`               | PDF 页数（pdf-lib）                                  | 🔀 ops.getMetadata                 | 已在 ipc-redesign 中合并                                                                                                                   |
| `isTextFile` / `_isTextFile` | 判断是否文本文件（chardet + isbinaryfile）           | ✅ ops.isTextFile                  | 纯路径操作                                                                                                                                 |
| `isDirectory`                | 判断是否目录                                         | ✅ ops.stat                        | 纯路径操作                                                                                                                                 |
| `fileNameGuard`              | 文件名消毒 + 同目录冲突检测                          | ❌ (拆分)                          | sanitize → shared 纯函数；冲突检测 → createEntry / copy / move 内部处理。同 parentId 下同名时自动加后缀（OS 默认行为），只改 name 不动 ext |
| `getFilePathById`            | fileId → 完整路径                                    | 🔀 FileManager.resolvePhysicalPath | entryId → 绝对路径，协调层职责                                                                                                             |

## D. 文件内容读取（含格式提取）

| v1 方法            | 功能                                      | v2 归属                   | 说明                                                                                                                                               |
| ------------------ | ----------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readFileCore`     | 核心读取逻辑（.doc/office/text 编码检测） | 🔀 ops.read               | private 方法，v1 为避免 IPC event 参数重复而抽取。v2 ops.read 本身只接受路径，内部按扩展名分派格式提取（word-extractor / officeParser / 编码检测） |
| `readFile`         | 按 fileId 读内容                          | 🔀 FileManager → ops.read | 协调层 resolve + delegate                                                                                                                          |
| `readExternalFile` | 按外部路径读内容                          | 🔀 ops.read               | 纯路径操作                                                                                                                                         |
| `base64Image`      | 按 fileId 读图片为 base64                 | 🔀 FileManager → ops.read | encoding: 'base64' 重载                                                                                                                            |
| `binaryImage`      | 按 fileId 读图片为 Buffer                 | 🔀 FileManager → ops.read | encoding: 'binary' 重载                                                                                                                            |
| `base64File`       | 按 fileId 读文件为 base64                 | 🔀 FileManager → ops.read | encoding: 'base64' 重载                                                                                                                            |

## E. Dialog（Electron 对话框）

| v1 方法        | 功能                | v2 归属               | 说明                               |
| -------------- | ------------------- | --------------------- | ---------------------------------- |
| `selectFile`   | 打开文件选择对话框  | 🔀 FileManager.select | 已在 ipc-redesign 中覆盖           |
| `open`         | 打开对话框 + 读内容 | ❌                    | 拆为 select + read 组合            |
| `save`         | 保存对话框 + 写入   | ✅ FileManager.save   | 已在 ipc-redesign 中覆盖           |
| `saveImage`    | 保存图片对话框      | 🔀 FileManager.save   | 合并到 save                        |
| `selectFolder` | 文件夹选择对话框    | 🔀 FileManager.select | 合并到 select({ directory: true }) |

## F. Shell（系统操作）

| v1 方法                    | 功能               | v2 归属                   | 说明                    |
| -------------------------- | ------------------ | ------------------------- | ----------------------- |
| `openPath`                 | 用系统默认应用打开 | ✅ ops.open               | 纯路径操作              |
| `openFileWithRelativePath` | 按相对路径打开     | 🔀 FileManager → ops.open | 协调层 resolve 相对路径 |
| `showInFolder`             | 在文件管理器中显示 | ✅ ops.showInFolder       | 纯路径操作              |

## G. 搜索（ripgrep + 模糊匹配）

全部是 `listDirectory` 的 private 内部实现，v2 统一归入 `ops/search.ts`。仅 `listDirectory` 作为公开函数导出。

| v1 方法                    | 功能                      | v2 归属               | 说明    |
| -------------------------- | ------------------------- | --------------------- | ------- |
| `getRipgrepBinaryPath`     | 定位 ripgrep 二进制       | 🔀 ops/search.ts 内部 | private |
| `executeRipgrep`           | 执行 ripgrep 命令         | 🔀 ops/search.ts 内部 | private |
| `searchByFilename`         | 按文件名搜索              | 🔀 ops/search.ts 内部 | private |
| `searchDirectories`        | 递归搜索目录              | 🔀 ops/search.ts 内部 | private |
| `listDirectoryWithRipgrep` | ripgrep 预过滤 + 模糊匹配 | 🔀 ops/search.ts 内部 | private |
| `isFuzzyMatch`             | 模糊匹配算法              | 🔀 ops/search.ts 内部 | private |
| `isGreedySubstringMatch`   | 贪婪子串匹配              | 🔀 ops/search.ts 内部 | private |
| `getFuzzyMatchScore`       | 模糊匹配评分              | 🔀 ops/search.ts 内部 | private |
| `getGreedyMatchScore`      | 贪婪匹配评分              | 🔀 ops/search.ts 内部 | private |
| `queryToGlobPattern`       | 查询转 glob 模式          | 🔀 ops/search.ts 内部 | private |
| `buildRipgrepBaseArgs`     | 构建 ripgrep 参数         | 🔀 ops/search.ts 内部 | private |

## H. 目录操作

| v1 方法                  | 功能                         | v2 归属                  | 说明                                                                                                                |
| ------------------------ | ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `listDirectory`          | 列出目录内容（支持搜索模式） | ✅ ops.listDirectory     | 纯路径操作                                                                                                          |
| `getDirectoryStructure`  | 递归获取目录树结构           | ❌                       | v2 用 DataApi children 查询替代。Notes 的 UI 树结构（isStarred / expanded 等）由 Notes 模块自行从 FileEntry 构建 VO |
| `validateNotesDirectory` | 验证目录可用性               | ✅ ops.validateNotesPath | 纯路径操作                                                                                                          |

## I. 文件监听（chokidar）

| v1 方法               | 功能               | v2 归属               | 说明           |
| --------------------- | ------------------ | --------------------- | -------------- |
| `startFileWatcher`    | 启动 chokidar 监听 | 🔀 ExternalSyncEngine | 已在架构中独立 |
| `stopFileWatcher`     | 停止监听           | 🔀 ExternalSyncEngine |                |
| `pauseFileWatcher`    | 暂停监听           | 🔀 ExternalSyncEngine |                |
| `resumeFileWatcher`   | 恢复监听           | 🔀 ExternalSyncEngine |                |
| `getWatcherStatus`    | 获取监听状态       | 🔀 ExternalSyncEngine |                |
| `createChangeHandler` | 创建变更处理器     | 🔀 ExternalSyncEngine |                |
| `shouldWatchFile`     | 检查扩展名是否监听 | 🔀 ExternalSyncEngine |                |
| `notifyChange`        | 通知 renderer      | 🔀 ExternalSyncEngine |                |
| `handleWatcherError`  | 错误处理           | 🔀 ExternalSyncEngine |                |
| `cleanup`             | 清理资源           | 🔀 ExternalSyncEngine |                |

## J. 初始化

| v1 方法            | 功能                    | v2 归属          | 说明                                 |
| ------------------ | ----------------------- | ---------------- | ------------------------------------ |
| `constructor`      | 初始化 storage 目录     | 🔀               | 目录初始化分散到各 service 的 onInit |
| `initStorageDir`   | 创建 storage/notes 目录 | 🔀 ops.ensureDir | 纯路径操作                           |
| `tempDir` (getter) | 获取临时目录路径        | 🔀 FileManager   | mount_temp basePath                  |

---

## 待讨论（❓）

以下方法的归属需要进一步讨论：

### 1. 图片压缩（compressImage / compressImageBuffer）

v1 在 upload 时自动压缩 >1MB 的图片。

**结论**：ops.ts 提供 `compressImage(path, options)` 纯函数。FileManager 在 createEntry 流程中调用。

### 2. URL 下载（downloadFile）

v1 从 URL 下载文件到 storage。

**结论**：ops.ts 提供 `download(url, destPath)` 纯函数。FileManager 在 createEntry（content: URLString）时调用。

### 3. 文件 hash / 去重（getFileHash / findDuplicateFile）

**结论**：保留 hash，改进去重实现。v1 遍历目录 O(n) → v2 在 fileEntryTable 增加双 hash 列（MD5，均有索引）：

- `contentHash` = md5(content) — 纯内容指纹
- `fullHash` = md5(content + name + ext) — 内容 + 元数据指纹

不同场景查不同列：

- **粘贴**（name 无意义，自动生成）→ 查 `contentHash` → 匹配则返回已有 entry，不匹配则创建临时 entry
- **用户主动上传**（name 有意义）→ 查 `fullHash` → 匹配则返回已有 entry，不匹配则创建新 entry

这样解决了核心矛盾：粘贴同一张图片不浪费空间，用户改名上传不丢失意图。去重在 FileManager 层自动完成，业务方无需感知。v1 的 `uploadFile` 本来就是同样语义（找到重复返回已有 metadata），v2 保持一致。

### 4. 文件名安全检查（fileNameGuard）

**结论**：拆分。sanitize → shared 纯函数（不需要 IPC）；冲突检测 → createEntry / copy / move 内部处理，同 parentId 下同名时自动加后缀（OS 默认行为），只改 name 不动 ext。

### 5. Office 内容提取（readFileCore）

**结论**：方案 A。ops/fs.ts 的 `read` 内部按扩展名分派格式提取（word-extractor / officeParser / chardet 编码检测）。readFileCore 是 v1 为避免 IPC event 参数重复而抽取的 private 方法，v2 ops.read 本身只接受路径，不需要单独抽取。

### 6. 目录树结构（getDirectoryStructure）

**结论**：移除。v2 用 DataApi `GET /files/entries/:id/children` 替代。Notes 的 UI 树结构（isStarred / expanded 等）由 Notes 模块自行从 FileEntry 构建 VO。

### 7. ripgrep 搜索（11 个 private 方法）

**结论**：全部归入 ops/search.ts 作为 `listDirectory` 的内部实现。仅 `listDirectory` 公开导出。这些方法全部是 private，操作外部路径，是通用的目录搜索能力。
