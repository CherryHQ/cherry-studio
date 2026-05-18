# `utils/file/` 整合：legacyFile.ts + fileOperations.ts 迁移方案

> **定位**：本文件回答 RFC 空白的一个问题——**v1 的 `src/main/utils/file.ts`（现已改名 `legacyFile.ts`）和 `src/main/utils/fileOperations.ts` 里每个导出函数，应该以什么方式合并进 v2 `@main/utils/file/*` 或其它新位置，分别在哪个 phase 落地**。
>
> **背景**：RFC 主文档（[rfc-file-manager.md](./rfc-file-manager.md)）和 [migration-plan.md](./migration-plan.md) 只在 [fs-usage-audit.md](./fs-usage-audit.md) 里提到过这两个文件，粒度是"P0 优先级迁移"，既没给新位置也没绑 phase。本文档补齐该空白，作为 Phase 1b.1 / 1b.2 编码 PR 的待办清单。
>
> **命名前提**：Phase 1a 已把 `src/main/utils/file.ts` 改名为 `src/main/utils/file/legacyFile.ts`，并通过 `src/main/utils/file/index.ts` 的 barrel re-export 保持原有 `@main/utils/file` 导入路径兼容。`fileOperations.ts` 尚在 `src/main/utils/fileOperations.ts`，本文档给出的方案第一步是把它也搬进 `src/main/utils/file/`。

---

## 一、目标布局回顾

Phase 1a 已落地的新结构：

```
src/main/utils/file/
├── index.ts          # barrel（re-export ./legacyFile，保证旧 import 不破）
├── legacyFile.ts     # v1 helpers（本文档规划如何把它拆干净）
├── fs.ts             # v2 原语：read / write / stat / copy / move / remove / removeDir / atomicWriteFile / statVersion / contentHash
├── metadata.ts       # v2 原语：getFileType(path) / isTextFile(path) / mimeToExt(mime)
├── path.ts           # v2 原语：resolvePath / isPathInside / canWrite / isNotEmptyDir / canonicalizeExternalPath / resolvePhysicalPath / getExtSuffix
├── search.ts         # v2 原语：listDirectory (ripgrep + fuzzy)
└── shell.ts          # v2 原语：open / showInFolder
```

以及跨进程共享层：

```
packages/shared/file/types/
├── fileType.ts       # getFileType(ext) + fileTypeMap（由 legacyFile 迁入，migration-plan §A1 已规划）
└── filename.ts       # sanitizeFilename / validateFileName（可供 main + renderer 复用）
```

FileManager（`src/main/services/file/FileManager.ts`）吸收所有需要 entry 语义的调用：`createInternalEntry` / `ensureExternalEntry` / `read(entryId, opts)` / `write` / `trash` / `restore` / `permanentDelete` / `rename` / `copy` / `withTempCopy` / …

Notes 域（未来 `src/main/services/notes/`）承接 Notes 树扫描、笔记命名等与 Notes 业务绑定的函数。

---

## 二、`legacyFile.ts` 函数分派

20 个导出（按当前文件顺序）。**Callers 数** 来自 `grep -rln <symbol> src/`，不含 `legacyFile.ts` 自身和 barrel。

### 2.1 纯 path / 校验类 → `@main/utils/file/path`

| 函数 | Callers | 目标位置 | 新签名（建议） | Phase | 备注 |
|---|---|---|---|---|---|
| `resolveAndValidatePath(baseDir, relativePath)` | 2 | `path.ts` | 同名，签名不变 | **1b.1** | 防路径穿越；`path.ts` 实现 canonicalizeExternalPath 时一起落实 |
| `untildify(pathWithTilde)` | 2 | `path.ts` | 同名 | **1b.1** | `~` 展开；纯 string op，无 FS |
| `isPathInside(childPath, parentPath)` | 9 | `path.ts` | 同名 | **1b.1** | 已作为 `path.ts` 原语列在架构 §7；高 callers 数，保持 API 稳定 |

