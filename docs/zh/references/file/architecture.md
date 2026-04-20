# File Module Architecture

> **本文档是文件模块的架构 Source of Truth**，聚焦模块边界、组件职责、IPC 设计与服务集成。
>
> 相关文档：
>
> - `docs/zh/references/file/file-manager-architecture.md` — FileManager 子模块设计（FileEntry 模型、origin 语义、原子写、版本检测、DirectoryWatcher、AI SDK 集成）
> - `v2-refactor-temp/docs/file-manager/rfc-file-manager.md` — 实现设计文档（Drizzle Schema、API 细节、Phase 规划、迁移策略）

---

## 1. 模块范围

### 1.0 核心原则

> **FileManager 管理通过显式调用 `createEntry` 引入的文件**——以 `internal`（Cherry 拥有内容）或 `external`（仅记录路径引用）两种 origin 之一存在。调用方选择哪种 origin 属于业务层决策，FileManager 不假设。

### 1.0.1 Origin 的语义

FileEntry 的 `origin` 字段定义内容所有权，有两种：

- **`internal`**：Cherry 拥有文件内容，物理存储在 `{userData}/files/{id}.{ext}`。调用方把 Buffer/Stream/源文件交给 FileManager，FileManager 复制并接管
- **`external`**：Cherry 仅记录一个用户侧的绝对路径引用，不复制内容，不拥有文件；文件的可用性、内容变化由用户侧决定

选择哪种 origin 是**调用方**的决策，FileManager 不对业务层做假设。具体调用方的迁移/现状请参考 RFC。

### 1.0.2 External 的 best-effort 语义

External entry 是"调用方在某一时刻表达过要引用此路径"的持久化记录，类比 codex 等工具的"best-effort external reference"——不保证文件稳定存在，不保证内容和当初引用时一致。Cherry 不主动镜像 FS 变化，让 FS 变更自然反映为"下次读到新内容"或"entry 变 dangling"。

### 1.1 File Module 包含

```
File Module (src/main/file/)
├── FileManager (唯一 lifecycle service)
│     ├── FileEntry 生命周期（create-or-upsert / write / trash / restore / rename / copy / permanentDelete）
│     ├── 版本检测 & 并发控制（read / writeIfUnchanged / withTempCopy）
│     ├── 元数据 & 系统操作（getMetadata / open / showInFolder / refreshMetadata）
│     ├── registerIpcHandlers() — 统一 IPC 入口，handler 层分派
│     └── Electron dialog (showOpenDialog / showSaveDialog)
│
├── danglingCache.ts (singleton)
│     ├── check(entry): DanglingState — 查内存 / 冷路径 stat
│     ├── onFsEvent(path, state) — 接收 watcher 事件
│     ├── 反向索引 Map<path, Set<entryId>>（file_module 启动时从 DB 建）
│     └── 由 DataApi handler 查询；由 watcher 工厂自动接线
│
├── watcher/
│     └── DirectoryWatcher (非 service, 通用 FS 监听 primitive)
│         ↳ 工厂 createDirectoryWatcher() 自动把事件接入 danglingCache
│
└── ops/ (纯函数, module-internal fs owner, 统一从 index.ts 导出)
      ├── fs.ts       — 基础 FS: read / write / stat / copy / move / remove
      │                 原子写: atomicWriteFile / atomicWriteIfUnchanged / createAtomicWriteStream
      │                 版本: statVersion / contentHash (xxhash-128)
      ├── shell.ts    — 系统操作: open / showInFolder
      ├── path.ts     — 路径工具: resolvePath / isPathInside / canWrite / isNotEmptyDir
      ├── metadata.ts — 类型检测: getFileType / isTextFile / mimeToExt
      └── search.ts   — 目录搜索: listDirectory (ripgrep + 模糊匹配)

Data Module 依赖 (src/main/data/)
├── FileEntryService (data repository, 纯 DB) — file_entry 表
├── FileRefService (data repository, 纯 DB) — file_ref 表
└── DataApi Handler (files.ts) — 无 fs 副作用端点，可 opt-in 带 dangling 状态
```

**延后实现**：

- **`FileUploadService` + `file_upload` 表 + `FileUploadRepository`** — 对接 Vercel AI SDK 的 Files Upload API。当前 AI SDK API 仍为 pre-release 状态，依赖未稳定，延后到 SDK 进入稳定版后独立 PR 引入。设计保留在 `file-manager-architecture.md §9` 以备参考。

### 1.2 FileManager 在模块中的定位

FileManager 是 file module 的核心子模块，但不等于 file module 本身。

