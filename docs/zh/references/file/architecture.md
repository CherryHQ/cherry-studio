# File Module Architecture

> **本文档是文件模块的架构 Source of Truth**，聚焦模块边界、组件职责、IPC 设计与服务集成。
>
> 相关文档：
>
> - `docs/zh/references/file/file-manager-architecture.md` — FileManager 子模块设计（条目模型、存储架构、同步、回收站、引用清理）
> - `v2-refactor-temp/docs/file-manager/rfc-file-manager.md` — 实现设计文档（数据模型、Schema、API 细节、迁移策略）
> - `v2-refactor-temp/docs/file-manager/ipc-redesign.md` — IPC 方法从 v1 到 v2 的迁移映射
> - `v2-refactor-temp/docs/file-manager/handler-mapping.md` — IPC handler 到 FileManager/ops.ts 的分派映射

---

## 1. 模块范围

### 1.1 File Module 包含

```
File Module (src/main/file/)
├── FileManager (唯一 lifecycle service)
│     ├── entry 管理 (create / trash / restore / move / copy / permanentDelete)
│     ├── registerIpcHandlers() — 统一 IPC 入口, handler 层分派
│     ├── Electron dialog (showOpenDialog / showSaveDialog)
│     └── ExternalSyncEngine (chokidar watching, 内部子模块)
└── ops/ (纯函数, sole fs owner, 统一从 index.ts 导出)
      ├── fs.ts       — 基础 FS: read / write / stat / copy / move / remove
      ├── shell.ts    — 系统操作: open / showInFolder
      ├── path.ts     — 路径工具: resolvePath / isPathInside / canWrite / isNotEmptyDir
      ├── metadata.ts — 类型检测: getFileType / isTextFile / mimeToExt
      └── search.ts   — 目录搜索: listDirectory (ripgrep + 模糊匹配)

Data Module 依赖 (src/main/data/)
├── FileTreeService (data repository, 纯 DB) — file_entry 表
├── FileRefService (data repository, 纯 DB) — file_ref 表
└── DataApi Handler (files.ts) — 无 fs 副作用端点
```

### 1.2 FileManager 在模块中的定位

FileManager 是 file module 的核心子模块，但不等于 file module 本身。

- **FileManager** 是 entry 管理系统——负责 FileEntry 的完整生命周期（创建、移动、删除、回收站、恢复），以及 entry 与物理文件之间的协调。它的 public API 只认 `FileEntryId`
- **ops.ts** 与 FileManager 平级——提供不依赖 entry 系统的纯 FS/路径操作。其他 main process service 可以直接调用 ops.ts，不需要经过 FileManager
- **IPC 统管** 是 FileManager 的额外职责（因为它是模块内唯一的 lifecycle service），不代表所有 IPC 操作都是 entry 操作

FileManager 的详细设计（条目模型、存储架构、同步机制、回收站、引用清理）见 [FileManager Architecture](./file-manager-architecture.md)。

### 1.3 不在范围内

以下文件类型**不由** File Module 管理：

- 知识库向量索引文件（由 KnowledgeService 自行管理）
- MCP 服务器配置文件
- 应用配置文件（Preference / BootConfig）
- 日志文件
- 备份 / 导出文件

---

## 2. IPC 设计

### 2.1 设计动机

Renderer 需要统一的文件操作入口（一个 `read` 既能读 entry 也能读外部路径），但 main process 内部 entry 管理（DB + FS 协调）和纯路径操作（直接 FS）是两种完全不同的职责。既要统一调用又要关注点分离，直接实现是矛盾的。

解法：**统一调用入口 + handler 层分派**。FileManager 作为唯一 lifecycle service 统管所有 IPC handler 注册，handler 内部按 target 类型分派到不同实现。

**Tradeoff**：纯路径操作（`canWrite`、`resolvePath` 等）也交由 entry + FS 协调层管理，FileManager 承担了超出 entry 管理的 IPC 注册职责。但 handler 层只是 thin routing，其 public 方法签名仍然只认 FileEntryId，纯 path 操作不污染 public API。相比引入第二个 lifecycle service，这个代价更小。

### 2.2 Handler 分派

```
Renderer
  → FileManager.registerIpcHandlers() (统一入口)
    ├── target: FileEntryId → FileManager 方法 (entry 协调: resolve → DB + FS)
    └── target: FilePath    → ops.ts (直接 FS/路径操作)
```