**合并手法**：Phase 1b.1 实现 `path.ts` 的 `canonicalizeExternalPath` / `isPathInside` 时，把上述函数原样内联进 `path.ts`，`legacyFile.ts` 留下 `export { ... } from './path'` 过渡 re-export 一轮（避免 9 处 `isPathInside` caller 一次性全改）。Phase 2 统一删 re-export。

### 2.2 权限 / 存在性探测 → `@main/utils/file/path`

| 函数 | Callers | 目标位置 | 新签名（建议） | Phase | 备注 |
|---|---|---|---|---|---|
| `hasWritePermission(dir)` | 5 | `path.ts` | `canWrite(path): Promise<boolean>` | **1b.1** | 架构 §7 已列 `canWrite` 为 path.ts 原语；改名对齐 |
| `directoryExists(dirPath)` | 2 | `path.ts` | `isDirectory(path): Promise<boolean>` | **1b.1** | `fs.stat` + `.isDirectory()` |
| `fileExists(filePath)` | 3 | `path.ts` | `isFile(path): Promise<boolean>` | **1b.1** | `fs.stat` + `.isFile()` |
| `pathExists(targetPath)` | 5 | `path.ts` | `exists(path): Promise<boolean>` | **1b.1** | `fs.access(R_OK)` |

**合并手法**：同 2.1，Phase 1b.1 引入新名字后，`legacyFile.ts` 保留旧名 re-export 一轮。

### 2.3 文件类型推导 → `packages/shared/file/types/fileType.ts` + `@main/utils/file/metadata`

| 函数 | Callers | 目标位置 | 新签名（建议） | Phase | 备注 |
|---|---|---|---|---|---|
| `getFileType(ext)` | 5 | `packages/shared/file/types/fileType.ts`（**ext 版**）<br>+ `@main/utils/file/metadata.ts`（**path 版**） | `getFileTypeByExt(ext): FileType`（shared）<br>`getFileType(path): Promise<FileType>`（metadata.ts 内部先 `path.extname`，再调 shared 版；OTHER 时 buffer 升级） | **1b.1** | 与 [migration-plan.md §A1-A3](./migration-plan.md) 规划一致：ext 版搬 shared，供 main + renderer 复用；v2 `metadata.ts.getFileType(path)` 取 path，内部派生 ext 调 shared |
| `getFileExt(filePath)` | 2 | **废弃** | 直接用 `path.extname(filePath)` | **2**（consumer 迁移） | 纯 node:path 薄包装，无价值；两处 callers 直接改 |
| `getFileDir(filePath)` | 0 | **删除** | — | Phase 1a 清理 | 无 caller；`path.dirname` 即可 |
| `getFileName(filePath)` | 0 | **删除** | — | Phase 1a 清理 | 无 caller；`path.basename` 即可 |

**合并手法**：Phase 1b.1 在 shared 建 `fileType.ts`；`metadata.ts.getFileType(path)` 正式实现；`legacyFile.getFileType(ext)` 改为 `export { getFileTypeByExt as getFileType } from '@shared/file/types/fileType'` 过渡。`getFileExt` 的两处 callers 直接改成 `path.extname(...)`。`getFileDir` / `getFileName` 本 PR（Phase 1a 尾声）就可以删掉。

### 2.4 文件名合法化 → `packages/shared/file/types/filename.ts`

| 函数 | Callers | 目标位置 | 新签名（建议） | Phase | 备注 |
|---|---|---|---|---|---|
| `sanitizeFilename(fileName, replacement)` | 6 | `packages/shared/file/types/filename.ts` | 同名 | **1b.1** | 纯 string op；main + renderer 都用；搬 shared |
| `validateFileName(fileName, platform)` | 0 | `packages/shared/file/types/filename.ts` | 同名 | **1b.1** | 同上；虽无直接 caller，被 `checkName` 调用 |
| `checkName(fileName)` | 1 | `packages/shared/file/types/filename.ts` | 同名 | **1b.1** | Notes 域在用；放 shared 更恰当（renderer 也可能用） |

**合并手法**：Phase 1b.1 在 shared 建 `filename.ts`，搬入三个函数；`legacyFile.ts` 保留 re-export 过渡。

