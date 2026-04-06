# FileManager Architecture

> **本文档聚焦 FileManager 子模块**——条目模型、存储架构、同步机制、回收站与引用清理。
>
> 模块级架构（组件职责、IPC 设计、服务集成、生命周期）见 [architecture.md](./architecture.md)。
>
> 相关文档：
> - `v2-refactor-temp/docs/file-manager/rfc-file-manager.md` — 实现设计文档（Schema、API 细节、迁移策略）
> - `v2-refactor-temp/docs/file-manager/ipc-redesign.md` — IPC 方法从 v1 到 v2 的迁移映射

---

## 1. 核心概念

### 1.1 条目模型（File Entry）

文件和目录统一表达为**条目（File Entry）**，存储在条目表中。

```
FileEntry
├── type: file | dir
├── name: 用户可见名称（不含扩展名）
├── ext: 扩展名（不含前导点），目录为 null
├── parentId: 父条目 ID（邻接表模式），mount 直接子条目为 null
├── mountId: 所属挂载点 ID（FK → mount 表）
├── contentHash: md5(content)，索引，目录为 null
├── fullHash: md5(content + name + ext)，索引，目录为 null
└── trashedAt: ms epoch | null（非 null 表示已 trash）
```

两种条目类型的不变量（Invariants）：

| 类型   | parentId                   | mountId       | ext         | contentHash | fullHash |
| ------ | -------------------------- | ------------- | ----------- | ----------- | -------- |
| `dir`  | nullable（mount 根子条目为 null） | FK → mount 表 | `null`      | `null`      | `null`   |
| `file` | nullable（mount 根子条目为 null） | FK → mount 表 | 通常非 null | MD5         | MD5      |

### 1.2 挂载点（Mount）— 独立表

挂载点从条目表中分离为独立的 **mount 表**，每个挂载点定义一种存储模式。

```
Mount
├── id: UUID v7（系统预置使用固定 systemKey 查找）
├── systemKey: 'files' | 'notes' | 'temp' | 'trash' | null
├── name: 用户可见名称
├── mountType: 'local_managed' | 'local_external' | 'remote' | 'system'
├── basePath: 存储根路径（local_managed / local_external）
├── watch: boolean（local_external）
├── watchExtensions: string[]（local_external）
├── apiType: 远程 API 类型（remote）
├── providerId: 远程服务商 ID（remote）
├── cachePath: 本地缓存路径（remote）
├── autoSync: boolean（remote）
└── remoteOptions: json（remote 扩展配置）
```

**分离理由**：

- mount 本质上是系统配置（< 10 行），与动态增长的 file entry 性质不同
- 消除 99.9% 行上的 `mountConfig` NULL 冗余
- `mountId` 成为真正的 FK 约束（而非 soft reference）
- 各 mount 类型的配置字段独立为列，无需 JSON 反序列化
- 支持动态创建 mount（用户自建 Obsidian vault、多个 remote 连接等）

**系统预置 mount 通过 `systemKey` 查找**，动态创建的 mount 的 `systemKey` 为 null，使用 UUID 标识。

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

### 2.1 Mount 类型驱动的存储模式

不同类型的文件有不同的存储需求，通过 mount 表的 `mountType` 区分：

| mountType         | Source of Truth | 物理文件名               | 典型用途                    |
| ----------------- | --------------- | ------------------------ | --------------------------- |
| `local_managed`   | DB              | `{id}.{ext}`             | 应用托管文件（附件、上传）  |
| `local_external`  | 文件系统        | `{name}.{ext}`           | 笔记（支持外部编辑器）      |
| `system`          | DB              | 无自有存储               | Trash mount（无物理存储）   |
| `remote` _(未来)_ | 远程 API        | `{cachePath}/{remoteId}` | 远程文件（OpenAI Files 等） |

### 2.2 系统预置挂载点

系统预置 mount 存储在 mount 表中，通过 `systemKey` 标识：

```
mount table (systemKey → mountType)
├── files   [local_managed]   ── 应用托管文件
├── notes   [local_external]  ── 笔记文件
├── temp    [local_managed]   ── 临时文件（粘贴、预览等）
└── trash   [system]          ── 回收站标记（无物理存储，仅用于 trashedAt 过期策略）
```

首次启动时幂等创建。动态创建的 mount（用户自建 vault 等）`systemKey` 为 null，使用 UUID 标识。

### 2.3 路径计算

物理路径**不持久化**，运行时由挂载点配置 + 树关系动态构建：

- **`local_managed`**: `{mount.basePath}/{entry.id}.{entry.ext}` — 平坦存储，目录仅逻辑存在
- **`local_external`**: `{mount.basePath}/{...ancestorNames}/{entry.name}.{entry.ext}` — 映射 OS 目录树
- **Trash 中的条目**：`trashedAt` 不改变 `parentId` 和 `mountId`，路径解析仍用原 mount

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
FileManager --lock--> OperationLock <--check-- 内部同步引擎 (chokidar)
    |                                              |
    |--ops.rename()--> ... --> unlink event --> "locked, skip"
    |--db.update()                                 |
    |--unlock()--> OperationLock                   |
