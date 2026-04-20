# RFC: 文件管理

> **定位**：实现设计文档。包含数据 Schema、API 契约、核心流程伪代码、迁移策略与分阶段计划。
>
> 架构决策（系统边界、组件职责、数据流）以 [`docs/zh/references/file/architecture.md`](../../../docs/zh/references/file/architecture.md) 和 [`docs/zh/references/file/file-manager-architecture.md`](../../../docs/zh/references/file/file-manager-architecture.md) 为准。本文档中与架构文档冲突的内容，以架构文档为 Source of Truth。
>
> 相关文档：
>
> - [`file-arch-problems.md`](./file-arch-problems.md) — 旧架构问题清单
> - [`file-arch-problems-response.md`](./file-arch-problems-response.md) — 各问题在新架构下的回应与设计决策
> - [`migration-plan.md`](./migration-plan.md) — 字段级退役 + 消费域切换的详细执行计划

---

## 一、背景

现有文件管理架构的结构性问题详见 [`file-arch-problems.md`](./file-arch-problems.md)，新架构下各问题的解决方案与决策依据见 [`file-arch-problems-response.md`](./file-arch-problems-response.md)。

本 RFC 聚焦**实现层面**：数据 Schema、API 契约、核心流程、迁移步骤、分阶段计划。核心取向：

- **扁平 FileEntry + 多态 FileRef**——持久化层不引入目录树、不引入 mount 概念
- **origin: `internal` / `external` 二态**——Cherry 拥有 vs 用户拥有
- **无内容去重**——每个显式上传都是独立 FileEntry
- **Notes / 其他 FS-first 业务解耦**——不强制镜像到 `file_entry`
- **AI SDK upload 延后**——待 Vercel AI SDK Files API 稳定后以独立 PR 引入

---

## 二、范畴说明

**本 RFC 覆盖**：

- `file_entry` / `file_ref` 两张表的 Drizzle Schema
- DataApi（只读）+ File IPC（读写）契约
- FileManager 核心流程伪代码（createEntry / read / write / trash / restore / permanentDelete / rename / copy）
- OrphanRefScanner 注册式 checker 设计
- Dexie → SQLite 的 FileMigrator 流程
- 分阶段实施计划（Phase 1a / 1b / 2 / X）

**不在范畴**：

- 具体 UI 改动（文件页、对话附件 picker 等属业务 PR）
- Notes 模块设计（独立 RFC）
- AI SDK Files API 集成（延后独立 PR，`file-manager-architecture.md §9` 保留设计意图）
- Painting 业务重构（仅依赖 FileMigrator 提供的 fileId，随 Painting 重构独立推进）
- 字段级退役与消费域切换的详细步骤（见 [`migration-plan.md`](./migration-plan.md)）

---

## 三、设计目标

- **统一主进程入口**：消除跨进程一致性风险（问题 1/2/3/11）
- **放弃内容去重**：每个上传独立 entry，用户视角不混淆（问题 4）
- **显式引用关系**：`file_ref` 表替代不透明的 `count`，可反查业务来源（问题 5/7）
- **元数据生产收口**：ext/type 推断统一在 main 侧（问题 13）
- **持久化层解耦 Notes**：不强制镜像笔记文件到 `file_entry`（问题 9/10）
- **为扩展预留空间**：AI SDK upload、DirectoryTreeBuilder primitive 等（问题 12）

---

## 四、数据模型（Drizzle Schema）

### 4.1 设计决策

| 决策 | 结论 | 理由 |
|---|---|---|
| FileEntry 结构 | 扁平（无 `parentId`、无 mount） | 持久化层不做目录树；Notes 自治（问题 6/10） |
| 主键策略 | UUID v7（`uuidPrimaryKeyOrdered`）；旧数据保留 v4 | 新 entry 时间有序；旧 v4 ID 跨表引用零翻译（migration-plan §2.9） |
| `origin` 枚举 | `'internal' \| 'external'` | Cherry 拥有 vs 用户拥有；语义清晰 |
| External path 唯一性 | Partial unique index: `WHERE origin='external' AND trashedAt IS NULL` | 同路径最多一个活跃 entry；`createEntry` 按 path upsert |
| `size` 字段 | 必填（INTEGER NOT NULL） | 查询/排序需要；external 为最后观测的快照 |
| trash 语义 | `trashedAt` 时间戳（无 parentId 变动） | 扁平 schema，软删仅 DB，不动 FS |
| `sourceType` / `role` | 应用层 Zod 验证 + 编译期 checker 注册 | 新增 sourceType 无需 DB migration |
| `file_ref` 防重 | UNIQUE(fileEntryId, sourceType, sourceId, role) | 一个业务对象不会以同一角色重复引用同一文件 |
| DataApi 职责 | 只读 + 允许幂等副作用（SQL 聚合、`fs.stat`） | 所有 mutation 走 File IPC |
| Upload 派生数据 | 延后引入 `file_upload` 表 | Vercel AI SDK Files API 未稳定 |

### 4.2 fileEntryTable

```typescript
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

export const fileEntryTable = sqliteTable(
  'file_entry',
  {
    id: uuidPrimaryKeyOrdered(),

    /** 'internal' | 'external' */
    origin: text().notNull(),

    /** 用户可见名称，不含扩展名。internal 为 SoT；external 为 basename 快照 */
    name: text().notNull(),
    /** 扩展名，不含前导点（'pdf' / 'md'）；无扩展名为 null */
    ext: text(),
    /** 字节数。internal 为 SoT；external 为最后观测快照 */
    size: integer().notNull(),

    /** 用户侧绝对路径。仅 origin='external' 非空 */
    externalPath: text(),

    /** 软删时间戳（ms epoch）；null 表示未 trash */
    trashedAt: integer(),

    ...createUpdateTimestamps
  },
  (t) => [
    index('fe_trashed_at_idx').on(t.trashedAt),
    index('fe_created_at_idx').on(t.createdAt),
    index('fe_external_path_idx').on(t.externalPath),
    // 同一 externalPath 最多一条非 trashed 的 external entry
    uniqueIndex('fe_external_path_unique_idx')
      .on(t.externalPath)
      .where(sql`${t.origin} = 'external' AND ${t.trashedAt} IS NULL`),
    check('fe_origin_check', sql`${t.origin} IN ('internal', 'external')`),
    check(
      'fe_origin_consistency',
      sql`(${t.origin} = 'internal' AND ${t.externalPath} IS NULL) OR (${t.origin} = 'external' AND ${t.externalPath} IS NOT NULL)`
    )
  ]
)
```