- **FileManager** 是 entry 管理系统——负责 FileEntry 的完整生命周期与内容操作。它的 public API 只认 `FileEntryId`。启动时后台执行 orphan sweep（清理 internal 残留 UUID 文件），**不阻塞 ready 信号**
- **DanglingCache** 是 file_module 的 singleton——维护 external entry 的 `'present' | 'missing'` 状态，由 watcher 事件推送更新、冷路径 stat 兜底，供 DataApi handler 以 opt-in 方式返回给 renderer
- **DirectoryWatcher** 是通用 FS primitive，**非 lifecycle service**，业务模块（未来的 NoteService 等）自行通过 `createDirectoryWatcher()` 工厂 new/dispose；工厂内部自动把事件接入 DanglingCache
- **ops.ts** 与 FileManager 平级——提供不依赖 entry 系统的纯 FS/路径操作，对整个 main 进程开放

FileManager 的详细设计见 [FileManager Architecture](./file-manager-architecture.md)。

### 1.3 不在范围内

以下类别**不由** File Module 管理（不产生 FileEntry）：

| 类别 | 归属 | 不由 FileManager 管的原因 |
|---|---|---|
| 笔记文件树（Notes app 内部浏览/编辑的文件） | Notes 模块（FS-first） | Notes 有自己的 notes dir 存储和外部编辑器兼容性；文件树由 Notes domain 管理，**不整体镜像到 FileEntry** |
| 知识库向量索引 | KnowledgeService | 自动产生的派生数据，非用户文件 |
| MCP 服务器配置 | MCP 模块 | 系统/用户配置，非用户上传文件 |
| Preference / BootConfig | 配置模块 | 应用状态 |
| 日志文件 | LoggerService | 自动产生 |
| 备份 / 导出文件 | 对应业务 | 业务生成的流转物 |
| Agent 工作区文件 | AgentService | Agent 运行期自产 |
| OCR / PDF 切页等中间产物 | 业务模块 / `os.tmpdir` | 临时计算产物 |
| 外部目录的实时同步镜像 | 业务模块用 DirectoryWatcher 组装 | File_module 不做 DB-FS 双向同步 |

**注意**：上表是"某些业务数据不入 FileManager"的边界，而非"某些文件类型不入"。同一物理文件可以同时属于某个 FS-first 业务 domain 与某个 external FileEntry（后者只是对该路径的引用），两者互不矛盾。

这些模块管理各自的文件，可直接使用 `node:fs` 或 `ops/*`，不受 file module 的 FileManager 约束。

---

## 2. IPC 设计

### 2.1 设计动机

Renderer 需要统一的文件操作入口（一个 `read` 既能读 FileEntry 也能读外部路径），但 main process 内部 entry 管理（DB + FS 协调）和纯路径操作（直接 FS）是两种完全不同的职责。

解法：**统一调用入口 + handler 层分派**。FileManager 作为唯一 IPC 注册方统管所有 handler，handler 内部按 target 类型分派到不同实现。

### 2.2 Handler 分派

```
Renderer
  → FileManager.registerIpcHandlers() (统一入口)
    ├── target: FileEntryId → FileManager 方法 (entry 协调: resolve → DB + FS)
    └── target: FilePath    → ops.ts (直接 FS/路径操作)
```

Main process 其他 service 可根据实际需求直接调用 ops.ts 或 FileManager，不需要经过 IPC。

### 2.3 IPC 方法分类

所有可作用于任意文件（managed FileEntry 或 unmanaged path）的操作，**接受 `FileHandle` tagged union**（`{ kind: 'managed', entryId } | { kind: 'unmanaged', path }`）。Handler 按 `handle.kind` 分派到 FileManager（managed）或 `ops/*`（unmanaged）。

**接受 FileHandle 的操作（managed + unmanaged 统一）**：

| 方法 | 说明 | managed-internal | managed-external | unmanaged |
|---|---|---|---|---|
| `read` | 读内容 | ops.read(userDataPath) | ops.read(externalPath) + DB snapshot refresh | ops.read(path) |
| `getMetadata` | 物理元数据 | 基于 entry + ops.stat | stat + refresh | ops.stat + getFileType |
| `getVersion` | FileVersion | stat userData | stat external + refresh | ops.statVersion |
| `getContentHash` | xxhash-128 | 读 userData + hash | 读 external + hash | ops.contentHash |
| `write` | 原子写 | atomic → userData | atomic → externalPath（用户显式编辑） | atomic → path |
| `writeIfUnchanged` | 乐观并发写 | 同 write 加版本检查 | 同 | 同（需要调用方先 getVersion） |
| `permanentDelete` | 物理删除 | unlink userData + 删 DB | **unlink externalPath** + 删 DB | ops.remove(path) |
| `rename` | 改名 | 纯 DB（UUID 路径不变） | fs.rename + 更新 DB | ops.rename(path, newPath) |
| `copy` | 复制为新 internal entry | 读源 + 创建新 internal | 读源 external + 创建新 internal | 读 path + 创建新 internal |
| `open` / `showInFolder` | 系统操作 | resolve + shell | resolve + shell | shell |

