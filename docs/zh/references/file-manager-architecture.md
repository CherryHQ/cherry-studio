# File Manager Architecture

> **本文档是文件管理系统的架构 Source of Truth**，聚焦系统边界、组件职责、数据流与关键设计决策。架构决策以本文档为准。
>
> 相关文档：
> - `v2-refactor-temp/docs/file-manager/rfc-file-manager.md` — 实现设计文档（数据模型、Schema、API 细节、迁移策略、分阶段计划）
> - `v2-refactor-temp/docs/file-manager/ipc-redesign.md` — IPC 方法从 v1 到 v2 的迁移映射

---

## 1. 核心概念

### 1.1 统一条目模型

所有文件系统实体（文件、目录、挂载点）统一表达为**条目（File Entry）**，存储在单一条目表中。

```
FileEntry
├── type: file | dir | mount
├── name: 用户可见名称（不含扩展名）
├── ext: 扩展名（不含前导点），目录/挂载点为 null
├── parentId: 父条目 ID（邻接表模式）
└── mountId: 所属挂载点 ID（冗余字段，避免递归查询）
```

三种条目类型的不变量（Invariants）：

| 类型    | parentId | mountId          | providerConfig | ext         |
| ------- | -------- | ---------------- | -------------- | ----------- |
| `mount` | `null`   | 自身 ID          | 必填           | `null`      |
| `dir`   | 非 null  | 继承自祖先 mount | `null`         | `null`      |
| `file`  | 非 null  | 继承自祖先 mount | `null`         | 通常非 null |

### 1.2 挂载点（Mount）

挂载点是条目树的根，每个挂载点通过 `providerConfig` 定义一种存储模式。挂载点本身也是条目（`type='mount'`），与文件/目录共用同一张表。

### 1.3 引用关系（File Ref）

文件与业务对象之间通过**引用表（file_ref）**建立多态关联：

```
FileRef
├── fileEntryId → 文件条目（FK，CASCADE 删除）
├── sourceType: 业务来源类型（chat_message / knowledge_item / painting / ...）
├── sourceId: 业务对象 ID（多态，无 FK）
└── role: 引用角色（attachment / source / asset / ...）
```

同一文件可被多个业务对象引用，同一业务对象以同一角色引用同一文件至多一条记录（UNIQUE 约束）。

---

## 2. 存储架构

### 2.1 Provider 驱动的双模式存储

不同类型的文件有不同的存储需求，通过 Provider 模式统一抽象：

| Provider 类型     | Source of Truth | 物理文件名               | 典型用途                    |
| ----------------- | --------------- | ------------------------ | --------------------------- |
| `local_managed`   | DB              | `{id}.{ext}`             | 应用托管文件（附件、上传）  |
| `local_external`  | 文件系统        | `{name}.{ext}`           | 笔记（支持外部编辑器）      |
| `system`          | DB              | 无自有存储               | 回收站                      |
| `remote` _(未来)_ | 远程 API        | `{cachePath}/{remoteId}` | 远程文件（OpenAI Files 等） |

### 2.2 系统预置挂载点

```
(root)
├── mount_files     [local_managed]   ── 应用托管文件
├── mount_notes     [local_external]  ── 笔记文件
├── mount_temp     [local_managed]   ── 临时文件（粘贴、预览等）
└── system_trash    [system]          ── 回收站
```

所有系统挂载点使用固定 ID，首次启动时幂等创建。

### 2.3 路径计算

物理路径**不持久化**，运行时由挂载点配置 + 树关系动态构建：

- **`local_managed`**: `{mount.basePath}/{entry.id}.{entry.ext}` — 平坦存储，目录仅逻辑存在
- **`local_external`**: `{mount.basePath}/{...ancestorNames}/{entry.name}.{entry.ext}` — 映射 OS 目录树
- **`system`**: 无自有存储，Trash 中的条目使用原 `mountId` 对应的 mount 解析路径

维护内存级路径缓存 `Map<entryId, absolutePath>`，树变更时重建。

### 2.4 物理目录结构

```
{userData}/Data/files/
├── managed/        ── mount_files 存储（UUID 命名的平坦文件）
├── notes/          ── mount_notes 默认路径（用户可自定义）
│   └── .trash/     ── external 模式的物理回收站（隐藏目录）
└── temp/           ── mount_temp 临时文件存储
```

---

## 3. 同步机制