**字段权威性矩阵**：

| 字段 | origin='internal' | origin='external' |
|---|---|---|
| `name` | SoT（用户可改名） | 上次 observe 的 basename 快照 |
| `ext` | SoT | 上次 observe 的扩展名 |
| `size` | SoT | 上次 observe 的字节数 |
| `externalPath` | NULL | 绝对路径（external 身份） |

### 4.3 fileRefTable

```typescript
export const fileRefTable = sqliteTable(
  'file_ref',
  {
    id: uuidPrimaryKey(),

    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),

    /** 业务来源类型（'chat_message' / 'knowledge_item' / 'painting' / ...） */
    sourceType: text().notNull(),
    /** 业务对象 ID（polymorphic, no FK） */
    sourceId: text().notNull(),
    /** 引用角色（'attachment' / 'source' / 'asset' / ...） */
    role: text().notNull(),

    ...createUpdateTimestamps
  },
  (t) => [
    index('file_ref_entry_id_idx').on(t.fileEntryId),
    index('file_ref_source_idx').on(t.sourceType, t.sourceId),
    uniqueIndex('file_ref_unique_idx').on(t.fileEntryId, t.sourceType, t.sourceId, t.role)
  ]
)
```

设计要点：

- `fileEntryId` CASCADE：删除 entry 自动清理其所有 ref
- `sourceId` 无 FK：polymorphic 多态；依赖应用层清理 + 孤儿扫描兜底（§六）
- UNIQUE：防重复引用（同一文件不会被同一业务对象以同一角色引用两次）

### 4.4 Upload 表（延后）

Vercel AI SDK `SharedV4ProviderReference` 集成所需的 `file_upload` 表在 SDK Files API 稳定后独立 PR 引入。设计意图见 [`file-manager-architecture.md §9`](../../../docs/zh/references/file/file-manager-architecture.md)，不在 Phase 1a 交付物内。

### 4.5 DTO 类型定义

位于 `packages/shared/data/types/file/`：

| 文件 | 内容 |
|---|---|
| `essential.ts` | `TimestampSchema`、`SafeNameSchema` 等基础 schema |
| `fileEntry.ts` | `FileEntrySchema`（`z.discriminatedUnion('origin')` + `.brand<'FileEntry'>()`）、`FileEntryIdSchema`、`DanglingStateSchema` |
| `ref/` | `FileRefSchema`（`z.discriminatedUnion('sourceType')`，不 brand）、`createRefSchema` 工厂 |
| `index.ts` | Barrel re-export |

### 4.5.1 Brand type 强化（解决问题 13）

**动机**：`FileEntry` 有**派生字段**——`name/ext` 由 basename 切分、`type` 由 `ext` 派生、`refCount/dangling/path/url` 是 DataApi 按需聚合。这些派生只有在 sanctioned 路径（main 侧）才能正确产生。旧 `FileMetadata` 是普通 interface，允许对象字面量满足——renderer / 业务代码自拼 entry 会破坏派生统一性。

**解法**：**只给 `FileEntry` 一个类型加 brand**——让对象字面量无法满足类型，只有经过 `FileEntrySchema.parse()` 的值才是 `FileEntry`：

```typescript
// packages/shared/data/types/file/fileEntry.ts
export const FileEntryIdSchema = z.uuid()  // 普通字符串，不 brand

export const FileEntrySchema = z
  .discriminatedUnion('origin', [InternalEntrySchema, ExternalEntrySchema])
  .brand<'FileEntry'>()

export type FileEntryId = z.infer<typeof FileEntryIdSchema>
export type FileEntry = z.infer<typeof FileEntrySchema>
```

**效果**：

- `const e: FileEntry = { id, origin, name, ... }` → 编译错误（缺 brand，拒绝绕过派生的鸭子对象）
- `const e = FileEntrySchema.parse(raw)` → OK，Zod 自动施加 brand
- `const e2: FileEntry = { ...e, name: 'x' }` → 编译错误（spread 丢 brand）——修改被迫走 `rename` IPC 等 sanctioned mutator

**范围严控**：仅 `FileEntry` 一个类型加 brand。其他类型（`FileEntryId` / `FileRef` / `FileRefId`）保持普通 `z.infer` 类型——它们没有派生字段（ID 是纯字符串，FileRef 是纯行），加 brand 只会给测试和 main 内部代码增加无谓的 parse 样板，不换保护。

**生产点仅三条**（每条都显式 `parse`）：

| 生产者 | 位置 |
|---|---|
| `createEntry` / `batchCreateEntries` IPC | `FileManager` 返回前 parse |
| DataApi handler（row → DTO） | `src/main/data/api/handlers/files.ts` 响应前 parse（含 opt-in 派生） |
| FileMigrator insert | `FileMigrator` 转换后 parse |

**Test 逃生舱**：`tests/__mocks__/factories.ts` 提供 `makeFileEntry(overrides)`，内部仍走 `FileEntrySchema.parse`——mock 数据也经过 schema 校验，不留 unbranded 后门。

**运行期防线**：brand 是编译期约束，运行期 `as FileEntry` 仍可绕；真正的运行时防线是 **IPC 边界与 DataApi 响应边界的显式 parse**，保证即便 TS 被绕过，数据形状依然合法。

### 4.5.2 推断类型

