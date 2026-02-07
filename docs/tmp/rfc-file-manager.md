# RFC: 文件管理（单一节点表 + 文件树）

## 一、背景

现有问题参见 `./file-arch-problems.md`，核心矛盾包括：

- 职责边界割裂与一致性风险（问题 1/2/3/11）。
- 去重机制与用户可见性冲突（问题 4）。
- 缺少结构化目录树与统一检索入口（问题 6/10）。
- 业务来源不可区分、引用关系不显式（问题 5/7）。
- 笔记体系与全局文件管理割裂（问题 9）。
- 元数据生成多入口导致策略不一致（问题 13）。

因此需要以"单一节点表 + 文件树 + 引用关系"作为新的文件管理基础，以解决上述结构性问题。

---

## 二、范畴说明

- 本 RFC 覆盖节点模型、文件树结构、存储模式、数据 Schema、核心流程、API 设计、引用清理、迁移策略与分阶段实施计划。
- 不涉及 UI 交互与具体页面改动。
- 不讨论元信息编辑（如改名、标签）之外的业务流程变更。

补充说明：

- 对话内复用应用内部文件的交互不在本 RFC 范围内，但在实现文件树后应可通过业务流程接入。（问题 8）
- 笔记体系需要迁移到本文件树架构之下，纳入统一节点表与引用关系。（问题 9/10）
- `FileMetadata` 等元数据生成应收口到统一工厂入口，避免多入口策略不一致。（问题 13）
- Painting 业务重构不在本次范围内，仅依赖 FileMigrator 提供的 fileId，随 Painting 重构独立推进。

---

## 三、设计目标

- 统一主进程入口与一致性保障，消除职责边界割裂。（问题 1/2/3/11）
- 放弃去重，让用户视角文件保持独立。（问题 4）
  - 可保留重复文件检查，由用户决定具体行为。
- 以单一节点表表达文件与目录，并形成可检索的目录树。（问题 6/10）
- 用显式引用关系表达业务使用情况与来源。（问题 5/7）
- 为笔记体系与对话复用提供结构基础。（问题 8/9）
- 为迁移与扩展提供清晰的演进方向。（问题 12/13）

---

## 四、双模式存储设计

### 4.1 问题

"节点应当保证与 OS 文件系统的目录结构保持一致"与"底层存储文件名为 `id + ext`"不可兼得。笔记系统必须使用人类可读文件名以支持外部编辑器（VS Code、Obsidian）。

### 4.2 方案：Provider 驱动的挂载点

引入**挂载点（Mount）**概念，每个挂载点定义一种存储模式：

| 挂载点 | provider_type | 物理文件名 | Source of Truth | 同步方向 |
|--------|-------------|-----------|----------------|---------|
| Files | `local_managed` | `{id}.{ext}` | DB | App → 文件系统 |
| Notes | `local_external` | `{name}.{ext}` | 文件系统 | 文件系统 ↔ DB |
| *(未来)* | `remote` | `{cache_path}/{remote_id}` | 远程 API | 远程 ↔ 本地缓存 ↔ DB |

### 4.3 路径计算规则

节点的物理路径由挂载点的 `provider_type` 决定：

- **`local_managed`**：`{mount.base_path}/{node.id}.{node.ext}`（平坦存储，目录仅逻辑）
- **`local_external`**：`{mount.base_path}/{...ancestor_names}/{node.name}.{node.ext}`（映射 OS 目录树）
- **`remote`**：`{mount.cache_path}/{node.remoteId}`（本地缓存），实际文件通过 API 访问，按需下载/同步

`path` 不作为持久化字段，运行时由树关系与挂载点配置构建。建议维护内存级路径缓存 `Map<nodeId, absolutePath>`，树变更时重建。

### 4.4 各模式同步策略

#### local_external 模式（Notes）

文件系统为 Source of Truth，节点表作为索引层：

```
                    ┌──────────────────┐
                    │   文件系统 (SoT)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         chokidar       启动时扫描      手动刷新
         (增量事件)     (全量 reconcile) (用户触发)
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                    ┌──────────────────┐
                    │  节点表 (索引层)   │
                    └──────────────────┘
```

- **启动时**：全量扫描文件系统 → diff 节点表 → 增删改对齐
- **运行时**：chokidar 监听 → 防抖 → 增量更新节点表
- **冲突处理**：文件系统 wins

#### remote 模式（远程文件 API）

远程 API 为 Source of Truth，本地缓存 + 节点表作为镜像层：

```
                    ┌──────────────────┐
                    │   远程 API (SoT)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         轮询/API推送    启动时全量同步   用户手动刷新
         (增量事件)     (list + diff)   (触发同步)
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                    ┌──────────────────┐
                    │   本地缓存        │
                    │  {cache_path}    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  节点表 (镜像层)   │
                    └──────────────────┘
```

- **启动时**：调用远程 API list files → diff 本地节点表 → 增删改对齐
- **运行时**：轮询或 webhook 接收变更 → 下载/更新本地缓存 → 更新节点表
- **本地访问**：优先读本地缓存，`isCached=true` 时直接返回缓存路径；未缓存时按需下载
- **冲突处理**：远程 wins（本地修改后需显式上传）
- **离线支持**：缓存文件可离线访问，联网后同步变更

#### 跨 Provider 文件引用

当需要在本地引用远程文件时（如用 Provider B 处理 Provider A 的文件），流程如下：

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Provider A     │         │   本地缓存       │         │  Provider B     │
│  (remote mount) │ ──────→ │ (managed mount) │ ──────→ │ (remote mount)  │
│                 │ 下载     │                 │ 上传     │                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
        ↑                                                    │
        └──────────────── file_ref ──────────────────────────┘
                    sourceType='chat_message'
                    role='attachment'
                    nodeId = 本地缓存节点ID
```

**处理流程**：

1. **用户选择远程文件**：从 `mount_openai` 选择 `file-abc123`
2. **创建本地副本**：下载到 `mount_files`（managed），生成新节点 `local-copy-xyz`
3. **建立引用**：创建 `file_ref`（`nodeId=local-copy-xyz`, `sourceType='chat_message'`）
4. **发送给 Provider B**：读取本地缓存路径 → 上传 → 获取 Provider B 的 `file_id`
5. **清理**：消息发送完成后，根据策略保留或删除本地副本

**设计要点**：

- 本地副本作为"暂存区"，生命周期与业务对象绑定
- 通过 `file_ref` 追踪"哪个消息引用了哪个本地副本"
- 本地副本存储在 `mount_files`（managed），享受统一的 Trash/清理机制
- 可选：标记 `isTemporary=true`，在引用清理时自动删除

---

## 五、Provider 配置类型定义

### 5.1 Zod Schema

采用 **Base + options 泛型字段** 模式：公共字段强类型，Provider 专属配置放在 `options` 中由具体实现二次验证。

```typescript
import * as z from 'zod'