### 3.1 local_managed — 无需同步

DB 是唯一的 Source of Truth，物理文件由应用完全管控。

### 3.2 local_external — 双向同步

文件系统为 Source of Truth，条目表作为索引层：

```
                  +--------------------+
                  |  File System (SoT) |
                  +---------+----------+
                            |
             +--------------+--------------+
             v              v              v
        chokidar      startup scan    manual refresh
        (incremental) (full reconcile) (user-triggered)
             |              |              |
             +--------------+--------------+
                            v
                  +--------------------------+
                  |  fileEntryTable (index)   |
                  +--------------------------+
```

**操作锁机制**：应用自身发起的 FS 变更（trash / restore / move / rename）必须在操作期间挂起 chokidar 事件处理。通过 `Set<path>` 记录"正在操作中的路径"，同步引擎处理事件前检查该集合，命中则跳过。

```
FileService --lock--> OperationLock <--check-- SyncEngine (chokidar)
    |                                              |
    |--fs.rename()--> ... --> unlink event --> "locked, skip"
    |--db.update()                                 |
    |--unlock()--> OperationLock                   |
```

**冲突策略**：文件系统 wins。

### 3.3 remote — 远程同步 _(未来)_

远程 API 为 Source of Truth → 本地缓存 + 条目表作为镜像层。按需下载，缓存失效通过 `cachedAt` 与远程 `updatedAt` 比较判断。

---

## 4. 删除与回收站

### 4.1 OS 风格 Trash

采用 **OS 风格 Trash**（类 macOS/Windows 回收站）：

| 操作         | 语义                       | 物理影响（managed） | 物理影响（external）                |
| ------------ | -------------------------- | ------------------- | ----------------------------------- |
| **Trash**    | 移动到 `system_trash` 下   | 仅 DB 操作          | 物理移动到 `.trash/{entryId}/`      |
| **Restore**  | 移回 `previousParentId`    | 仅 DB 操作          | 物理移回原路径                      |
| **永久删除** | 硬删条目（CASCADE 子条目） | 删物理文件 + 删 DB  | 删 `.trash` 中的物理文件 + 删 DB    |

**设计要点**：

- Trash 条目保持原 `mountId` 不变（路径解析仍用原 mount）
- 子条目的 `parentId` 不变，整棵子树随父条目进入/离开 Trash
- 回收站只展示直接子条目（`parentId = system_trash`）
- 永久删除顺序：先删物理文件 → 再删 DB（保证可重试）
- chokidar 排除 `.trash` 目录

**Edge Case 处理**（参考 macOS / Windows）：

- **恢复时原父目录已删**：自动重建原路径的目录结构，而非 fallback 到根目录
- **磁盘空间管理**：UI 显示回收站占用空间，支持用户手动清空。未来可增加磁盘空间不足时自动清理最旧条目
- **自动过期**：默认 30 天自动清理，可由用户在 Preference 中配置天数或关闭

### 4.2 临时文件生命周期（mount_temp）

`mount_temp` 是 `local_managed` 类型的挂载点，`basePath = {userData}/Data/files/temp/`，用于粘贴、临时预览等场景。

**生命周期管理**：

- **有 ref 的临时文件**：由调用方显式管理。典型流程：粘贴时创建 ref → 发送后删临时 ref + 创建正式 ref + move 到 `mount_files` → 取消时删 ref
- **无 ref 的临时文件**：自动清理（启动时 + 定期扫描）
- **清理器绝不自动删除 ref**，通过删 ref 来主动释放不需要的缓存

---

## 5. 引用清理机制

三层防护，逐层兜底：

```
+-------------------------------------------------------+
| Layer 1: fileEntryId CASCADE                          |
| file entry deleted -> file_ref auto-cascaded          |
| (DB FK constraint, zero app code)                     |
+-------------------------------------------------------+
| Layer 2: business delete hooks                        |
| business entity deleted -> cleanup file_ref           |
| (called in each Service's delete method)              |
+-------------------------------------------------------+
| Layer 3: registered orphan scanner                    |
| background scan for file_ref with missing sourceId    |
| (each module registers a checker, scanner runs them)  |
| compile-time enforced: Record<FileRefSourceType, ...> |
+-------------------------------------------------------+
```

Layer 3 的注册表通过 `Record<FileRefSourceType, OrphanChecker>` 类型约束，确保每个 sourceType 都有对应的 checker。新增 sourceType 后若未注册 checker，编译直接报错。具体实现方案见 RFC。