```typescript
type FileEntry = z.infer<typeof FileEntrySchema>              // branded, discriminated on origin
type InternalFileEntry = z.infer<typeof InternalEntrySchema>
type ExternalFileEntry = z.infer<typeof ExternalEntrySchema>
type FileRef = z.infer<typeof FileRefSchema>                  // 不 branded（纯行，无派生）
type FileEntryId = z.infer<typeof FileEntryIdSchema>          // 不 branded；z.uuid() 接受 v4 / v7
type DanglingState = z.infer<typeof DanglingStateSchema>      // 'present' | 'missing' | 'unknown'
```

**API DTO**：`FileEntryView = FileEntry & { refCount?, dangling?, path?, url? }`，各字段为 opt-in 派生（见 §七）。`FileEntryView` 保留 `FileEntry` 的 brand，opt-in 字段由 DataApi handler 在 parse 前合并，parse 后整体 branded。

`FileEntryIdSchema` 使用 `z.uuid()` 而非 `z.uuidv7()`，以接受旧数据的 v4 ID（见 migration-plan §2.9）。

---

## 五、核心流程

> FS 操作由 `ops/*` 纯函数执行（唯一 FS owner）。DB 操作由 `FileEntryService` / `FileRefService` 执行（纯 DB repository）。FileManager 做协调与 IPC 分派。

### 5.1 createEntry（上传 / 登记）

```typescript
// Internal: 复制 / 移动内容到 {userData}/files/{id}.{ext}
async function createEntry(params: CreateEntryIpcParams): Promise<FileEntry> {
  if (params.origin === 'internal') {
    const id = uuidv7()
    const { name, ext } = splitName(params.name, params.ext)
    const dest = resolvePhysicalPath({ id, ext, origin: 'internal' })

    // 1. 原子写物理文件
    await ops.atomicWriteFile(dest, params.content)
    const { size } = await ops.stat(dest)

    // 2. 写入 DB
    return fileEntryService.create({ id, origin: 'internal', name, ext, size })
  }

  // External: 按 externalPath upsert
  const normalizedPath = path.resolve(params.externalPath)
  const existing = await fileEntryService.findByExternalPath(normalizedPath, { includeTrashed: true })

  if (existing && existing.trashedAt === null) {
    return existing // 复用活跃 entry
  }
  if (existing?.trashedAt != null) {
    return fileEntryService.update(existing.id, { trashedAt: null }) // 复活
  }

  const stat = await ops.stat(normalizedPath) // 验证存在 + 取 snapshot
  const { name, ext } = splitName(path.basename(normalizedPath))
  return fileEntryService.create({
    origin: 'external',
    name,
    ext,
    size: stat.size,
    externalPath: normalizedPath
  })
}
```

**原子性**：

- Internal：物理写 + DB 写两步。物理写失败 → 无 DB 行；DB 写失败 → 启动期 orphan sweep 清理残留 UUID 文件
- External：仅 DB 写 + 一次 stat 验证；stat 失败直接抛错

### 5.2 read / write / writeIfUnchanged

所有接受 `FileHandle`（`managed | unmanaged`）。

- `read`：managed 解析 `entryId → path` 后调 `ops.read`；unmanaged 直接读 path
- `write`：原子写（`ops.atomicWriteFile`），更新版本缓存；external 覆盖用户文件（显式操作语义）
- `writeIfUnchanged`：乐观并发（`ops.atomicWriteIfUnchanged`），版本不匹配抛 `StaleVersionError`

详细语义见 `file-manager-architecture.md §4-§6`。

### 5.3 trash / restore（软删除）

**纯 DB 操作，不碰 FS**（external 的用户文件 **不**移到 `.trash`——Cherry 不在外部目录制造结构）：

```typescript
async function trash(id: FileEntryId): Promise<void> {
  await fileEntryService.update(id, { trashedAt: Date.now() })
}

async function restore(id: FileEntryId): Promise<FileEntry> {
  return fileEntryService.update(id, { trashedAt: null })
}
```

### 5.4 permanentDelete

```typescript
async function permanentDelete(handle: FileHandle): Promise<void> {
  if (handle.kind === 'unmanaged') {
    await ops.remove(handle.path)
    return
  }
  const entry = await fileEntryService.getById(handle.entryId)

  // 先删物理文件（失败时 DB 仍在可重试）
  if (entry.origin === 'internal') {
    await ops.remove(resolvePhysicalPath(entry)).catch(ignoreEnoent)
  } else {
    // external: 用户显式要求的物理删除
    await ops.remove(entry.externalPath).catch((err) => {
      logger.warn(`external permanentDelete failed: ${err.message}`)
      // 继续删 DB; 用户视角该文件已从 Cherry 消失
    })
  }

  await fileEntryService.delete(entry.id) // CASCADE 清 file_ref
}
```

### 5.5 rename

- **Managed-internal**：纯 DB 更新 `name`（物理文件名是 UUID 不变）
- **Managed-external**：`ops.rename(oldExternalPath, newPath)` + DB 更新 `externalPath` / `name` / `ext`
- **Unmanaged**：`ops.rename(oldPath, newPath)`，等价于 `fs.rename`

### 5.6 copy

产出新 internal entry：

```typescript
async function copy(params: { source: FileHandle; newName?: string }): Promise<FileEntry> {
  const sourcePath = resolveFileHandle(params.source)
  const content = ops.createReadStream(sourcePath)
  return createEntry({
    origin: 'internal',
    name: params.newName ?? deriveNameFromHandle(params.source),
    content
  })
}
```

### 5.7 崩溃恢复（启动期 orphan sweep）

`FileManager.onInit` 后台 fire-and-forget（不阻塞 ready）：

1. 扫描 `{userData}/files/` 下 UUID 文件名：查 DB 找不到对应 entry → `unlink`
2. 扫描 `*.tmp-<uuidv7>` 原子写残留 → `unlink`

`DanglingCache` 反向索引初始化为同步 DB 查询（external entries 通常 < 10k）；watcher 事件与冷路径 stat 在运行期增量更新。