// ─── Provider Type 枚举 ───
export const MountProviderTypeSchema = z.enum([
  'local_managed',
  'local_external',
  'remote',
])
export type MountProviderType = z.infer<typeof MountProviderTypeSchema>

// ─── Remote API 类型枚举（可扩展）───
export const RemoteApiTypeSchema = z.enum([
  'openai_files',
  // 未来: 's3', 'webdav', 'google_drive', ...
])
export type RemoteApiType = z.infer<typeof RemoteApiTypeSchema>

// ─── 各 Provider 的 Config Schema ───

/** 托管文件：应用内部管理，UUID 命名 */
export const LocalManagedConfigSchema = z.object({
  provider_type: z.literal('local_managed'),
  base_path: z.string().min(1),
})

/** 外部文件：文件系统为主，人类可读命名 */
export const LocalExternalConfigSchema = z.object({
  provider_type: z.literal('local_external'),
  base_path: z.string().min(1),
  watch: z.boolean().default(true),
  watch_extensions: z.array(z.string()).optional(),
})

/** 远程文件：通过 API 访问 */
export const RemoteConfigSchema = z.object({
  provider_type: z.literal('remote'),
  api_type: RemoteApiTypeSchema,
  provider_id: z.string().min(1),       // 关联 AI provider 配置（不存敏感信息）
  cache_path: z.string().optional(),
  auto_sync: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({}),  // 各 API 专属配置
})

// ─── 判别联合 ───
export const MountProviderConfigSchema = z.discriminatedUnion('provider_type', [
  LocalManagedConfigSchema,
  LocalExternalConfigSchema,
  RemoteConfigSchema,
])
export type MountProviderConfig = z.infer<typeof MountProviderConfigSchema>
```

### 5.2 远程 Provider 扩展模式

`RemoteConfigSchema.options` 是泛型 Record，具体 Provider 实现时二次验证：

```typescript
// 示例：OpenAI Files Provider 实现中
const OpenAIFilesOptionsSchema = z.object({
  purpose_filter: z.array(z.string()).optional(),
  org_id: z.string().optional(),
})

class OpenAIFilesProvider implements RemoteProvider {
  constructor(config: RemoteConfig) {
    this.options = OpenAIFilesOptionsSchema.parse(config.options)
  }
}
```

核心 Schema 不需要因新增 Provider 而变更。

---

## 六、数据模型（Drizzle Schema）

### 6.1 设计决策汇总

| 决策项 | 结论 | 理由 |
|--------|------|------|
| 挂载点与节点同表/分表 | **同表** | 挂载点极少（2-5 个），字段浪费可忽略 |
| managed 模式目录 | **平坦存储** | 物理无子目录，目录仅逻辑存在于 DB |
| 主键策略 | **UUID v7**（时间有序） | 大数据量表，顺序插入性能更优 |
| 删除策略 | **OS 风格 Trash** | 移动到 Trash 节点下，记录 previousParentId |
| `mountId` 冗余字段 | **保留** | 避免递归 CTE 查挂载点，查询性能关键 |
| `parentId` 级联删除 | **CASCADE** | Trash 清空时物理级联删除子节点 |
| `sourceType`/`role` 枚举约束 | **应用层 Zod 验证** | 避免新增来源需要 migration |
| `file_ref` 防重复 | **UNIQUE 约束** | 防止应用层 bug 导致重复引用 |

### 6.2 nodeTable

```typescript
import type { MountProviderConfig } from '@shared/data/types/fileNode'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Node table - unified file/directory/mount node entity
 *
 * Uses adjacency list pattern (parentId) for tree navigation.
 * Mount nodes (type='mount') serve as root nodes with provider configuration.
 * Trash is a system directory node for OS-style soft deletion.
 */
export const nodeTable = sqliteTable(
  'node',
  {
    id: uuidPrimaryKeyOrdered(),

    // ─── 核心字段 ───
    // 节点类型：file | dir | mount
    type: text().notNull(),
    // 用户可见名称（不含扩展名）
    name: text().notNull(),
    // 扩展名，不含前导点（如 'pdf'、'md'）。目录/挂载点为 null
    ext: text(),

    // ─── 树结构 ───
    // 父节点 ID。挂载点和 Trash 为 null（顶层）
    parentId: text(),
    // 所属挂载点 ID（冗余，便于查询）。挂载点自身 mountId = id
    // Trash 中的节点保持原 mountId 不变
    mountId: text().notNull(),

    // ─── 文件属性 ───
    // 文件大小（字节）。目录/挂载点为 null
    size: integer(),

    // ─── 挂载点专属（仅 type='mount'）───
    // Provider 配置 JSON，经 MountProviderConfigSchema 验证
    providerConfig: text({ mode: 'json' }).$type<MountProviderConfig>(),
    // 是否只读（远程源可能只读）
    isReadonly: integer({ mode: 'boolean' }).default(false),

    // ─── 远程文件预留（仅远程挂载点下的文件）───
    // 远程端文件 ID（如 OpenAI file-abc123）
    remoteId: text(),
    // 是否有本地缓存副本
    isCached: integer({ mode: 'boolean' }).default(false),

    // ─── Trash 相关 ───
    // 被移入 Trash 前的原始父节点 ID（仅 Trash 直接子节点有值）
    previousParentId: text(),

    // ─── 时间戳 ───
    ...createUpdateTimestamps
  },
  (t) => [
    // 自引用外键：删除父节点时级联删除子节点（Trash 清空时生效）
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] })
      .onDelete('cascade'),
    // 索引
    index('node_parent_id_idx').on(t.parentId),
    index('node_mount_id_idx').on(t.mountId),
    index('node_mount_type_idx').on(t.mountId, t.type),
    index('node_name_idx').on(t.name),
    index('node_updated_at_idx').on(t.updatedAt),
    // 类型约束
    check('node_type_check', sql`${t.type} IN ('file', 'dir', 'mount')`),
  ]
)
```

### 6.3 fileRefTable

```typescript
/**
 * File reference table - tracks which business entities reference which files
 *
 * Polymorphic association: sourceType + sourceId identify the referencing entity.
 * No FK constraint on sourceId (polymorphic). Application-layer cleanup required
 * when source entities are deleted.
 *
 * nodeId has CASCADE delete: removing a file node auto-removes its references.
 */