**无引用文件策略**：文件保留，不自动删除。UI 可显示"未引用"标记，由用户手动清理。

---

## 6. 分层架构

### 6.1 数据读取路径（DataApi）

FileTreeService / FileRefService 是 `src/main/data/services/` 下的 data service，遵循项目现有的 DataApi 分层模式（详见 [DataApi in Main](../../en/references/data/data-api-in-main.md)）。它们**不是独立的 lifecycle service**，而是通过 DataApiService 桥接暴露给 Renderer：

```
Renderer                              Main
+------------------+           +---------------------------+
| useQuery()       |           | DataApiService (bridge)   |
| useMutation()    |--DataApi--+   |                       |
| (React hooks)    |           |   v                       |
+------------------+           | Handler (files.ts)        |
                               |   |                       |
                               |   v                       |
                               | FileTreeService (data svc)|
                               | FileRefService  (data svc)|
                               |   |                       |
                               |   v                       |
                               | DB (fileEntryTable/fileRefTable)|
                               +---------------------------+
```

Main 进程内部的 service（FileService、业务 Service 等）可以直接 import 调用 data service，不需要经过 DataApi handler。DataApiService 桥接仅用于 Renderer 访问。

DataApi 端点：

| 端点                            | 用途                                               |
| ------------------------------- | -------------------------------------------------- |
| `GET /files/entries`              | 条目列表（支持 mountId / parentId / inTrash 过滤） |
| `GET /files/entries/:id`          | 单条目查询                                         |
| `GET /files/entries/:id/children` | 子条目（文件树懒加载，支持排序分页）               |
| `GET /files/entries/:id/refs`     | 文件的所有引用方                                   |
| `GET /files/refs/by-source`       | 业务对象引用的所有文件                             |
| `GET /files/mounts`               | 挂载点列表                                         |

### 6.2 文件操作路径（File IPC）

所有涉及 FS 的操作走专用 IPC 通道，**不走 DataApi**。v1 的 44 个细粒度方法合并为 v2 的 19 个方法（详见 `ipc-redesign.md`）。

```
Renderer                          Main
+--------------+           +--------------------------------------+
| window.api   |           | FileIpcService (IPC entry)           |
| .fileManager |---IPC---->|   |                                   |
| .createEntry()|          |   +-- all ops ------> FileService     |
| .read()      |           |   |                   (sole FS owner) |
| .trash()     |           |   |                                   |
| .select()    |           |   +-- dialog only --> Electron dialog |
| .open()  ... |           |      (no fs, just showOpenDialog)     |
+--------------+           +--------------------------------------+
```

FileIpcService 自身**不调用 `fs` 模块**。所有涉及文件系统的操作统一委托给 FileService，FileIpcService 仅保留 Electron dialog API（`showOpenDialog` / `showSaveDialog`），因为 dialog 返回的是用户选择结果，不是 FS 操作。

#### IPC 方法按分发目标分类

**委托 FileService**：所有涉及 FS 的操作，无论入参是 FileEntryId 还是 FilePath。

| 方法 | FileEntryId 入参 | FilePath 入参 |
|------|------------------|---------------|
| `createEntry` | FS 写入 + 创建条目（按 providerType） | — |
| `trash` / `restore` | Trash 逻辑（按 providerType） | — |
| `permanentDelete` | 删物理文件 + 删条目 | — |
| `move` / `copy` | FS 移动/复制 + 更新条目 | — |
| `read` | 解析路径 → 读文件 | 直接读文件 |
| `write` | 解析路径 → 写文件 | 直接写文件 |
| `getMetadata` | 查条目 + `fs.stat` | 直接 `fs.stat` |
| `open` | 解析路径 → `shell.openPath` | 直接 `shell.openPath` |
| `showInFolder` | 解析路径 → `shell.showItemInFolder` | 直接 `shell.showItemInFolder` |
| `save` | — | dialog 选路径 → 写文件 |
| `listDirectory` | — | 列出外部目录内容 |
| `validateNotesPath` | — | 校验路径合法性 |
| `batch*` | 逐项委托 FileService | — |

**FileIpcService 自行处理**：仅 Electron dialog（无 FS 操作）。

| 方法 | 说明 |
|------|------|
| `select` | `dialog.showOpenDialog`，返回路径字符串，不涉及 FS |