**仅 FileEntryId 的操作（只对 managed entry 有意义）**：

| 方法 | 说明 |
|---|---|
| `createEntry` / `batchCreateEntries` | 创建新 FileEntry（internal = 写入 userData；external = **按 externalPath upsert**，同路径 non-trashed entry 复用，已 trashed 则 restore） |
| `trash` / `restore` | 基于 trashedAt 的软删除（DB only，不影响 FS，external 的用户文件**不动**） |
| `batchTrash` / `batchRestore` / `batchPermanentDelete` | 批量版本 |
| `refreshMetadata` | 显式 stat 刷新 external snapshot（UI 手动刷新按钮） |
| `withTempCopy` | 副本隔离调用第三方库 |

**dangling 状态的获取**：不通过 IPC 单独暴露。DataApi 的 entry 查询端点支持 `includeDangling: true` 参数，handler 侧通过 DanglingCache 按需填充（详见 §3.1）。

**仅 FilePath 的操作**：

| 方法 | 说明 |
|---|---|
| `select` | Electron 文件选择 dialog |
| `save` | Electron 保存 dialog + 写文件 |
| `listDirectory` | 扫描任意目录内容 |
| `isNotEmptyDir` | 判断目录非空 |

### 2.4 External 文件的操作语义

**Cherry 的操作对 external 文件的影响**：

| 用户动作 | external 物理文件 |
|---|---|
| 从 Cherry trash | **不动**（仅 DB 标记 trashedAt） |
| 从 Cherry restore | **不动**（DB 清 trashedAt） |
| 从 Cherry permanentDelete | **删除**（`ops.remove(externalPath)`，用户显式要求） |
| 从 Cherry write / writeIfUnchanged | **覆盖**（atomic write） |
| 从 Cherry rename | **物理 rename**（外部文件名跟着改） |

**关键原则**：
- Cherry 不做自动 / watcher 驱动的外部文件修改
- Cherry 做用户显式要求的外部文件修改（保存、改名、删除）
- **Cherry 不追踪外部文件的 rename/move**——文件在 Cherry 外部被移动，对应 entry 变 dangling（best-effort 语义）；调用方需主动对新路径再次调用 `createEntry` 建立新引用（按 path upsert，命中现有 entry 则复用）

类似 VS Code 对打开的文件的行为模型：你让它改就改，不会偷偷动；你在外面动了它，它也不会自动跟上。

### 2.5 AI SDK 集成（延后）

**AI SDK 上传相关** → FileUploadService 方法（**延后实现**，待 AI SDK Files API 稳定后引入）：

| 方法                                | 说明                           |
| ----------------------------------- | ------------------------------ |
| `ensureUploaded(entryId, provider)` | upload-if-needed               |
| `buildProviderReference(entryId)`   | 构造 SharedV4ProviderReference |
| `invalidate(entryId)`               | 清缓存（内容变更时）           |

---

## 3. 分层架构

### 3.1 无 FS 副作用路径（DataApi）

FileEntryService / FileRefService 是 `src/main/data/services/` 下的 data repository，遵循项目现有的 DataApi 分层模式。它们**不是独立的 lifecycle service**，而是通过 DataApiService 桥接暴露给 Renderer。

（`FileUploadRepository` 随 FileUploadService 一起延后引入。）

```
Renderer                              Main
+------------------+           +---------------------------------+
| useQuery()       |           | DataApiService (bridge)         |
| useMutation()    |--DataApi--+   |                             |
| (React hooks)    |           |   v                             |
+------------------+           | Handler (files.ts)              |
                               |   |                             |
                               |   v                             |
                               | FileEntryService (repository)   |
                               | FileRefService  (repository)    |
                               |   |                             |
                               |   v                             |
                               | DB (file_entry / file_ref)      |
                               +---------------------------------+
```

Main 进程内部的 service 可以直接 import 调用 data repository，不需要经过 DataApi handler。

DataApi 端点（只读）：