```

**冲突策略**：文件系统 wins。

### 3.3 remote — 远程同步 _(未来)_

远程 API 为 Source of Truth → 本地缓存 + 条目表作为镜像层。按需下载，缓存失效通过 `cachedAt` 与远程 `updatedAt` 比较判断。

---

## 4. 删除与回收站

### 4.1 OS 风格 Trash（trashedAt 方案）

采用 **OS 风格 Trash**（类 macOS/Windows 回收站），通过 `trashedAt` 时间戳标记：

| 操作         | DB 操作                          | 物理影响（managed） | 物理影响（external）                |
| ------------ | -------------------------------- | ------------------- | ----------------------------------- |
| **Trash**    | `trashedAt = Date.now()`         | 仅 DB 操作          | 物理移动到 `.trash/{entryId}/`      |
| **Restore**  | `trashedAt = null`               | 仅 DB 操作          | 物理移回原路径                      |
| **永久删除** | 硬删条目（CASCADE 子条目）       | 删物理文件 + 删 DB  | 删 `.trash` 中的物理文件 + 删 DB    |

**`trashedAt` 方案的优势**（相比旧方案 `parentId = system_trash` + `previousParentId`）：

- `parentId` 从不改变 → 不需要 `previousParentId` 字段
- 不需要 `system_trash` 条目 → mount 表分离更干净
- `trashedAt` 天然支持自动过期查询（`WHERE trashedAt < now() - 30d`）
- 不需要 trash 状态的双条件 check 约束

**设计要点**：

- 只有被直接 trash 的顶层条目设置 `trashedAt`，子条目不设（通过父级 CASCADE 或树遍历隐式处理）
- Trash 条目保持原 `parentId` 和 `mountId` 不变（路径解析仍用原 mount）
- 回收站列表：`WHERE trashedAt IS NOT NULL`（仅顶层 trash 条目）
- 永久删除顺序：先删物理文件 → 再删 DB（保证可重试）
- chokidar 排除 `.trash` 目录

**Edge Case 处理**（参考 macOS / Windows）：

- **恢复时原父目录已删**：自动重建原路径的目录结构，而非 fallback 到根目录
- **磁盘空间管理**：UI 显示回收站占用空间，支持用户手动清空。未来可增加磁盘空间不足时自动清理最旧条目
- **自动过期**：默认 30 天自动清理（lifecycle service 定时器），可由用户在 Preference 中配置天数或关闭

### 4.2 临时文件生命周期（mount_temp）

`mount_temp` 是 `local_managed` 类型的挂载点，`basePath = {userData}/Data/files/temp/`，用于粘贴、临时预览等场景。

**生命周期管理**：

- **有 ref 的临时文件**：由调用方显式管理。典型流程：粘贴时创建 ref → 发送后删临时 ref + 创建正式 ref + move 到 `mount_files` → 取消时删 ref
- **无 ref 的临时文件**：自动清理（启动时 + 定期扫描）
- **清理器绝不自动删除 ref**，通过删 ref 来主动释放不需要的缓存

### 4.3 临时文件的业务流转

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

## 6. 关键设计决策

| 决策              | 结论                           | 核心理由                                          |
| ----------------- | ------------------------------ | ------------------------------------------------- |
| 挂载点与条目      | **独立表**                     | mount 是系统配置（< 10 行），与动态 entry 性质不同；消除 NULL 冗余；mountId 成为真正 FK |
| mount 配置存储    | **独立列（非 JSON）**          | mount 行数极少，列级存储直接可查询，无需 JSON 反序列化 |
| 去重策略          | **双 hash 去重**               | contentHash（纯内容）+ fullHash（内容+name+ext）。粘贴查 contentHash，上传查 fullHash。重复时返回已有 entry |
| 主键              | **UUID v7**                    | 时间有序，大表顺序插入性能优                      |
| 删除模型          | **OS 风格 Trash（trashedAt）** | `trashedAt` 时间戳标记，parentId 不变；天然支持自动过期；无需 system_trash 条目和 previousParentId 字段 |
| `mountId` 冗余    | **保留（FK → mount 表）**      | 避免递归 CTE 查挂载点，查询性能关键               |
| 跨 mount 移动     | **禁止**                       | 存储模式不兼容，复杂度高，用"复制+删除"替代       |
| 元数据生成        | **Service 单一入口**           | mountId 推导、name/ext 拆分、size 读取全部收口    |
| DataApi 写操作    | **仅无 FS 副作用**             | 当前无零副作用字段，暂不暴露 PATCH 端点            |
| FileRef 创建      | **不暴露 DataApi 端点**        | Ref 创建是业务操作的副作用，业务 Service 直接调用 |
| `ext`/`size` 存放 | **保留在 fileEntryTable**      | 高频过滤/排序需索引支持，查询性能优先             |
| 临时文件          | **`mount_temp` mount**         | 享受统一 Trash/清理机制，无 ref 则自动清理        |