### 6.3 FS 交互的层级归属

```
+---------------------------------------------------------------------+
| FileIpcService                                                      |
| (Lifecycle Service, WhenReady phase)                                |
|                                                                     |
| Role: IPC handler registration, param dispatch                      |
| FS:   none -- delegates everything to FileService                   |
| Own:  Electron dialog API only (showOpenDialog/showSaveDialog)      |
+---------------------------------------------------------------------+
| FileService  *** SOLE FS OWNER ***                                  |
| (Lifecycle Service, WhenReady phase)                                |
|                                                                     |
| Role: the ONLY module that imports and calls `fs` / `shell`         |
| FS:   all FS ops -- entry-related (by providerType) and raw path   |
|       read / write / stat / rename / unlink / copy / open / list    |
| DB:   delegates to FileTreeService for all entry mutations          |
|       maintains in-memory path cache                                |
|       owns OperationLock for ExternalSyncEngine coordination        |
+---------------------------------------------------------------------+
| FileTreeService  (data service, not lifecycle)                      |
|                                                                     |
| Role: entry CRUD, tree queries, path resolution                     |
| FS:   none (pure DB)                                                |
| DB:   fileEntryTable read/write, tree traversal (children, ancestors)|
| Note: exposed to Renderer via DataApiService bridge (read-only)     |
+---------------------------------------------------------------------+
| FileRefService  (data service, not lifecycle)                       |
|                                                                     |
| Role: ref CRUD, cleanup by source, batch cleanup                    |
| FS:   none (DB only)                                                |
| Note: exposed to Renderer via DataApiService bridge (read-only)     |
+---------------------------------------------------------------------+
| ExternalSyncEngine                                                  |
| (Lifecycle Service, WhenReady phase)                                |
|                                                                     |
| Role: local_external mount file watching & sync                     |
| FS:   none -- delegates to FileService for stat/scan                |
|       owns chokidar instance, but FS reads go through FileService   |
|       respects FileService.OperationLock to skip self-initiated ops |
+---------------------------------------------------------------------+
| DataApi Handler                                                     |
|                                                                     |
| Role: DB read-only endpoints                                        |
| FS:   none                                                          |
+---------------------------------------------------------------------+
```

**核心原则**：

- **FileService 是进程中唯一 `import fs` 的模块**——所有 FS 操作（无论 FileEntryId 还是 FilePath）最终都经过它
- **Renderer 永远不直接操作 FS**，所有 FS 操作通过 IPC 委托给 Main
- **FileTreeService 是纯条目层**——只做 DB 读写和树查询，不碰 FS
- **FileIpcService 是纯 IPC 入口**——不碰 FS，只做参数分发 + Electron dialog
- **ExternalSyncEngine 通过 FileService 做 FS 读取**——自身不直接调用 `fs`
- **DataApi、FileRefService 完全不碰 FS**

### 6.4 职责边界总结

| 层 | 类型 | 碰 DB | 碰 FS | 碰 Electron API | 暴露给 Renderer |
|----|------|-------|-------|-----------------|----------------|
| **FileIpcService** | lifecycle | 否（委托） | 否（委托 FileService） | dialog | 是（IPC） |
| **FileService** | lifecycle | 通过 data service | **是（唯一 FS owner）** | shell | 否（内部） |
| **ExternalSyncEngine** | lifecycle | 通过 data service | 通过 FileService | 否 | 否（内部） |
| **FileTreeService** | data service | 是（直接） | 否（纯 DB） | 否 | 是（通过 DataApi） |
| **FileRefService** | data service | 是（直接） | 否（纯 DB） | 否 | 是（通过 DataApi） |
| **DataApi Handler** | data layer | 调用 data service | 否 | 否 | 是（DataApi 桥接） |

---

## 7. 业务服务集成

Main 进程的其他服务通过以下方式与文件管理系统交互：

### 7.1 交互全景

