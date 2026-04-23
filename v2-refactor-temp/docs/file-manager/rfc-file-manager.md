# RFC: 文件管理

> **定位**：实现设计文档。包含数据 Schema、API 契约、核心流程伪代码、迁移策略与分阶段计划。
>
> 架构决策（系统边界、组件职责、数据流）以 [`docs/references/file/architecture.md`](../../../docs/references/file/architecture.md) 和 [`docs/references/file/file-manager-architecture.md`](../../../docs/references/file/file-manager-architecture.md) 为准。本文档中与架构文档冲突的内容，以架构文档为 Source of Truth。
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
- **类型分层：引用 vs 数据形状**——`FileHandle` 是跨边界的多态引用层；`FileEntry`（managed）与 `FileInfo`（unmanaged）是两种"数据形状"。旧 `FileMetadata` 同时承担"DB 行"与"通用文件描述符"两个角色，v2 把这两个角色**显式拆分**：持久化角色 → `FileEntry`，描述符角色 → `FileInfo`。详见 [`architecture.md §2`](../../../docs/references/file/architecture.md#2-type-system-reference-vs-data-shape)
- **AI SDK upload 延后**——待 Vercel AI SDK Files API 稳定后以独立 PR 引入

---

## 二、范畴说明

**本 RFC 覆盖**：

- `file_entry` / `file_ref` 两张表的 Drizzle Schema
- DataApi（只读）+ File IPC（读写）契约
- FileManager 核心流程伪代码（createInternalEntry / ensureExternalEntry / read / write / trash / restore / permanentDelete / rename / copy）
- OrphanRefScanner 注册式 checker 设计
- Dexie → SQLite 的 FileMigrator 流程
- 分阶段实施计划（Phase 1a / 1b.1-4 / 2 / X）

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

| 决策                  | 结论                                                                                                                    | 理由                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| FileEntry 结构        | 扁平（无 `parentId`、无 mount）                                                                                         | 持久化层不做目录树；Notes 自治（问题 6/10）                                                      |
| 主键策略              | UUID v7（`uuidPrimaryKeyOrdered`）；旧数据保留 v4                                                                       | 新 entry 时间有序；旧 v4 ID 跨表引用零翻译（migration-plan §2.9）                                |
| `origin` 枚举         | `'internal' \| 'external'`                                                                                              | Cherry 拥有 vs 用户拥有；语义清晰                                                                |
| External path 唯一性  | Global unique index on `externalPath`（internal 行为 null，SQLite UNIQUE 视多个 NULL 互不冲突，天然只约束 external 行） | 同 path 全局最多一条；`ensureExternalEntry` 纯 upsert by path，无 "restore trashed" 分支         |
| `size` 字段           | 必填（INTEGER NOT NULL）                                                                                                | 查询/排序需要；external 为最后观测的快照                                                         |
| trash 语义            | `trashedAt` 时间戳；**仅对 internal 有效**，external 由 `fe_external_no_trash` CHECK 禁止 trashed                       | internal 保留软删可逆窗口；external 生命周期单向（Active → Deleted），重建成本为零所以不需要撤销 |
| external 删除语义     | `permanentDelete` 只删 DB 行；物理文件不动（path-level `ops.remove` 独立提供）                                          | Cherry 不在 entry-level 自动 unlink 用户拥有的文件；用户有需要时走独立的 unmanaged 删除通道      |
| `sourceType` / `role` | 应用层 Zod 验证 + 编译期 checker 注册                                                                                   | 新增 sourceType 无需 DB migration                                                                |
| `file_ref` 防重       | UNIQUE(fileEntryId, sourceType, sourceId, role)                                                                         | 一个业务对象不会以同一角色重复引用同一文件                                                       |
| DataApi 职责          | 只读 + 允许幂等副作用（SQL 聚合、`fs.stat`）                                                                            | 所有 mutation 走 File IPC                                                                        |
| Upload 派生数据       | 延后引入 `file_upload` 表                                                                                               | Vercel AI SDK Files API 未稳定                                                                   |

### 4.2 fileEntryTable

```typescript
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  createUpdateTimestamps,
  uuidPrimaryKeyOrdered,
} from "./_columnHelpers";

export const fileEntryTable = sqliteTable(
  "file_entry",
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

    /**
     * 软删时间戳（ms epoch）；null 表示未 trash。**仅 internal 可用**；
     * external 恒为 null（由 `fe_external_no_trash` CHECK 强制）。
     */
    trashedAt: integer(),

    ...createUpdateTimestamps,
  },
  (t) => [
    index("fe_trashed_at_idx").on(t.trashedAt),
    index("fe_created_at_idx").on(t.createdAt),
    // 同 externalPath 全局最多一条。internal 行为 null，SQLite 视多个 NULL
    // 互不冲突，因此天然只约束 external 行。兼任查询索引。
    uniqueIndex("fe_external_path_unique_idx").on(t.externalPath),
    check("fe_origin_check", sql`${t.origin} IN ('internal', 'external')`),
    check(
      "fe_origin_consistency",
      sql`(${t.origin} = 'internal' AND ${t.externalPath} IS NULL) OR (${t.origin} = 'external' AND ${t.externalPath} IS NOT NULL)`,
    ),
    // External 不可 trashed：trash/restore 仅对 internal，external 走 permanentDelete
    check(
      "fe_external_no_trash",
      sql`${t.origin} != 'external' OR ${t.trashedAt} IS NULL`,
    ),
  ],
);
```

**字段权威性矩阵**：

| 字段           | origin='internal' | origin='external'             |
| -------------- | ----------------- | ----------------------------- |
| `name`         | SoT（用户可改名） | 上次 observe 的 basename 快照 |
| `ext`          | SoT               | 上次 observe 的扩展名         |
| `size`         | SoT               | 上次 observe 的字节数         |
| `externalPath` | NULL              | 绝对路径（external 身份）     |

### 4.3 fileRefTable

```typescript
export const fileRefTable = sqliteTable(
  "file_ref",
  {
    id: uuidPrimaryKey(),

    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: "cascade" }),

    /** 业务来源类型（'chat_message' / 'knowledge_item' / 'painting' / ...） */
    sourceType: text().notNull(),
    /** 业务对象 ID（polymorphic, no FK） */
    sourceId: text().notNull(),
    /** 引用角色（'attachment' / 'source' / 'asset' / ...） */
    role: text().notNull(),

    ...createUpdateTimestamps,
  },
  (t) => [
    index("file_ref_entry_id_idx").on(t.fileEntryId),
    index("file_ref_source_idx").on(t.sourceType, t.sourceId),
    uniqueIndex("file_ref_unique_idx").on(
      t.fileEntryId,
      t.sourceType,
      t.sourceId,
      t.role,
    ),
  ],
);
```

设计要点：

- `fileEntryId` CASCADE：删除 entry 自动清理其所有 ref
- `sourceId` 无 FK：polymorphic 多态；依赖应用层清理 + 孤儿扫描兜底（§六）
- UNIQUE：防重复引用（同一文件不会被同一业务对象以同一角色引用两次）

### 4.4 Upload 表（延后）

Vercel AI SDK `SharedV4ProviderReference` 集成所需的 `file_upload` 表在 SDK Files API 稳定后独立 PR 引入。设计意图见 [`file-manager-architecture.md §9`](../../../docs/zh/references/file/file-manager-architecture.md)，不在 Phase 1a 交付物内。

### 4.5 DTO 类型定义

位于 `packages/shared/data/types/file/`（managed 数据形状与引用图）：

| 文件           | 内容                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `essential.ts` | `TimestampSchema`、`SafeNameSchema` 等基础 schema                                                                           |
| `fileEntry.ts` | `FileEntrySchema`（`z.discriminatedUnion('origin')` + `.brand<'FileEntry'>()`）、`FileEntryIdSchema`、`DanglingStateSchema` |
| `ref/`         | `FileRefSchema`（`z.discriminatedUnion('sourceType')`，不 brand）、`createRefSchema` 工厂                                   |
| `index.ts`     | Barrel re-export                                                                                                            |

位于 `packages/shared/file/types/`（跨边界引用层与 unmanaged 数据形状）：

| 文件         | 内容                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| `common.ts`  | `FilePath` / `FileType` / `PhysicalFileMetadata` 等基础类型                          |
| `handle.ts`  | `FileHandle` tagged union、`createManagedHandle` / `createUnmanagedHandle` 工厂      |
| `info.ts`    | `FileInfo`（unmanaged 数据形状，见 §4.5.3）                                          |
| `ipc.ts`     | File IPC 方法签名                                                                    |
| `index.ts`   | Barrel re-export                                                                     |

### 4.5.1 Brand type 强化（解决问题 13）

**动机**：`FileEntry` 有**派生字段**——`name/ext` 由 basename 切分、`type` 由 `ext` 派生、`refCount/dangling/path/url` 是 DataApi 按需聚合。这些派生只有在 sanctioned 路径（main 侧）才能正确产生。旧 `FileMetadata` 是普通 interface，允许对象字面量满足——renderer / 业务代码自拼 entry 会破坏派生统一性。

**解法**：**只给 `FileEntry` 一个类型加 brand**——让对象字面量无法满足类型，只有经过 `FileEntrySchema.parse()` 的值才是 `FileEntry`：

```typescript
// packages/shared/data/types/file/fileEntry.ts
export const FileEntryIdSchema = z.uuid(); // 普通字符串，不 brand

export const FileEntrySchema = z
  .discriminatedUnion("origin", [InternalEntrySchema, ExternalEntrySchema])
  .brand<"FileEntry">();

export type FileEntryId = z.infer<typeof FileEntryIdSchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
```

**效果**：

- `const e: FileEntry = { id, origin, name, ... }` → 编译错误（缺 brand，拒绝绕过派生的鸭子对象）
- `const e = FileEntrySchema.parse(raw)` → OK，Zod 自动施加 brand
- `const e2: FileEntry = { ...e, name: 'x' }` → 编译错误（spread 丢 brand）——修改被迫走 `rename` IPC 等 sanctioned mutator

**范围严控**：仅 `FileEntry` 一个类型加 brand。其他类型（`FileEntryId` / `FileRef` / `FileRefId`）保持普通 `z.infer` 类型——它们没有派生字段（ID 是纯字符串，FileRef 是纯行），加 brand 只会给测试和 main 内部代码增加无谓的 parse 样板，不换保护。

**生产点仅三条**（每条都显式 `parse`）：

| 生产者                                                                                                          | 位置                                                                 |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `createInternalEntry` / `ensureExternalEntry` / `batchCreateInternalEntries` / `batchEnsureExternalEntries` IPC | `FileManager` 返回前 parse                                           |
| DataApi handler（row → DTO）                                                                                    | `src/main/data/api/handlers/files.ts` 响应前 parse；固定 shape，无 opt-in 派生 |
| File IPC enrichment（dangling / path / url）                                                                   | `FileManager` 专用方法内部计算（见 §七）                            |
| FileMigrator insert                                                                                             | `FileMigrator` 转换后 parse                                          |

**Test 逃生舱**：`tests/__mocks__/factories.ts` 提供 `makeFileEntry(overrides)`，内部仍走 `FileEntrySchema.parse`——mock 数据也经过 schema 校验，不留 unbranded 后门。

**运行期防线**：brand 是编译期约束，运行期 `as FileEntry` 仍可绕；真正的运行时防线是 **IPC 边界与 DataApi 响应边界的显式 parse**，保证即便 TS 被绕过，数据形状依然合法。

### 4.5.2 推断类型

```typescript
type FileEntry = z.infer<typeof FileEntrySchema>; // branded, discriminated on origin
type InternalFileEntry = z.infer<typeof InternalEntrySchema>;
type ExternalFileEntry = z.infer<typeof ExternalEntrySchema>;
type FileRef = z.infer<typeof FileRefSchema>; // 不 branded（纯行，无派生）
type FileEntryId = z.infer<typeof FileEntryIdSchema>; // 不 branded；z.uuid() 接受 v4 / v7
type DanglingState = z.infer<typeof DanglingStateSchema>; // 'present' | 'missing' | 'unknown'
```

**API DTO**：DataApi 的 `/files/entries` 端点响应 shape 固定为 `FileEntry`（branded）——无 opt-in 派生字段。引用计数由专用端点 `/files/entries/ref-counts` 返回 `FileEntryRefCount[]`（纯 SQL）；dangling / path / url 等 FS/resolver 派生一律走 File IPC（见 §七）。旧设计的 `FileEntryView` 类型（带 opt-in `refCount?` / `dangling?` / `path?` / `url?`）已作废。

`FileEntryIdSchema` 使用 `z.uuid()` 而非 `z.uuidv7()`，以接受旧数据的 v4 ID（见 migration-plan §2.9）。

### 4.5.3 FileInfo（unmanaged 数据形状）

位于 [`packages/shared/file/types/info.ts`](../../../packages/shared/file/types/info.ts)：

```typescript
interface FileInfo {
  readonly path: FilePath       // unmanaged 身份字段；绝对路径
  readonly name: string         // basename 去扩展名（对齐 FileEntry.name）
  readonly ext: string | null   // 扩展名不含前导点（对齐 FileEntry.ext）
  readonly size: number         // fs.stat 实时
  readonly mime: string         // 由 ext 派生，未知时 'application/octet-stream'
  readonly type: FileType       // 由 ext 派生
  readonly createdAt: number    // fs 出生时间（ms epoch；不可靠时回退 mtime）
  readonly modifiedAt: number   // fs mtime（ms epoch）
}
```

**定位**：`FileInfo` 是**unmanaged 文件的数据形状**——与 `UnmanagedFileHandle` 在引用层对应。它不承载身份（无 `id`、无 `origin`、无 `trashedAt`），只承载"磁盘上此刻的一份描述"。

**与 `FileEntry` 的关系**：

| 对比项       | `FileEntry`                                     | `FileInfo`                             |
| ------------ | ----------------------------------------------- | -------------------------------------- |
| 身份字段     | `id`                                            | `path`                                 |
| 活性         | 快照（与物理状态解耦）                          | 实时（每次读都可能不同）               |
| 生命周期     | 持久化；internal 有 trash/restore               | 瞬态——随调用产生即走                  |
| 生产入口     | `createInternalEntry` / `ensureExternalEntry`   | `ops.stat` / `toFileInfo(entry)`       |
| brand        | 有（强制走 sanctioned 生产路径）                | 无（可自由构造）                       |
| 同名字段语义 | `size` 为注册时快照；external 可能 drift        | `size` 为 fs.stat 实时读取             |

**投影方向单一**：`FileEntry → FileInfo` 通过 `toFileInfo(entry)` 异步投影（需要 `fs.stat` + 根据 `origin` 做 path 解析）。反向**不是类型转换**——从 `FileInfo` 得到 `FileEntry` 必须走 `createInternalEntry` / `ensureExternalEntry`，因为它是状态变更（注册），不是形状变换。`FileEntrySchema` 的 brand 会挡住任何对象字面量式的伪造。

**签名选型**：绝大多数公共 / IPC 方法应接 **`FileHandle`** 而非 `FileInfo` —— 让同一个 API 同时服务 managed 与 unmanaged。`FileInfo` 主要出现在：

- **返回类型**：`ops.stat(path)` / export 产物 / backup 归档产物
- **叶子消费者的参数**：OCR / TokenService / 哈希计算等只读 path + 物理属性的纯处理函数（调用方若持有 `FileEntry` 需先 `toFileInfo` 投影）

完整选型矩阵见 [`architecture.md §2.4`](../../../docs/references/file/architecture.md#24-signature-selection-guide)。

---

## 五、核心流程

> FS 操作由 `ops/*` 纯函数执行（唯一 FS owner）。DB 操作由 `FileEntryService` / `FileRefService` 执行（纯 DB repository）。FileManager 做协调与 IPC 分派。

### 5.1 Entry 创建：`createInternalEntry` + `ensureExternalEntry`

公开 API 按语义严格拆分（见 `file-manager-architecture.md §1.6`）：

- `createInternalEntry(params)` —— 总是 insert，每次产生新 UUID
- `ensureExternalEntry(params)` —— 按 `externalPath` 纯 upsert：reuse（刷 snapshot）/ insert 两路之一，幂等（external 恒非 trashed，无 restore 分支）

```typescript
// CreateInternalEntryParams 是 source-discriminated union：
//   | { source: 'path',   path: FilePath }
//   | { source: 'url',    url: URLString }
//   | { source: 'base64', data: Base64String; name?: string }
//   | { source: 'bytes',  data: Uint8Array;   name: string; ext: string | null }
// 类型门把"能从 content 派生的字段"在可派生分支上直接 hide，避免调用方冗余/矛盾输入。
// 完整契约与决策说明见 `packages/shared/file/types/ipc.ts` + `file-arch-problems-response.md`（A-7 延伸）。

// createInternalEntry: 复制 / 移动内容到 {userData}/files/{id}.{ext}
async function createInternalEntry(
  params: CreateInternalEntryParams,
): Promise<FileEntry> {
  const id = uuidv7();
  const { name, ext, bytes } = await resolveInternalSource(params);
  const dest = resolvePhysicalPath({ id, ext, origin: "internal" });

  // 1. 原子写物理文件
  await ops.atomicWriteFile(dest, bytes);
  const { size } = await ops.stat(dest);

  // 2. 写入 DB
  return fileEntryService.create({ id, origin: "internal", name, ext, size });
}

// resolveInternalSource: 按 source 分支派生 name/ext/bytes
async function resolveInternalSource(p: CreateInternalEntryParams) {
  switch (p.source) {
    case "path": {
      const bytes = await ops.createReadStream(p.path);
      return { ...splitName(path.basename(p.path)), bytes };
    }
    case "url": {
      const res = await fetch(p.url);
      return {
        ...deriveFromUrl(p.url, res.headers), // 末段 / Content-Disposition / Content-Type
        bytes: new Uint8Array(await res.arrayBuffer()),
      };
    }
    case "base64": {
      const { mime, bytes } = decodeDataUrl(p.data);
      return {
        name: p.name ?? synthesizeName(mime),
        ext: mimeToExt(mime),
        bytes,
      };
    }
    case "bytes":
      return { name: p.name, ext: p.ext, bytes: p.data };
  }
}

// ensureExternalEntry: 按 externalPath 纯 upsert
async function ensureExternalEntry(
  params: EnsureExternalEntryParams,
): Promise<FileEntry> {
  // Phase 1b.1 同步廉价 canonicalize: path.resolve + NFC + trailing-sep strip.
  // 不含 fs.realpath（case-insensitive FS 去重由 Phase 2 视用户反馈补）。
  // 是 upsert/查询的唯一 key 来源。
  const canonicalPath = canonicalizeExternalPath(params.externalPath);
  // External 恒非 trashed（fe_external_no_trash CHECK），所以不需要 includeTrashed。
  const existing = await fileEntryService.findByExternalPath(canonicalPath);

  const stat = await ops.stat(canonicalPath); // 验证存在 + 取 snapshot
  const { name, ext } = splitName(path.basename(canonicalPath));

  if (existing) {
    // 刷新 snapshot（size/name/ext 可能因外部写而过期）
    return fileEntryService.update(existing.id, { name, ext, size: stat.size });
  }

  return fileEntryService.create({
    origin: "external",
    name,
    ext,
    size: stat.size,
    externalPath: canonicalPath,
  });
}
```

**原子性**：

- `createInternalEntry`：物理写 + DB 写两步。物理写失败 → 无 DB 行；DB 写失败 → 启动期 orphan sweep 清理残留 UUID 文件
- `ensureExternalEntry`：仅 DB 写 + 一次 stat 验证；stat 失败直接抛错

### 5.2 read / write / writeIfUnchanged

所有接受 `FileHandle`（`managed | unmanaged`）。

- `read`：managed 解析 `entryId → path` 后调 `ops.read`；unmanaged 直接读 path
- `write`：原子写（`ops.atomicWriteFile`），更新版本缓存；external 覆盖用户文件（显式操作语义）
- `writeIfUnchanged`：乐观并发（`ops.atomicWriteIfUnchanged`），版本不匹配抛 `StaleVersionError`

详细语义见 `file-manager-architecture.md §4-§6`。

### 5.3 trash / restore（软删除，仅 internal）

**纯 DB 操作，不碰 FS。仅对 internal 有效**——external 由 `fe_external_no_trash` CHECK 禁止 trashed，调用入口先校验 origin，传入 external id 直接抛错；schema 层兜底：

```typescript
async function trash(id: FileEntryId): Promise<void> {
  const entry = await fileEntryService.findById(id);
  if (entry.origin === "external") {
    throw new Error(
      `Cannot trash external entry ${id}; external entries have no trashed state. Use permanentDelete.`,
    );
  }
  await fileEntryService.update(id, { trashedAt: Date.now() });
}

async function restore(id: FileEntryId): Promise<FileEntry> {
  const entry = await fileEntryService.findById(id);
  if (entry.origin === "external") {
    throw new Error(
      `Cannot restore external entry ${id}; external entries are never trashed.`,
    );
  }
  return fileEntryService.update(id, { trashedAt: null });
}
```

### 5.4 permanentDelete

物理 FS 行为按 origin 分叉：internal 真删，external 仅删 DB 行（物理文件不动；用户若想物理删除请走 unmanaged path 分支）。

```typescript
async function permanentDelete(handle: FileHandle): Promise<void> {
  if (handle.kind === "unmanaged") {
    // Path-level 删除（显式、与任何 entry 解绑）
    await ops.remove(handle.path);
    return;
  }
  const entry = await fileEntryService.getById(handle.entryId);

  if (entry.origin === "internal") {
    // Cherry 拥有物理文件：unlink FS + 删 DB
    await ops.remove(resolvePhysicalPath(entry)).catch(ignoreEnoent);
  }
  // external: entry-level 删除仅动 DB 行；不触碰用户的物理文件。
  // 需要物理删的调用方应独立走 unmanaged 分支（上面）。

  await fileEntryService.delete(entry.id); // CASCADE 清 file_ref
}
```

### 5.5 rename

- **Managed-internal**：纯 DB 更新 `name`（物理文件名是 UUID 不变）
- **Managed-external**：`ops.rename(oldExternalPath, newPath)` + DB 更新 `externalPath` / `name` / `ext`
- **Unmanaged**：`ops.rename(oldPath, newPath)`，等价于 `fs.rename`

### 5.6 copy

产出新 internal entry：

```typescript
async function copy(params: {
  source: FileHandle;
  newName?: string;
}): Promise<FileEntry> {
  const sourcePath = resolveFileHandle(params.source); // → absolute FilePath
  // source: 'path' 分支 — createInternalEntry 内部会走 basename/extname 派生 name/ext。
  // newName 另走一条：若提供则在派生后 override（copy 独占的 UX 需求，不污染 core API）。
  const entry = await createInternalEntry({ source: "path", path: sourcePath });
  return params.newName ? rename(entry.id, params.newName) : entry;
}
```

### 5.7 崩溃恢复（启动期 orphan sweep）

`FileManager.onInit` 后台 fire-and-forget（不阻塞 ready）：

1. 扫描 `{userData}/files/` 下 UUID 文件名：查 DB 找不到对应 entry → `unlink`
2. 扫描 `*.tmp-<uuidv7>` 原子写残留 → `unlink`

`DanglingCache` 反向索引初始化为同步 DB 查询（external entries 通常 < 10k）；watcher 事件与冷路径 stat 在运行期增量更新。

### 5.8 元数据生产统一入口（问题 13）

- **`createInternalEntry` / `ensureExternalEntry` 是 entry 创建的唯一路径**——renderer 不再自己拼接 FileMetadata
- **`name` / `ext` 切分**：main 侧统一在这两个方法内处理（见 migration-plan §2.7）
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
await fileRefService.cleanupBySource(sourceType, sourceId);

// 批量（如删除 topic 时一次性清理所有消息的引用）
await fileRefService.cleanupBySourceBatch(sourceType, sourceIds);
```

**接入点**：

| 删除场景       | 清理调用                                           |
| -------------- | -------------------------------------------------- |
| 删除消息       | `cleanupBySource('chat_message', messageId)`       |
| 删除 topic     | `cleanupBySourceBatch('chat_message', messageIds)` |
| 删除知识库     | `cleanupBySourceBatch('knowledge_item', itemIds)`  |
| 删除知识库条目 | `cleanupBySource('knowledge_item', itemId)`        |
| 删除 painting  | `cleanupBySource('painting', paintingId)`          |

### 6.4 第三层：注册式孤儿扫描

```typescript
interface SourceTypeChecker {
  sourceType: FileRefSourceType;
  /** 给一批 sourceId，返回其中仍然存在的 ID 集合 */
  checkExists: (sourceIds: string[]) => Promise<Set<string>>;
}

/**
 * 编译期强制：每个 FileRefSourceType 都必须有 checker。
 * 新增 sourceType 未注册 → TypeScript 报错。
 */
type OrphanCheckerRegistry = Record<FileRefSourceType, SourceTypeChecker>;

class OrphanRefScanner {
  constructor(private checkers: OrphanCheckerRegistry) {}

  /** 扫描一种 sourceType 的孤儿引用，cursor-based 分页 */
  async scanOneType(sourceType: FileRefSourceType): Promise<number>;

  /** 扫描所有已注册的 sourceType */
  async scanAll(): Promise<{
    total: number;
    byType: Partial<Record<FileRefSourceType, number>>;
  }>;
}
```

**注册示例**（编译期强制覆盖所有 sourceType）：

```typescript
const orphanScanner = new OrphanRefScanner({
  chat_message: {
    sourceType: "chat_message",
    checkExists: async (ids) => {
      const rows = await db
        .select({ id: messageTable.id })
        .from(messageTable)
        .where(inArray(messageTable.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  },
  knowledge_item: {
    sourceType: "knowledge_item",
    checkExists: async (ids) => {
      /* ... */
    },
  },
  painting: {
    sourceType: "painting",
    checkExists: async (ids) => {
      /* ... */
    },
  },
  // 新增 FileRefSourceType 未补上 checker → TypeScript 编译报错
});
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

### 7.1 DataApi（只读，纯 SQL，固定 shape）

位于 `packages/shared/data/api/schemas/files.ts`。所有端点**只做 SQL**——不触 FS、不调 main-side resolver、不查 in-memory cache。响应 shape 按端点固定，**不使用 opt-in 派生字段**。任何需要 FS IO 或 main-side 计算的派生都搬到 File IPC（§7.2）。

```typescript
export interface FileSchemas {
  "/files/entries": {
    GET: {
      query: {
        origin?: "internal" | "external";
        inTrash?: boolean;
        sortBy?: "name" | "createdAt" | "updatedAt" | "size";
        sortOrder?: "asc" | "desc";
        page?: number;
        limit?: number;
      };
      response: OffsetPaginationResponse<FileEntry>;  // 固定 shape
    };
  };

  "/files/entries/:id": {
    GET: {
      params: { id: FileEntryId };
      response: FileEntry;  // 固定 shape
    };
  };

  "/files/entries/ref-counts": {
    GET: {
      query: { entryIds: FileEntryId[] };
      response: FileEntryRefCount[];  // { entryId, refCount }[] 纯 SQL 聚合
    };
  };

  "/files/entries/:id/refs": {
    GET: { params: { id: FileEntryId }; response: FileRef[] };
  };

  "/files/refs/by-source": {
    GET: {
      query: { sourceType: string; sourceId: string };
      response: FileRef[];
    };
    // 不暴露 POST / DELETE —— ref 写操作由业务 service 直接调 fileRefService
  };
}
```

**旧 opt-in 派生字段迁移表**（全部搬出 DataApi，分别落到专用端点或 File IPC）：

| 旧 opt-in         | 新归属                                                                    | 类别                      |
| ----------------- | ------------------------------------------------------------------------- | ------------------------- |
| `includeRefCount` | DataApi 专用端点 `/files/entries/ref-counts`                              | 纯 SQL 聚合（仍 DataApi） |
| `includeDangling` | File IPC `getDanglingState` / `batchGetDanglingStates`                    | FS-backed                 |
| `includePath`     | File IPC `getPhysicalPath` / `batchGetPhysicalPaths`                      | Main-side resolver        |
| `includeUrl`      | 共享纯函数 `toSafeFileUrl(path, ext)`（`@shared/file/urlUtil`）在进程内合成 | Pure formatting + 危险扩展包装（零 IPC）|

### 7.2 File IPC（读写）

位于 `packages/shared/file/types/ipc.ts`。所有涉及 FS 或 mutation 的操作走此通道。

| 方法                          | 入参                                  | 返回                         | 说明                                                                                                                                    |
| ----------------------------- | ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `select`                      | 对话框选项                            | `string \| string[] \| null` | Electron file/folder picker                                                                                                             |
| `save`                        | `{ content, defaultPath?, filters? }` | `string \| null`             | Save dialog + 写文件                                                                                                                    |
| `createInternalEntry`         | `CreateInternalEntryIpcParams`        | `FileEntry`                  | 新建 Cherry 拥有 entry，每次产生新 UUID，无冲突                                                                                         |
| `ensureExternalEntry`         | `EnsureExternalEntryIpcParams`        | `FileEntry`                  | 按 `externalPath` 纯 upsert：reuse（刷 snapshot）/ insert                                                                               |
| `batchCreateInternalEntries`  | `CreateInternalEntryIpcParams[]`      | `BatchOperationResult`       | 批量新建 internal                                                                                                                       |
| `batchEnsureExternalEntries`  | `EnsureExternalEntryIpcParams[]`      | `BatchOperationResult`       | 批量 upsert external（批内 path 重复会 coalesce）                                                                                       |
| `read`                        | `FileHandle, opts?`                   | `ReadResult<T>`              | 读内容（text / base64 / binary）                                                                                                        |
| `getMetadata`                 | `FileHandle`                          | `PhysicalFileMetadata`       | 物理元数据                                                                                                                              |
| `getVersion`                  | `FileHandle`                          | `FileVersion`                | 轻量版本戳                                                                                                                              |
| `getContentHash`              | `FileHandle`                          | `string`                     | xxhash-128                                                                                                                              |
| `write`                       | `FileHandle, data`                    | `FileVersion`                | 原子写                                                                                                                                  |
| `writeIfUnchanged`            | `FileHandle, data, version`           | `FileVersion`                | 乐观并发写                                                                                                                              |
| `trash`                       | `{ id }`                              | `void`                       | 软删（DB only）。**Internal-only** — 传 external id 抛错（`fe_external_no_trash` CHECK）                                                |
| `restore`                     | `{ id }`                              | `FileEntry`                  | 从 Trash 恢复。**Internal-only** — external 恒非 trashed，传 external id 抛错                                                           |
| `permanentDelete`             | `FileHandle`                          | `void`                       | 删 entry。Internal: unlink FS + 删 DB 行；External (managed): **只删 DB 行**，物理文件不动；Unmanaged path: `ops.remove(path)` 物理删除 |
| `batchTrash` / `batchRestore` | 批量参数                              | `BatchOperationResult`       | 批量版本，internal-only                                                                                                                 |
| `batchPermanentDelete`        | 批量参数                              | `BatchOperationResult`       | 批量 permanentDelete（物理影响按上述 origin 规则）                                                                                      |
| `rename`                      | `FileHandle, newTarget`               | `FileEntry \| void`          | 重命名                                                                                                                                  |
| `copy`                        | `{ source, newName? }`                | `FileEntry`                  | 复制为新 internal entry                                                                                                                 |
| `refreshMetadata`             | `{ id }`                              | `FileEntry`                  | 显式 stat 刷新 external snapshot                                                                                                        |
| `open` / `showInFolder`       | `FileHandle`                          | `void`                       | 系统程序打开 / 资源管理器定位                                                                                                           |
| `listDirectory`               | `FilePath, options?`                  | `string[]`                   | 扫描目录                                                                                                                                |
| `isNotEmptyDir`               | `FilePath`                            | `boolean`                    | 目录非空检查                                                                                                                            |
| `getDanglingState` / `batchGetDanglingStates` | `{ id }` / `{ ids }`      | `DanglingState` / `Record<id, DanglingState>` | 查询 external entry 存在状态（DanglingCache + 冷路径 fs.stat）。Internal 恒 `'present'`                        |
| `getPhysicalPath` / `batchGetPhysicalPaths`   | `{ id }` / `{ ids }`      | `FilePath` / `Record<id, FilePath>`           | 主进程 `resolvePhysicalPath(entry)`。用于 agent / drag-drop / subprocess                                       |

详细类型契约见 [`packages/shared/file/types/ipc.ts`](../../../packages/shared/file/types/ipc.ts)。

### 7.3 Renderer 使用示例

新模式：**DataApi 拉纯 SQL 数据 + File IPC 按需补 FS/resolver 派生**，renderer 端组合。每个 enrichment 对应一个独立的 `useQuery`，成本显式可见。

```typescript
// 案例 1：FilesPage 列表 + 引用计数 + dangling + preview URL
const { data: entries } = useQuery(fileApi.listEntries, { origin: "internal" });
const entryIds = entries?.map((e) => e.id) ?? [];

const { data: refCounts } = useQuery(fileApi.refCounts, { entryIds });
const { data: presence } = useQuery(
  ["fileManager.batchGetDanglingStates", entryIds],
  () => window.api.fileManager.batchGetDanglingStates(entryIds),
  { enabled: entryIds.length > 0 }
);
const { data: paths } = useQuery(
  ["fileManager.batchGetPhysicalPaths", entryIds],
  () => window.api.fileManager.batchGetPhysicalPaths(entryIds),
  { enabled: entryIds.length > 0 }
);
// renderer 合并后按 refCount 排序
// URL 在进程内合成（共享纯函数，零 IPC）：
//   <img src={paths && toSafeFileUrl(paths[entry.id], entry.ext)} />
// dangling 标记：presence?.[entry.id]

// 案例 2：Agent compose 需要绝对路径（复用同一 IPC，不同 consumer）
const { data: entries } = useQuery(fileApi.listEntries, { ids: selectedFileIds });
const { data: paths } = useQuery(
  ["fileManager.batchGetPhysicalPaths", selectedFileIds],
  () => window.api.fileManager.batchGetPhysicalPaths(selectedFileIds)
);
const filePaths = selectedFileIds.map((id) => paths?.[id]).filter(Boolean).join("\n");

// 案例 3：写操作（走 File IPC）
// createInternalEntry 按 source 分支调用，字段类型门自动收紧
await window.api.file.createInternalEntry({
  source: "path",
  path: userPickedPath,
});
await window.api.file.createInternalEntry({
  source: "base64",
  data: dataUrl,
  name: "Pasted Image",
});
await window.api.file.createInternalEntry({ source: "url", url: downloadUrl });
await window.api.file.ensureExternalEntry({ externalPath });
await window.api.file.trash({ id });
```

---

## 八、迁移策略

### 8.1 迁移的两条主线

| 主线                        | 含义                                            | 文档                                       |
| --------------------------- | ----------------------------------------------- | ------------------------------------------ |
| **数据层一次搬运**          | Dexie `db.files` → SQLite `file_entry`（保 ID） | 本章                                       |
| **字段级退役 + 消费域切换** | 旧 `FileMetadata` 字段逐个退役；消费者按域迁移  | [`migration-plan.md`](./migration-plan.md) |

### 8.2 FileMigrator

```typescript
class FileMigrator extends BaseMigrator {
  readonly id = "file";
  readonly name = "File Migration";
  readonly description = "Migrate files from Dexie to file_entry table";
  readonly order = 2.5; // After Assistant(2), Before Knowledge(3)
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
const fileIdMap = ctx.sharedData.get("fileIdMap") as Map<string, string>;

if (item.type === "file" && item.content?.id) {
  if (fileIdMap.has(item.content.id)) {
    await ctx.db.insert(fileRefTable).values({
      id: generateUUIDv7(),
      fileEntryId: item.content.id,
      sourceType: "knowledge_item",
      sourceId: newKnowledgeItemId,
      role: "source",
    });
  } else {
    logger.warn(`Skipping file_ref: entry ${item.content.id} not found`);
  }
}
```

**ChatMigrator（order=4）**：

迁移 message blocks 时，`block.type === 'file' | 'image'` 且含 `fileId` → 创建 `sourceType='chat_message'` 的 ref。

> **容错要求**：旧数据中可能存在 `block.fileId` 指向已被删除文件的情况（悬挂引用）。由于 `fileRefTable.fileEntryId` 有 FK 约束，直接插入会失败。因此必须**先验证存在性**，缺失跳过并记录 warning。

```typescript
const fileIdMap = ctx.sharedData.get("fileIdMap") as Map<string, string>;

if ((block.type === "file" || block.type === "image") && block.fileId) {
  if (fileIdMap.has(block.fileId)) {
    fileRefsToInsert.push({
      id: generateUUIDv7(),
      fileEntryId: block.fileId,
      sourceType: "chat_message",
      sourceId: messageId,
      role: "attachment",
    });
  } else {
    logger.warn(`Skipping file_ref: entry ${block.fileId} not found`);
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

| 场景                 | 方案                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| FileMigrator 失败    | MigrationEngine 标记失败，用户可重试。清空 `file_entry`（origin='internal' 部分）重跑 |
| 迁移完成后数据异常   | Dexie 导出文件（`files.json`）保留，可重建                                            |
| 新旧并行期数据不一致 | `toFileMetadata` 适配函数（见 migration-plan §4）保证旧消费方继续工作                 |
| 物理文件丢失         | 迁移不移动物理文件，路径兼容性在 resolver 内处理，无文件丢失风险                      |

### 8.7 字段级退役 + 消费域切换

详见 [`migration-plan.md`](./migration-plan.md) §2（字段退役）与 §3（Batch A-E 消费域切换）。本 RFC 不重复。

---

## 九、分阶段实施计划

### 9.1 总览

```
Phase 1a ──→ Phase 1b.1 ──→ Phase 1b.2 ──→ Phase 1b.3 ──→ Phase 1b.4 ──→ Phase 2 ──→ (业务 PRs)
(契约+骨架)   (读路径)        (写/生命周期)   (监控+悬挂)    (启动一致性)    (消费方迁移)
 零运行时      repo + ops       versionCache   watcher +      orphanSweep +               │
                read + canon.    + mutations    DanglingCache  Ref checker                 └──→ Phase X (AI SDK upload)
```

**每个 1b.x 作为独立可合入 PR**。上游（1b.1）合入后，renderer 可以按能力 opt-in 切换新路径；后续阶段 additive 扩展，互不阻塞。

### 9.2 Phase 1a：Contract、Schema、Skeleton（零运行时）

**职责边界**：只定义**类型契约**、**数据库 schema**、**接口骨架**。**不含任何业务逻辑实现**——所有 method body `throw new Error('not implemented in Phase 1a')`，所有 ops 纯函数、FileManager public API、IPC handler、DataApi handler 只保留签名 + JSDoc 契约。Phase 1a 的成功标准是「能让 Phase 1b.x 的子 PR 各自独立合入」。

**交付物**：

| 类别         | 内容                                                                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB Schema    | `src/main/data/db/schemas/file.ts` — `fileEntryTable` + `fileRefTable`，全部 CHECK 约束（`fe_origin_consistency` / `fe_external_no_trash` / `fe_size_nonneg`）就位                                                                             |
| DB migration | `pnpm agents:generate` 生成的 SQL                                                                                                                                                                                                              |
| 跨进程类型   | `packages/shared/data/types/file/` DTO（FileEntry brand DU / FileRef / DanglingState 等）；`packages/shared/data/api/schemas/files.ts` DataApi schema 声明                                                                                     |
| File 类型    | `packages/shared/file/types/ipc.ts` File IPC 契约；`packages/shared/file/types/handle.ts` `FileHandle` tagged union + factory；`packages/shared/file/types/info.ts` `FileInfo` + `toFileInfo` **declare only**                                 |
| Source 枚举  | `FileRefSourceType` 扩成完整 literal union（`'chat_message' \| 'knowledge_item' \| 'painting' \| 'note' \| 'temp_session'`）——Phase 1b.4 加 checker 时缺项会编译期爆                                                                           |
| Main 骨架    | `src/main/file/index.ts` barrel；`src/main/file/ops/*` 纯函数签名 + JSDoc + `throw NotImplemented`；`src/main/file/FileManager.ts` lifecycle service 骨架；`src/main/file/danglingCache.ts` / `watcher/index.ts` / `internal/deps.ts` interface |
| 运行时实现   | **仅** `pathResolver.resolvePhysicalPath` + `getExtSuffix`（含 null-byte 防御、9 条边界测试）                                                                                                                                                  |
| DataApi      | `src/main/data/api/handlers/files.ts` — read-only endpoint 允许占位（返回 stub / NotImplemented）                                                                                                                                              |
| 文档         | `architecture.md` / `file-manager-architecture.md` 全文 Phase badge；RFC 本章 Phase 准入门槛                                                                                                                                                    |

**出口条件**：

- `pnpm lint` + `pnpm build:check` 通过
- `src/main/file/` 下的 interface 与 ops 签名能被 Phase 1b.x 子 PR 独立 import，无循环依赖
- renderer 编译通过（但不走 Phase 1a handler；IPC 调用 Phase 1a 时 throw 是 acceptable）
- 全部骨架文件包含显式 `// [Phase 1b.x] TODO:` 注释指向对应 milestone

**不在本期**：

- FileManager / ops / internal / watcher / danglingCache / orphanSweep 任何运行时逻辑
- `canonicalizeExternalPath` 实现（契约与签名 Phase 1a 锁定，实现在 1b.1）
- `versionCache` 运行时（只定义 interface）
- 任何 Dexie → SQLite 数据搬运
- renderer 切换调用路径

**依赖**：无（可独立 merge）

### 9.3 Phase 1b.1：Read Path & Repository

**职责边界**：填充「**数据仓库 + 读路径**」的 runtime——使 renderer 能通过新架构**读到文件条目**。零写入、零生命周期变更。

**交付物**：

- `FileEntryService` / `FileRefService` CRUD 实现（纯 DB；read 路径完整，write 可保留 stub）
- `ops/fs.ts` 的 `read` / `stat` / `exists` / `metadata` / `contentHash`（xxhash-128）
- `ops/path.ts` 的 `resolvePhysicalPath`（已存在）+ `isUnderManagedStorage` guard
- `canonicalizeExternalPath` 真实现（`path.resolve` + NFC + trailing-sep strip）+ 8-10 条边界测试（NFC/NFD / trailing / `./a/../a` / Windows `\\` / 盘符大小写）
- `FileManager.get*` / `read*` / `getMetadata` / `getUrl` / `findByExternalPath` / `ensureExternalEntry`（upsert-only，不写 FS）
- `internal/content/read.ts` / `internal/content/hash.ts`（含 `*Unmanaged` 变体）
- `dispatchHandle(handle, managedFn, unmanagedFn)` helper 的读路径分派骨架
- DataApi 只读 endpoint 全部上线
- 单测：`ops/*` 纯函数 + service repo + `setupTestDatabase()` schema 不变量验证

**出口条件**：

- renderer 可通过 `FileHandle.managed` 查询 entry + 读内容
- external path 大小写/NFC 差异不产生双 entry（在 case-sensitive FS 下）
- 文件页原有读路径可 feature-flag 切到新架构，旧路径仍存

**不在本期**：

- 写 FS / rename / copy / trash / restore / permanentDelete
- versionCache 运行时（interface 维持骨架）
- watcher / DanglingCache / orphanSweep

**依赖**：Phase 1a

### 9.4 Phase 1b.2：Write Path & Lifecycle

**职责边界**：填充「**所有 mutation**」——文件写入（含 OCC 防护）、条目生命周期（trash/restore/permanentDelete）、条目物理操作（rename/copy/refresh）。

**交付物**：

- `VersionCache` 实现 + 跨进程可见性决策（per-process LRU，进程间不共享）
- `FileVersion` 精度 fallback 运行时落实：mtime 秒级 + size 未变时 content-hash 回退
- `ops/fs.atomicWriteFile` / `atomicWriteIfUnchanged` / `createAtomicWriteStream`（tmp + rename，失败回滚）
- `ops/fs.ts` 的 `write` / `copy` / `move` / `remove` / `open` / `showInFolder` / `listDirectory`（ripgrep + 模糊）
- `internal/entry/create.ts` — `createInternal` / `ensureExternal`（write 分支）
- `internal/entry/lifecycle.ts` — `trash` / `restore` / `permanentDelete` + batch 变体（`permanentDelete` 解耦物理 —— DB 删 row 与 FS 删文件分两步）
- `internal/entry/rename.ts` / `copy.ts` / `refresh.ts`
- `internal/content/write.ts`（含 `*Unmanaged` 变体）
- `internal/system/shell.ts` / `tempCopy.ts`
- `FileManager` facade 全部 mutation API + `dispatchHandle` 写路径分派
- 单测：atomic 失败回滚、OCC 误判场景（同秒+同 size）、trash/restore/permanentDelete 的 CHECK 约束

**出口条件**：

- renderer 可完整走 FileManager 做增删改
- external entry 的 `trash` 调用被 DB CHECK 阻断（`fe_external_no_trash`）
- 写失败时物理文件零残留（atomic 保证）
- `writeIfUnchanged` 在同秒+同 size 场景用 content-hash 回退，不误判

**不在本期**：

- watcher / DanglingCache（外部变更感知）
- orphanSweep（启动期一致性检查）

**依赖**：Phase 1b.1

### 9.5 Phase 1b.3：Watcher & DanglingCache（可观测性）

**职责边界**：对**外部文件变更**的感知——watcher 作为事件源，DanglingCache 作为可订阅的状态聚合。

**交付物**：

- `createDirectoryWatcher` primitive 实际实现（chokidar 或等价），含 debounce / 去重
- `DanglingCache` 反向索引实现（externalPath → entryId set）
- watcher 事件自动接入 DanglingCache 状态更新
- File IPC `getDanglingState` / `batchGetDanglingStates` 落地（DataApi 不承载 dangling 查询）
- `FileManager.subscribeDangling` 订阅 API（future：push-based 失效通知）
- 单测：watcher 事件→DanglingCache 状态转换、反向索引增删一致性、订阅清理

**出口条件**：

- external entry 物理消失 → `DanglingState` 从 `'ok'` 变 `'missing'`
- 文件页能订阅并展示 dangling 状态
- `DanglingCache.'unknown'` 在启动未完成索引时的行为与文档一致（consumer MUST 视为 not-actionable）

**不在本期**：

- 启动期全量孤儿扫描（独立于 per-path watcher）
- 自动清理 file_ref（用户手动处理）

**依赖**：Phase 1b.2

### 9.6 Phase 1b.4：OrphanSweep & FileRefCheckerRegistry（启动期一致性）

**职责边界**：启动期一次性「**数据一致性 sweep**」—— orphan entry（无任何 file_ref 指向）扫描与 bucket P consumers 的 ref checker 注册。

**交付物**：

- `internal/orphanSweep.ts` 实现
- `FileManager.onInit` 的 fire-and-forget sweep
- `src/main/data/services/orphan/FileRefCheckerRegistry.ts` 实现
- 覆盖 bucket P consumers 的 checker（chat_message / knowledge_item / painting，见 `filemetadata-consumer-audit.md`）
- sweep 结果 metric + 日志（不自动删除，只汇总 + 暴露给清理 UI）
- 单测：orphan 识别、checker 注册完备性（`Record<FileRefSourceType, SourceTypeChecker>` 强制所有变体）

**出口条件**：

- 启动能识别所有 orphan entry 并产生报告
- 新增 `FileRefSourceType` variant 时 checker 缺失会编译期爆
- RFC §6 注册式 checker 设计完全落地

**不在本期**：

- 孤儿自动清理（须用户确认；UI 在 Phase 2 业务 PR）
- `fs.realpath` case-insensitive FS 去重（见风险表，Phase 2 additively）

**依赖**：Phase 1b.3

### 9.7 Phase 2：FileMigrator + 消费方迁移（分多 PR）

先落 **FileMigrator**（§8），将 Dexie `db.files` 一次性搬到 `file_entry`；随后按 [`migration-plan.md §3`](./migration-plan.md) 的 Batch A-E 推进：

- **Batch 0**：FileMigrator（数据层一次搬运，包括 KnowledgeMigrator / ChatMigrator 内新增的 file_ref 创建）
- **Batch A**：数据层适配（`toFileMetadata` 适配 + 旧 `FileMetadata` 标注 `@deprecated`）
- **Batch B**：AI Core（`fileProcessor` / `messageConverter` / API 客户端）
- **Batch C**：Knowledge + Painting
- **Batch D**：UI + state management（文件页、消息 block、绘图页面、messageThunk、knowledgeThunk）
- **Batch E**：清理（移除 Dexie `files` 表、`FileMetadata` 类型、旧 `FileStorage`、`toFileMetadata` 适配）

**每个 Batch 完成后**：运行 `pnpm build:check`（lint + test + typecheck），确保不引入回归。

**依赖**：Phase 1b.4

### 9.8 Phase X：AI SDK Upload（延后独立 PR）

Vercel AI SDK Files API 稳定后：

- `file_upload` 表 additive migration
- `FileUploadService` lifecycle service + `FileUploadRepository`
- `ensureUploaded` / `buildProviderReference` / `invalidate` 方法
- 设计意图见 `file-manager-architecture.md §9`

---

## 十、取舍记录

| 取舍              | 结论                                    | 权衡                                                                                                              |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 内容去重          | **放弃**                                | 优点：用户视角每文件独立；代价：磁盘占用增加、无 COW 复用。影响：`count` 字段退役，逻辑简化                       |
| 目录树            | **持久化层不做**                        | 优点：schema 简洁；代价：文件页无 in-app 树。缓解：primitive 层预留 `DirectoryTreeBuilder`（§十二）供业务按需消费 |
| Notes 耦合        | **解耦**                                | Notes 自治 FS-first；跨域引用用 `origin='external'` FileEntry                                                     |
| UUID 版本         | **新 entry 用 v7；旧 v4 保留**          | v7 的 time-order 只对新 insert 有意义；保留 v4 避免跨表翻译（migration-plan §2.9）                                |
| External 操作策略 | **用户显式操作可改，不追踪外部 rename** | 类 VS Code 语义；外部 rename 让 entry 自然 dangling                                                               |
| AI SDK upload     | **延后独立 PR**                         | 依赖未稳定；FileEntry schema 不受影响                                                                             |
| `count` 字段      | **退役**                                | 改由 DataApi 专用端点 `/files/entries/ref-counts` 按需 SQL 聚合（migration-plan §2.3）                            |
| `type` 字段       | **不持久化**                            | 查询时 ext 派生；`getMetadata` 可 buffer 升级（migration-plan §2.5）                                              |
| `purpose` 字段    | **退役**                                | 业务上是 upload 调用参数，不是文件属性（migration-plan §2.2）                                                     |
| `tokens` 字段     | **纯删**                                | 0 producer + 0 consumer 的死字段（migration-plan §2.4）                                                           |

---

## 十一、风险项

| 风险                                                                           | 影响                                    | 缓解                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FileMetadata` 引用面广（274+ 处）                                             | Consumer Migration 工作量大             | `toFileMetadata` 适配 + 分批 Batch A-E 迁移（migration-plan §3）                                                                                                                                                                                        |
| 旧 `ext` 含点/不含点不统一                                                     | 路径解析错误                            | 迁移时 normalize 为不含点；`resolvePhysicalPath` 拼接时始终加点（migration-plan §2.7.6）                                                                                                                                                                |
| KnowledgeMigrator / ChatMigrator 的 `fileId` 可能悬挂                          | 插入 file_ref 失败                      | 先查 `fileIdMap` 验证存在性，缺失跳过 + warn                                                                                                                                                                                                            |
| Painting 的 file_ref 暂缺                                                      | 文件页无法追溯 painting 引用            | 文件条目本身已存在可访问；随 Painting 重构补建                                                                                                                                                                                                          |
| Phase 1a 的 `throw NotImplemented` 影响上游                                    | 开发期阻塞                              | Phase 1a 不切换 renderer 调用路径，Phase 1b.1/1b.2 各自补齐后 feature-flag 切换读/写路径                                                                                                                                                                |
| External entry 物理文件外部丢失                                                | entry 变 dangling                       | DanglingCache + File IPC `getDanglingState` / `batchGetDanglingStates` 给 UI 展示；不自动清理 file_ref（用户手动处理）                                                                                                                                 |
| `externalPath` 大小写不敏感 FS 导致同文件双 entry（macOS APFS / Windows NTFS） | 文件页用户看到两份同文件、file_ref 分裂 | Phase 1b.1 `canonicalizeExternalPath` 做同步廉价规范化（resolve + NFC + trailing-sep），**刻意不做** `fs.realpath` case 去重——支配性来源（dialog / drag-drop）本就给 OS-canonical 值；收到真实用户报告后再 additively 扩展 + one-off migration 合并重复行 |

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
  path: string; // 绝对路径
  name: string; // basename
  kind: "file" | "directory";
  parent: TreeNode<T> | null;
  children: TreeNode<T>[]; // file 节点为空数组
  data?: T; // 业务侧扩展
}

export interface DirectoryTreeOptions<T = unknown> {
  /** 过滤：返回 false 的路径不纳入树（同时传给 watcher 的 ignored 避免噪声） */
  shouldInclude?: (path: string, stat: { isDirectory: boolean }) => boolean;
  /** 初始化节点 payload */
  initNodeData?: (node: Omit<TreeNode<T>, "data">) => T;
  /** 透传给底层 DirectoryWatcher */
  watcherOptions?: Partial<DirectoryWatcherOptions>;
}

export type TreeMutationEvent<T> =
  | { type: "added"; node: TreeNode<T>; parent: TreeNode<T> }
  | { type: "removed"; node: TreeNode<T>; parent: TreeNode<T> }
  | {
      type: "renamed";
      node: TreeNode<T>;
      oldPath: string;
      newParent: TreeNode<T> | null;
    };

export interface DirectoryTreeBuilder<T = unknown> extends Disposable {
  readonly root: TreeNode<T>;
  getNode(path: string): TreeNode<T> | null;
  onMutation: Event<TreeMutationEvent<T>>;
}
```

### 12.4 工厂与接线

```typescript
// src/main/file/tree/factory.ts

export async function createDirectoryTree<T = unknown>(
  rootPath: string,
  options?: DirectoryTreeOptions<T>,
): Promise<DirectoryTreeBuilder<T>>;
```

工厂内部：

1. walk `rootPath` 构建初始树（受 `shouldInclude` 过滤）
2. 通过 `createDirectoryWatcher()` 订阅 FS 事件（复用现有 primitive，自动接入 DanglingCache）
3. 事件 → 树 mutation 映射：
   - `onAdd` / `onAddDir` → `added`
   - `onUnlink` / `onUnlinkDir` → `removed`
   - `onRename` → `renamed`（启用 `renameDetection` 时）

### 12.5 阶段化路线

| 阶段                    | 内容                                                                  | 触发条件                 |
| ----------------------- | --------------------------------------------------------------------- | ------------------------ |
| **A. 接口草案（本节）** | 类型 + 文档                                                           | 已完成                   |
| **B. Lean 实现**        | scan + watcher 接线 + add/remove/rename mutation；无 lazy、无高级过滤 | Notes 集成时落地         |
| **C. 能力补全**         | lazy 展开、gitignore、diff 推送                                       | 第二消费者出现且确有需求 |
| **D. 公共抽取重构**     | 若第二消费者需求与 Notes 分叉严重                                     | Phase C 后               |

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