Main process 其他 service 可根据实际需求直接调用 ops.ts 或 FileManager，不需要经过 IPC。

### 2.3 IPC 方法按操作类型分类

**纯 Entry 操作** → FileManager 方法：

| 方法                 | 说明                                  |
| -------------------- | ------------------------------------- |
| `createEntry`        | FS 写入 + 创建条目（按 providerType） |
| `batchCreateEntries` | 事务包裹                              |
| `trash` / `restore`  | Trash 逻辑（按 providerType）         |
| `permanentDelete`    | 删物理文件 + 删条目                   |
| `move` / `copy`      | FS 移动/复制 + 更新条目               |
| `batch*`             | 逐项执行条目操作                      |

**纯 Path 操作** → ops.ts：

| 方法                | 说明                      |
| ------------------- | ------------------------- |
| `select`            | Electron dialog，返回路径 |
| `save`              | dialog 选路径 → 写文件    |
| `listDirectory`     | 列出外部目录内容          |
| `validateNotesPath` | 校验路径合法性            |
| `canWrite`          | 路径权限检测              |
| `resolvePath`       | `~` 展开 + resolve        |
| `isPathInside`      | 路径包含关系判断          |
| `isNotEmptyDir`     | 目录非空检测              |

**双态方法** → handler 按 target 类型分派：

| 方法           | FileEntryId →                                 | FilePath →             |
| -------------- | --------------------------------------------- | ---------------------- |
| `read`         | FileManager.read（resolve + ops.read）        | ops.read               |
| `write`        | FileManager.write（resolve + ops.write）      | ops.write              |
| `getMetadata`  | FileManager.getMetadata（resolve + ops.stat） | ops.stat + getFileType |
| `open`         | FileManager.open（resolve + ops.open）        | ops.open               |
| `showInFolder` | FileManager.showInFolder（resolve）           | ops.showInFolder       |

---

## 3. 分层架构

### 3.1 无 FS 副作用路径（DataApi）

FileTreeService / FileRefService 是 `src/main/data/services/` 下的 data repository，遵循项目现有的 DataApi 分层模式（详见 [DataApi in Main](../../en/references/data/data-api-in-main.md)）。它们**不是独立的 lifecycle service**，而是通过 DataApiService 桥接暴露给 Renderer。

DataApi 暴露的端点涵盖查询和**无 FS 副作用的写操作**（如纯元数据更新）：

```
Renderer                              Main
+------------------+           +---------------------------------+
| useQuery()       |           | DataApiService (bridge)         |
| useMutation()    |--DataApi--+   |                             |
| (React hooks)    |           |   v                             |
+------------------+           | Handler (files.ts)              |
                               |   |                             |
                               |   v                             |
                               | FileTreeService (repository)    |
                               | FileRefService  (repository)    |
                               |   |                             |
                               |   v                             |
                               | DB (fileEntryTable/fileRefTable)|
                               +---------------------------------+
```

Main 进程内部的 service 可以直接 import 调用 data repository，不需要经过 DataApi handler。

DataApi 端点：

| 端点                          | 方法  | 用途                                               |
| ----------------------------- | ----- | -------------------------------------------------- |
| `/files/entries`              | GET   | 条目列表（支持 mountId / parentId / inTrash 过滤） |
| `/files/entries/:id`          | GET   | 单条目查询                                         |
| `/files/entries/:id/children` | GET   | 子条目（文件树懒加载，支持排序分页）               |
| `/files/entries/:id/refs`     | GET   | 文件的所有引用方                                   |
| `/files/refs/by-source`       | GET   | 业务对象引用的所有文件                             |
| `/files/mounts`               | GET   | 挂载点列表                                         |

> **判定标准**：DataApi 只暴露无 FS 副作用的操作。有 FS 副作用的写操作（create / rename / delete / move 等）走 File IPC。

### 3.2 有 FS 副作用路径（File IPC）

所有涉及 FS 的操作走专用 IPC 通道，**不走 DataApi**。v1 的 52 个文件相关 IPC 合并为 v2 的 22 个方法（详见 `ipc-redesign.md`）。