```
+- Renderer -------------------------------------------------------+
|                                                                   |
|  useQuery('/files/...')        window.api.file.xxx()              |
|           |                                    |                  |
+-----------|------------------------------------|------------------+
            | DataApi (read-only)                | IPC (read/write)
            |                                    |
+===========|====================================|==================+
|  Main     |                                    |                  |
|  Process  v                                    v                  |
|                                                                   |
|  Lifecycle Services                                               |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|                                                                   |
|  +----------------------------+   +----------------------------+  |
|  | FileIpcService             |   | ExternalSyncEngine         |  |
|  | (IPC entry, no FS)         |   | (chokidar, WhenReady)      |  |
|  +-------------+--------------+   +-------------+--------------+  |
|                |                                |                 |
|     all ops    | (except dialog)     events     |                 |
|                v                                v                 |
|  +----------------------------------------------------------+    |
|  | FileService  *** SOLE FS OWNER ***                        |    |
|  |                                                           |    |
|  |  -- entry ops --         -- file content --               |    |
|  |  create / trash          readFile / writeFile             |    |
|  |  restore / move          resolvePhysicalPath              |    |
|  |  permanentDelete / copy                                   |    |
|  |                          -- raw path ops --               |    |
|  |                          stat / open / showInFolder       |    |
|  |                          save / listDirectory             |    |
|  |                          validateNotesPath                |    |
|  |                                                           |    |
|  |  FS ops (sole fs user)   OperationLock (sync coord)       |    |
|  +--------------------+-------------------------------------+    |
|                       |                                           |
|  Data Services (via DataApiService bridge to Renderer)            |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|                       |                                           |
|  +--------------------+-------------------------------------+    |
|  | FileTreeService (data service, DB only)                   |    |
|  |  getById / getChildren / list / create                    |    |
|  |  update / delete / getMounts                              |    |
|  +-----------------------------------------------------------+    |
|  +-----------------------------------------------------------+    |
|  | FileRefService (data service, DB only)                    |    |
|  |  create / cleanup / cleanupBySource                       |    |
|  +-----------------------------------------------------------+    |
|                       |                                           |
|  . . . . . . . . . . | . . . . . . . . . . . . . . . . . . . .  |
|  Business Services    |                                           |
|                       |                                           |
|  +---------------+ +-+-------------+ +-----------------+         |
|  | MessageService| | KnowledgeServ.| | PaintingService |         |
|  +---+---+---+---+ +---+---+---+--+ +---+---+-----+---+         |
|      |   |   |          |   |   |        |   |     |              |
|    read ref readFile  read ref readFile read ref  readFile        |
|    entry write resolve entry write resolve entry write resolve    |
|      |   |   |          |   |   |        |   |     |              |
|      v   v   v          v   v   v        v   v     v              |
|  FileTree FileRef FileService  (same pattern for all)             |
|  Reader   Service (sole FS)                                       |
|  (read)   (read+write)                                            |
|                                                                   |
|  . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .  |
|  Background Services                                              |
|                                                                   |
|  +---------------------------------------------------------+     |
|  | OrphanRefScanner (Background phase)                     |     |
|  |  checkers: Record<FileRefSourceType, SourceTypeChecker> |     |
|  |  (compile-time enforced, covers all sourceTypes)        |     |
|  +---------------------------------------------------------+     |
+===================================================================+
```

**要点**：

- **FileService 是唯一碰 `fs` 的模块**——所有其他模块（FileIpcService、业务 Service、ExternalSyncEngine）通过它间接访问文件系统
- FileIpcService 是纯 IPC 入口，只做参数校验/分发 + Electron dialog
- FileTreeService 是纯条目层，DataApi Handler 直接调用它做只读查询；FileService 调用它做条目变更

**关键数据流**：

- **Renderer → Main（读取）**：DataApi → Handler → FileTreeService → DB
- **Renderer → Main（写操作）**：IPC → FileIpcService → FileService（FS + Entry）
- **业务 Service → 文件数据**：纯 DB 操作（条目查询 + 引用管理）直接调 data service，涉及 FS 的操作（读写文件内容）走 FileService
- **外部文件系统 → Main**：chokidar → ExternalSyncEngine → FileService（stat）+ FileTreeService（DB）

### 7.2 业务服务的接触点

业务服务通过两个途径与文件管理系统交互：

- **纯 DB 操作**（条目查询 + 引用管理）→ 直接 import data service（`fileTreeReader` / `fileRefService`）
- **涉及 FS 的操作**（读写文件内容）→ **FileService**

#### (1) 创建业务时 —— 创建 FileRef

业务操作产生文件引用时，直接调用 `fileRefService.create()`。Renderer 不直接创建 ref。