export const fileRefTable = sqliteTable(
  'file_ref',
  {
    id: uuidPrimaryKey(),

    // 引用的文件节点 ID
    nodeId: text()
      .notNull()
      .references(() => nodeTable.id, { onDelete: 'cascade' }),

    // 业务来源类型（如 'chat_message', 'knowledge_item', 'painting', 'note'）
    // 枚举由应用层 Zod 验证，不设 CHECK 约束
    sourceType: text().notNull(),
    // 业务对象 ID（多态，无 FK 约束）
    sourceId: text().notNull(),
    // 引用角色（如 'attachment', 'source', 'asset'）
    role: text().notNull(),

    ...createUpdateTimestamps
  },
  (t) => [
    // 从文件查引用方
    index('file_ref_node_id_idx').on(t.nodeId),
    // 从业务对象查引用的文件
    index('file_ref_source_idx').on(t.sourceType, t.sourceId),
    // 防止重复引用（同一文件不能被同一业务对象以同一角色引用两次）
    uniqueIndex('file_ref_unique_idx').on(t.nodeId, t.sourceType, t.sourceId, t.role),
  ]
)
```

### 6.4 系统初始化节点

应用首次启动时创建以下系统节点：

```typescript
const SYSTEM_NODES = [
  {
    id: 'mount_files',           // 固定 ID
    type: 'mount',
    name: 'Files',
    mountId: 'mount_files',      // 自引用
    providerConfig: {
      provider_type: 'local_managed',
      base_path: getFilesDir(),  // {userData}/Data/Files
    },
  },
  {
    id: 'mount_notes',
    type: 'mount',
    name: 'Notes',
    mountId: 'mount_notes',
    providerConfig: {
      provider_type: 'local_external',
      base_path: getNotesDir(),  // 用户配置 或 {userData}/Data/Notes
      watch: true,
    },
  },
  {
    id: 'system_trash',
    type: 'dir',
    name: 'Trash',
    mountId: 'system_trash',     // Trash 不属于任何挂载点
    parentId: null,
  },
]
```

### 6.5 DTO 类型定义

位于 `packages/shared/data/types/fileNode.ts`。

```typescript
/** 节点实体 */
interface FileNode {
  id: string
  type: 'file' | 'dir' | 'mount'
  name: string
  ext: string | null
  parentId: string | null
  mountId: string
  size: number | null
  providerConfig: MountProviderConfig | null
  isReadonly: boolean
  remoteId: string | null
  isCached: boolean
  previousParentId: string | null
  createdAt: number
  updatedAt: number
}

/** 创建节点 */
interface CreateNodeDto {
  type: 'file' | 'dir'
  name: string
  ext?: string
  parentId: string
  mountId: string
  size?: number
}

/** 更新节点 */
interface UpdateNodeDto {
  name?: string
  ext?: string
}

/** 文件引用实体 */
interface FileRef {
  id: string
  nodeId: string
  sourceType: string
  sourceId: string
  role: string
  createdAt: number
  updatedAt: number
}

/** 创建引用 */
interface CreateFileRefDto {
  sourceType: string
  sourceId: string
  role: string
}
```

---

## 七、核心流程

### 7.1 统一入口与一致性要求（问题 1/2/3/11）

- 通过统一入口由 main 管理所有落地写入，renderer 仅通过 DataApi 交互。
- main 进程负责"物理写入 + 节点登记"的原子性保障。
- 任何失败都必须回滚物理文件或节点记录，避免半成状态。
- renderer 不得绕过 main 直接写入节点表。

### 7.2 上传

```
1. Renderer: window.api.file.upload(file)     ← 复用现有 IPC（物理文件传输）
2. Main: FileStorage 写入物理文件              ← 复用现有逻辑
3. Main: FileNodeService.create(nodeDto)       ← 新增：写入节点表
4. Main: 返回 FileNode                        ← 替代原有 FileMetadata
```

上传是原子操作：物理文件写入 + 节点创建在同一个 main 进程事务中完成。

补充约束：

- 放弃去重，不做内容去重。允许同名文件存在。
- `local_managed` 模式：底层存储文件名为 `id + ext`，不与用户可见名称冲突。
- `local_external` 模式：存储文件名为 `name + ext`，映射 OS 目录结构。

### 7.3 删除与恢复（OS 风格 Trash）

参照 Windows/macOS 回收站行为：

- **删除 = 移动到 Trash 目录下**（不是原地标记）
- **恢复 = 移回 `previousParentId`**
- **永久删除 = 从 Trash 中硬删**（CASCADE 级联子节点 + 物理文件清理）

#### 删除节点

```typescript
async function trashNode(nodeId: string): Promise<void> {
  const node = await getNode(nodeId)
  // 移动到 Trash 下，记录原始位置
  await db.update(nodeTable)
    .set({
      parentId: SYSTEM_TRASH_ID,
      previousParentId: node.parentId,
    })
    .where(eq(nodeTable.id, nodeId))
  // 子节点不需要移动 — 它们的 parentId 仍然指向被移动的节点
  // 整棵子树自然跟随父节点进入 Trash
}
```

#### 恢复节点

```typescript
async function restoreNode(nodeId: string): Promise<void> {
  const node = await getNode(nodeId)

  // 检查原始父节点是否存在且可达
  const originalParent = await getNode(node.previousParentId)
  if (!originalParent || isInTrash(originalParent)) {
    // 原路径不可达：选项 A - 恢复到挂载点根目录
    // 选项 B - 提示用户先恢复父目录
    throw new Error('Original parent is in Trash. Restore parent first.')
  }

  await db.update(nodeTable)
    .set({
      parentId: node.previousParentId,
      previousParentId: null,
    })
    .where(eq(nodeTable.id, nodeId))
}
```

#### 永久删除（清空回收站）

```typescript
async function permanentDelete(nodeId: string): Promise<void> {
  // 收集所有后代节点的物理文件路径（用于清理）
  const descendants = await getDescendants(nodeId) // 递归 CTE
  const filesToDelete = descendants
    .filter(n => n.type === 'file')
    .map(n => resolvePhysicalPath(n))

  // 硬删节点（CASCADE 自动删除子节点 + file_ref）
  await db.delete(nodeTable).where(eq(nodeTable.id, nodeId))

  // 清理物理文件
  await Promise.all(filesToDelete.map(p => fs.unlink(p).catch(() => {})))
}
```

#### 回收站展示

回收站只展示 Trash 的**直接子节点**（`parentId = SYSTEM_TRASH_ID`），每个条目是一个独立的删除操作单元。

#### 边界情况

| 场景 | 行为 |
|------|------|
| 删文件 A，再删其父目录 | Trash 中有两个独立条目：文件 A 和目录 |
| 恢复文件 A，但父目录在 Trash 中 | 提示"原目录已删除，请先恢复目录"或恢复到根目录 |
| 恢复目录 | 目录及其所有子节点恢复到原位（子节点 parentId 未变，自然跟随） |
| Trash 中目录包含子文件 | 子文件跟随目录，不单独展示为 Trash 条目 |
| 永久删除目录 | CASCADE 删除所有后代 + 清理物理文件 |

### 7.4 内容编辑

- 直接修改节点对应的真实文件。
- 更新节点 `updated_at` 与元信息。

### 7.5 元信息编辑

- 更新节点字段（如 `name`、`ext`）。
- `local_external` 模式需要同步更新真实文件名（文件系统 rename）。
- `local_managed` 模式仅更新 DB（物理文件名为 UUID，不受影响）。

### 7.6 元数据统一入口（问题 13）

- `FileMetadata` 等元数据生成收口到统一工厂入口。
- 保证 `ext`/`type` 生成策略一致，避免多入口规则漂移。

---

## 八、引用清理机制

### 8.1 问题

`file_ref.sourceId` 是多态字段（可能是 message ID、knowledge item ID、painting ID 等），无法用数据库外键约束级联删除。当业务对象被删除时，对应的 `file_ref` 记录可能变成悬挂引用。

### 8.2 三层防护

```
┌─────────────────────────────────────────────┐
│ 第一层：nodeId CASCADE                       │
│ 文件节点删除 → file_ref 自动级联删除          │
│ （由 DB FK 约束保证，无需应用层代码）          │
├─────────────────────────────────────────────┤
│ 第二层：业务删除钩子                          │
│ 业务对象删除时，主动清理对应 file_ref          │
│ （应用层 Service 代码，各删除路径必须接入）     │
├─────────────────────────────────────────────┤
│ 第三层：定期孤儿扫描                          │
│ 后台任务扫描 sourceId 不存在的 file_ref        │
│ （兜底安全网，补偿遗漏的清理路径）              │
└─────────────────────────────────────────────┘
```

### 8.3 第一层：nodeId CASCADE

`fileRefTable.nodeId` 外键 `onDelete: 'cascade'` 已在 Schema 中定义。

- 文件节点被永久删除（如清空回收站）→ 其所有 `file_ref` 自动删除
- 无需任何应用层代码

### 8.4 第二层：业务删除钩子

统一入口 `FileRefService`：

```typescript
class FileRefService {
  /** 清理某个业务对象的所有文件引用 */
  async cleanupBySource(sourceType: string, sourceId: string): Promise<void> {
    await db.delete(fileRefTable).where(
      and(
        eq(fileRefTable.sourceType, sourceType),
        eq(fileRefTable.sourceId, sourceId),
      )
    )
  }