### 5.8 元数据生产统一入口（问题 13）

- **`createEntry` 是 entry 创建的唯一路径**——renderer 不再自己拼接 FileMetadata
- **`name` / `ext` 切分**：main 侧统一在 createEntry 内处理（见 migration-plan §2.7）
- **`type` 派生**：不持久化，查询时由 `ops/metadata.getFileType(ext)` 计算；`getMetadata` 可 buffer 升级 OTHER → 具体类型（见 migration-plan §2.5）

---

## 六、引用清理机制

### 6.1 三层防护

```
┌─────────────────────────────────────────────┐
│ 第一层：fileEntryId CASCADE                   │
│ 文件条目删除 → file_ref 自动级联删除          │
├─────────────────────────────────────────────┤
│ 第二层：业务删除钩子                          │
│ 业务对象删除时主动清理对应 file_ref            │
├─────────────────────────────────────────────┤
│ 第三层：注册式孤儿扫描                        │
│ 后台任务扫描 sourceId 不存在的 file_ref        │
└─────────────────────────────────────────────┘
```

### 6.2 第一层：fileEntryId CASCADE

`fileRefTable.fileEntryId` 外键 `onDelete: 'cascade'` 在 Schema 中已定义。文件条目被永久删除 → 其所有 `file_ref` 自动删除，无需应用层代码。

### 6.3 第二层：业务删除钩子

业务 Service 在 delete 路径调用：

```typescript
// 单条
await fileRefService.cleanupBySource(sourceType, sourceId)

// 批量（如删除 topic 时一次性清理所有消息的引用）
await fileRefService.cleanupBySourceBatch(sourceType, sourceIds)
```

**接入点**：

| 删除场景 | 清理调用 |
|---|---|
| 删除消息 | `cleanupBySource('chat_message', messageId)` |
| 删除 topic | `cleanupBySourceBatch('chat_message', messageIds)` |
| 删除知识库 | `cleanupBySourceBatch('knowledge_item', itemIds)` |
| 删除知识库条目 | `cleanupBySource('knowledge_item', itemId)` |
| 删除 painting | `cleanupBySource('painting', paintingId)` |

### 6.4 第三层：注册式孤儿扫描

```typescript
interface SourceTypeChecker {
  sourceType: FileRefSourceType
  /** 给一批 sourceId，返回其中仍然存在的 ID 集合 */
  checkExists: (sourceIds: string[]) => Promise<Set<string>>
}

/**
 * 编译期强制：每个 FileRefSourceType 都必须有 checker。
 * 新增 sourceType 未注册 → TypeScript 报错。
 */
type OrphanCheckerRegistry = Record<FileRefSourceType, SourceTypeChecker>

class OrphanRefScanner {
  constructor(private checkers: OrphanCheckerRegistry) {}

  /** 扫描一种 sourceType 的孤儿引用，cursor-based 分页 */
  async scanOneType(sourceType: FileRefSourceType): Promise<number>

  /** 扫描所有已注册的 sourceType */
  async scanAll(): Promise<{
    total: number
    byType: Partial<Record<FileRefSourceType, number>>
  }>
}
```

**注册示例**（编译期强制覆盖所有 sourceType）：

```typescript
const orphanScanner = new OrphanRefScanner({
  chat_message: {
    sourceType: 'chat_message',
    checkExists: async (ids) => {
      const rows = await db.select({ id: messageTable.id }).from(messageTable).where(inArray(messageTable.id, ids))
      return new Set(rows.map((r) => r.id))
    }
  },
  knowledge_item: { sourceType: 'knowledge_item', checkExists: async (ids) => { /* ... */ } },
  painting: { sourceType: 'painting', checkExists: async (ids) => { /* ... */ } }
  // 新增 FileRefSourceType 未补上 checker → TypeScript 编译报错
})
```

**触发时机**：

- 应用启动后延迟 30 秒（Background phase，低优先级）
- 每种 sourceType 间隔 5 秒处理，避免阻塞主进程
- 用户可在设置页面手动触发"清理无效引用"

### 6.5 无引用文件的处理

**策略：文件保留，用户手动管理**。

- 无引用不代表用户不需要（可能备用或手动浏览）
- 文件页可显示"未引用"标记，供批量清理
- 不自动移入 Trash，避免用户困惑

---

## 七、API 层设计

### 7.1 DataApi（只读）

位于 `packages/shared/data/api/schemas/files.ts`。所有端点只读；允许幂等副作用（SQL 聚合、`fs.stat` 查 dangling）；禁止任何 mutation。

```typescript
export interface FileSchemas {
  '/files/entries': {
    GET: {
      query: {
        origin?: 'internal' | 'external'
        inTrash?: boolean
        includeRefCount?: boolean
        includeDangling?: boolean
        includePath?: boolean
        includeUrl?: boolean
        sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'size' | 'refCount'
        sortOrder?: 'asc' | 'desc'
        page?: number
        limit?: number
      }
      response: OffsetPaginationResponse<FileEntryView>
    }
  }

  '/files/entries/:id': {
    GET: {
      params: { id: FileEntryId }
      query: {
        includeRefCount?: boolean
        includeDangling?: boolean
        includePath?: boolean
        includeUrl?: boolean
      }
      response: FileEntryView
    }
  }

  '/files/entries/:id/refs': {
    GET: { params: { id: FileEntryId }; response: FileRef[] }
  }

  '/files/refs/by-source': {
    GET: {
      query: { sourceType: string; sourceId: string }
      response: FileRef[]
    }
    // 不暴露 POST / DELETE —— ref 写操作由业务 service 直接调 fileRefService
  }
}
```

**opt-in 派生字段**（`architecture.md §3.1.1`）：