| 业务场景 | sourceType | role | 触发时机 |
|---------|-----------|------|---------|
| 发送带附件的消息 | `chat_message` | `attachment` | MessageService 创建消息时 |
| 添加文件到知识库 | `knowledge_item` | `source` | KnowledgeService 添加条目时 |
| AI 生图保存 | `painting` | `asset` | PaintingService 保存结果时 |
| 粘贴临时文件 | `temp_session` | `pending` | PasteService 落盘时 |

#### (2) 删除业务时 —— 清理 FileRef

业务对象被删除时，**必须**主动清理关联的 file_ref，防止悬挂引用：

| 删除场景 | 清理调用 |
|---------|---------|
| 删除消息 | `fileRefService.cleanupBySource('chat_message', messageId)` |
| 删除 topic | 先查出 messageIds → `fileRefService.cleanupBySourceBatch(...)` |
| 删除知识库 | `fileRefService.cleanupBySourceBatch('knowledge_item', itemIds)` |
| 删除知识库条目 | `fileRefService.cleanupBySource('knowledge_item', itemId)` |

#### (3) 孤儿检查器覆盖

`OrphanRefScanner` 通过 `Record<FileRefSourceType, SourceTypeChecker>` 类型的注册表集中声明所有 checker。每个 `FileRefSourceType` 必须有对应的 checker，否则编译报错（详见 RFC §8）。

```
OrphanRefScanner.checkers: Record<FileRefSourceType, SourceTypeChecker>
  'chat_message'    -> checkExists: query messageTable
  'knowledge_item'  -> checkExists: query knowledgeItemTable
  'painting'        -> checkExists: query paintingTable
  'temp_session'    -> checkExists: no-ref entries auto-cleanup
```

### 7.3 业务服务访问文件的方式

业务服务通过两个途径访问文件管理系统，划分标准是**是否涉及 FS**：

```
BusinessService
    |
    +-- direct import data service (pure DB, read + ref write)
    |   +-- fileTreeReader.getById(entryId)       -> FileEntry
    |   +-- fileTreeReader.getChildren(parentId)  -> FileEntry[]
    |   +-- fileRefService.create(dto)            -> FileRef
    |   +-- fileRefService.cleanupBySource(...)   -> void
    |
    +-- via FileService (involves FS)
    |   +-- readFile(entryId, opts?)              -> string | Uint8Array
    |   +-- writeFile(entryId, data)              -> void
    |   +-- resolvePhysicalPath(id)               -> string (for external libs only)
    |
    x-- fs.readFile / writeFile / unlink          -> FORBIDDEN
    x-- fileTreeWriter.create / update / delete   -> FORBIDDEN (compile error)
```

#### 读写接口分离（编译期强制）

由于条目数据与 FS 强关联，条目的写操作（create / update / delete）必须经过 FileService 协调 FS + DB。为在编译期强制这一约束，FileTreeService 导出读写两个类型：

```typescript
// src/main/data/services/FileTreeService.ts

export type FileTreeReader = Pick<FileTreeService,
  'getById' | 'getChildren' | 'list' | 'getMounts' | ...>

class FileTreeService {
  // read methods
  getById(id: string): Promise<FileEntry> { ... }
  getChildren(parentId: string): Promise<FileEntry[]> { ... }
  // write methods
  create(dto: CreateEntryDto): Promise<FileEntry> { ... }
  update(id: string, dto: UpdateEntryDto): Promise<FileEntry> { ... }
  delete(id: string): Promise<void> { ... }
}

// full instance — FileService imports this
export const fileTreeService = FileTreeService.getInstance()
// read-only view — business services import this
export const fileTreeReader: FileTreeReader = fileTreeService
```

文件位置与模块边界：

```
src/main/data/                        -- data layer (pure DB)
  services/
    FileTreeService.ts                -- exports fileTreeService + fileTreeReader
    FileRefService.ts                 -- exports fileRefService (read+write, no split needed)
  api/handlers/
    files.ts                          -- DataApi handler, read-only endpoints
  db/schemas/
    file.ts                           -- fileEntryTable + fileRefTable
  db/seeding/
    fileEntrySeeding.ts               -- system mount initialization

src/main/services/                    -- lifecycle services
  FileService.ts                      -- imports fileTreeService (full), sole FS owner
  FileIpcService.ts                   -- imports FileService, registers IPC handlers
  ExternalSyncEngine.ts               -- imports FileService, chokidar watch
```