```
Renderer                          Main
+---------------+           +--------------------------------------+
| window.api    |           | FileManager (lifecycle service)      |
| .fileManager  |---IPC---->|   |                                  |
| .createEntry()|           |   +-- entry ops ----+                |
| .read()       |           |   |  (resolve entryId → filePath,    |
| .trash()      |           |   |   coordinate DB via repository   |
| .select()     |           |   |   + ops.ts pure functions)       |
| .open()  ...  |           |   |                                  |
|               |           |   +-- path ops ---> ops.ts           |
|               |           |   |                 (sole FS owner)  |
|               |           |   +-- dialog -----> Electron dialog  |
+---------------+           +--------------------------------------+
```

### 3.3 FS 交互的层级归属

```
+-------------------------------------------------------------------------+
| FileManager  *** THE ONE LIFECYCLE SERVICE ***                          |
| (Lifecycle Service, WhenReady phase)                                    |
|                                                                         |
| Role: IPC handler registration, entry coordination, dialog,             |
|       external sync (chokidar watching as internal submodule)           |
| FS:   none -- delegates ALL FS operations to ops.ts                     |
| DB:   delegates to FileTreeService / FileRefService (repository)        |
|       maintains in-memory path cache                                    |
|       owns OperationLock for chokidar sync coordination                 |
| Own:  Electron dialog API (showOpenDialog/showSaveDialog)               |
+-------------------------------------------------------------------------+
| ops/ (pure functions)  *** SOLE FS OWNER ***                            |
| (NOT a class/service — stateless exported functions, barrel export)     |
|                                                                         |
| Role: the ONLY module that imports and calls `fs` / `shell`             |
| FS:   all FS ops -- pure path-based, no entry/DB awareness              |
|   fs.ts       -- read / write / stat / copy / move / remove             |
|   shell.ts    -- open / showInFolder                                    |
|   path.ts     -- resolvePath / isPathInside / canWrite / isNotEmptyDir  |
|   metadata.ts -- getFileType / isTextFile / mimeToExt                   |
|   search.ts   -- listDirectory (ripgrep + fuzzy matching)               |
| DB:   none -- only knows about file paths, not entries                  |
| Lifecycle: none -- pure functions, no initialization needed             |
+-------------------------------------------------------------------------+
| FileTreeService  (data repository, not lifecycle)                       |
|                                                                         |
| Role: entry CRUD, tree queries, path resolution                         |
| FS:   none (pure DB)                                                    |
| DB:   fileEntryTable read/write, tree traversal (children, ancestors)   |
| Note: exposed to Renderer via DataApiService bridge (no FS side effect) |
+-------------------------------------------------------------------------+
| FileRefService  (data repository, not lifecycle)                        |
|                                                                         |
| Role: ref CRUD, cleanup by source, batch cleanup                        |
| FS:   none (DB only)                                                    |
| Note: exposed to Renderer via DataApiService bridge (no FS side effect) |
+-------------------------------------------------------------------------+
| DataApi Handler                                                         |
|                                                                         |
| Role: DB endpoints (no FS side effect)                                  |
| FS:   none                                                              |
+-------------------------------------------------------------------------+
```

### 3.4 职责边界总结

| 层                  | 类型            | 碰 DB           | 碰 FS                   | 碰 Electron API           | 暴露给 Renderer    |
| ------------------- | --------------- | --------------- | ----------------------- | ------------------------- | ------------------ |
| **FileManager**     | lifecycle       | 通过 repository | **否（通过 ops.ts）**   | dialog + shell            | 是（IPC）          |
| **ops.ts**          | pure functions  | 否              | **是（唯一 FS owner）** | shell (open/showInFolder) | 否                 |
| **FileTreeService** | data repository | 是（直接）      | 否（纯 DB）             | 否                        | 是（通过 DataApi） |
| **FileRefService**  | data repository | 是（直接）      | 否（纯 DB）             | 否                        | 是（通过 DataApi） |
| **DataApi Handler** | data layer      | 调用 repository | 否                      | 否                        | 是（DataApi 桥接） |

**核心原则**：

- **ops.ts 是唯一直接 `import node:fs` 的模块**——所有 FS 操作经过它。chokidar 作为第三方事件库不在此约束内，但 FileManager 内部 sync 逻辑需要的 FS 操作仍通过 ops.ts 执行
- **FileManager 是唯一的 lifecycle service**——注册 IPC handler，解析 entryId → filePath，协调 DB（通过 repository）+ FS（通过 ops.ts），管理 chokidar watching
- **Renderer 永远不直接操作 FS**，所有 FS 操作通过 IPC 委托给 Main

---

