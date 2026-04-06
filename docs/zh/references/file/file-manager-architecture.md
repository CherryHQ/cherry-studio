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

### 1.1 统一条目模型

所有文件系统实体（文件、目录、挂载点）统一表达为**条目（File Entry）**，存储在单一条目表中。

```
FileEntry
├── type: file | dir | mount
├── name: 用户可见名称（不含扩展名）
├── ext: 扩展名（不含前导点），目录/挂载点为 null
├── parentId: 父条目 ID（邻接表模式）
├── mountId: 所属挂载点 ID（冗余字段，避免递归查询）
├── contentHash: md5(content)，索引，目录/挂载点为 null
└── fullHash: md5(content + name + ext)，索引，目录/挂载点为 null
```

三种条目类型的不变量（Invariants）：

| 类型    | parentId | mountId          | providerConfig | ext         | contentHash | fullHash     |
| ------- | -------- | ---------------- | -------------- | ----------- | ----------- | ------------ |
| `mount` | `null`   | 自身 ID          | 必填           | `null`      | `null`      | `null`       |
| `dir`   | 非 null  | 继承自祖先 mount | `null`         | `null`      | `null`      | `null`       |
| `file`  | 非 null  | 继承自祖先 mount | `null`         | 通常非 null | MD5         | MD5          |

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

| 决策              | 结论                    | 核心理由                                          |
| ----------------- | ----------------------- | ------------------------------------------------- |
| 挂载点与条目      | **同表**                | 挂载点极少（2-5 个），字段浪费可忽略              |
| 去重策略          | **双 hash 去重** | contentHash（纯内容）+ fullHash（内容+name+ext）。粘贴查 contentHash，上传查 fullHash。重复时返回已有 entry |
| 主键              | **UUID v7**             | 时间有序，大表顺序插入性能优                      |
| 删除模型          | **OS 风格 Trash**       | 用户心智模型一致，可恢复                          |
| `mountId` 冗余    | **保留**                | 避免递归 CTE 查挂载点，查询性能关键               |
| 跨 mount 移动     | **禁止**                | 存储模式不兼容，复杂度高，用"复制+删除"替代       |
| 元数据生成        | **Service 单一入口**    | mountId 推导、name/ext 拆分、size 读取全部收口    |
| DataApi 写操作    | **仅无 FS 副作用**      | 纯元数据更新（sortOrder 等）走 DataApi，有 FS 副作用的走 File IPC |
| FileRef 创建      | **不暴露 DataApi 端点** | Ref 创建是业务操作的副作用，业务 Service 直接调用 |
| `ext`/`size` 存放 | **保留在 fileEntryTable** | 高频过滤/排序需索引支持，查询性能优先           |
| 临时文件          | **`mount_temp` mount** | 享受统一 Trash/清理机制，无 ref 则自动清理        |