| 端点                      | 方法 | 用途                                                   |
| ------------------------- | ---- | ------------------------------------------------------ |
| `/files/entries`          | GET  | FileEntry 列表（支持 origin / trashed / 时间范围过滤；可 opt-in `includeRefCount` / `includeDangling`）|
| `/files/entries/:id`      | GET  | 单条目查询（可 opt-in `includeRefCount` / `includeDangling`）|
| `/files/entries/:id/refs` | GET  | 文件的所有引用方                                       |
| `/files/refs/by-source`   | GET  | 业务对象引用的所有文件                                 |

> **DataApi vs File IPC 的判定标准**：
> - **DataApi** = 只读查询，不改变持久化状态。DTO shape 可以和 DB schema 不同——允许派生字段、聚合、计算列；允许**幂等的只读副作用**（SQL 聚合、`fs.stat` 查 dangling 等）。**禁止任何 mutation**
> - **File IPC** = 所有 mutation（create / rename / delete / move / write / trash），以及不便用 REST 表达的读操作（全文件 read、dialog、stream、`open` 系统程序等）

**External entry 的 list 查询**：DataApi 默认返回 DB 快照（可能陈旧），不做 stat。消费者需要**最新 snapshot**（name/ext/size 刷新）调 File IPC `refreshMetadata` / `read` / `getVersion`；只需要**当前是否存在**（dangling）传 `includeDangling: true` 即可。

### 3.1.1 Opt-in 派生字段

DataApi 的 entry 查询提供四个 opt-in 字段，统一解决"我需要一个关于文件的派生信息"的所有场景：

**`includeRefCount`**（纯 SQL 聚合）：
- Handler 用 `SELECT fileEntryId, COUNT(*) GROUP BY` 对 `file_ref` 聚合，join 到 FileEntry
- 可配合 `sortBy: 'refCount'` 按引用次数排序
- 零 FS IO

**`includeDangling`**（FS-backed，安全 stat）：
- Handler 并行调用 `danglingCache.check(entry)`；cache/watcher 命中同步返回，miss 触发一次 `fs.stat`
- 是只读幂等副作用，符合 DataApi 规则
- Internal entry 恒为 `'present'`
- 详见 FileManager Architecture §11

**`includePath`**（原始绝对路径）：
- Handler 调 main 侧 `resolvePhysicalPath(entry)` 返回绝对路径字符串
- 用于 agent 上下文、drag-drop、subprocess spawn 等需要 path 字符串的场景
- 不做 safety wrap——调用方自行决定用法

**`includeUrl`**（file:// URL with safety）：
- Handler 调 main 侧 `resolveSafeUrl(entry)` 产生 `file://` URL；危险文件（.sh/.bat/.ps1 等）返回 dirname 避免误点执行
- 用于 `<img src>` / `<video src>` 的同步渲染场景
- 让 renderer 不知晓内部存储布局（id+ext 拼接、userData 路径），存储格式变化不影响 renderer

### 3.1.2 典型 renderer 调用流

```typescript
// 案例 1：FilesPage 按引用次数排序 + 显示 dangling 状态 + file 预览
const { data: entries } = useQuery(fileApi.listEntries, {
  includeRefCount: true,
  includeDangling: true,
  includeUrl: true,
  sortBy: 'refCount',
})
// <img src={entry.url} /> 同步渲染

// 案例 2：Agent compose 需要绝对路径
const { data: entries } = useQuery(fileApi.listEntries, {
  ids: selectedFileIds,
  includePath: true,
})
const filePaths = entries.map(e => e.path).join('\n')

// 案例 3：简单 chat attachment 列表（不需要派生）
const { data: entries } = useQuery(fileApi.listEntries, { origin: 'internal' })
```

分层带来的好处：
- DataApi 集中所有只读查询，消费者一次 query 拿齐需要的字段
- 不要的字段零成本（opt-in）
- Mutation 统一走 IPC，清晰区分"看数据"和"改数据"
- Renderer 不知晓内部存储布局，main 改存储格式不破坏 renderer

### 3.2 有 FS 副作用路径（File IPC）