### 2.5 FS 内容读写 → `@main/utils/file/fs` + FileManager

| 函数 | Callers | 目标位置 | 新签名（建议） | Phase | 备注 |
|---|---|---|---|---|---|
| `readTextFileWithAutoEncoding(filePath)` | 5 | `@main/utils/file/fs.read(path, { encoding: 'text', detectEncoding: true })` | 已在 `fs.ts` 签名中（`read` overload） | **1b.1** | `fs.read` overload 1 就是这个：`read(path, { encoding?: 'text', detectEncoding?: boolean })`。把 chardet + iconv-lite 逻辑在 1b.1 实现 `fs.read` 时一起落 |
| `writeWithLock(filePath, data, options)` | 1 | **被 `fs.atomicWriteFile(path, data)` 取代** | — | **1b.2** | v2 设计明确用 tmp+rename 替代锁文件方案（架构 §5.3、fs-usage-audit §关键发现-5）。单 caller 在 1b.2 改用 `atomicWriteFile`；`legacyFile.writeWithLock` 整个删除 |
| `base64Image(file: FileMetadata)` | 8 | **被 `FileManager.read(entryId, { encoding: 'base64' })` 取代** | — | **Phase 2**（consumer 迁移） | 架构 §3.3 `read` IPC 的 base64 overload 返回 `{ data, mime }`；`base64Image` 等于这个能力的 v1 早期实现。8 个 callers 随消费者迁移（FileMetadata → FileEntryId）一起改 |
| `getAllFiles(dirPath)` | 2 | **被 `listDirectory` + FileManager 组合取代** | — | **Phase 2**（consumer 迁移） | 返回 v1 `FileMetadata[]` 含 uuid 生成——v2 下不应再生成游离 uuid，要么业务明确调 `ensureExternalEntry` 产生 FileEntry，要么只需要 `listDirectory(dirPath)` 获取路径列表 + 按需 `FileManager.getMetadata`。两个 callers 拆两套用法 |

**合并手法**：
- `readTextFileWithAutoEncoding` 是 v2 `fs.read` 的已声明 overload，Phase 1b.1 实现 `fs.read` 时一起落；`legacyFile` 留 re-export 到 Phase 2。
- `writeWithLock`、`base64Image`、`getAllFiles` 属于**语义被新 API 整体替代**的情况，不是简单搬家。按 caller 迁移节奏在 Phase 1b.2 / Phase 2 分别处理。

### 2.6 Notes 域函数 → `src/main/services/notes/`（out of file-module）

| 函数 | Callers | 目标位置 | 新签名（建议） | Phase | 备注 |
|---|---|---|---|---|---|
| `scanDir(dirPath, depth, basePath)` | 1 | `src/main/services/notes/`（未来 NotesService 内部） | 保留或重构成 NotesService 方法 | **NotesService 落地 phase** | 返回 `NotesTreeNode[]`——Notes 域类型；RFC §1.3 明确 Notes 树不在 file-module 范围 |
| `getName(baseDir, fileName, isFile)` | 5 | `src/main/services/notes/` | Notes 域内部 helper | **NotesService 落地 phase** | 强耦合 `.md` 扩展名 + 递增编号——是 Notes 独有的命名策略，不是通用 filename 工具 |

**合并手法**：这两个函数随 NotesService 迁移一起移出。Phase 1b 期间可先原地保留，Phase 2 之后随 Notes 改造搬家。

### 2.7 汇总表：legacyFile.ts 20 个导出的去向