| 字段 | 语义 | 实现 |
|---|---|---|
| `includeRefCount` | `refCount: number` | SQL 聚合 `file_ref` |
| `includeDangling` | `dangling: DanglingState` | 查 `DanglingCache`；miss 触发 `fs.stat` |
| `includePath` | `path: string` | `resolvePhysicalPath(entry)` 原始路径 |
| `includeUrl` | `url: string` | `file://` URL + 危险文件 safety wrap（`.sh/.bat/.ps1` 返回 dirname） |

### 7.2 File IPC（读写）

位于 `packages/shared/file/types/ipc.ts`。所有涉及 FS 或 mutation 的操作走此通道。

| 方法 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `select` | 对话框选项 | `string \| string[] \| null` | Electron file/folder picker |
| `save` | `{ content, defaultPath?, filters? }` | `string \| null` | Save dialog + 写文件 |
| `createEntry` | `CreateEntryIpcParams` | `FileEntry` | Internal 创建 / External upsert |
| `batchCreateEntries` | 批量参数 | `BatchOperationResult` | 批量创建 |
| `read` | `FileHandle, opts?` | `ReadResult<T>` | 读内容（text / base64 / binary） |
| `getMetadata` | `FileHandle` | `PhysicalFileMetadata` | 物理元数据 |
| `getVersion` | `FileHandle` | `FileVersion` | 轻量版本戳 |
| `getContentHash` | `FileHandle` | `string` | xxhash-128 |
| `write` | `FileHandle, data` | `FileVersion` | 原子写 |
| `writeIfUnchanged` | `FileHandle, data, version` | `FileVersion` | 乐观并发写 |
| `trash` | `{ id }` | `void` | 软删（DB only） |
| `restore` | `{ id }` | `FileEntry` | 从 Trash 恢复 |
| `permanentDelete` | `FileHandle` | `void` | 物理删除 |
| `batchTrash` / `batchRestore` / `batchPermanentDelete` | 批量参数 | `BatchOperationResult` | 批量版本 |
| `rename` | `FileHandle, newTarget` | `FileEntry \| void` | 重命名 |
| `copy` | `{ source, newName? }` | `FileEntry` | 复制为新 internal entry |
| `refreshMetadata` | `{ id }` | `FileEntry` | 显式 stat 刷新 external snapshot |
| `open` / `showInFolder` | `FileHandle` | `void` | 系统程序打开 / 资源管理器定位 |
| `listDirectory` | `FilePath, options?` | `string[]` | 扫描目录 |
| `isNotEmptyDir` | `FilePath` | `boolean` | 目录非空检查 |

详细类型契约见 [`packages/shared/file/types/ipc.ts`](../../../packages/shared/file/types/ipc.ts)。

### 7.3 Renderer 使用示例

```typescript
// 案例 1：FilesPage 按引用次数排序 + 显示 dangling + file 预览
const { data: entries } = useQuery(fileApi.listEntries, {
  includeRefCount: true,
  includeDangling: true,
  includeUrl: true,
  sortBy: 'refCount'
})
// <img src={entry.url} /> 同步渲染

// 案例 2：Agent compose 需要绝对路径
const { data: entries } = useQuery(fileApi.listEntries, {
  ids: selectedFileIds,
  includePath: true
})
const filePaths = entries.map((e) => e.path).join('\n')

// 案例 3：写操作（走 File IPC）
await window.api.file.createEntry({ origin: 'internal', name, content })
await window.api.file.trash({ id })
```

---

## 八、迁移策略

### 8.1 迁移的两条主线

| 主线 | 含义 | 文档 |
|---|---|---|
| **数据层一次搬运** | Dexie `db.files` → SQLite `file_entry`（保 ID） | 本章 |
| **字段级退役 + 消费域切换** | 旧 `FileMetadata` 字段逐个退役；消费者按域迁移 | [`migration-plan.md`](./migration-plan.md) |

### 8.2 FileMigrator

```typescript
class FileMigrator extends BaseMigrator {
  readonly id = 'file'
  readonly name = 'File Migration'
  readonly description = 'Migrate files from Dexie to file_entry table'
  readonly order = 2.5 // After Assistant(2), Before Knowledge(3)
}
```

**执行顺序**：

```
Preferences(1) → Assistant(2) → File(2.5) → Knowledge(3) → Chat(4)
                                  ↑ 新增
```

- FileMigrator 在 Knowledge 和 Chat 之前运行，确保文件条目已就绪
- 后续迁移器（Knowledge、Chat）可以创建各自的 `file_ref` 记录
- PaintingMigrator 不在本次范围内，随 Painting 业务重构独立推进

### 8.3 三阶段流程

**Prepare**：检查 Dexie `files` 表存在性 + 计数 + 样本字段校验。

```typescript
async prepare(ctx: MigrationContext): Promise<PrepareResult> {
  const hasFiles = await ctx.sources.dexieExport.tableExists('files')
  if (!hasFiles) return { success: true, itemCount: 0 }

  const reader = ctx.sources.dexieExport.createStreamReader('files')
  const count = await reader.count()

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

**Execute**：

```typescript
async execute(ctx: MigrationContext): Promise<ExecuteResult> {
  const BATCH_SIZE = 100
  const reader = ctx.sources.dexieExport.createStreamReader('files')
  const totalCount = await reader.count()
  let processed = 0
  const fileIdMap = new Map<string, string>() // oldId → newId (1:1, ID 保留)

  await reader.readInBatches(BATCH_SIZE, async (batch) => {
    const entries = batch.map((old) => this.transformFile(old))
    await ctx.db.insert(fileEntryTable).values(entries)
    for (const entry of entries) {
      fileIdMap.set(entry.id, entry.id)
    }
    processed += batch.length
    this.reportProgress(
      Math.round((processed / totalCount) * 100),
      `Migrated ${processed}/${totalCount} files`,
      { key: 'migration.progress.files', params: { current: processed, total: totalCount } }
    )
  })

  ctx.sharedData.set('fileIdMap', fileIdMap)
  return { success: true, processedCount: processed }
}