所有涉及 FS 的操作走专用 IPC 通道，**不走 DataApi**。

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
| FileManager  (Lifecycle Service, WhenReady phase)                       |
|                                                                         |
| Role: IPC handler registration, entry coordination, dialog              |
| FS:   none -- delegates ALL FS operations to ops.ts                     |
| DB:   delegates to FileEntryService / FileRefService (repository)       |
|       maintains in-memory LRU version cache                             |
| Own:  Electron dialog API (showOpenDialog/showSaveDialog)               |
+-------------------------------------------------------------------------+
| Startup Orphan Sweep  (background task inside FileManager)              |
|                                                                         |
| Role: clean up internal UUID files not in DB + *.tmp-<uuid> residues    |
| FS:   via ops.ts                                                        |
| DB:   read-only DB queries                                              |
+-------------------------------------------------------------------------+
| DanglingCache  (file_module singleton, not lifecycle)                   |
|                                                                         |
| Role: track external entry presence state (present/missing/unknown)     |
| State: Map<entryId, DanglingState> + reverse index Map<path, entryIds>  |
| Updates: watcher events (auto-wired), ops observations, cold-path stat  |
| Queried by: DataApi handler (on includeDangling=true)                   |
+-------------------------------------------------------------------------+
| DirectoryWatcher  (NOT lifecycle -- consumable primitive)               |
|                                                                         |
| Role: chokidar wrapper with optional rename detection                   |
| Factory: createDirectoryWatcher() auto-wires events into DanglingCache  |
| Used by: business modules that need directory monitoring                |
+-------------------------------------------------------------------------+
| ops/ (pure functions)  *** MODULE-INTERNAL FS OWNER ***                 |
|                                                                         |
| Role: the sole module that imports `fs` / `shell` in file_module        |
|       atomicWriteFile exports are consumable by OTHER main modules      |
|       (BootConfig, MCP oauth, etc.) for safe writes                     |
| FS:   all FS ops -- pure path-based, no entry/DB awareness              |
| DB:   none                                                              |
+-------------------------------------------------------------------------+
| FileEntryService / FileRefService  (data repositories, not lifecycle)   |
|                                                                         |
| Role: DB CRUD, exposed via DataApiService bridge                        |
| FS:   none (pure DB)                                                    |
+-------------------------------------------------------------------------+
```

### 3.4 职责边界总结

| 层                       | 类型            | 碰 DB          | 碰 FS                   | 碰 Electron API           | 暴露给 Renderer    |
| ------------------------ | --------------- | -------------- | ----------------------- | ------------------------- | ------------------ |
| **FileManager**          | lifecycle       | via repository | **否（via ops.ts）**    | dialog                    | 是（IPC）          |
| **DanglingCache**        | singleton       | 启动时只读一次 | 否（cache only，fs 通过 ops） | 否                 | 间接（via DataApi）|
| **DirectoryWatcher**     | primitive 类    | 否             | 间接（chokidar）        | 否                        | 否（业务模块使用） |
| **ops.ts**               | pure functions  | 否             | **是（唯一 FS owner）** | shell (open/showInFolder) | 否                 |
| **FileEntryService**     | data repository | 是（直接）     | 否                      | 否                        | 是（via DataApi）  |
| **FileRefService**       | data repository | 是（直接）     | 否                      | 否                        | 是（via DataApi）  |

**核心原则**：

- **ops.ts 是唯一直接 `import node:fs` 的模块**——所有 FS 操作经过它。非 file_module 的模块（BootConfig、MCP oauth 等）可 import `atomicWriteFile` 等 primitive
- **FileManager 是 entry 操作的唯一入口**——注册 IPC handler，解析 entryId → filePath，协调 DB（via repository）+ FS（via ops.ts）
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
|  Lifecycle Services                                               |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|                                                                   |
|  +-----------------------------------------------------------+    |
|  | FileManager                                               |    |
|  |  -- IPC handler registration --                           |    |
|  |  dispatch by target type (FileEntryId vs FilePath)        |    |
|  |                                                           |    |
|  |  -- entry ops --                                          |    |
|  |  createEntry (external = upsert by path)                  |    |
|  |  trash / restore / rename / copy / permDelete             |    |
|  |  read / write / writeIfUnchanged / withTempCopy           |    |
|  |                                                           |    |
|  |  -- version / refresh --                                  |    |
|  |  getVersion / getContentHash / refreshMetadata            |    |
|  |                                                           |    |
|  |  -- Electron dialog --                                    |    |
|  |  showOpenDialog / showSaveDialog                          |    |
|  |                                                           |    |
|  |  in-memory: LRU version cache                             |    |
|  |                                                           |    |
|  |  -- Startup Orphan Sweep (background, non-blocking) --    |    |
|  |  Cleans internal UUID files not in DB + *.tmp residues    |    |
|  |  Non-blocking; other methods work immediately.            |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  +-----------------------------------------------------------+    |
|  | DanglingCache (singleton)                                 |    |
|  |  check(entry) → DanglingState                             |    |
|  |  onFsEvent(path, 'present' | 'missing')                   |    |
|  |  state: Map<entryId, DanglingState>                       |    |
|  |  reverse index: Map<path, Set<entryId>>                   |    |
|  |  populated on startup from DB (external + not trashed)    |    |
|  |  updated by watcher events / ops observations             |    |
|  +-----------------------------------------------------------+    |
|                        |                                          |
|             all FS ops v                                          |
|  +-----------------------------------------------------------+    |
|  | ops.ts  *** FS OWNER (pure functions) ***                 |    |
|  |  read / write / stat / copy / move / remove / open        |    |
|  |  atomicWriteFile / atomicWriteIfUnchanged                 |    |
|  |  createAtomicWriteStream                                  |    |
|  |  statVersion / contentHash (xxhash-128)                   |    |
|  |                                                           |    |
|  |  stateless, pure path-based, open to all main modules     |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  Data Repositories (via DataApiService bridge to Renderer)        |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|  +-----------------------------------------------------------+    |
|  | FileEntryService (data repository, DB only)               |    |
|  |  getById / list / create / update / delete                |    |
|  +-----------------------------------------------------------+    |
|  +-----------------------------------------------------------+    |
|  | FileRefService (data repository, DB only)                 |    |
|  |  create / cleanupBySource / cleanupBySourceBatch          |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  Business Services (examples — each module chooses its own       |
|   origin and ref conventions)                                     |
|  +---------------+ +------------------+                           |
|  | MessageService| | KnowledgeService |   ...                     |
|  +---+-----------+ +------+-----------+                           |
|      |   |                |   |                                   |
|      read/write          read/write                               |
|      file_ref mgmt        file_ref mgmt                           |
|      (may use            (may use                                 |
|       DirectoryWatcher)   DirectoryWatcher)                       |
|                                                                   |
|  Background Services                                              |
|  +---------------------------------------------------------+      |
|  | OrphanRefScanner (Background phase)                     |      |
|  |  checkers: Record<FileRefSourceType, SourceTypeChecker> |      |
|  +---------------------------------------------------------+      |
+===================================================================+
```