  /** 批量清理（如删除 topic 时一次性清理所有消息的引用） */
  async cleanupBySourceBatch(sourceType: string, sourceIds: string[]): Promise<void> {
    await db.delete(fileRefTable).where(
      and(
        eq(fileRefTable.sourceType, sourceType),
        inArray(fileRefTable.sourceId, sourceIds),
      )
    )
  }
}
```

各业务删除路径的接入点：

| 删除场景 | 触发位置 | 清理调用 |
|---------|---------|---------|
| 删除消息 | `MessageService.delete()` | `cleanupBySource('chat_message', messageId)` |
| 删除 topic | `TopicService.delete()` | 先查出所有 messageIds → `cleanupBySourceBatch('chat_message', messageIds)` |
| 删除知识库 | `KnowledgeService.delete()` | `cleanupBySourceBatch('knowledge_item', itemIds)` |
| 删除知识库条目 | `KnowledgeService.remove()` | `cleanupBySource('knowledge_item', itemId)` |
| 删除 painting | painting 删除逻辑 | `cleanupBySource('painting', paintingId)` |

### 8.5 第三层：注册式孤儿扫描器

为避免 hardcode 各业务表的 JOIN，采用**注册式 checker 模式**——各模块注册自己的存在性检查函数，扫描器泛型执行。

```typescript
/** 存在性检查接口 */
interface SourceTypeChecker {
  sourceType: string
  /** 给一批 sourceId，返回其中仍然存在的 ID 集合 */
  checkExists: (sourceIds: string[]) => Promise<Set<string>>
}

class OrphanRefScanner {
  private checkers: Map<string, SourceTypeChecker> = new Map()
  private BATCH_SIZE = 200

  register(checker: SourceTypeChecker): void {
    this.checkers.set(checker.sourceType, checker)
  }

  /** 扫描一种 sourceType 的孤儿引用，分批处理 */
  async scanOneType(sourceType: string): Promise<number> {
    const checker = this.checkers.get(sourceType)
    if (!checker) return 0

    let cleaned = 0
    let offset = 0

    while (true) {
      const refs = await db.select({ id: fileRefTable.id, sourceId: fileRefTable.sourceId })
        .from(fileRefTable)
        .where(eq(fileRefTable.sourceType, sourceType))
        .limit(this.BATCH_SIZE)
        .offset(offset)

      if (refs.length === 0) break

      const sourceIds = refs.map(r => r.sourceId)
      const existingIds = await checker.checkExists(sourceIds)
      const orphanRefIds = refs
        .filter(r => !existingIds.has(r.sourceId))
        .map(r => r.id)

      if (orphanRefIds.length > 0) {
        await db.delete(fileRefTable)
          .where(inArray(fileRefTable.id, orphanRefIds))
        cleaned += orphanRefIds.length
      }

      offset += this.BATCH_SIZE
    }
    return cleaned
  }