| 目标桶 | 函数数量 | 函数 |
|---|---|---|
| `@main/utils/file/path` | 7 | `resolveAndValidatePath` / `untildify` / `isPathInside` / `hasWritePermission`→`canWrite` / `directoryExists`→`isDirectory` / `fileExists`→`isFile` / `pathExists`→`exists` |
| `@main/utils/file/metadata` + shared `fileType.ts` | 1 | `getFileType(ext)` 拆成 shared 的 ext 版 + metadata.ts 的 path 版 |
| shared `filename.ts` | 3 | `sanitizeFilename` / `validateFileName` / `checkName` |
| `@main/utils/file/fs.read` overload | 1 | `readTextFileWithAutoEncoding` |
| **被新 API 语义取代**（无 1:1 映射） | 3 | `writeWithLock` → `atomicWriteFile`；`base64Image` → `FileManager.read({encoding:'base64'})`；`getAllFiles` → `listDirectory` + FileManager 组合 |
| Notes 域（移出 file-module） | 2 | `scanDir` / `getName` |
| 直接删（无 caller 或纯包装） | 3 | `getFileDir` / `getFileName` / `getFileExt` |
| **合计** | 20 | |

---

## 三、`fileOperations.ts` 函数分派

3 个导出，全部外部 caller：

| 函数 | Callers（去重） | 目标位置 | 新签名（建议） | Phase | 备注 |
|---|---|---|---|---|---|
| `copyDirectoryRecursive(source, destination, opts)` | `SkillInstaller.ts` | `@main/utils/file/fs` | `copyDir(src, dest, opts?): Promise<void>` | **1b.2** | 现有实现含 `allowedBasePath` 守卫、`MAX_RECURSION_DEPTH=1000` 防栈溢出、skip symlink、race-condition ENOENT 容忍——**这些安全特性要在合并时保留**。与 `fs.copy(src, dest)`（单文件版）并列导出；不建议把目录语义塞进 `copy` 做 overload |
| `deleteDirectoryRecursive(dirPath, opts)` | `SkillInstaller.ts`, `SkillService.ts` | `@main/utils/file/fs` | `removeDir(path, opts?): Promise<void>` | **1b.2** | `fs.ts` 已有 `removeDir` 的 stub 签名；合并时把 `allowedBasePath` 守卫保留下来 |
| `getDirectorySize(dirPath, opts)` | `markdownParser.ts` | `@main/utils/file/metadata` | `getDirectorySize(path, opts?): Promise<number>` | **1b.1 或 1b.2** | 纯统计类（递归 `lstat + size`）；放 `metadata.ts`（因为是派生元数据）或 `fs.ts`（因为是目录遍历）都合理。**建议：`metadata.ts`**——与 `getFileType(path)` 的"查询派生信息"语义一致 |

**安全特性保留清单**（合并时不能丢）：

1. `allowedBasePath` 白名单——所有 src/dest/delete target 必须在此目录内，防越界操作
2. `MAX_RECURSION_DEPTH = 1000`——防栈溢出攻击
3. `lstat` 检测并跳过 symlink——防 TOCTOU + 防跟随外部链接
4. `copyFile + chmod` 保留权限位
5. 递归拷贝中 `ENOENT` 容忍（文件在拷贝过程中消失不中断整体流程）
6. 特殊文件（pipe/socket/device）跳过

**合并手法**：Phase 1b.2 实现 `fs.copy` / `fs.removeDir`（文件版、目录版并列导出）时，把 `fileOperations.ts` 的三个函数带安全特性一起落进 `fs.ts` / `metadata.ts`。`fileOperations.ts` 整个文件删除；3 个业务 caller + 2 个测试 mock 改导入路径。

### 中间过渡步骤（可选，本 PR 即可做）

在 Phase 1b.2 真正合并之前，可以先做**纯搬家**：`git mv src/main/utils/fileOperations.ts → src/main/utils/file/fileOperations.ts`，内容不动，仅改 5 处 import（3 业务 + 2 测试 mock）。好处：

- `utils/file/` 目录的"文件类 helper"全部到齐（`legacyFile.ts` + `fileOperations.ts` 并列）
- 和 Phase 1a 搬 `legacyFile.ts` 的动作一致，结构完整性强
- Phase 1b.2 只需关心"合并进 fs.ts / metadata.ts"的语义合并，无需再改导入路径

---

## 四、按 Phase 汇总的落地清单

### Phase 1a（当前 PR，收尾前可选）