**关键数据流**：

- **Renderer → Main（读取）**：DataApi → Handler → FileEntryService → DB（可 opt-in 合并 DanglingCache 状态）
- **Renderer → Main（写操作）**：IPC → FileManager（协调 DB + ops.ts）
- **业务 Service → 文件数据**：纯 DB 操作直接调 data repository；涉及 FS 的操作走 FileManager
- **外部目录监控**：业务 Service 通过 `createDirectoryWatcher()` 工厂创建实例订阅自己关心的事件；工厂内部自动把事件注入 DanglingCache（业务不感知）

### 4.2 业务服务的接触点

业务服务通过三个途径与文件模块交互：

- **无 FS 副作用的操作**（条目查询、引用管理）→ 直接 import data repository（`fileEntrySafe` / `fileRefService`）
- **涉及 FS 的操作**（读写文件内容、创建/删除 entry）→ **FileManager**
- **外部目录监控**（如有需要）→ 调 `createDirectoryWatcher()` 工厂（file_module 提供）；工厂自动把事件接入 DanglingCache，业务只需订阅自己关心的事件

#### (1) 创建业务时 —— 创建 FileRef

业务操作产生文件引用时，直接调用 `fileRefService.create()`。Renderer 不直接创建 ref。

`sourceType` / `role` 的具体取值由各业务模块自行约定，在 `SourceTypeChecker` 注册时统一登记（Layer 3 孤儿扫描依赖此登记，编译期强制）。

#### (2) 删除业务时 —— 清理 FileRef

业务对象被删除时，**必须**主动清理关联的 file_ref：

```typescript
// 单条
await fileRefService.cleanupBySource(sourceType, sourceId)
// 批量（例如删除一个父对象时连带其子对象的所有引用）
await fileRefService.cleanupBySourceBatch(sourceType, sourceIds)
```

各业务模块在自身 delete 流程中调用。未清理的 ref 由 Layer 3 孤儿扫描兜底。

#### (3) 业务服务访问文件的方式

```
BusinessService
    |
    +-- direct import (no FS side effect)
    |   +-- fileEntrySafe.getById(entryId)          -> FileEntry
    |   +-- fileEntrySafe.list(filter)              -> FileEntry[]
    |   +-- fileRefService.create(dto)              -> FileRef
    |   +-- fileRefService.cleanupBySource(...)     -> void
    |
    +-- via FileManager (has FS side effect)
    |   +-- read(entryId, opts?)                    -> ReadResult
    |   +-- write(entryId, data)                    -> FileVersion  [internal only]
    |   +-- writeIfUnchanged(entryId, data, ver)    -> FileVersion  [internal only]
    |   +-- withTempCopy(entryId, fn)               -> T            [for 3rd-party libs]
    |
    +-- fileModule.createDirectoryWatcher(opts) (optional)
    |   +-- for monitoring external directories (NoteService 等业务)
    |   +-- factory auto-wires events into DanglingCache
    |
    x-- fs.readFile / writeFile / unlink           -> FORBIDDEN for FileEntry paths
    x-- ops/fs direct on managed paths              -> FORBIDDEN for FileEntry paths
```