  /** 扫描所有已注册的 sourceType */
  async scanAll(): Promise<{ total: number; byType: Record<string, number> }> {
    const byType: Record<string, number> = {}
    let total = 0
    for (const [sourceType] of this.checkers) {
      const cleaned = await this.scanOneType(sourceType)
      byType[sourceType] = cleaned
      total += cleaned
    }
    return { total, byType }
  }
}
```

各模块注册示例：

```typescript
orphanScanner.register({
  sourceType: 'chat_message',
  checkExists: async (ids) => {
    const rows = await db.select({ id: messageTable.id })
      .from(messageTable)
      .where(inArray(messageTable.id, ids))
    return new Set(rows.map(r => r.id))
  }
})
```

触发时机：

- 应用启动后延迟 30 秒执行（低优先级后台任务）
- 每次扫描一种 sourceType，间隔 5 秒（避免阻塞主进程）
- 用户可在设置页面手动触发"清理无效引用"

### 8.6 无引用文件的处理

当一个文件的所有引用都被清理后，文件变成"无人引用"状态。

策略：**文件保留，用户手动管理**。

- 无引用不代表用户不需要该文件（可能备用或手动浏览）
- 文件页面可以显示"未引用"标记，方便用户批量清理
- 不自动移入 Trash，避免用户困惑

---

## 九、API 层设计

遵循项目现有的 DataApi 架构模式：Schema（shared）→ Service（main）→ Handler（main）→ Hooks（renderer）。

### 9.1 API Schema 定义

位于 `packages/shared/data/api/schemas/files.ts`，与 `TopicSchemas`、`MessageSchemas` 同级。

```typescript
export type FileSchemas = {
  // ─── 节点 CRUD ───

  '/files/nodes': {
    /** 查询节点列表（支持按 mountId/parentId/inTrash 过滤） */
    GET: {
      query: {
        mountId?: string
        parentId?: string
        type?: 'file' | 'dir'
        inTrash?: boolean
      }
      response: FileNode[]
    }
    /** 创建节点（上传文件 / 创建目录） */
    POST: {
      body: CreateNodeDto
      response: FileNode
    }
  }

  '/files/nodes/:id': {
    GET: { params: { id: string }; response: FileNode }
    /** 更新节点元信息（重命名等） */
    PATCH: { params: { id: string }; body: UpdateNodeDto; response: FileNode }
    /** 永久删除节点 */
    DELETE: { params: { id: string }; response: void }
  }

  // ─── 树操作 ───

  '/files/nodes/:id/children': {
    /** 获取子节点（文件树懒加载） */
    GET: { params: { id: string }; query: { recursive?: boolean }; response: FileNode[] }
  }

  '/files/nodes/:id/move': {
    /** 移动节点到新父节点 */
    PUT: { params: { id: string }; body: { targetParentId: string }; response: FileNode }
  }

  '/files/nodes/:id/trash': {
    /** 移入 Trash（软删除） */
    PUT: { params: { id: string }; response: void }
  }

  '/files/nodes/:id/restore': {
    /** 从 Trash 恢复 */
    PUT: { params: { id: string }; response: FileNode }
  }

  // ─── 文件引用 ───

  '/files/nodes/:id/refs': {
    /** 查询文件的所有引用方 */
    GET: { params: { id: string }; response: FileRef[] }
    /** 创建引用 */
    POST: { params: { id: string }; body: CreateFileRefDto; response: FileRef }
  }

  '/files/refs/by-source': {
    /** 查询某个业务对象引用的所有文件 */
    GET: { query: { sourceType: string; sourceId: string }; response: FileRef[] }
    /** 清理某个业务对象的所有引用 */
    DELETE: { query: { sourceType: string; sourceId: string }; response: void }
  }

  // ─── 挂载点 ───

  '/files/mounts': {
    /** 获取所有挂载点 */
    GET: { response: FileNode[] }
  }
}
```

### 9.2 Service 层

位于 `src/main/data/services/`，遵循现有 `TopicService`、`MessageService` 模式。

```typescript
// FileNodeService - 节点业务逻辑
class FileNodeService {
  async create(dto: CreateNodeDto): Promise<FileNode>
  async getById(id: string): Promise<FileNode>
  async update(id: string, dto: UpdateNodeDto): Promise<FileNode>
  async permanentDelete(id: string): Promise<void>  // 硬删 + 物理文件清理
  async list(filters: NodeListFilters): Promise<FileNode[]>
  async getChildren(parentId: string, recursive?: boolean): Promise<FileNode[]>
  async getMounts(): Promise<FileNode[]>
  async move(id: string, targetParentId: string): Promise<FileNode>
  async trash(id: string): Promise<void>
  async restore(id: string): Promise<FileNode>
  async resolvePhysicalPath(id: string): Promise<string>
}

// FileRefService - 引用关系管理（同第八章定义）
class FileRefService {
  async create(nodeId: string, dto: CreateFileRefDto): Promise<FileRef>
  async getByNode(nodeId: string): Promise<FileRef[]>
  async getBySource(sourceType: string, sourceId: string): Promise<FileRef[]>
  async cleanupBySource(sourceType: string, sourceId: string): Promise<void>
  async cleanupBySourceBatch(sourceType: string, sourceIds: string[]): Promise<void>
}
```

### 9.3 Handler 注册

位于 `src/main/data/api/handlers/files.ts`，合并到 `apiHandlers`。

```typescript
export const fileHandlers = {
  '/files/nodes': {
    GET: async ({ query }) => nodeService.list(query),
    POST: async ({ body }) => nodeService.create(body),
  },
  '/files/nodes/:id': {
    GET: async ({ params }) => nodeService.getById(params.id),
    PATCH: async ({ params, body }) => nodeService.update(params.id, body),
    DELETE: async ({ params }) => { await nodeService.permanentDelete(params.id) },
  },
  '/files/nodes/:id/children': {
    GET: async ({ params, query }) => nodeService.getChildren(params.id, query?.recursive),
  },
  '/files/nodes/:id/move': {
    PUT: async ({ params, body }) => nodeService.move(params.id, body.targetParentId),
  },
  '/files/nodes/:id/trash': {
    PUT: async ({ params }) => { await nodeService.trash(params.id) },
  },
  '/files/nodes/:id/restore': {
    PUT: async ({ params }) => nodeService.restore(params.id),
  },
  '/files/nodes/:id/refs': {
    GET: async ({ params }) => fileRefService.getByNode(params.id),
    POST: async ({ params, body }) => fileRefService.create(params.id, body),
  },
  '/files/refs/by-source': {
    GET: async ({ query }) => fileRefService.getBySource(query.sourceType, query.sourceId),
    DELETE: async ({ query }) => { await fileRefService.cleanupBySource(query.sourceType, query.sourceId) },
  },
  '/files/mounts': {
    GET: async () => nodeService.getMounts(),
  },
}

// handlers/index.ts 中合并
export const apiHandlers: ApiImplementation = {
  ...topicHandlers,
  ...messageHandlers,
  ...fileHandlers,   // ← 新增
}
```

### 9.4 Renderer 使用示例

```typescript
// 获取某目录下的子节点（文件树懒加载）
const { data: children } = useQuery('/files/nodes/:id/children', {
  params: { id: folderId },
})

// 获取 Trash 内容
const { data: trashItems } = useQuery('/files/nodes', {
  query: { inTrash: true },
})