private transformFile(old: DexieFileMetadata): InsertFileEntry {
  const { name, ext } = splitName(old.origin_name || old.name)
  return {
    id: old.id, // 保留原 v4 ID（Schema 已放宽 z.uuid()）
    origin: 'internal', // 旧数据全部视为 Cherry 管理
    name,
    ext: (old.ext ?? '').replace(/^\./, '') || null,
    size: old.size ?? 0,
    externalPath: null,
    trashedAt: null,
    createdAt: new Date(old.created_at).getTime(),
    updatedAt: new Date(old.created_at).getTime()
  }
}
```

**关键要点**：

- **ID 保留**：`FileMetadata.id → file_entry.id`（1:1），所有引用该 ID 的地方（message blocks `fileId`、knowledge items `content.id`、painting `files[*].id`）**零翻译**
- **`origin='internal'`**：旧数据全部视为 Cherry 管理（旧架构无 external 概念）
- **物理文件不移动**：旧路径 `{userData}/Data/Files/{id}{ext}` 与新路径 `{userData}/files/{id}.{ext}` 可能存在微差（含点/不含点），在 `resolvePhysicalPath` / 启动期兼容逻辑内处理（详见 migration-plan §2.7.6）
- **`ext` normalize**：去除前导点；无扩展名为 `null`

**Validate**：对比 Dexie 源表行数与 `file_entry.origin='internal'` 计数。

```typescript
async validate(ctx: MigrationContext): Promise<ValidateResult> {
  const reader = ctx.sources.dexieExport.createStreamReader('files')
  const sourceCount = await reader.count()

  const [{ count: targetCount }] = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(fileEntryTable)
    .where(eq(fileEntryTable.origin, 'internal'))

  const errors: ValidationError[] = []
  if (sourceCount !== targetCount) {
    errors.push({
      key: 'file_count_mismatch',
      expected: sourceCount,
      actual: targetCount,
      message: `Expected ${sourceCount} files, found ${targetCount}`
    })
  }

  return {
    success: errors.length === 0,
    errors,
    stats: { sourceCount, targetCount, skippedCount: sourceCount - targetCount }
  }
}
```

### 8.4 其他 Migrator 的 file_ref 创建

**KnowledgeMigrator（order=3）**：

```typescript
const fileIdMap = ctx.sharedData.get('fileIdMap') as Map<string, string>

if (item.type === 'file' && item.content?.id) {
  if (fileIdMap.has(item.content.id)) {
    await ctx.db.insert(fileRefTable).values({
      id: generateUUIDv7(),
      fileEntryId: item.content.id,
      sourceType: 'knowledge_item',
      sourceId: newKnowledgeItemId,
      role: 'source'
    })
  } else {
    logger.warn(`Skipping file_ref: entry ${item.content.id} not found`)
  }
}
```

**ChatMigrator（order=4）**：

迁移 message blocks 时，`block.type === 'file' | 'image'` 且含 `fileId` → 创建 `sourceType='chat_message'` 的 ref。

> **容错要求**：旧数据中可能存在 `block.fileId` 指向已被删除文件的情况（悬挂引用）。由于 `fileRefTable.fileEntryId` 有 FK 约束，直接插入会失败。因此必须**先验证存在性**，缺失跳过并记录 warning。

```typescript
const fileIdMap = ctx.sharedData.get('fileIdMap') as Map<string, string>

if ((block.type === 'file' || block.type === 'image') && block.fileId) {
  if (fileIdMap.has(block.fileId)) {
    fileRefsToInsert.push({
      id: generateUUIDv7(),
      fileEntryId: block.fileId,
      sourceType: 'chat_message',
      sourceId: messageId,
      role: 'attachment'
    })
  } else {
    logger.warn(`Skipping file_ref: entry ${block.fileId} not found`)
  }
}
```

### 8.5 Painting 迁移（延后）

Paintings 数据存储在 Redux state 中（`PaintingParams.files: FileMetadata[]`）。

**决策**：PaintingMigrator 不在本次范围内，随 Painting 业务重构独立推进。

- 唯一依赖：FileMigrator 已将文件条目写入 `fileEntryTable`（保留原 ID），PaintingMigrator 可直接用 `FileMetadata.id` 作为 `fileEntryId` 创建 file_ref
- 在 PaintingMigrator 实现之前，painting 引用的文件不会有 `file_ref` 记录，但文件条目本身已存在且可访问
- `sourceType: 'painting'` 已纳入 OrphanRefScanner 的注册式设计，PaintingMigrator 上线后自动覆盖

### 8.6 回滚策略

| 场景 | 方案 |
|---|---|
| FileMigrator 失败 | MigrationEngine 标记失败，用户可重试。清空 `file_entry`（origin='internal' 部分）重跑 |
| 迁移完成后数据异常 | Dexie 导出文件（`files.json`）保留，可重建 |
| 新旧并行期数据不一致 | `toFileMetadata` 适配函数（见 migration-plan §4）保证旧消费方继续工作 |
| 物理文件丢失 | 迁移不移动物理文件，路径兼容性在 resolver 内处理，无文件丢失风险 |

### 8.7 字段级退役 + 消费域切换

详见 [`migration-plan.md`](./migration-plan.md) §2（字段退役）与 §3（Batch A-E 消费域切换）。本 RFC 不重复。

---

## 九、分阶段实施计划

### 9.1 总览

```
Phase 1a ──→ Phase 1b ──→ Phase 2 ──→ (业务 PRs)
(Schema +    (FileManager  (消费方
 骨架)        实现 + 测试)   按域迁移)
                                 │
                                 └──→ Phase X (AI SDK upload, 延后)