- **业务 Service** import `fileTreeReader`（`Pick` 类型）— 只有读方法，调写方法编译报错
- **FileService** import `fileTreeService`（完整实例）— 可以调读写方法，因为它负责协调 FS + DB
- **FileRefService** 不需要拆分 — ref 操作是纯 DB，与 FS 无关，业务 Service 可以直接调用读写方法

类型收窄只能引导正确用法，无法阻止其他模块 `import { fileTreeService }` 绕过限制。需配合 ESLint `no-restricted-imports` 规则强制：

```jsonc
// eslint config
{
  "rules": {
    "no-restricted-imports": ["error", {
      "paths": [{
        "name": "@data/services/FileTreeService",
        "importNames": ["fileTreeService"],
        "message": "Use fileTreeReader for read-only access. Only FileService may import fileTreeService."
      }]
    }]
  },
  // FileService.ts exempt via overrides
  "overrides": [{
    "files": ["src/main/services/FileService.ts"],
    "rules": { "no-restricted-imports": "off" }
  }]
}
```

**为什么禁止直接使用 `fs`**：

- **路径不透明**：物理路径由 `providerType` 决定，业务服务不应假设路径格式
- **缓存一致性**：FileService 维护内存路径缓存，绕过它会导致不一致
- **同步引擎冲突**：对 `local_external` mount 直接写入会被 chokidar 捕获为外部变更

**唯一例外**：`resolvePhysicalPath` 返回的路径可以传递给无法接受流式数据的外部库（如 AI SDK 的文件上传 API），但业务服务不应对该路径做任何 FS 操作。

### 7.4 临时文件的业务流转

典型场景：用户粘贴图片 → 发送消息。涉及两个 Service 协作：

```
PasteService                          MessageService
    |                                      |
    +-- 1. write to mount_temp             |
    +-- 2. create ref (temp_session)       |
    |                                      |
    |-------- user sends ----------------->|
    |                                      +-- 3. move entry to mount_files
    |                                      +-- 4. create ref (chat_message/attachment)
    |                                      +-- 5. delete temp ref (temp_session)
    |                                      |
    |-------- user cancels -->|            |
    |                         |            |
    +-- 3'. delete temp ref   |            |
    +-- (scanner later cleans up no-ref entries)
```

### 7.5 服务生命周期

文件管理系统中的服务遵循项目的 [Lifecycle 系统](../../en/references/lifecycle/README.md)，通过 `@Injectable`、`@ServicePhase`、`@DependsOn` 装饰器声明依赖和启动阶段。

#### 启动阶段分配

Lifecycle service 和 data service 的区别参见 [Lifecycle Decision Guide](../../en/references/lifecycle/lifecycle-decision-guide.md)。

```
Lifecycle Services:

BeforeReady (parallel with app.whenReady(), no Electron API)
+-- DbService                    -- database connection
+-- FileEntrySeedingService       -- seed system entries
      @DependsOn(DbService)

WhenReady (after app.whenReady(), Electron API available)
+-- FileService                  -- sole FS owner, build path cache
+-- FileIpcService               -- register IPC handlers (no FS)
|     @DependsOn(FileService)
+-- ExternalSyncEngine           -- chokidar watch (Notes mount)
      @DependsOn(FileService)

Background (fire-and-forget, non-blocking)
+-- OrphanRefScanner             -- delayed 30s, scan orphan refs

Data Services (not lifecycle, managed by DataApiService):
+-- FileTreeService              -- entry CRUD (pure DB)
+-- FileRefService               -- ref CRUD (pure DB)
```

#### 启动时序

```
                     BeforeReady
                          |
      DbService --> FileEntrySeedingService
          |            (upsert system entries)
          |
     app.whenReady()
          |
          v         WhenReady
     FileService
     (build path cache, sole FS owner)
     (calls FileTreeService internally)
          |
+---------+-----------+
|                     |
FileIpcService  ExternalSyncEngine
(register IPC)  (start chokidar watch)
          |
     onAllReady()
          |
OrphanRefScanner.start()
(delayed 30s, background scan)
```

#### 关键点