// 创建文件节点
const { trigger: createNode } = useMutation('POST', '/files/nodes', {
  refresh: ['/files/nodes'],
})
await createNode({ body: { type: 'file', name: 'report', ext: 'pdf', parentId, mountId } })

// 移入 Trash
const { trigger: trashNode } = useMutation('PUT', '/files/nodes/:id/trash', {
  refresh: ['/files/nodes'],
})
await trashNode({ params: { id: nodeId } })

// 恢复
const { trigger: restore } = useMutation('PUT', '/files/nodes/:id/restore', {
  refresh: ['/files/nodes'],
})

// 查询文件被谁引用
const { data: refs } = useQuery('/files/nodes/:id/refs', {
  params: { id: fileNodeId },
})

// 查询某消息引用的所有文件
const { data: messageFiles } = useQuery('/files/refs/by-source', {
  query: { sourceType: 'chat_message', sourceId: messageId },
})
```

### 9.5 文件上传流程（特殊处理）

文件上传不同于普通 CRUD，需要先传输物理文件再创建节点。保留现有的 IPC 通道用于文件传输：

```
1. Renderer: window.api.file.upload(file)     ← 复用现有 IPC（物理文件传输）
2. Main: FileStorage 写入物理文件              ← 复用现有逻辑
3. Main: FileNodeService.create(nodeDto)       ← 新增：写入节点表
4. Main: 返回 FileNode                        ← 替代原有 FileMetadata
```

上传是原子操作：物理文件写入 + 节点创建在同一个 main 进程事务中完成，解决了 P1/P2 问题。

---

## 十、迁移策略

### 10.1 FileMigrator 设计

```typescript
class FileMigrator extends BaseMigrator {
  readonly id = 'file'
  readonly name = 'File Migration'
  readonly description = 'Migrate files from Dexie to node table'
  readonly order = 2.5  // After Assistant(2), Before Knowledge(3)
}
```

**执行顺序**：

```
Preferences(1) → Assistant(2) → File(2.5) → Knowledge(3) → Chat(4)
                                  ↑ 新增
```

- FileMigrator 在 Knowledge 和 Chat 之前运行，确保文件节点已就绪
- 后续迁移器（Knowledge、Chat）可以创建各自的 file_ref 记录
- PaintingMigrator 不在本次范围内，随 Painting 业务重构独立推进

### 10.2 三阶段迁移流程

**Prepare 阶段**：

```typescript
async prepare(ctx: MigrationContext): Promise<PrepareResult> {
  // 1. 检查 Dexie files 表是否存在
  const hasFiles = await ctx.sources.dexieExport.tableExists('files')
  if (!hasFiles) return { success: true, itemCount: 0 }

  // 2. 读取并计数
  const reader = ctx.sources.dexieExport.createStreamReader('files')
  const count = await reader.count()

  // 3. 样本验证（检查必须字段）
  const sample = await reader.readSample(10)
  const warnings: string[] = []
  for (const file of sample) {
    if (!file.id || !file.origin_name) {
      warnings.push(`File ${file.id} missing required fields`)
    }
  }

  return { success: true, itemCount: count, warnings }
}
```

**Execute 阶段**：

```typescript
async execute(ctx: MigrationContext): Promise<ExecuteResult> {
  const BATCH_SIZE = 100

  // 1. 创建系统节点（幂等）
  await this.ensureSystemNodes(ctx.db)

  // 2. 流式读取旧文件数据
  const reader = ctx.sources.dexieExport.createStreamReader('files')
  const totalCount = await reader.count()
  let processed = 0

  // 3. 文件 ID 映射（供后续迁移器使用）
  const fileIdMap = new Map<string, string>()  // oldId → newNodeId

  await reader.readInBatches(BATCH_SIZE, async (batch) => {
    const nodes = batch.map(oldFile => this.transformFile(oldFile))

    await ctx.db.insert(nodeTable).values(nodes)

    // 记录 ID 映射（旧系统和新系统使用相同 ID，因此映射是 1:1）
    for (const node of nodes) {
      fileIdMap.set(node.id, node.id)
    }

    processed += batch.length
    this.reportProgress(
      Math.round((processed / totalCount) * 100),
      `Migrated ${processed}/${totalCount} files`,
      { key: 'migration.progress.files', params: { current: processed, total: totalCount } }
    )
  })

  // 4. 存储映射到 sharedData，供 Knowledge/Chat 迁移器使用
  ctx.sharedData.set('fileIdMap', fileIdMap)
  ctx.sharedData.set('fileMountId', 'mount_files')

  return { success: true, processedCount: processed }
}
```

**字段转换规则**：

```typescript
private transformFile(old: DexieFileMetadata): NewNodeInsert {
  return {
    id: old.id,                                    // 保持原 ID 不变
    type: 'file',
    name: old.origin_name || old.name,             // 优先 origin_name（用户可见名）
    ext: old.ext?.replace(/^\./, '') || null,      // 去除前导点
    parentId: 'mount_files',                       // 全部归入 Files 挂载点根目录
    mountId: 'mount_files',
    size: old.size || null,
    createdAt: parseTimestamp(old.created_at),      // ISO 8601 → ms timestamp
    updatedAt: parseTimestamp(old.created_at),
  }
}

