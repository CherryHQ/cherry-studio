# FileManager Architecture

> **本文档聚焦 FileManager 子模块**——条目模型、存储架构、版本与并发、原子写、回收站、引用清理、AI SDK 集成。
>
> 模块级架构（组件职责、IPC 设计、服务集成、生命周期）见 [architecture.md](./architecture.md)。
>
> 相关文档：
>
> - `v2-refactor-temp/docs/file-manager/rfc-file-manager.md` — 实现设计文档（Schema、API 细节、迁移策略）

---

## 1. 核心概念

### 1.0 管辖原则

FileManager 提供两种 origin 的文件管理能力，调用方根据自身需求选择：

- **`internal`**：Cherry 拥有文件内容，存储在 `{userData}/files/{id}.{ext}`。调用方把源内容交给 FileManager，FileManager 复制并接管生命周期
- **`external`**：Cherry 仅记录一个用户侧的绝对路径引用，不复制内容。文件的可用性、内容变化由用户侧决定

**调用方决定 origin**，FileManager 不对业务层做假设。具体调用方的迁移/现状见 RFC。

**External 的 best-effort 语义**：external entry 是"调用方在某时刻表达过要引用此路径"的持久化记录，不保证文件稳定存在，不保证内容和引用时一致。Cherry 不做 DB-FS 双向同步，不追踪外部 rename/move；外部变化自然反映为"下次读到新内容"或"dangling"。