- [x] `git mv src/main/utils/file.ts → src/main/utils/file/legacyFile.ts`（已完成）
- [x] `src/main/utils/file/index.ts` barrel re-export `./legacyFile`（已完成）
- [ ] （可选纯搬家）`git mv src/main/utils/fileOperations.ts → src/main/utils/file/fileOperations.ts`，更新 5 处 import
- [ ] 删除无 caller 的 `getFileDir` / `getFileName`（两处）

### Phase 1b.1（读路径 runtime）

- [ ] `path.ts` 内联实现 `resolveAndValidatePath` / `untildify` / `isPathInside` / `canWrite`（原 `hasWritePermission`）/ `isDirectory` / `isFile` / `exists`
- [ ] `packages/shared/file/types/fileType.ts` 新建，搬 `getFileType(ext)` + `fileTypeMap`（迁移 5 处 `getFileType` caller 指向 main 或 shared，按所在进程选）
- [ ] `packages/shared/file/types/filename.ts` 新建，搬 `sanitizeFilename` / `validateFileName` / `checkName`
- [ ] `metadata.ts` 实现 `getFileType(path)`：内部 `path.extname` + 调 shared 的 ext 版；OTHER 时 buffer 升级（`chardet` + `isbinaryfile`）
- [ ] `fs.ts` 实现 `read` 的 text overload（含 `detectEncoding: true`），语义等同 `readTextFileWithAutoEncoding`
- [ ] `legacyFile.ts` 内部改为对上述新位置的 re-export，保持 `@main/utils/file` 旧 import 不破
- [ ] （可选）`metadata.ts` 实现 `getDirectorySize(path)`，如果选在 1b.1 做

### Phase 1b.2（写路径 + 生命周期）

- [ ] `fs.ts` 实现 `atomicWriteFile` / `atomicWriteIfUnchanged`；`writeWithLock` 的唯一 caller 迁移到 `atomicWriteFile`；`legacyFile.writeWithLock` 删除
- [ ] `fs.ts` 实现 `copy(src, dest)`（单文件）和 `copyDir(src, dest, opts?)`（带 `allowedBasePath` / `MAX_RECURSION_DEPTH` / symlink skip 等安全特性）
- [ ] `fs.ts` 实现 `remove` / `removeDir(opts?)`（保留 `allowedBasePath` 守卫）
- [ ] `SkillInstaller.ts` / `SkillService.ts` / `markdownParser.ts` 改 import 至 `@main/utils/file/fs` / `@main/utils/file/metadata`
- [ ] `fileOperations.ts` 整文件删除
- [ ] （可选）`metadata.ts` 实现 `getDirectorySize(path)`，如果 1b.1 没做则 1b.2 做

### Phase 2（consumer 迁移期）

- [ ] `base64Image` 的 8 处 caller 迁移到 `FileManager.read(entryId, { encoding: 'base64' })`；`legacyFile.base64Image` 删除
- [ ] `getAllFiles` 的 2 处 caller 拆用法：仅需路径列表的改用 `listDirectory`；需要 FileEntry 的改走 `ensureExternalEntry` 批量创建；`legacyFile.getAllFiles` 删除
- [ ] `getFileExt` 的 2 处 caller 改成 `path.extname(...)`，`legacyFile.getFileExt` 删除
- [ ] `legacyFile.ts` 内残留的 re-export 全部删完后，`legacyFile.ts` 整文件删除（`utils/file/index.ts` barrel 在此时也可以从"re-export legacy"演进为"re-export v2 surface"）

### NotesService 落地 phase（file-module 之外）

- [ ] `scanDir` / `getName` 移出 `legacyFile.ts`，并入 `src/main/services/notes/`
- [ ] Notes 域的 `checkName` 使用改指 shared 的 `filename.ts`

---

## 五、设计决策备忘

### 5.1 为什么 `getFileType` 要拆成 ext 版 + path 版