function parseTimestamp(iso?: string): number {
  return iso ? new Date(iso).getTime() : Date.now()
}
```

**设计说明**：

- **ID 保持不变**：旧 `FileMetadata.id` 直接作为新 `nodeTable.id`，这样所有引用该 ID 的地方（message blocks 的 `fileId`、knowledge items 的文件引用）无需修改
- **全部归入 Files 根目录**：旧系统无目录概念，迁移后全部作为 `mount_files` 的直接子节点。用户可以后续手动整理
- **物理文件无需移动**：旧存储路径 `{userData}/Data/Files/{id}{ext}` 与新 managed 模式路径 `{mount.base_path}/{id}.{ext}` 一致（仅 ext 前可能差一个点，需在路径解析器中兼容）

**Validate 阶段**：

```typescript
async validate(ctx: MigrationContext): Promise<ValidateResult> {
  const reader = ctx.sources.dexieExport.createStreamReader('files')
  const sourceCount = await reader.count()

  const [{ count: targetCount }] = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(nodeTable)
    .where(and(
      eq(nodeTable.type, 'file'),
      eq(nodeTable.mountId, 'mount_files')
    ))

  const errors: ValidationError[] = []
  if (sourceCount !== targetCount) {
    errors.push({
      key: 'file_count_mismatch',
      expected: sourceCount,
      actual: targetCount,
      message: `Expected ${sourceCount} files, found ${targetCount}`,
    })
  }

  return {
    success: errors.length === 0,
    errors,
    stats: { sourceCount, targetCount, skippedCount: sourceCount - targetCount },
  }
}
```

### 10.3 其他迁移器的 file_ref 创建

**KnowledgeMigrator（order=3）**：

迁移知识库条目时，对于 `type: 'file'` 或 `type: 'video'` 的 knowledge item，从其 `content` 中提取 `FileMetadata.id`，创建 file_ref 记录：

```typescript
// KnowledgeMigrator.execute() 中
if (item.type === 'file' && item.content?.id) {
  await ctx.db.insert(fileRefTable).values({
    id: generateUUID(),
    nodeId: item.content.id,        // FileMetadata.id = nodeTable.id
    sourceType: 'knowledge_item',
    sourceId: newKnowledgeItemId,
    role: 'source',
  })
}
```

**ChatMigrator（order=4）**：

迁移消息 blocks 时，对于含 `fileId` 的 block，创建 file_ref 记录：

```typescript
// ChatMigrator 的 block 转换中
if (block.type === 'file' && block.fileId) {
  fileRefsToInsert.push({
    id: generateUUID(),
    nodeId: block.fileId,
    sourceType: 'chat_message',
    sourceId: messageId,
    role: 'attachment',
  })
}
if (block.type === 'image' && block.fileId) {
  fileRefsToInsert.push({
    id: generateUUID(),
    nodeId: block.fileId,
    sourceType: 'chat_message',
    sourceId: messageId,
    role: 'attachment',
  })
}
```

### 10.4 Paintings 迁移（不在本次范围内）

Paintings 数据存储在 Redux state 中（`PaintingParams.files: FileMetadata[]`）。

**决策**：PaintingMigrator 不在本次文件管理重构范围内，随 Painting 业务重构独立推进。

- 唯一依赖：FileMigrator 已将文件节点写入 nodeTable（保持原 ID），PaintingMigrator 可直接用 `FileMetadata.id` 作为 `nodeId` 创建 file_ref
- 在 PaintingMigrator 实现之前，painting 引用的文件不会有 file_ref 记录，但文件节点本身已存在且可访问
- `sourceType: 'painting'` 已纳入 OrphanRefScanner 的注册式设计，PaintingMigrator 上线后自动覆盖

### 10.5 迁移回滚策略

| 场景 | 回滚方案 |
|------|---------|
| FileMigrator 执行失败 | MigrationEngine 标记失败，用户可重试。nodeTable 清空重来（TRUNCATE + 重跑） |
| 迁移完成后发现数据异常 | Dexie 导出文件（`files.json`）保留不删除，可重建 nodeTable |
| 新旧系统并行期数据冲突 | `toFileMetadata` 适配层保证旧消费方仍可工作 |
| 物理文件丢失 | 迁移不移动物理文件，路径不变，无文件丢失风险 |

---

## 十一、分阶段实施计划

### 11.1 总览

整个文件管理重构分为 **6 个阶段**，作为 v2 迁移的一部分推进。各阶段有明确的交付物和依赖关系。

```
Phase 1          Phase 2          Phase 3          Phase 4           Phase 5         Phase 6
Schema &    ──→  Core Services  ──→  FileMigrator  ──→  Consumer     ──→  Notes       ──→  Cleanup
Foundation       + API              + 迁移整合         Migration         Integration
                                                       (分 4 批)