**为什么禁止业务 Service 直接操作 FileEntry 对应的物理文件**：

- **路径不透明**：物理路径由 origin 决定（internal = UUID-based；external = user-provided），业务服务不应假设
- **缓存一致性**：FileManager 维护内存版本缓存，绕过它会导致不一致
- **原子性保证**：写入必须经过 FileManager 的 atomic write 路径

此约束的 scope 是 **FileEntry 对应的物理文件**。其他模块管理的自有文件（Knowledge 向量索引、Agent 工作区、MCP 配置、Notes 等）不在此约束范围内。

### 4.3 Path Operations 的暴露原则

`resolvePhysicalPath` **不对外暴露**。业务服务通过两种方式获取文件内容：

1. **Buffer / Stream**：`FileManager.read` / `createReadStream` —— 大多数场景
2. **临时副本**：`FileManager.withTempCopy(id, fn)` —— 用于只吃 path 的第三方库（sharp / pdf-lib / officeparser 等）

这保证了写入必然经过 FileManager（类型系统层无写路径出口），同时三方库 path 强依赖场景有逃生舱。

**未来**：AI SDK 上传将通过独立的 `FileUploadService.ensureUploaded` 封装 read + upload 流程（待 AI SDK Files API 稳定后引入）。

---

## 5. 服务生命周期

### 5.1 启动阶段分配

```
Lifecycle Services:

BeforeReady (parallel with app.whenReady(), no Electron API)
+-- DbService                    -- database connection

WhenReady (after app.whenReady(), Electron API available)
+-- FileManager                  -- entry coordination + IPC
      @DependsOn(DbService)
      onInit(): registers IPC, inits LRU cache, inits DanglingCache reverse
                index from DB, FIRES background orphan sweep
                (sweep runs async; does NOT block ready)

Background (fire-and-forget, non-blocking)
+-- OrphanRefScanner             -- delayed 30s, scan orphan refs
+-- FileManager.runOrphanSweep   -- started in onInit, cleans internal UUID
                                    files not in DB + *.tmp-<uuid> residues

Singletons / Primitives (no lifecycle):
+-- ops.ts                        -- sole FS owner, stateless
+-- DanglingCache                 -- file_module singleton, populated lazily
+-- DirectoryWatcher              -- consumable class, created via factory

Data Repositories (not lifecycle, managed by DataApiService):
+-- FileEntryService              -- entry CRUD (pure DB)
+-- FileRefService                -- ref CRUD (pure DB)
```

**延后引入（AI SDK 稳定后）**：

- `FileUploadService` (lifecycle service) + `FileUploadRepository`

### 5.2 启动时序

```
                     BeforeReady
                          |
                      DbService
                          |
                     app.whenReady()
                          |
                          v     WhenReady
                     FileManager.onInit():
                       1. register IPC handlers
                       2. initialize version cache LRU
                       3. init DanglingCache reverse index from DB
                          (SELECT id, externalPath FROM file_entry
                           WHERE origin='external' AND trashedAt IS NULL)
                       4. fire void this.runOrphanSweep()  ◄── 不 await
                                   │
                          (ready 信号立即发出,ready 不阻塞)
                          │                            │
                          ▼                            ▼
                      onAllReady()                 （后台并行）
                          │                   orphan sweep:
                          ▼                     UUID files not in DB → unlink
                 OrphanRefScanner.start          *.tmp-<uuidv7> → unlink
                 (delayed 30s)
```

**关键**：`runOrphanSweep()` 以 `void` 启动而非 await，`onInit` 立即返回、服务立即 ready。DanglingCache 反向索引初始化是**同步 DB 查询**，应当快速（external entries 通常 <10000 条），不额外引入 signal 机制。

### 5.3 业务服务的依赖声明

任何消费 FileManager 的业务 service 都需要 `@DependsOn(FileManager)`：

```
<AnyBusinessService>
  @DependsOn(FileManager)
  +-- queries entries via fileEntrySafe (no FS side effect)
  +-- creates/cleans refs via fileRefService (pure DB)
  +-- reads file content via FileManager (FS)
  +-- (optional) owns DirectoryWatcher instances via the factory
```