## 4. 业务服务集成

### 4.1 交互全景

```
+- Renderer --------------------------------------------------------+
|                                                                   |
|  useQuery('/files/...')        window.api.file.xxx()              |
|           |                                    |                  |
+-----------|------------------------------------|------------------+
            | DataApi (no fs side effect)        | IPC (read/write)
            |                                    |
+===========|====================================|==================+
|  Main     |                                    |                  |
|  Process  v                                    v                  |
|                                                                   |
|  Lifecycle Service                                                |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|                                                                   |
|  +-----------------------------------------------------------+    |
|  | FileManager  *** THE ONE LIFECYCLE SERVICE ***            |    |
|  |                                                           |    |
|  |  -- IPC handler registration --                           |    |
|  |  (via this.ipcHandle(), auto-cleaned on stop)             |    |
|  |  dispatch by target type:                                 |    |
|  |    FileEntryId -> entry methods                           |    |
|  |    FilePath    -> ops.ts direct delegation                |    |
|  |                                                           |    |
|  |  -- entry ops --                                          |    |
|  |  create / trash / restore / move                          |    |
|  |  permanentDelete / copy                                   |    |
|  |  readFile / writeFile / resolvePhysicalPath               |    |
|  |                                                           |    |
|  |  -- Electron dialog --                                    |    |
|  |  showOpenDialog / showSaveDialog                          |    |
|  |                                                           |    |
|  |  OperationLock (sync)                                     |    |
|  |  path cache: Map<entryId, absolutePath>                   |    |
|  |                                                           |    |
|  |  +----------------------------------------------------+   |    |
|  |  | ExternalSyncEngine (internal submodule)            |   |    |
|  |  | chokidar watching for local_external mounts        |   |    |
|  |  | respects OperationLock to skip self-initiated ops  |   |    |
|  |  +----------------------------------------------------+   |    |
|  +---------------------+-------------------------------------+    |
|                        |                                          |
|             all FS ops v                                          |
|  +-----------------------------------------------------------+    |
|  | ops.ts  *** SOLE FS OWNER (pure functions) ***            |    |
|  |                                                           |    |
|  |  read / write / stat / rename / unlink / copy             |    |
|  |  open / showInFolder / listDirectory                      |    |
|  |  canWrite / resolvePath / isPathInside / isNotEmptyDir    |    |
|  |  validateNotesPath / save                                 |    |
|  |                                                           |    |
|  |  stateless, pure path-based, no entry/DB awareness        |    |
|  +-----------------------------------------------------------+    |
|                       |                                           |
|  Data Repositories (via DataApiService bridge to Renderer)        |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|                       |                                           |
|  +--------------------+--------------------------------------+    |
|  | FileTreeService (data repository, DB only)                |    |
|  |  getById / getChildren / list / create                    |    |
|  |  update / delete / getMounts                              |    |
|  +-----------------------------------------------------------+    |
|  +-----------------------------------------------------------+    |
|  | FileRefService (data repository, DB only)                 |    |
|  |  create / cleanup / cleanupBySource                       |    |
|  +-----------------------------------------------------------+    |
|                       |                                           |
|  . . . . . . . . . .  | . . . . . . . . . . . . . . . . . . . . . |
|  Business Services    |                                           |
|                       |                                           |
|  +---------------+ +--+------------+ +-----------------+          |
|  | MessageService| | KnowledgeServ.| | PaintingService |          |
|  +---+---+---+---+ +----+---+---+--+ +---+---+-----+---+          |
|      |   |   |          |   |   |        |   |     |              |
|    read ref readFile  read ref readFile read ref  readFile        |
|    entry write resolve entry write resolve entry write resolve    |
|      |   |   |          |   |   |        |   |     |              |
|      v   v   v          v   v   v        v   v     v              |
|  FileTree FileRef FileManager  (same pattern for all)             |
|  Reader   Service (coordination → ops.ts)                         |
|  (read)   (read+write)                                            |
|                                                                   |
|  . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .  |
|  Background Services                                              |
|                                                                   |
|  +---------------------------------------------------------+      |
|  | OrphanRefScanner (Background phase)                     |      |
|  |  checkers: Record<FileRefSourceType, SourceTypeChecker> |      |
|  |  (compile-time enforced, covers all sourceTypes)        |      |
|  +---------------------------------------------------------+      |
+===================================================================+
```

**关键数据流**：