- **FileEntrySeedingService** 在 `BeforeReady` 阶段幂等创建系统挂载点
- **FileTreeService / FileRefService** 是 data service（非 lifecycle），随 DataApiService 初始化就绪，供 FileService 和 DataApi handler 调用
- **FileService** 在 `WhenReady` 阶段构建内存路径缓存（`Map<entryId, absolutePath>`），是唯一 `import fs` 的模块
- **FileIpcService** 在 `WhenReady` 阶段通过 `this.ipcHandle()` 注册所有 IPC handler。大部分操作委托给 FileService，少数不涉及 FS 的 Electron API（如 `select` → `dialog.showOpenDialog`）由自身直接处理（参见 6.2）。IPC handler 由 lifecycle 系统自动管理：`onStop()` 返回后统一移除，无需手动 `removeHandler()`；restart 时重新注册（详见 [Lifecycle Usage - IPC](../../en/references/lifecycle/lifecycle-usage.md#api)）
- **ExternalSyncEngine** 在 `onInit()` 中启动 chokidar，通过 FileService 做 FS 读取，通过 `FileService.OperationLock` 跳过自发操作
- **OrphanRefScanner** 在 `Background` 阶段运行，不阻塞启动。通过 `onAllReady()` 确认所有业务服务就绪后开始扫描

#### 业务服务的依赖声明

业务服务需声明对 `FileService` 的依赖（FileRefService 是 data service，无需 `@DependsOn`，直接 import 调用）：

```
MessageService
  @DependsOn(FileService)
  +-- queries entries via fileTreeReader (pure DB, read-only)
  +-- creates/cleans refs via fileRefService (pure DB)
  +-- reads file content via FileService (FS)

KnowledgeService
  @DependsOn(FileService)
  +-- same pattern as above

Note: 孤儿 ref 清理的 checker 集中定义在 OrphanRefScanner 的注册表中（编译期强制覆盖所有 sourceType），
业务 Service 不需要主动注册。
```

业务服务不需要依赖 `FileIpcService`（IPC 层，仅供 Renderer），也不需要依赖 `ExternalSyncEngine`（Notes 专属）。

---

## 8. 关键设计决策

| 决策              | 结论                    | 核心理由                                          |
| ----------------- | ----------------------- | ------------------------------------------------- |
| 挂载点与条目      | **同表**                | 挂载点极少（2-5 个），字段浪费可忽略              |
| 去重策略          | **放弃去重**            | OS 目录结构与用户视角一致，逻辑显著简化           |
| 主键              | **UUID v7**             | 时间有序，大表顺序插入性能优                      |
| 删除模型          | **OS 风格 Trash**       | 用户心智模型一致，可恢复                          |
| `mountId` 冗余    | **保留**                | 避免递归 CTE 查挂载点，查询性能关键               |
| 跨 mount 移动     | **禁止**                | 存储模式不兼容，复杂度高，用"复制+删除"替代       |
| 元数据生成        | **Service 单一入口**    | mountId 推导、name/ext 拆分、size 读取全部收口    |
| DataApi 写操作    | **不提供**              | 写操作涉及 FS，必须走 File IPC                    |
| FileRef 创建      | **不暴露 DataApi 端点** | Ref 创建是业务操作的副作用，业务 Service 直接调用 `fileRefService.create()` |
| `ext`/`size` 存放 | **保留在 fileEntryTable** | 高频过滤/排序需索引支持，查询性能优先           |
| 临时文件          | **`mount_temp` mount** | 享受统一 Trash/清理机制，无 ref 则自动清理        |

---

## 9. 约束与限制

- **跨 mount 移动不可用**：不同 Provider 的存储模式不兼容
- **`path` 不持久化**：运行时计算，依赖内存缓存
- **FileRef 多态无 FK**：`sourceId` 指向不同业务表，依赖应用层清理 + 孤儿扫描兜底
- **external 模式复杂度**：双向同步需操作锁、chokidar 排除、冲突处理
- **系统条目不可删除**：`mount_files`、`mount_notes`、`system_trash`、`mount_temp` 受保护

---

## 10. 扩展点

| 扩展方向                                 | 接入方式                                            |
| ---------------------------------------- | --------------------------------------------------- |
| 新增远程存储（S3、WebDAV、Google Drive） | 新增 `RemoteProvider` 实现，核心 Schema 不变        |
| 新增业务引用来源                         | 新增 `sourceType` 枚举值 + 注册 `SourceTypeChecker` |
| 新增挂载点                               | 创建新 mount 条目 + 配置 `providerConfig`           |
| 笔记体系迁入                             | 通过 `local_external` mount 纳入统一条目表          |
| 对话内复用应用文件                       | 通过 `file_ref` 建立引用关系                        |