```

### 9.2 Phase 1a：Schema & Foundation（当前 PR 目标）

**目标**：建立类型系统与数据库 schema，打通骨架。handler 允许 `throw NotImplemented`。

| 交付物 | 内容 |
|---|---|
| `src/main/data/db/schemas/file.ts` | `fileEntryTable` + `fileRefTable` Drizzle Schema |
| Drizzle migration SQL | `pnpm agents:generate` 生成 |
| `packages/shared/data/types/file/` | DTO 类型（`essential` / `fileEntry` / `ref/`） |
| `packages/shared/data/api/schemas/files.ts` | DataApi `FileSchemas` 类型声明 |
| `packages/shared/file/types/ipc.ts` | File IPC 类型契约 |
| `packages/shared/file/types/handle.ts` | `FileHandle` tagged union |
| `src/main/file/ops/` | `ops/*` 纯函数骨架（`fs` / `shell` / `path` / `metadata` / `search`） |
| `src/main/file/FileManager.ts` | lifecycle service 骨架，IPC handler 占位 |
| `src/main/file/danglingCache.ts` | singleton 骨架 |
| `src/main/file/watcher/` | `DirectoryWatcher` primitive + 工厂 |
| `src/main/data/api/handlers/files.ts` | DataApi handler（只读端点，允许部分端点占位） |

**依赖**：无（可独立 merge）

### 9.3 Phase 1b：FileManager 实现

**目标**：填充 FileManager 与 ops 的具体实现 + 单元测试。

**关键任务**：

1. `ops/*` 纯函数实现：`atomicWriteFile` / `atomicWriteIfUnchanged` / `createAtomicWriteStream` / `statVersion` / `contentHash`（xxhash-128）/ `read` / `write` / `copy` / `move` / `remove` / `open` / `showInFolder` / `listDirectory`（ripgrep + 模糊匹配）
2. `FileEntryService` / `FileRefService` data repository 实现（纯 DB）
3. `FileManager` 协调逻辑：
   - `createEntry` 原子性（物理写 + DB 写）
   - `read` / `write` / `writeIfUnchanged` 按 `FileHandle.kind` 分派
   - `trash` / `restore`（纯 DB）/ `permanentDelete`（先 FS 后 DB）
   - `rename` / `copy` / `refreshMetadata`
   - `resolvePhysicalPath` 路径解析
   - LRU version cache
4. 启动期 orphan sweep（非阻塞）
5. DanglingCache 反向索引初始化 + watcher 事件自动接入
6. 单元测试覆盖（使用 `setupTestDatabase()` 真 DB）

**依赖**：Phase 1a

### 9.4 Phase 2：FileMigrator + 消费方迁移（分多 PR）

先落 **FileMigrator**（§8），将 Dexie `db.files` 一次性搬到 `file_entry`；随后按 [`migration-plan.md §3`](./migration-plan.md) 的 Batch A-E 推进：

- **Batch 0**：FileMigrator（数据层一次搬运，包括 KnowledgeMigrator / ChatMigrator 内新增的 file_ref 创建）
- **Batch A**：数据层适配（`toFileMetadata` 适配 + 旧 `FileMetadata` 标注 `@deprecated`）
- **Batch B**：AI Core（`fileProcessor` / `messageConverter` / API 客户端）
- **Batch C**：Knowledge + Painting
- **Batch D**：UI + state management（文件页、消息 block、绘图页面、messageThunk、knowledgeThunk）
- **Batch E**：清理（移除 Dexie `files` 表、`FileMetadata` 类型、旧 `FileStorage`、`toFileMetadata` 适配）

**每个 Batch 完成后**：运行 `pnpm build:check`（lint + test + typecheck），确保不引入回归。

**依赖**：Phase 1b

### 9.5 Phase X：AI SDK Upload（延后独立 PR）

Vercel AI SDK Files API 稳定后：

- `file_upload` 表 additive migration
- `FileUploadService` lifecycle service + `FileUploadRepository`
- `ensureUploaded` / `buildProviderReference` / `invalidate` 方法
- 设计意图见 `file-manager-architecture.md §9`

---

## 十、取舍记录

| 取舍 | 结论 | 权衡 |
|---|---|---|
| 内容去重 | **放弃** | 优点：用户视角每文件独立；代价：磁盘占用增加、无 COW 复用。影响：`count` 字段退役，逻辑简化 |
| 目录树 | **持久化层不做** | 优点：schema 简洁；代价：文件页无 in-app 树。缓解：primitive 层预留 `DirectoryTreeBuilder`（§十二）供业务按需消费 |
| Notes 耦合 | **解耦** | Notes 自治 FS-first；跨域引用用 `origin='external'` FileEntry |
| UUID 版本 | **新 entry 用 v7；旧 v4 保留** | v7 的 time-order 只对新 insert 有意义；保留 v4 避免跨表翻译（migration-plan §2.9） |
| External 操作策略 | **用户显式操作可改，不追踪外部 rename** | 类 VS Code 语义；外部 rename 让 entry 自然 dangling |
| AI SDK upload | **延后独立 PR** | 依赖未稳定；FileEntry schema 不受影响 |
| `count` 字段 | **退役** | 改由 DataApi `includeRefCount` 按需 SQL 聚合（migration-plan §2.3） |
| `type` 字段 | **不持久化** | 查询时 ext 派生；`getMetadata` 可 buffer 升级（migration-plan §2.5） |
| `purpose` 字段 | **退役** | 业务上是 upload 调用参数，不是文件属性（migration-plan §2.2） |
| `tokens` 字段 | **纯删** | 0 producer + 0 consumer 的死字段（migration-plan §2.4） |

---

## 十一、风险项

| 风险 | 影响 | 缓解 |
|---|---|---|
| `FileMetadata` 引用面广（274+ 处） | Consumer Migration 工作量大 | `toFileMetadata` 适配 + 分批 Batch A-E 迁移（migration-plan §3） |
| 旧 `ext` 含点/不含点不统一 | 路径解析错误 | 迁移时 normalize 为不含点；`resolvePhysicalPath` 拼接时始终加点（migration-plan §2.7.6） |
| KnowledgeMigrator / ChatMigrator 的 `fileId` 可能悬挂 | 插入 file_ref 失败 | 先查 `fileIdMap` 验证存在性，缺失跳过 + warn |
| Painting 的 file_ref 暂缺 | 文件页无法追溯 painting 引用 | 文件条目本身已存在可访问；随 Painting 重构补建 |
| Phase 1a 的 `throw NotImplemented` 影响上游 | 开发期阻塞 | Phase 1a 不切换 renderer 调用路径，Phase 1b 补齐后统一切换 |
| External entry 物理文件外部丢失 | entry 变 dangling | DanglingCache + `includeDangling` opt-in 给 UI 展示；不自动清理 file_ref（用户手动处理） |

---

## 十二、预留 Primitive：DirectoryTreeBuilder

> **状态**：接口草案，不在当前 Phase 实现范围。首个实现者（Notes）落地时产出 lean 版本，第二个消费者到来时再抽公共。

### 12.1 动机

Notes 笔记树、未来可能的 VSCode-like 文件浏览器、知识库目录型 item 视图等，都需要"从某根目录构建一棵可维护的树并随 FS 变更更新"的能力。若每个业务各写一份，会带来重复的事件→mutation 逻辑、各异的过滤规则实现，以及第二消费者出现时昂贵的回迁成本。

方案：在 file module 内预留 **`DirectoryTreeBuilder`** 作为 primitive（与 `DirectoryWatcher`、`ops` 同级，位于 `src/main/file/tree/`），只提供数据层的树构建与维护能力。

### 12.2 设计边界

**属于 primitive**：

- 初始扫描：`scan(rootPath)` → 生成 `TreeNode<T>`
- 事件应用：订阅 `DirectoryWatcher`，按 add / unlink / rename 事件 mutate 树
- 节点 payload 泛型：`TreeNode<T>`，业务可扩展 `data: T`
- 过滤：可插拔 `shouldInclude(path, stat) => boolean` 回调

**不属于 primitive**（留给消费者）：

- UI 状态：选中、展开/折叠、虚拟滚动
- 懒加载：默认全量 scan；lazy 展开作为后续扩展点
- 业务 mutation（创建/删除/重命名 FS 文件）：消费者调 `ops/*` 或 FileManager
- 跨树聚合、搜索高亮、git 状态叠加：上层业务组合

### 12.3 接口草案

```typescript
// packages/shared/file/types/tree.ts

export interface TreeNode<T = unknown> {
  path: string // 绝对路径
  name: string // basename
  kind: 'file' | 'directory'
  parent: TreeNode<T> | null
  children: TreeNode<T>[] // file 节点为空数组
  data?: T // 业务侧扩展
}

export interface DirectoryTreeOptions<T = unknown> {
  /** 过滤：返回 false 的路径不纳入树（同时传给 watcher 的 ignored 避免噪声） */
  shouldInclude?: (path: string, stat: { isDirectory: boolean }) => boolean
  /** 初始化节点 payload */
  initNodeData?: (node: Omit<TreeNode<T>, 'data'>) => T
  /** 透传给底层 DirectoryWatcher */
  watcherOptions?: Partial<DirectoryWatcherOptions>
}