- **Renderer → Main（读取）**：DataApi → Handler → FileTreeService → DB
- **Renderer → Main（写操作）**：IPC → FileManager（协调 DB + ops.ts）
- **业务 Service → 文件数据**：纯 DB 操作直接调 data repository，涉及 FS 的操作走 FileManager
- **外部文件系统 → Main**：chokidar → FileManager 内部同步引擎 → ops.ts + FileTreeService

### 4.2 业务服务的接触点

业务服务通过两个途径与文件模块交互：

- **无 FS 副作用的操作**（条目查询、纯元数据更新、引用管理）→ 直接 import data repository（`fileTreeSafe` / `fileRefService`）
- **涉及 FS 的操作**（读写文件内容）→ **FileManager**

#### (1) 创建业务时 —— 创建 FileRef

业务操作产生文件引用时，直接调用 `fileRefService.create()`。Renderer 不直接创建 ref。

| 业务场景         | sourceType       | role         | 触发时机                    |
| ---------------- | ---------------- | ------------ | --------------------------- |
| 发送带附件的消息 | `chat_message`   | `attachment` | MessageService 创建消息时   |
| 添加文件到知识库 | `knowledge_item` | `source`     | KnowledgeService 添加条目时 |
| AI 生图保存      | `painting`       | `asset`      | PaintingService 保存结果时  |
| 粘贴临时文件     | `temp_session`   | `pending`    | PasteService 落盘时         |

#### (2) 删除业务时 —— 清理 FileRef

业务对象被删除时，**必须**主动清理关联的 file_ref：

| 删除场景       | 清理调用                                                         |
| -------------- | ---------------------------------------------------------------- |
| 删除消息       | `fileRefService.cleanupBySource('chat_message', messageId)`      |
| 删除 topic     | 先查出 messageIds → `fileRefService.cleanupBySourceBatch(...)`   |
| 删除知识库     | `fileRefService.cleanupBySourceBatch('knowledge_item', itemIds)` |
| 删除知识库条目 | `fileRefService.cleanupBySource('knowledge_item', itemId)`       |

#### (3) 业务服务访问文件的方式

```
BusinessService
    |
    +-- direct import (no FS side effect)
    |   +-- fileTreeSafe.getById(entryId)         -> FileEntry
    |   +-- fileTreeSafe.getChildren(parentId)    -> FileEntry[]
    |   +-- fileTreeSafe.updateMeta(id, { sortOrder }) -> void  (pure DB, no FS)
    |   +-- fileRefService.create(dto)            -> FileRef
    |   +-- fileRefService.cleanupBySource(...)   -> void
    |
    +-- via FileManager (has FS side effect, calls ops.ts internally)
    |   +-- readFile(entryId, opts?)              -> string | Uint8Array
    |   +-- writeFile(entryId, data)              -> void
    |   +-- resolvePhysicalPath(id)               -> string (for external libs only)
    |
    x-- fs.readFile / writeFile / unlink          -> FORBIDDEN
    x-- ops.ts (direct)                            -> FORBIDDEN (business services must go through FileManager)
    x-- fileTreeService.create / rename / delete  -> FORBIDDEN (has FS side effect, compile error)
```

#### 按 FS 副作用分离接口（编译期强制）

区分标准不是 read/write，而是**是否有 FS 副作用**。纯元数据更新（如 `sortOrder`）是无 FS 副作用的 DB 写操作，业务 Service 可以直接调用。有 FS 副作用的写操作（如 `create`、`rename`、`delete`）必须经过 FileManager 协调。

```typescript
// FileTreeService 按 FS 副作用分离两个类型
export type FileTreeSafe = Pick<
  FileTreeService,
  // reads
  | "getById"
  | "getChildren"
  | "list"
  | "getMounts"
  // pure-DB writes (no FS side effect)
  | "updateMeta"
>;

// full instance — FileManager imports this (has FS-side-effect methods)
export const fileTreeService = FileTreeService.getInstance();
// safe view — business services import this (no FS side effect)
export const fileTreeSafe: FileTreeSafe = fileTreeService;
```

配合 ESLint `no-restricted-imports` 规则：业务 Service 只能 import `fileTreeSafe`，`fileTreeService` 仅 FileManager 可用。

**为什么禁止业务 Service 直接使用 `fs` / `ops.ts`**：