不进入 FileManager 的数据类别（自动派生数据、日志、Agent 工作区、OCR 中间件、MCP 配置、FS-first 模块自管文件等）详见 [architecture.md §1.3](./architecture.md#13-不在范围内)。

### 1.1 FileEntry

每一条 FileEntry 对应一个用户上传/保存的文件。FileEntry 是**扁平的个体记录**——没有目录树、没有父子关系、没有 mount 概念。

```
FileEntry
├── id: UUID v7
├── origin: 'internal' | 'external'
├── name: 文件名（不含扩展名）
├── ext: 扩展名（不含前导点），可为 null
├── size: 字节数
├── externalPath: 绝对路径，仅 origin='external' 非空
├── trashedAt: ms epoch | null
├── createdAt / updatedAt
```

### 1.2 Origin：internal vs external

每个 FileEntry 的 `origin` 字段定义**内容所有权**：

| origin | 物理位置 | 所有权 | 可变性 |
|---|---|---|---|
| `internal` | `{userData}/files/{id}.{ext}` | Cherry 完全拥有 | 读写皆可 |
| `external` | `externalPath` 指向的绝对路径 | 用户拥有，Cherry 引用 | **用户显式操作可改**（write / rename / permanentDelete 生效，委派到 ops）；Cherry 不做自动/watcher 驱动修改；**不追踪外部 rename/move**，外部变化让 entry 自然 dangling |

**Path 唯一性**：同一 `externalPath` 在 **非 trashed 状态下最多只能存在一条 entry**。通过 SQLite partial unique index 实现：`UNIQUE(externalPath) WHERE origin='external' AND trashedAt IS NULL`。

**`externalPath` 的 canonical 不变量**：SQLite 对 `externalPath` 字段做**字节级**比较，无法感知 `FILE.pdf` ≡ `file.pdf`（case-insensitive FS）或 NFC ≡ NFD（Unicode）。因此 `externalPath` 持久化前**必须**经 `canonicalizeExternalPath(raw)` 规范化——这是应用层不变量，`ensureExternalEntry` 与 `fileEntryService.findByExternalPath` 都是强制调用点。

| 来源 | 是否原生 canonical | 依赖规范化消除 |
|---|---|---|
| Electron `showOpenDialog` | ✅（OS 返回磁盘真 case） | 无 |
| Drag-drop from Finder/Explorer | ✅（OS drag source） | 无 |
| 用户手敲 `@/path/...` / 剪贴板粘贴 | ❌ | case / NFD/NFC 都有风险 |
| 外部 URL scheme / shell 集成 | ❌ | 同上 |
| v1 migration（继承 Dexie 存值） | ❌（继承旧值质量） | 迁移时 canonicalize 一次 |

**Phase 1b 规范化范围**（同步、无 FS IO）：
- `path.resolve(raw)` → 绝对化 + 消除 `./` `../`
- `.normalize('NFC')` → Unicode 规范化（关 macOS 中日韩 NFD/NFC 窗口）
- 尾部分隔符裁剪

**Phase 1b 刻意不做**（留给 Phase 2 按用户反馈补）：
- `fs.realpath` 做 case-insensitive FS 去重（需异步 FS IO + 文件存在前置条件）
- Symlink target 合并
- Windows 8.3 短名解析

详细契约见 `src/main/data/utils/pathResolver.ts:canonicalizeExternalPath` 的 JSDoc。

不变量（Invariants）：

| 字段 | origin='internal' | origin='external' |
|---|---|---|
| `name` | SoT（用户可主动改名） | 上次 observe 的 basename 派生值（快照） |
| `ext` | SoT | 上次 observe 的扩展名 |
| `size` | SoT | 上次 observe 的字节数 |
| `externalPath` | NULL | 绝对路径（external 的权威身份） |

`external` 的 `name/ext/size` 本质是**外部文件的派生快照**，由 file_module 在触发刷新时更新。

### 1.3 FileRef（业务引用）

业务对象通过 FileRef 多态关联 FileEntry：

```
FileRef
├── fileEntryId → FileEntry（FK, CASCADE delete）
├── sourceType: 由各业务模块登记（polymorphic, no FK on sourceId）
├── sourceId: 业务对象 ID
├── role: 业务语义的引用角色（由业务模块定义）
└── UNIQUE(fileEntryId, sourceType, sourceId, role)
```

`sourceType` / `role` 的枚举值由各业务模块在 `SourceTypeChecker` 注册时声明，编译期强制闭合（Layer 3 孤儿扫描依赖此闭合性，见 §7）。

业务对象被删除时，业务 Service 负责清理对应的 FileRef（第 7 节）。

### 1.4 FileHandle（统一的文件引用）

消费者经常需要在"managed FileEntry"和"unmanaged 任意路径"之间共用一套操作逻辑（显示预览、读内容、定位资源管理器等）。`FileHandle` 是这两种情况的统一引用类型：

```typescript
type FileHandle =
  | { kind: 'managed'; entryId: FileEntryId }
  | { kind: 'unmanaged'; path: FilePath }

// 构造（FileHandle 是 brand 类型，只能通过工厂函数创建）
createManagedHandle(entry.id)           // 指向 FileEntry
createUnmanagedHandle('/Users/me/doc')  // 指向任意路径
```

**定位**：
- 与 `FileRef`（file_ref 表，业务对象对 FileEntry 的引用）是**不同概念**
- `FileHandle` 是"文件操作的统一 locator"，服务于 IPC 和业务代码
- Handler 按 `handle.kind` 分派：managed → FileManager，unmanaged → `ops/*`

**接受 FileHandle 的操作**：`read` / `getMetadata` / `getVersion` / `getContentHash` / `write` / `writeIfUnchanged` / `rename` / `permanentDelete` / `copy` / `open` / `showInFolder`

**仅对 FileEntryId 生效的操作**（即只针对 managed entry，unmanaged 不适用）：`trash` / `restore` / `createInternalEntry` / `ensureExternalEntry` / `refreshMetadata` / `withTempCopy`

### 1.5 FileUpload（AI provider 上传缓存）

为对接 AI SDK 的 `SharedV4ProviderReference`（Record<provider, fileId>），追踪每个 FileEntry 在各 provider 上的上传记录：

```
FileUpload
├── fileEntryId → FileEntry（FK, CASCADE delete）
├── provider: 'openai' | 'anthropic' | 'google' | ...
├── remoteId: provider 返回的 file ID
├── contentVersion: xxhash-128，上传时的内容 hash
├── uploadedAt / expiresAt
├── status: 'active' | 'expired' | 'failed'
└── UNIQUE(fileEntryId, provider)
```

### 1.6 FileManager 实现布局（Facade + Private Internals）

FileManager 是 file module 的**唯一公开入口**，但并非一个 30 方法的 God class。实现上采用 **facade + 私有纯函数模块**模式。

#### 1.6.1 为什么可以拆

对 FileManager public API 逐方法盘点"是否依赖 class instance 状态"后，结论：**绝大多数方法不依赖实例状态**。

| 状态 | 使用者 | 归属 |
|---|---|---|
| `versionCache` (LRU) | `write` / `writeIfUnchanged` / `getVersion` | **class private field**（FileManager 实例持有） |
| `fileEntryService` / `fileRefService` | 所有 DB 操作 | container singleton（`application.get(...)`） |
| `danglingCache` | external 相关方法 | file-module singleton（模块 import） |
| `ops/*` | 所有 FS 操作 | 纯函数，无状态 |
| IPC handler 注册句柄、orphan sweep handle | lifecycle | `onInit` / `onStop` 管理 |

真正绑定在 FileManager 实例上的只有 **versionCache** 与 **lifecycle 工件**；业务方法自身是无状态的。

#### 1.6.2 模块布局

```
src/main/file/
├── index.ts              ← barrel: 仅导出 FileManager + 公共类型
├── FileManager.ts        ← facade class; lifecycle + IPC + versionCache
├── internal/             ← 私有实现 (不经 index.ts 导出, 外部不得 import)
│     ├── deps.ts              — FileManagerDeps 类型
│     ├── entry/
│     │    ├── create.ts       — createInternal / ensureExternal
│     │    ├── lifecycle.ts    — trash / restore / permanentDelete + batches
│     │    ├── rename.ts
│     │    ├── copy.ts
│     │    └── refresh.ts      — refreshMetadata / getMetadata
│     ├── content/
│     │    ├── read.ts         — read / createReadStream (含 unmanaged 变体)
│     │    ├── write.ts        — write / writeIfUnchanged / createWriteStream
│     │    └── hash.ts         — getContentHash / getVersion
│     ├── system/
│     │    ├── shell.ts        — open / showInFolder
│     │    └── tempCopy.ts     — withTempCopy
│     └── orphanSweep.ts       — 启动期孤儿扫描任务
└── versionCache.ts       ← LRU 类型定义
```

#### 1.6.3 依赖传递约定

每个 `internal/*` 纯函数显式接收 `FileManagerDeps`：

```typescript
// internal/deps.ts
export interface FileManagerDeps {
  readonly repo: FileEntryService
  readonly versionCache: VersionCache
  readonly danglingCache: DanglingCache
}

// internal/entry/create.ts — 两个 API，对应 FileManager facade 的两个 public method
// 注：CreateInternalEntryParams 是 source-discriminated union
//   （source: 'path' | 'url' | 'base64' | 'bytes'），每个分支只暴露 content
//   无法派生的 name/ext 字段。完整矩阵见 `packages/shared/file/types/ipc.ts`
//   及 `v2-refactor-temp/docs/file-manager/file-arch-problems-response.md`（A-7 延伸）。
export async function createInternalEntry(
  deps: FileManagerDeps,
  params: CreateInternalEntryParams
): Promise<FileEntry> {
  // 按 source 分支解出 { name, ext, bytes } → 写物理文件 → DB insert；永远产生新 entry
}

export async function ensureExternalEntry(
  deps: FileManagerDeps,
  params: EnsureExternalEntryParams
): Promise<FileEntry> {
  // 按 externalPath upsert：reuse / restore / insert 三路之一
}
```

#### 1.6.4 Facade 薄委托

```typescript
// FileManager.ts
export class FileManager extends BaseService implements IFileManager {
  private readonly versionCache = new VersionCache(1000)
  private readonly repo = application.get('FileEntryService')

  private get deps(): FileManagerDeps {
    return { repo: this.repo, versionCache: this.versionCache, danglingCache }
  }

  // public API: 薄委托；命名严格对齐语义（create = 新增、ensure = upsert）
  createInternalEntry(params) { return entryCreate.createInternalEntry(this.deps, params) }
  ensureExternalEntry(params) { return entryCreate.ensureExternalEntry(this.deps, params) }
  read(id, opts?) { return contentRead.readManaged(this.deps, id, opts) }
  trash(id) { return entryLifecycle.trash(this.deps, id) }
  // ... 每个方法一行

  protected async onInit() {
    this.registerIpcHandlers()
    void orphanSweep.run(this.deps) // fire-and-forget
  }
}
```

#### 1.6.5 FileHandle 分派约定（IPC 边界的适配职责）

**分派位置**：`FileHandle.kind` 的分派**留在 IPC handler 注册处**。理由：

- `FileHandle` 是 IPC 序列化层的输入形态——renderer 送来的是 `{ kind, ... }` tagged union，反序列化后做 kind 分派属于"解读请求"范畴，是 IPC 适配层的**正当职责**
- FileManager public API 保持 entry-native（只收 `FileEntryId`），Main 侧业务 service 调用直观，不需要 `createManagedHandle(id)` 包装
- 对 unmanaged 的操作**仅 IPC handler 需要**，Main 侧业务 service 持有的就是 FileEntry，没有 unmanaged path 场景

**Internal 模块约定**：每个 action 文件按 kind 暴露命名一致的变体：

```typescript
// internal/content/read.ts
export async function readManaged(deps, entryId, opts): Promise<ReadResult<T>>    // 服务 FileManager public API
export async function readUnmanaged(deps, path, opts): Promise<ReadResult<T>>      // 服务 IPC handler 的 unmanaged 分支
// future: export async function readVirtual(deps, handle, opts)
```

`*Managed` 走 FileManager 公开方法；`*Unmanaged`（及未来的 `*Virtual`）**不走** FileManager 公开方法——它们只服务 IPC handler 的 unmanaged 分支。

**分派 helper 统一风格**：防止"每个 IPC 方法各写 if-else"脏化，FileManager 内部提供小辅助：

```typescript
// FileManager.ts (私有)
private dispatchHandle<T>(
  handle: FileHandle,
  managed: (entryId: FileEntryId) => Promise<T>,
  unmanaged: (path: FilePath) => Promise<T>
): Promise<T> {
  switch (handle.kind) {
    case 'managed':   return managed(handle.entryId)
    case 'unmanaged': return unmanaged(handle.path)
  }
}

private registerIpcHandlers() {
  this.ipcHandle('file.read', (handle, opts) =>
    this.dispatchHandle(handle,
      id   => this.read(id, opts),
      path => contentRead.readUnmanaged(this.deps, path, opts)
    )
  )
  this.ipcHandle('file.write', (handle, data) =>
    this.dispatchHandle(handle,
      id   => this.write(id, data),
      path => contentWrite.writeUnmanaged(this.deps, path, data)
    )
  )
  // ... 其他接受 FileHandle 的 IPC 方法

  // 仅 FileEntryId 的 IPC 方法直接透传
  this.ipcHandle('file.trash', ({ id }) => this.trash(id))
  this.ipcHandle('file.createInternalEntry', params => this.createInternalEntry(params))
  this.ipcHandle('file.ensureExternalEntry', params => this.ensureExternalEntry(params))
}
```

**新增 handle kind**（例如 `virtual` 指向压缩包成员、`remote` 指向 S3 URI）的改动面：

1. `packages/shared/file/types/handle.ts` — handle union 加变体
2. 相关 `internal/*/*.ts` — 加对应 `*Virtual` / `*Remote` 纯函数
3. `FileManager.ts` — `dispatchHandle` 签名增加回调参数；每个 IPC handler 显式处理该 kind（或抛"不支持"）

**扩展面集中在 FileManager.ts 一个文件内**——每个 IPC 方法对哪些 kind 有意义一目了然，有利审计。这比引入独立 `FileAccessor` 类更轻，但获得同样的"扩展收敛"效果。

#### 1.6.6 外部访问约束

| 位置 | 可 import | 禁止 import |
|---|---|---|
| Main 业务 service（KnowledgeService、MessageService 等） | `@main/file`（拿 FileManager） / `@main/file/ops` / `@main/file/watcher` | `@main/file/internal/**` |
| file-module 自身内部（`internal/*`、`ops/*`、`watcher/*`） | 按需互相引用 | 除 FileManager 外不得 import `internal/*` |
| 外部 Node/renderer | 不适用（file-module 是 main 侧） | — |

**边界强化**：通过 `src/main/file/index.ts` barrel 只 re-export 公共类型 + `FileManager` class；`internal/` 的 symbol 无法通过 `@main/file` 取到。Phase 1b 实现时如发现越界 import，追加 ESLint `no-restricted-imports` 规则。

#### 1.6.7 设计权衡

| 选项 | 采纳？ | 理由 |
|---|---|---|
| 把业务方法拆成 5 个 lifecycle service | ❌ | 过度——lifecycle 注册、依赖排序、测试 mock 成本都要 5 倍，换来的只是"方法分文件" |
| FileManager 作为 facade + `internal/*` 纯函数 | ✅ | 只有 1 个 lifecycle node，纯函数可直接用 stub deps 单测，外部 API 面保持稳定 |
| FileAccessor 独立 class 负责 `FileHandle` 分派 | ❌ | 分派本身是 IPC 适配层的正当职责，收敛到 FileManager 内部的 `dispatchHandle` helper 即可；再分一层纯增复杂度 |
| FileManager public API 改 handle-native | ❌ | IPC 与 Main-side 调用契约不必同 shape；Main 侧业务 service 直接用 entry-native 更直观，不需要 `createManagedHandle` 包装 |
| versionCache 抽为模块 singleton | ❌ | 作为 FileManager private field 天然支持 test 隔离（new instance = fresh cache）|

---

## 2. 存储架构

### 2.1 物理路径规则

物理路径不持久化，运行时根据 `origin` 解析：

```typescript
function resolvePhysicalPath(entry: FileEntry): string {
  if (entry.origin === 'internal') {
    return application.getPath('files', `${entry.id}${entry.ext ? '.' + entry.ext : ''}`)
  }
  return entry.externalPath!
}
```

**internal** 的物理路径永远扁平：`{userData}/files/{uuid}.{ext}`，不随 FileEntry 的 `name` 变化而改变。UUID 命名使 internal 文件**对用户不可见、不可手动整理**——这是设计有意为之。

**external** 的物理路径完全由用户决定，Cherry 不动它。

### 2.2 物理目录结构

```
{userData}/files/
├── {uuid-1}.pdf
├── {uuid-2}.png
├── ...
└── {uuid-n}.tmp-{uuid}      ← 原子写的临时文件（异常残留由启动 sweep 清理）
```

Cherry 不创建任何子目录于 `{userData}/files/` 下。所有 internal 文件全部扁平存放。

### 2.3 临时文件处理

临时性处理文件（OCR 中间产物、PDF 切页、压缩包解压等）**不创建 FileEntry**，直接用 `ops/fs.ts` 的 primitive 操作于 `{userData}/temp/`（或进程级 `os.tmpdir()`）下。处理完成后由业务方清理或依赖 OS 机制。

---

## 3. External Entry 的快照与 Dangling 模型

### 3.1 问题

`external` 的 `name/ext/size` 是派生字段。外部文件随时可能被用户重命名、修改、移动，DB 快照会陈旧。

file_module 接受这个陈旧，不做 DB-FS 双向同步，走 best-effort 语义：外部变化自然反映为"下次读到新内容"或"dangling"。

### 3.2 刷新触发点

file_module 在以下场景刷新 external entry 的 DB 快照（stat + 对比 + UPDATE）：

| # | 触发 | 刷新内容 |
|---|---|---|
| 1 | `ensureExternalEntry({ externalPath })`（upsert 路径） | 新建时初次 stat；复用现有 entry 时 stat 刷新 snapshot |
| 2 | `read(id)` 对 external | stat-verify；size 变则 UPDATE |
| 3 | `getVersion(id)` 对 external | stat，更新 size |
| 4 | `getContentHash(id)` 对 external | 读文件 + hash（stat 顺带） |
| 5 | `FileUploadService.ensureUploaded(id, provider)` | 上传前必须重算 hash |
| 6 | `refreshMetadata(id)` 显式调用 | stat + UPDATE 全部派生字段 |

**刷新的副产物**：每次 stat 同步更新 DanglingCache 的状态（stat 成功 → `present`；stat 失败 → `missing`）。

**不刷新的路径**：纯 SQL 查询（list / getById / file_ref join）直接返回 DB 值，可能陈旧。

**Cherry 不追踪 external rename**：用户在 Cherry 外部 mv/rename 文件后，对应 entry 变 dangling。用户需要在 Cherry 内重新 @ 建立新引用（由于 path unique 约束，若同路径 trashed entry 存在会被 restore；否则新建）。

### 3.3 陈旧容忍

file_module 设计接受"list 查询返回陈旧快照"这个代价，换取：
- List 查询无需 N 次 fs.stat
- SQL 可按 name/size/mtime 跨 origin 过滤
- 读路径保持纯度（无副作用，除了 critical path 的 stat-verify）

用户需要强制刷新时：
- **隐式**：打开/读取/上传文件时自动走 critical path 刷新
- **显式**：UI 提供刷新按钮，触发业务层循环调 `refreshMetadata`

### 3.4 Dangling 模型

当 external 文件在磁盘上不存在（或不可访问），对应 entry 称为 **dangling**。Dangling 状态由 **DanglingCache**（file_module singleton）维护，详见 §11。

**状态三态**：

| 状态 | 含义 |
|---|---|
| `'present'` | 最近观察到文件存在（watcher 事件 / stat 成功 / ops 操作观测）|
| `'missing'` | 最近观察到文件缺失（watcher unlink / stat ENOENT）|
| `'unknown'` | 无 watcher 覆盖、尚未做过 stat（或 cache 被主动清空）|

**检测时机**：
- **被动**：DataApi handler 查询时 opt-in `includeDangling: true` → `danglingCache.check(entry)`
- **主动推送**：业务模块通过 `createDirectoryWatcher()` 创建 watcher 时，工厂自动把 add/unlink 事件接入 DanglingCache
- **副产物**：FileManager 的 read/stat/write 等操作成功/失败时也更新 cache

**UI 语义**：dangling 的 entry 在 UI 上显示失效样式（灰色、图标标记），但**不自动清理**——保留 file_ref 链，用户可手动 permanentDelete 或尝试重新指向。

---

## 4. 版本检测与并发控制

### 4.1 FileVersion

```typescript
interface FileVersion {
  mtime: number   // ms epoch
  size: number
}
```

作为快速检测外部变更的信号。两级用法：
- 快路径：`statVersion(path)`（微秒级，覆盖 99% 场景）
- 深路径：`contentHash(path)` → xxhash-128（毫秒-秒级，mtime/size 匹配仍需确认时使用）

mtime + size 作为签名的合理性：
- ms 同刻多写、时钟回拨、备份保留 mtime、用户 touch、低精度 FS（FAT32）、就地 1 字节编辑——六种 mtime 单独失效场景由 size 或 hash 兜底

### 4.2 Read API

```typescript
interface ReadResult<T> {
  content: T
  mime: string
  version: FileVersion
}

read(id, opts?: { encoding?: 'text' }): Promise<ReadResult<string>>
read(id, opts: { encoding: 'base64' }): Promise<ReadResult<string>>
read(id, opts: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>
```

read 统一返回 `{ content, mime, version }`。附带 version 几乎零成本——stat 本来就是 read 路径必做的一步。

### 4.3 Write vs WriteIfUnchanged

```typescript
write(id, data): Promise<FileVersion>
writeIfUnchanged(id, data, expectedVersion: FileVersion): Promise<FileVersion>
```

**两个独立方法**，强制调用方显式选择是否需要冲突检测：

| 调用方 | 用哪个 | 理由 |
|---|---|---|
| 首次写入、覆盖、迁移、预处理 | `write` | 无并发语义 |
| 编辑器保存（Notes、Markdown 等未来可能的消费者） | `writeIfUnchanged` | 必须检测外部变更 |

`writeIfUnchanged` 在冲突时抛 `StaleVersionError`，调用方捕获后决定 UX（弹框、三方合并、保留双版本等）。

**对 external 的行为**：write / writeIfUnchanged / createWriteStream / rename / permanentDelete **都生效**——Cherry 支持用户显式触发的 external 文件修改（编辑器保存、UI rename、用户确认删除），委派到 ops 的 atomic write / fs.rename / ops.remove 等 primitive。Cherry **不做**自动 / watcher 驱动的外部文件修改。

### 4.4 LRU Version Cache

FileManager 内部维护 `Map<FileEntryId, CachedVersion>`（LRU, ~2000 条目）：

| 触发 | 动作 |
|---|---|
| `write` / `writeIfUnchanged` 完成 | `set(id, new version)` |
| Critical path 检测到外部变更 | `set(id, new version)` |
| 启动 reconcile 完成 | `clear()` |

**信任边界**：缓存仅加速 `getVersion` 查询，不用于关键决策。`writeIfUnchanged` 的并发比对**必须重新 stat**，不信任缓存。

---

## 5. 原子写

### 5.1 tmp + fsync + rename 流程

所有写入（internal 写到 userData、external 写到 externalPath、unmanaged 写到任意 path）都遵循 POSIX 原子流程：

```
1. 同目录创建 {target}.tmp-{uuid}
2. 写入数据到 tmp fd
3. fsync(tmp fd)                  ← 数据落盘
4. rename(tmp, target)             ← 原子替换（POSIX 保证）
5. fsync(dir fd)                   ← rename 元数据落盘
```

关键规则：
- **fsync 默认开启**。Cherry 写入频率为用户操作级，SSD 上 fsync 成本 < 10ms
- **tmp 必须与 target 同目录**。跨文件系统 rename 非原子
- **tmp 命名**：`{target}.tmp-{uuidv7}`——UUID 避免并发写冲突
- **崩溃残留**：FileManager 的后台 orphan sweep 按 `^.+\.tmp-<uuidv7>$` 清理
- **2× 磁盘占用**是 POSIX rename 语义的固有代价，不可规避

### 5.2 Stream 变体

```typescript
createWriteStream(id): Promise<AtomicWriteStream>
```

Stream 写入同样走 tmp + rename。返回的 `AtomicWriteStream` 继承 `Writable`，`.close()` 触发 fsync + rename + fsync(dir)，`.abort()` 取消并 unlink tmp。

### 5.3 ops.ts 的对外开放

`ops/fs.ts` 导出的 `atomicWriteFile` / `atomicWriteIfUnchanged` / `createAtomicWriteStream` 等 primitive **对非 file_module 模块开放**。BootConfig / MCP oauth storage / utils/file 等模块统一迁移到此，消除散落的 tmp+rename 各自实现。

---

## 6. 删除与回收站

### 6.1 trashedAt 模型

所有软删除通过 `trashedAt` 时间戳实现，无需物理移动文件：

| 操作 | 物理影响（internal） | 物理影响（external） |
|---|---|---|
| `trash(id)` | 无 | **无**（仅 DB 标记，用户文件原封不动） |
| `restore(id)` | 无 | **无**（仅 DB 清 trashedAt） |
| `permanentDelete(id)` | unlink FS + 删 DB | **ops.remove(externalPath) + 删 DB** |

**trash / restore 对两种 origin 都只动 DB**——软删除是"可逆的临时隐藏"，此时不改 FS 保持可逆性。

**permanentDelete 对两种 origin 都删 FS**——这是用户明确表达"彻底清理"的动作。external 的 permanentDelete 委派到 `ops.remove(externalPath)`，真删用户文件。unlink 失败（ENOENT、权限不足等）log 记录但不阻塞 DB 删除，保持 DB-FS 终态一致（两边都没有）。

### 6.2 自动过期

默认 30 天自动清理 trashed entry（lifecycle service 定时器），用户可在 Preference 配置天数或关闭。

查询：`WHERE trashedAt < now() - retentionMs` → 批量 permanentDelete。

### 6.3 Edge Cases

| 场景 | 处理 |
|---|---|
| permanentDelete 时 unlink 失败（文件已缺失、权限问题） | 幂等忽略 ENOENT，其他错误 log warn，继续删 DB |
| permanentDelete external 时 externalPath 不可写（只读挂载盘、权限不足） | log error，仍删 DB 记录；用户可见 Cherry 里消失，但文件留在磁盘 |
| `ensureExternalEntry(path)` 时同路径 non-trashed entry 已存在 | 入口先 `canonicalizeExternalPath(raw)`；Upsert：返回现有 entry，顺带刷新 snapshot；同时可能 restore 已 trashed 的同路径 entry |
| **case / NFC 差异导致同文件出现两条 entry**（macOS APFS、Windows NTFS、或 NFD ↔ NFC 输入） | Phase 1b 的 canonicalize 关 NFC 窗口；case-insensitive FS dedup 暂不实现（见 §1.2 "Phase 1b 规范化范围"）——有真实用户报告后补 `fs.realpath` + one-off migration |
| restore external entry 时原路径文件已被外部替换为另一个文件 | Cherry 不检测内容一致性（best-effort），`refreshMetadata` 会刷新 size/name；UI 可由 dangling/snapshot 变化提示用户 |
| trash 中的 entry 被外部永久删除后再 restore | 表现为 dangling（DanglingCache 下次 check 返回 missing），UI 显示失效样式 |
| external write 时目标路径权限错误 / 磁盘满 | 抛错不污染 DB，调用方决定重试或告知用户 |

---

## 7. 引用清理机制

三层防护，逐层兜底：

```
+-------------------------------------------------------+
| Layer 1: fileEntryId CASCADE                          |
| FileEntry deleted -> file_ref auto-cascaded           |
| file_upload auto-cascaded                             |
| (DB FK constraint, zero app code)                     |
+-------------------------------------------------------+
| Layer 2: business delete hooks                        |
| business entity deleted -> cleanup file_ref           |
| (called in each Service's delete method)              |
+-------------------------------------------------------+
| Layer 3: registered orphan scanner                    |
| background scan for file_ref with missing sourceId    |
| compile-time enforced: Record<FileRefSourceType, ...> |
+-------------------------------------------------------+
```

Layer 3 通过 `Record<FileRefSourceType, OrphanChecker>` 类型约束强制"每个 sourceType 必有 checker"。新增 sourceType 未注册 → 编译报错。

**无引用文件策略**：FileEntry 保留，不自动删除。UI 可显示"未引用"标记，由用户手动清理。

---

## 8. DirectoryWatcher

### 8.1 定位

`DirectoryWatcher` 是**非 lifecycle 的通用 FS primitive**（不是 service），供业务模块自行 new 使用。它只做 chokidar 封装，不绑定任何业务语义。

放置在 `src/main/file/watcher/`，**与 `ops/` 平级但独立成子模块**。分层依据：

| 对比 | `ops/` | `watcher/` |
|---|---|---|
| 范式 | 纯函数（stateless） | 有状态 class |
| 生命周期 | 无（调用即完成） | 有（start → running → dispose） |
| 资源持有 | 无 | FSWatcher 实例 + pending queues + timers |
| 消费契约 | `const x = await ops.read(path)` | `const w = new DirectoryWatcher(...); ... w.dispose()` |

把有状态的 class 放到名为 "ops"（operations）的 barrel 里会破坏其纯函数契约。这是 Node.js 官方 `fs.readFile`（function）与 `fs.watch` 返回 `FSWatcher` 实例（class）在同个模块里因命名合并的分层，我们显式把它们拆开。

### 8.2 API

```typescript
export type IgnoreRule =
  | { basename: string }    // 按文件名完整匹配
  | { glob: string }         // micromatch 匹配绝对路径
  | { regex: RegExp }        // 正则匹配绝对路径

export type AwaitWriteFinishOption =
  | { enabled: true; stabilityThreshold?: number; pollInterval?: number }
  | { enabled: false }

export type RenameDetectionOption =
  | { enabled: true; windowMs?: number }
  | { enabled: false }

export interface DirectoryWatcherOptions {
  path: string
  ignored?: IgnoreRule[]
  depth?: number
  emitInitial?: boolean
  awaitWriteFinish?: AwaitWriteFinishOption   // 默认 enabled, stability=200, poll=100
  renameDetection?: RenameDetectionOption      // 默认 disabled
}

export class DirectoryWatcher implements Disposable {
  readonly onAdd: Event<{ path: string; stat: Stats }>
  readonly onChange: Event<{ path: string; stat: Stats }>
  readonly onUnlink: Event<{ path: string }>
  readonly onAddDir: Event<{ path: string; stat: Stats }>
  readonly onUnlinkDir: Event<{ path: string }>
  readonly onRename: Event<{ oldPath: string; newPath: string; stat: Stats }>
  readonly onReady: Event<void>
  readonly onError: Event<Error>

  constructor(opts: DirectoryWatcherOptions)
  start(): Promise<void>
  stop(): Promise<void>
  dispose(): void
}
```

### 8.3 Rename Detection 语义

启用时，unlink/add 事件延迟 `windowMs` 处理以尝试配对为 rename：

- 匹配成功 → 仅触发 `onRename`（被匹配的 unlink/add 被抑制）
- 未匹配 → 超时后正常触发 unlink/add

**关键保证**：启用时 `onUnlink`/`onAdd` 与 `onRename` **不同时触发**，消费者语义清晰。

**平台精度**：
- Unix（macOS/Linux）：优先 inode 匹配，次用 size
- Windows：仅 size（NTFS ino 不稳定），精度降级，文档化接受

**仅处理 file rename**。目录 rename 不做特殊识别，由消费者自行组合子文件事件处理。

### 8.4 内建 Ignore 规则

默认忽略 OS 垃圾文件（不可关闭）：
- `{ basename: '.DS_Store' }`
- `{ basename: '.localized' }`
- `{ basename: 'Thumbs.db' }`
- `{ basename: 'desktop.ini' }`

消费者可追加 `ignored`，合并到默认规则之后。

### 8.5 使用模式

业务模块根据需要自行 new + dispose：

```typescript
// 示意（非 file_module 实现）
const watcher = new DirectoryWatcher({
  path: source.basePath,
  renameDetection: { enabled: true }
})
watcher.onAdd(...)
watcher.onRename(...)
await watcher.start()
// ...
watcher.dispose()
```

file_module **不启动任何 watcher 实例**。是否需要监控外部目录是业务模块的决策。

---

## 9. AI SDK 集成（FileUploadService）—— **延后实现**

> ⚠️ **本节为设计记录，不在 Phase 1a 实现范围内**。Vercel AI SDK 的 Files Upload API（`FilesV4`、`SharedV4ProviderReference`）当前仍为 pre-release 状态，对应依赖未稳定。FileUploadService、`file_upload` 表、相关 IPC 方法均延后到 SDK 进入稳定版后在独立 PR 中引入。本节保留设计意图，便于将来直接落地。

### 9.1 动机

Cherry 需要对接 Vercel AI SDK 的文件上传 API。SDK 的 `SharedV4ProviderReference` 建模"同一逻辑文件可上传到 N 个 provider，每个有独立 fileId"。

届时独立一张 `file_upload` 表追踪这些上传，与 `fileEntry` 解耦。

### 9.2 Schema

```sql
CREATE TABLE file_upload (
  id              TEXT PRIMARY KEY,
  file_entry_id   TEXT NOT NULL REFERENCES file_entry(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  remote_id       TEXT NOT NULL,
  content_version TEXT NOT NULL,   -- 上传时的 xxhash-128
  uploaded_at     INTEGER NOT NULL,
  expires_at      INTEGER,
  status          TEXT NOT NULL,   -- 'active' | 'expired' | 'failed'
  metadata        TEXT,             -- JSON, provider-specific
  UNIQUE(file_entry_id, provider)
);
```

### 9.3 Service API

```typescript
interface IFileUploadService {
  ensureUploaded(fileEntryId: FileEntryId, provider: string): Promise<FileUpload>
  buildProviderReference(fileEntryId: FileEntryId): Promise<SharedV4ProviderReference>
  invalidate(fileEntryId: FileEntryId): Promise<void>
}
```

**ensureUploaded** 逻辑：
1. 查 `file_upload` 中 (entryId, provider)
2. 计算当前 contentHash（internal 可信 versionCache，external 必须重算）
3. 若 contentVersion 匹配 + 未过期 → 复用
4. 否则：读内容 → 调 `provider.files().uploadFile()` → upsert `file_upload`

**buildProviderReference** 把所有活跃 upload 组装成 `Record<provider, remoteId>`。

### 9.4 失效与重新上传

- 内容改变（FileEntry 写入触发）→ 所有 file_upload 标记为 stale（或直接删）
- Provider 过期（expires_at < now）→ 下次使用视为不存在，重新上传
- Provider 侧被手动删除 → 发送时上游报错，catch 后 `invalidate` + 重新上传

---

## 10. 启动 Orphan Sweep（FileManager 后台任务）

### 10.1 定位

启动 orphan sweep 由 FileManager 在 `onInit()` 中以 **fire-and-forget** 方式触发：

```typescript
protected override onInit(): void {
  this.registerIpcHandlers()
  this.initVersionCache()

  // DanglingCache 反向索引从 DB 同步建立
  danglingCache.initFromDb()

  // 🔑 不 await → ready 信号不被阻塞
  void this.runOrphanSweep().catch((err) => {
    logger.error('Orphan sweep failed', err)
  })
}

private async runOrphanSweep(): Promise<void> {
  // 扫 {userData}/files/*：
  //   UUID v7 文件 AND 不在 fileEntryTable AND mtime > 5min → unlink
  //   *.tmp-<uuidv7> 文件 AND mtime > 5min → unlink（原子写崩溃残留）
}
```

**理由**：
- Orphan sweep 典型 <500ms，fire-and-forget 不占启动时间
- 与其他 service 的 `onInit()` 并行，业务 service 可以立即依赖 FileManager
- 失败不影响服务可用（仅残留 orphan，下次启动再扫）

### 10.2 DanglingCache 初始化

DanglingCache 的反向索引（`Map<path, Set<entryId>>`）通过一次同步 DB 查询建立：

```sql
SELECT id, externalPath FROM file_entry
WHERE origin = 'external' AND trashedAt IS NULL
```

**不做 stat**——状态字段（`Map<entryId, DanglingState>`）初始为空，查询时 lazy stat（详见 §11）。

### 10.3 没有 Dangling Probe 的原因

旧版本在启动时对所有 external entry 批量 stat，构建 dangling 集合。新版本**砍掉了这一步**：

1. **Dangling 是 opt-in 查询**（`includeDangling` 参数），大多数查询场景不需要
2. **Lazy + Promise.all 已经足够快**：首次带 dangling 查询时，N 个 stat 并行跑，通常 <100ms
3. **Watcher 覆盖的路径零 IO**：业务模块（NoteService 等）启用 watcher 后，相关目录下的 entry dangling 状态由 watcher 事件直接推送，无需 stat

### 10.4 并发安全

| 并发场景 | 结果 |
|---|---|
| sweep 期间 createInternalEntry 创建新 internal 文件 | orphan sweep 的 `mtime > 5min` 过滤，新文件不被误删 |
| sweep 期间 FileManager.read/write 已有 entry | 无互斥，读写走不同代码路径，不受影响 |
| sweep 期间 app 退出 | 无持久副作用，下次启动重跑 |

### 10.5 崩溃一致性

file_module 的崩溃窗口非常窄：

| 操作 | 顺序 | 崩溃中途 | 恢复 |
|---|---|---|---|
| createInternalEntry | FS 写 UUID 文件 → DB insert | orphan 文件 | Orphan sweep |
| write (internal) | atomic tmp+rename + DB update | 新旧文件之一保留 | 自然一致 |
| trash / restore / rename | DB only | 无 | 无 |
| permanentDelete (internal) | FS unlink → DB delete | dangling（真 dangling，表现为读失败）| DanglingCache 查询时自然发现 |
| copy (internal) | FS copy → DB insert | orphan 文件 | Orphan sweep |
| ensureExternalEntry | DB insert / reuse / restore（不动用户文件） | 无 | 无 |
| permanentDelete (external) | DB delete + ops.remove | 仅 DB 已删 FS 未删 / 反之，两边终态都是"没有"即可 | 自然一致 |

无需 WAL / pending_fs_ops 表。Orphan sweep 覆盖 internal 侧的崩溃残留；external 侧天然不需要（删除失败就留在磁盘）。

---

## 11. DanglingCache（External Presence Tracker）

### 11.1 定位

DanglingCache 是 file_module 的 **singleton**（非 lifecycle service），维护 external entry 的"最新已知在盘状态"。

```typescript
// src/main/file/danglingCache.ts
export const danglingCache = new DanglingCache()
```

**作用**：
- 给 DataApi handler 提供快速查询接口（opt-in `includeDangling: true`）
- 承接所有 watcher 的 add/unlink 事件（通过工厂自动接线）
- 承接 FileManager 自身 ops 操作的观察结果（read/stat/write 成功/失败）

### 11.2 状态模型

```typescript
type DanglingState = 'present' | 'missing' | 'unknown'

class DanglingCache {
  private byEntryId: Map<FileEntryId, DanglingState>
  private pathToEntryIds: Map<string, Set<FileEntryId>>  // reverse index
  
  // 查询（供 DataApi handler）
  async check(entry: FileEntry): Promise<DanglingState>
  
  // 事件入口（供 watcher 工厂 + FileManager ops）
  onFsEvent(path: string, state: 'present' | 'missing'): void
  
  // 索引维护（供 FileManager entry CRUD）
  addEntry(entryId: FileEntryId, externalPath: string): void
  removeEntry(entryId: FileEntryId, externalPath: string): void
  
  // 启动初始化
  initFromDb(): void
}
```

**check 的分层策略**：

```typescript
async check(entry: FileEntry): Promise<DanglingState> {
  if (entry.origin === 'internal') return 'present'
  
  // L1: cache 命中（无 TTL，事件驱动失效）
  const cached = this.byEntryId.get(entry.id)
  if (cached !== undefined) return cached
  
  // L2: 冷路径 stat 一次
  const state = await statToState(entry.externalPath!)
  this.byEntryId.set(entry.id, state)
  return state
}
```

### 11.3 Watcher 自动接线

业务模块**不需要直接感知 DanglingCache**。所有 watcher 必须通过 `createDirectoryWatcher()` 工厂创建，工厂内部自动 hook：

```typescript
// src/main/file/watcher/factory.ts
export function createDirectoryWatcher(opts: DirectoryWatcherOptions): DirectoryWatcher {
  const watcher = new DirectoryWatcher(opts)
  watcher.onAdd(({ path }) => danglingCache.onFsEvent(path, 'present'))
  watcher.onUnlink(({ path }) => danglingCache.onFsEvent(path, 'missing'))
  // 可选：rename 事件更新两侧
  watcher.onRename(({ oldPath, newPath }) => {
    danglingCache.onFsEvent(oldPath, 'missing')
    danglingCache.onFsEvent(newPath, 'present')
  })
  return watcher
}
```

**注意**：watcher 的 rename 事件**不自动更新 external entry 的 externalPath**——Cherry 不追踪外部 rename。rename 后原 entry 变 dangling，用户需重新 @ 建立新引用。

### 11.4 反向索引维护

`pathToEntryIds` 的变更时机（file_module 内部完全自治，无 DB-FS 同步）：

| 事件 | 动作 |
|---|---|
| 启动 `initFromDb()` | `SELECT id, externalPath FROM file_entry WHERE origin='external' AND trashedAt IS NULL` → 批量 add |
| `ensureExternalEntry` 新建 | addEntry(id, path) |
| `ensureExternalEntry` 复用（upsert hit） | 无变化（路径已在索引）|
| `restore(external)` | addEntry(id, path) |
| `trash(external)` | removeEntry(id, path)（trashed entry 不参与 dangling 跟踪）|
| `permanentDelete(external)` | removeEntry(id, path) |
| `rename(external)`（用户显式操作）| removeEntry(id, oldPath) + addEntry(id, newPath) |

### 11.5 Handler 侧的并行化

DataApi handler 在 `includeDangling: true` 时并行执行：

```typescript
async function attachDangling(entries: FileEntry[]): Promise<FileEntryView[]> {
  return Promise.all(
    entries.map(async (e) => ({
      ...e,
      dangling: await danglingCache.check(e)
    }))
  )
}
```

- Cache 命中的 entry 同步返回（微任务）
- 仅 cache miss 的 external entry 走 stat，全部并行
- 1000 entries 冷启动典型 <100ms（libuv threadpool 并行 stat）

### 11.6 状态失效策略

**无 TTL，事件驱动失效**。cache 状态只在以下事件变化：

- Watcher 的 add/unlink/rename 事件
- FileManager ops 的观察副产物（read 成功 → present；stat ENOENT → missing；write 成功 → present；rename 成功 → oldPath missing + newPath present）
- `refreshMetadata` 显式调用

**不主动过期**——stale 几秒不影响 best-effort 语义；没 watcher 覆盖的路径下次 query 时由 ops 观察结果自然更新。

### 11.7 反应性（暂不实现）

当前设计不主动推送 dangling 变化给 renderer：
- Renderer 的 DataApi query 按其生命周期（focus 切换、refetch interval 等）刷新
- UI 以查询时刻的 snapshot 展示

未来如需要实时 push，可在 DanglingCache 状态变化时触发对应 DataApi query 的 invalidation（Phase 1a 不做）。

---

## 12. 关键设计决策

| 决策 | 结论 | 核心理由 |
|---|---|---|
| **树 vs 扁平** | 扁平 | FileEntry 管"用户提交的独立文件"，目录组织不是 file_module 职责 |
| **Mount 抽象** | 移除 | 所有 internal 文件都在 `userData/files/` 扁平存储；external 由 `externalPath` 直达；无需 mount |
| **origin 二态** | internal/external | 分别表示"Cherry 拥有"和"用户拥有，Cherry 引用"，语义清晰 |
| **external 读写权限** | 用户显式操作可改，Cherry 不自动改 | VS Code 式行为模型——用户让改就改，不偷偷动 |
| **external 操作对称性** | write/rename/permanentDelete 都委派到 ops 生效；trash/restore 仅动 DB | 软删除保可逆（不碰 FS）；硬删是终局动作（真删 FS） |
| **external 身份** | externalPath unique(where not trashed) | 同路径同时只有一个活 entry；`ensureExternalEntry` 按 path upsert |
| **Cherry 追踪 external rename** | 不追踪 | Best-effort 语义；外部 rename → dangling → 用户重新 @ |
| **快照 vs 实时 stat** | DB 存快照，critical path 自动刷新 | List 查询零 stat 成本；接受 UI 显示可能陈旧（用户可手动刷新） |
| **Dangling 状态载体** | 内存 singleton DanglingCache | 不入 DB（避免 DB-FS 双向同步）；三态 `present/missing/unknown`；无 TTL 事件驱动失效 |
| **Dangling 暴露方式** | DataApi opt-in `includeDangling` 参数 | 统一 query 入口；默认零成本；按需并行 stat |
| **Watcher → DanglingCache 接线** | 工厂自动接线 | 业务模块不感知 DanglingCache；一个 watcher 实例同时服务业务事件 + dangling 跟踪 |
| **Content hash 算法** | xxhash-128 | 非加密场景最优性价比（~20GB/s，128 位抗碰撞足够） |
| **write 是否带 version** | 拆成 write / writeIfUnchanged | 强制调用方显式选择；避免忘传 version 沉默降级为盲写 |
| **原子写 fsync** | 默认开启 | 正确性保证优先于性能；Cherry 非高吞吐场景 |
| **Trash 模型** | trashedAt 时间戳 | parentId 不变；天然支持过期；无 system_trash 条目 |
| **pending_fs_ops** | 移除 | 极简化后 orphan sweep 足以兜底崩溃 |
| **启动 dangling probe** | 移除 | 改为 lazy + Promise.all；opt-in 查询时才 stat |
| **Watcher 是否是 lifecycle service** | 不是 | DirectoryWatcher 是 primitive，业务通过工厂 new；file_module 不主动 watch |
| **目录 import / 双向同步** | 移出 file_module | 业务模块（Knowledge 等）自行用 DirectoryWatcher + 自己的映射表实现 |
| **AI SDK 上传缓存** | 独立 file_upload 表（延后） | 与 mount / remote 解耦；天然对齐 SharedV4ProviderReference |
| **Notes** | 文件树独立 domain，不镜像到 FileEntry | 其他模块若需引用 notes 文件，按自身选择的 origin 走相应路径 |