```

### 11.2 Phase 1: Schema & Foundation

**目标**：建立所有类型定义和数据库 Schema，为后续阶段提供基础。

**交付物**：

| 文件路径 | 内容 |
|---------|------|
| `src/main/data/db/schemas/node.ts` | `nodeTable` + `fileRefTable` Drizzle Schema（第六章） |
| `packages/shared/data/types/fileNode.ts` | `FileNode`、`FileRef`、DTO 类型定义（第六章） |
| `packages/shared/data/types/fileProvider.ts` | Provider Config Zod Schema（第五章） |
| `packages/shared/data/api/schemas/files.ts` | `FileSchemas` API 类型声明（第九章） |

**关键任务**：

1. 创建 Drizzle Schema 并生成 migration SQL（`pnpm db:migrations:generate`）
2. 实现系统节点初始化逻辑——首次启动时创建 `mount_files`、`mount_notes`、`system_trash`
3. 实现路径解析器 `resolvePhysicalPath(node)`：根据 `providerConfig.provider_type` 计算物理路径
   - `local_managed`：`{mount.base_path}/{node.id}.{node.ext}`
   - `local_external`：`{mount.base_path}/{...ancestors}/{node.name}.{node.ext}`

**依赖**：无

### 11.3 Phase 2: Core Services + API

**目标**：实现完整的节点 CRUD 和引用管理能力，可以独立于旧系统运行。

**交付物**：

| 文件路径 | 内容 |
|---------|------|
| `src/main/data/services/FileNodeService.ts` | 节点 CRUD、树操作、Trash、路径解析 |
| `src/main/data/services/FileRefService.ts` | 引用 CRUD、按来源清理、批量清理 |
| `src/main/data/api/handlers/files.ts` | DataApi handlers（第九章） |
| `src/renderer/src/hooks/useFileNodes.ts` | SWR hooks（`useQuery`/`useMutation` 封装） |

**关键任务**：

1. `FileNodeService`：
   - `create()` 原子性保障——物理文件写入 + 节点记录在同一事务
   - `trash()` / `restore()` 实现 OS 风格 Trash 逻辑（第七章）
   - `permanentDelete()` 级联删除 + 物理文件清理
   - `move()` 物理文件移动（external 模式）或纯 DB 更新（managed 模式）
   - 内存级路径缓存 `Map<nodeId, absolutePath>`，树变更时重建

2. `FileRefService`：
   - CRUD + 按 source 查询/清理
   - `OrphanRefScanner` 注册式扫描器（第八章）

3. Handler 注册到 `apiHandlers`，URL 前缀 `/files/`

4. Renderer hooks 封装，支持文件树懒加载

**依赖**：Phase 1

### 11.4 Phase 3: FileMigrator + 迁移整合

**目标**：将旧 Dexie `db.files` 数据迁移到新 nodeTable，并协调其他迁移器创建 file_ref 记录。

详见第十章。

**依赖**：Phase 1, Phase 2

### 11.5 Phase 4: Consumer Migration（消费方迁移）

**目标**：将 64+ 个引用 `FileMetadata` 的文件逐步迁移到使用 `FileNode` + DataApi。

分 4 批进行，按依赖关系和影响范围排序：

#### Batch 4.1: 数据层适配（影响最小，验证新系统可用性）

| 文件 | 变更 |
|------|------|
| `src/renderer/src/services/FileManager.ts` | 重写为 thin wrapper，调用 DataApi hooks 而非直接操作 Dexie |
| `src/main/services/FileStorage.ts` | 文件 I/O 保留，元数据管理迁移到 `FileNodeService` |
| `src/renderer/src/types/file.ts` | `FileMetadata` 标记 `@deprecated`，新增 re-export from `FileNode` |

**兼容策略**：提供 `toFileMetadata(node: FileNode): FileMetadata` 适配函数，让尚未迁移的消费方继续工作：

```typescript
/** @deprecated 仅用于过渡期 */
function toFileMetadata(node: FileNode): FileMetadata {
  return {
    id: node.id,
    name: node.id + (node.ext ? '.' + node.ext : ''),
    origin_name: node.name + (node.ext ? '.' + node.ext : ''),
    path: resolvePhysicalPath(node),
    size: node.size ?? 0,
    ext: node.ext ? '.' + node.ext : '',
    type: inferFileType(node.ext),
    created_at: new Date(node.createdAt).toISOString(),
    count: 0,  // deprecated, 引用计数由 file_ref 聚合
  }
}
```

#### Batch 4.2: AI Core（影响核心功能，需充分测试）

| 文件 | 变更 |
|------|------|
| `fileProcessor.ts` | 入参从 `FileMetadata` 改为 `FileNode`，路径通过 `resolvePhysicalPath` 获取 |
| `messageConverter.ts` | 从 file blocks 中读取 `fileId` → 查询 `FileNode` → 获取路径/元数据 |
| 各 API 客户端 | 文件上传参数适配 |

#### Batch 4.3: Knowledge + Paintings

| 文件 | 变更 |
|------|------|
| `KnowledgeService.ts` | 文件引用从嵌入 `FileMetadata` 改为 `nodeId` 引用 |
| 6+ 预处理 providers | 入参改为 `FileNode` 或 `{ path, ext, name }` |
| Painting 相关 | `files: FileMetadata[]` → `fileIds: string[]` |

#### Batch 4.4: UI + State Management

| 文件 | 变更 |
|------|------|
| 文件页面组件 | 从 `db.files` 查询改为 `useQuery('/files/nodes')` |
| 消息 block 组件 | 文件展示从嵌入数据改为通过 `fileId` 查询 |
| 绘图页面 | 适配 `fileIds` 引用模式 |
| `messageThunk.ts` | 文件上传流程走新 API |
| `knowledgeThunk.ts` | 文件引用走新 API |

**每个 Batch 完成后**：运行 `pnpm build:check`（lint + test + typecheck），确保不引入回归。

**依赖**：Phase 2, Phase 3

### 11.6 Phase 5: Notes Integration

**目标**：将笔记文件树纳入节点表管理，保持外部编辑器兼容。

**交付物**：

| 文件路径 | 内容 |
|---------|------|
| `src/main/services/ExternalSyncEngine.ts` | 文件系统 ↔ DB 同步引擎 |
| `src/main/services/FileWatcherService.ts` | 基于 chokidar 的文件监听（复用现有逻辑） |

**关键任务**：

1. **启动同步**：扫描 `notesPath` → diff 与 `mount_notes` 下的节点表 → 增删改对齐
2. **运行时同步**：chokidar 事件 → 防抖（200ms）→ 增量更新节点表
3. **冲突策略**：文件系统 wins（见第四章 4.4 节）
4. **迁移**：首次启动时执行全量 reconcile，将现有笔记文件扫描入库
5. **页面重构**：`NotesPage.tsx` 从直接调用 `getDirectoryStructure` 改为查询 `nodeTable`
6. **兼容保障**：外部编辑器创建/修改/删除文件时，应用内同步更新

**依赖**：Phase 2（与 Phase 3/4 可并行）

### 11.7 Phase 6: Cleanup

**目标**：移除所有旧代码路径。

**关键任务**：

1. 移除 Dexie `files` 表定义和相关迁移代码
2. 移除 `FileMetadata` 类型和 `toFileMetadata` 适配函数
3. 移除 `FileManager.ts`（renderer 侧旧文件管理）
4. 清理 `FileStorage.ts` 中已迁移到 `FileNodeService` 的逻辑
5. 移除 `findDuplicateFile()` 等去重相关代码
6. 最终集成测试

**依赖**：Phase 4, Phase 5

### 11.8 阶段依赖关系图

```
Phase 1 ──────────────┐
(Schema)               │
                       ▼
Phase 2 ──────────────┐
(Services + API)       │
      │                ▼
      │         Phase 3
      │         (FileMigrator)
      │                │
      ├────────────────┤
      │                ▼
      │         Phase 4 (Batch 4.1 → 4.2 → 4.3 → 4.4)
      │         (Consumer Migration)
      │                │
      ▼                │
Phase 5                │
(Notes Integration)    │
      │                │
      └────────┬───────┘
               ▼
         Phase 6
         (Cleanup)
```

**注意**：Phase 2 和 Phase 5 之间没有强依赖——Notes Integration 只需要 Core Services，不需要等 Consumer Migration 完成。两条路线可以并行推进。

---

## 十二、取舍记录（Trade-off）

放弃文件池/去重的主要原因与代价：

- 优点：OS 目录结构与用户视角一致，导出/备份更直观。
- 代价：磁盘占用增加，重复内容不再复用。
- 影响：引用计数与 COW 的价值降低，逻辑显著简化。

---

## 十三、风险项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `FileMetadata` 引用面太广（274 处） | Consumer Migration 工作量大 | `toFileMetadata` 适配函数 + 分批迁移 |
| 旧文件 `ext` 含点/不含点不统一 | 路径解析错误 | `resolvePhysicalPath` 兼容两种格式 |
| KnowledgeMigrator 尚未实现 | File ref 创建时机不确定 | FileMigrator 不依赖 Knowledge，仅通过 `sharedData` 提供数据 |
| Painting 的 file_ref 暂缺 | 文件页面无法追溯 painting 引用 | 文件节点已存在可访问，file_ref 随 Painting 重构补建 |
| Notes 双向同步复杂度 | 冲突、数据不一致 | 文件系统 wins + 启动时全量 reconcile 兜底 |

---

## 十四、待补充内容

- [ ] 笔记 external 模式的详细同步方案（Phase 5 细化设计）
- [ ] PaintingMigrator（随 Painting 业务重构独立推进，仅依赖 FileMigrator 提供的 fileId）