export type TreeMutationEvent<T> =
  | { type: 'added'; node: TreeNode<T>; parent: TreeNode<T> }
  | { type: 'removed'; node: TreeNode<T>; parent: TreeNode<T> }
  | { type: 'renamed'; node: TreeNode<T>; oldPath: string; newParent: TreeNode<T> | null }

export interface DirectoryTreeBuilder<T = unknown> extends Disposable {
  readonly root: TreeNode<T>
  getNode(path: string): TreeNode<T> | null
  onMutation: Event<TreeMutationEvent<T>>
}
```

### 12.4 工厂与接线

```typescript
// src/main/file/tree/factory.ts

export async function createDirectoryTree<T = unknown>(
  rootPath: string,
  options?: DirectoryTreeOptions<T>
): Promise<DirectoryTreeBuilder<T>>
```

工厂内部：

1. walk `rootPath` 构建初始树（受 `shouldInclude` 过滤）
2. 通过 `createDirectoryWatcher()` 订阅 FS 事件（复用现有 primitive，自动接入 DanglingCache）
3. 事件 → 树 mutation 映射：
   - `onAdd` / `onAddDir` → `added`
   - `onUnlink` / `onUnlinkDir` → `removed`
   - `onRename` → `renamed`（启用 `renameDetection` 时）

### 12.5 阶段化路线

| 阶段 | 内容 | 触发条件 |
|---|---|---|
| **A. 接口草案（本节）** | 类型 + 文档 | 已完成 |
| **B. Lean 实现** | scan + watcher 接线 + add/remove/rename mutation；无 lazy、无高级过滤 | Notes 集成时落地 |
| **C. 能力补全** | lazy 展开、gitignore、diff 推送 | 第二消费者出现且确有需求 |
| **D. 公共抽取重构** | 若第二消费者需求与 Notes 分叉严重 | Phase C 后 |

### 12.6 与问题清单的关系

此 primitive **不改变** `file-arch-problems-response.md` 中 §6 / §9 / §10 的决策：

- `file_entry` 表仍然扁平，不引入 `parentId`
- Notes 文件仍不镜像到 `file_entry`
- 树是**运行时 / 渲染层**关注点，与持久化模型正交

它只是把"各业务各写一份 tree 逻辑"的潜在重复收敛到 file module primitive，换句话说：**把 §6 原问题中的"目录树能力缺失"回应为"primitive 就位，业务按需消费"**——而非把目录结构塞回 DB。

---

## 十三、待补充内容

- [ ] FileMigrator 对旧物理文件路径的兼容细节（含点 ext 目录结构的过渡方案，migration-plan §2.7.6）
- [ ] PaintingMigrator（随 Painting 业务重构独立推进，仅依赖 FileMigrator 提供的 fileId）
- [ ] DirectoryTreeBuilder Lean 实现细节（随 Notes 集成落地）
- [ ] AI SDK FileUploadService 详细接口（SDK 稳定后独立 PR）