- **ext 版**是纯映射（`.md` → `'text'`），同构于 renderer 的需求（拖拽预判 / 附件分类）；不能要求 renderer 把路径送过 IPC 才能知道一个文件是不是图片
- **path 版**是 ext 版 + buffer 升级：当 ext 不在映射表（`FILE_TYPE.OTHER`）且 `isbinaryfile` 判定为文本时升格为 `FILE_TYPE.TEXT`；属于 main-only 能力（要读 buffer）
- 两者共用 `fileTypeMap`，但调用语义不同——分两个函数反而是清晰设计，而不是"一个带 overload 的通用函数"

### 5.2 为什么 `writeWithLock` 要整体换掉而非搬家

v2 主进程是单进程单实例（`requireSingleInstance`），根本不需要跨进程文件锁；锁文件机制是 v1 早期遗留。v2 统一用 `atomicWriteFile`（tmp + rename + fsync）——这既是架构 §5.3 的明确结论，也是 [fs-usage-audit §关键发现-5](./fs-usage-audit.md) 指出的"原子写入不统一"问题的解法。

### 5.3 为什么 `base64Image` 要整体换掉而非搬家

- 输入类型是 v1 `FileMetadata`；v2 下整块废弃，新签名接 `FileEntryId`
- 物理路径由 `application.getPath('feature.files.data', ...)` 拼接——这是 `resolvePhysicalPath` 的职责，不应在工具函数里重复
- 功能完全可由 `FileManager.read(entryId, { encoding: 'base64' })` 覆盖（架构 §3.3 已定义该 overload）

### 5.4 为什么 `getAllFiles` 无 1:1 替代

内部做了三件不相关的事：

1. 递归列目录（→ `listDirectory`）
2. 按 ext 过滤类型（→ `metadata.getFileType(path)`）
3. **给每个文件生成一个游离的 `FileMetadata`（含 `uuidv4()`）**

第三点是 v1 特有——v2 里 uuid 只在 `createInternalEntry` 内部生成，不能让工具函数产出"悬空 uuid"。所以 Phase 2 caller 迁移时要**按场景拆**：

- 需要路径和类型的：`listDirectory` + `metadata.getFileType`
- 需要 FileEntry 的：`ensureExternalEntry` 批量 upsert（目录内每个文件产一行 file_entry）

### 5.5 Notes 函数为什么 out of scope

RFC §1.3 明确："Notes file tree（files browsed/edited inside the Notes app）由 Notes module（FS-first）拥有；文件树不整体映射进 FileEntry"。`scanDir` 返回 `NotesTreeNode`，`getName` 基于 `.md` 硬编码——它们是 Notes 业务逻辑，不是通用文件工具。搬到 `src/main/services/notes/` 才是正确归属。

---

## 六、未决事项（需要 reviewer 定的）

1. **`getDirectorySize` 放 `metadata.ts` 还是 `fs.ts`？**
   - metadata.ts 派：它是"关于文件集合的元数据"，和 `getFileType` 性质接近
   - fs.ts 派：它内部是目录遍历 + lstat，和 `copyDir` / `removeDir` 放一起更对称
   - 本文倾向 metadata.ts，但无强理由排除 fs.ts
2. **`legacyFile.ts` 过渡 re-export 的生命周期是否设硬截止？**
   - 一种方案：Phase 1b.1 引入新位置时，旧名字就标 `@deprecated`，Phase 2 前强制迁移完毕
   - 另一种：自然枯萎——只要还有 caller 就不删，rely on periodic grep
   - 本文默认后者，但如果 reviewer 倾向前者，在 Phase 1b.1 PR 描述里加硬截止日期即可
3. **Shared `fileType.ts` / `filename.ts` 文件名是否恰当？**
   - migration-plan §A1 建议的是 `packages/shared/file/types/fileType.ts`
   - 目前 `packages/shared/file/types/` 下已有 `handle.ts` / `info.ts` / `ipc.ts`——命名风格是"结构/形状" 而非"操作"
   - `fileType.ts`（一个 enum + 映射表）和 `filename.ts`（validate / sanitize 函数）偏行为，放 `packages/shared/file/utils/` 可能更对口——但会和现有 `types/` 目录分裂
   - 本文默认沿用 migration-plan 的 `types/` 归档，但欢迎 reviewer 改 `utils/` 分离