具体的 service 及其依赖声明由各业务模块在 `serviceRegistry.ts` 注册。

---

## 6. 文件位置与模块边界

```
src/main/data/                        -- data layer (pure DB)
  services/
    FileEntryService.ts               -- repository: exports fileEntryService + fileEntrySafe
    FileRefService.ts                 -- repository: exports fileRefService
  api/handlers/
    files.ts                          -- DataApi handler, no FS side effect
  db/schemas/
    file.ts                           -- file_entry / file_ref

src/main/file/                        -- file module
  FileManager.ts                      -- entry lifecycle + IPC + startup orphan sweep (background)
  orphanSweep.ts                      -- internal helper: UUID file + *.tmp residue cleanup
  danglingCache.ts                    -- singleton: external entry presence state
                                         exports: check / onFsEvent / addEntry / removeEntry
  watcher/
    DirectoryWatcher.ts               -- chokidar wrapper primitive
    factory.ts                        -- createDirectoryWatcher() — auto-wires danglingCache
    index.ts                          -- barrel export
  ops/                                -- pure functions, FS owner
    index.ts                          -- barrel export
    fs.ts                             -- read / write / stat / copy / move / remove
                                         atomicWriteFile / atomicWriteIfUnchanged
                                         createAtomicWriteStream
                                         statVersion / contentHash
    shell.ts                          -- open / showInFolder
    path.ts                           -- resolvePath / isPathInside / canWrite / isNotEmptyDir
    metadata.ts                       -- getFileType / isTextFile / mimeToExt
    search.ts                         -- listDirectory (ripgrep + fuzzy matching)
```

---

## 7. 约束与限制

- **External entry 是 best-effort 引用**：不保证文件稳定存在，不保证内容和引用时一致。对应 codex 等工具的"用户在某时刻表达过要引用此路径"语义
- **External entry path unique**：同路径同时最多一个 non-trashed entry（SQLite partial unique index）。`createEntry(external)` 变为 upsert：存在 non-trashed 则复用，存在 trashed 则 restore
- **External entry 允许用户显式编辑**：`write` / `writeIfUnchanged` / `createWriteStream` / `rename` / `permanentDelete` 对 external 生效（分别委派到 ops 的 atomic write / fs.rename / ops.remove），由用户显式操作触发。Cherry **不做**自动 / watcher 驱动的 external 文件修改
- **External entry 的 trash / restore 只动 DB**：不触碰用户的物理文件，仅通过 `trashedAt` 实现 Cherry 视图的软删除
- **Cherry 不追踪 external 文件的 rename/move**：外部 rename 会让 entry 变 dangling，用户需重新 @ 建立新引用
- **External entry 的 DB 快照可能陈旧**：list 查询直接返回 DB 值；关键路径（read / hash / upload）自动 stat-verify + 刷新；UI 可提供手动刷新
- **Dangling 状态通过 DanglingCache + opt-in DataApi 参数暴露**：不持久化到 DB，watcher 事件 + 冷路径 stat 推送更新
- **物理路径不持久化**：internal 由 `application.getPath('files', ...)` 推导；external 从 `externalPath` 列读取
- **FileRef 多态无 FK**：`sourceId` 指向不同业务表，依赖应用层清理 + 孤儿扫描兜底
- **File Module 不做目录导入 / 双向同步**：业务模块用 DirectoryWatcher + 自己的映射表实现
- **File Module 不启动任何 chokidar watcher**：watcher 生命周期由业务模块管理，通过工厂创建时自动对接 DanglingCache

---

## 8. 扩展点

| 扩展方向                               | 接入方式                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| AI provider 上传（SDK 稳定后引入）     | 新增 `FileUploadService` + `file_upload` 表；FileEntry 结构不变；迁移以 additive migration 完成 |
| 新增业务引用来源                       | 新增 `sourceType` 枚举值 + 注册 `SourceTypeChecker`（编译期强制）                               |
| 业务模块需要监控外部目录               | 通过 `createDirectoryWatcher()` 工厂获取实例；订阅事件；DanglingCache 自动同步                  |
| Dangling 反应性（实时 push 给 renderer）| 当前走 DataApi query-time lookup；未来可在 DanglingCache 状态变化时触发 DataApi invalidation     |
| 跨设备文件同步                         | 超出 file_module 范围；由应用层或外部同步工具（Drive/Dropbox）解决                              |
| 全文搜索                               | 当前 `ops/search.ts` 提供基于 ripgrep 的扫描；持久化索引由 Knowledge 等业务自行管理             |