- **路径不透明**：物理路径由 `providerType` 决定，业务服务不应假设路径格式
- **缓存一致性**：FileManager 维护内存路径缓存，绕过它会导致不一致
- **同步引擎冲突**：对 `local_external` mount 直接写入会被 chokidar 捕获为外部变更

**唯一例外**：`resolvePhysicalPath` 返回的路径可以传递给无法接受流式数据的外部库（如 AI SDK 的文件上传 API），但业务服务不应对该路径做任何 FS 操作。

---

## 5. 服务生命周期

### 5.1 启动阶段分配

```
Lifecycle Services:

BeforeReady (parallel with app.whenReady(), no Electron API)
+-- DbService                    -- database connection
+-- FileEntrySeedingService       -- seed system entries
      @DependsOn(DbService)

WhenReady (after app.whenReady(), Electron API available)
+-- FileManager                  -- the ONE lifecycle service:
                                    build path cache, register IPC handlers,
                                    start chokidar watching,
                                    coordinate DB (via repository) + FS (via ops.ts)

Background (fire-and-forget, non-blocking)
+-- OrphanRefScanner             -- delayed 30s, scan orphan refs

Pure Functions (no lifecycle, no initialization):
+-- ops.ts                        -- sole FS owner, stateless pure functions

Data Repositories (not lifecycle, managed by DataApiService):
+-- FileTreeService              -- entry CRUD (pure DB)
+-- FileRefService               -- ref CRUD (pure DB)
```

### 5.2 启动时序

```
                     BeforeReady
                          |
      DbService --> FileEntrySeedingService
          |            (upsert system entries)
          |
     app.whenReady()
          |
          v         WhenReady
     FileManager
     (1. build path cache)
     (2. register IPC handlers)
     (3. start chokidar watching)
          |
     onAllReady()
          |
OrphanRefScanner.start()
(delayed 30s, background scan)
```

### 5.3 业务服务的依赖声明

```
MessageService
  @DependsOn(FileManager)
  +-- queries/updates entries via fileTreeSafe (no FS side effect)
  +-- creates/cleans refs via fileRefService (pure DB)
  +-- reads file content via FileManager (FS)

KnowledgeService
  @DependsOn(FileManager)
  +-- same pattern as above
```

---

## 6. 文件位置与模块边界

```
src/main/data/                        -- data layer (pure DB)
  services/
    FileTreeService.ts                -- repository: exports fileTreeService + fileTreeSafe
    FileRefService.ts                 -- repository: exports fileRefService
  api/handlers/
    files.ts                          -- DataApi handler, no FS side effect
  db/schemas/
    file.ts                           -- fileEntryTable + fileRefTable
  db/seeding/
    fileEntrySeeding.ts               -- system mount initialization

src/main/file/                        -- file module
  FileManager.ts                      -- the ONE file management lifecycle service
  ops/                                -- pure functions, sole fs owner
    index.ts                          -- barrel export
    fs.ts                             -- read / write / stat / copy / move / remove
    shell.ts                          -- open / showInFolder
    path.ts                           -- resolvePath / isPathInside / canWrite / isNotEmptyDir
    metadata.ts                       -- getFileType / isTextFile / mimeToExt
    search.ts                         -- listDirectory (ripgrep + fuzzy matching)
```

---

## 7. 约束与限制

- **跨 mount 移动不可用**：不同 Provider 的存储模式不兼容
- **`path` 不持久化**：运行时计算，依赖内存缓存
- **FileRef 多态无 FK**：`sourceId` 指向不同业务表，依赖应用层清理 + 孤儿扫描兜底
- **external 模式复杂度**：双向同步需操作锁、chokidar 排除、冲突处理
- **系统条目不可删除**：`mount_files`、`mount_notes`、`system_trash`、`mount_temp` 受保护

---

## 8. 扩展点

| 扩展方向                                 | 接入方式                                            |
| ---------------------------------------- | --------------------------------------------------- |
| 新增远程存储（S3、WebDAV、Google Drive） | 新增 `RemoteProvider` 实现，核心 Schema 不变        |
| 新增业务引用来源                         | 新增 `sourceType` 枚举值 + 注册 `SourceTypeChecker` |
| 新增挂载点                               | 创建新 mount 条目 + 配置 `providerConfig`           |
| 笔记体系迁入                             | 通过 `local_external` mount 纳入统一条目表          |
| 对话内复用应用文件                       | 通过 `file_ref` 建立引用关系                        |
