# 旧架构问题清单回应

> **问题来源**：`v2-refactor-temp/docs/file-manager/file-arch-problems.md`
> **回应对象**：新文件管理架构（`docs/zh/references/file/architecture.md` + `file-manager-architecture.md` + `rfc-file-manager.md`）
> **目的**：逐条回应 13 项问题在新架构下的解决状态、方案出处与设计权衡，供评审追溯。

---

## 状态图例

- ✅ **已解决**：新架构有明确机制关闭该问题
- ⚠️ **部分解决**：架构已使能，完整交付依赖业务侧 PR
- 🚫 **非目标**：经设计评估后明确不纳入本次改造（并附原因）

---

## 1. 职责边界割裂 — ✅ 已解决

**原问题**：物理文件由 main 落地，逻辑引用由 renderer 维护，跨进程无原子性。

**解决方案**：

- **`ops/`** 是整个 file module 内唯一直接 `import node:fs` 的位置，成为 FS 的唯一所有者
- **`FileEntryService` / `FileRefService`** 是 main 侧的 data repository，纯 DB 操作
- **`FileManager`** 作为 lifecycle service，统一协调 FS（via `ops`）与 DB（via repository），也是唯一 IPC 注册方
- Renderer 消费路径只有两条：DataApi（只读查询）+ File IPC（写操作），不再持有 `db.files` 表

**参考**：`architecture.md §3`（分层架构）、§4.1（交互全景）。

---

## 2. 上传与登记非原子 — ✅ 已解决

**原问题**：uploadFile 完成后 renderer 再写 db.files；`addFile` 可绕过 main 直接登记。

**解决方案**：

- **`createInternalEntry` / `ensureExternalEntry` IPC** 在 main 侧一次性完成 "FS 落地 + DB 登记"（internal）或 "upsert + stat 验证"（external），成功/失败整体可见
- Internal：拷贝内容到 `{userData}/files/{id}.{ext}` 后 insert `file_entry` 行
- External：按 `externalPath` 纯 upsert（同 path 有行就 reuse + 刷 snapshot；否则新建）；external 不进入 trashed 生命周期，`fe_external_no_trash` CHECK 在 schema 层兜底
- Renderer **没有**独立登记 entry 的入口——`addFile` 这类绕路被类型系统封闭

**参考**：`architecture.md §2.3` 的 `createInternalEntry` / `ensureExternalEntry`（及批量版本）、`file-manager-architecture.md §1.2`（external path unique）。

---

## 3. 渲染进程可直接写入文件引用 — ✅ 已解决

**原问题**：renderer 可调 `addFile` 写 db.files，`FileMetadata.path` 可能指向不存在/越权文件。

**解决方案**：

- DataApi **判定标准**明确：read-only、禁止 mutation。所有 FileRef 的 create / cleanup **不**经 DataApi 暴露
- `FileRef` 的写操作仅由 main 侧业务 service 直接调用 `fileRefService`
- `FileEntry` 的所有写操作仅经 File IPC → FileManager，无 renderer 直写路径
- External path 由 main 侧在 `ensureExternalEntry` 时 stat 验证，不信任 renderer 传入的任意字符串

**参考**：`architecture.md §3.1`（DataApi vs File IPC 判定）、§4.2 (1)(2)。

---

## 4. 去重对用户可见性冲突 — ✅ 已解决

**原问题**：旧架构按 "size + MD5" 去重，同内容不同文件名被合并，与 "用户视角每个文件独立存在" 冲突。

**解决方案**：

- 新架构**取消 internal 的内容级去重**。"每一条 FileEntry 对应一个用户上传/保存的文件"，每次 `createInternalEntry` 产生独立 entry
- `contentHash`（xxhash-128）仅用于版本检测与 upload 缓存失效，**不作为身份键**
- External 通过 `externalPath` 去重（同路径复用 entry），这是**路径语义的同一性**，非内容去重，不与"文件名独立"相冲突

**TODO**：在 `file-manager-architecture.md §1.1` 增一行显式声明 "No content-based deduplication for internal entries"，避免未来再次被当遗漏。

**参考**：`file-manager-architecture.md §1.1`（FileEntry 扁平个体记录）、§1.2（path 唯一性）。

---

## 5. 引用计数语义不足 — ✅ 已解决

**原问题**：`count` 是聚合数字，引用关系本身不可见，无法反查 / 无法解释。

**解决方案**：

- **`file_ref` 表**显式 polymorphic：`(fileEntryId, sourceType, sourceId, role)` + UNIQUE 约束
- 新增两条反查端点：
  - `/files/entries/:id/refs` — 某文件被谁引用
  - `/files/refs?sourceType=…&sourceId=…` — 某业务对象引用了哪些文件
- `sourceType` / `role` 由业务模块在 `SourceTypeChecker` 注册，编译期闭合
- DataApi 专用端点 `GET /files/entries/ref-counts?entryIds=...` 按需 SQL 聚合计数，不再持久化 `count` 字段（见 `migration-plan.md §2.3`）。注：旧设计曾用 `includeRefCount` opt-in 字段，已废弃——DataApi 边界收紧为纯 SQL + 固定 shape。

**参考**：`file-manager-architecture.md §1.3` / §7（三层 ref 清理）。

---

## 6. 缺少结构化目录树 — 🚫 DB 层非目标 / ⚠️ 运行时 primitive 已预留

**原问题**：文件页缺少 in-app 目录树，用户无法按目录组织。

**决策**：**不在 file module DB 层引入目录树**（`file_entry` 扁平，无 `parentId`、无 mount）；但在 **primitive 层预留 `DirectoryTreeBuilder`** 供业务按需消费。

**设计分层**：

| 层                 | 决策                   | 位置                                                |
| ------------------ | ---------------------- | --------------------------------------------------- |
| 持久化模型         | 扁平，不做目录树       | `file_entry` schema                                 |
| 运行时树构建       | 抽象为可复用 primitive | `src/main/file/tree/`（与 `watcher/`、`ops/` 同级） |
| UI 状态 / 业务语义 | 由消费者自治           | Notes / 未来文件浏览器各自持有                      |

**运行时 primitive：`DirectoryTreeBuilder`**（接口草案见 `rfc-file-manager.md §14`）：

- 首个消费者 Notes 通过工厂 `createDirectoryTree(path, options)` 构建内存树
- 内部复用 `createDirectoryWatcher()`（已自动接入 DanglingCache），事件 → 树 mutation
- 节点 payload 泛型化（`TreeNode<T>`），业务可附加元数据
- 不写入 DB，不与 `file_entry` 耦合

**按来源组织的另一维度**：业务聚合用 `FileRef.sourceType` / `sourceId`，和目录树正交并存，两者都能用。

**实施节奏**：primitive 接口草案先进 RFC（已完成），Lean 实现随 Notes Phase 5 集成落地；第二消费者（如未来的文件浏览器）到来时再抽公共、补能力。

**参考**：`rfc-file-manager.md §14`（DirectoryTreeBuilder）、`file-manager-architecture.md §1.1`（FileEntry 扁平）、`architecture.md §1.3`（Notes 不在 file module 范围）。

---

## 7. 业务来源不可区分 — ⚠️ 架构已使能，UI 交付属业务

**原问题**：知识库/对话/笔记上传混在一起，无来源维度。

**解决方案**：

- **架构层面**：`FileRef.sourceType` 提供 "chat_message" / "knowledge_item" / "painting" 等来源标签，DataApi 可按来源反查
- **UI 交付**：文件页是否展示 "按来源分组" 过滤器，属业务侧（FilesPage）PR 范围，不阻塞架构落地

**笔记来源问题**：见 §9（笔记解耦设计）。笔记文件**不默认**进入文件页列表。如未来需要"统一的文件页"，业务可显式为笔记文件创建 external FileEntry 挂 FileRef，但这是业务决策。

**参考**：`architecture.md §4.2`（业务服务接触点）、`file-manager-architecture.md §1.3`（FileRef 结构）。

---

## 8. 对话上传无法复用内部文件 — ⚠️ 架构已使能，UI 交付属业务

**原问题**：对话输入只能从 OS 选文件，不能复用已上传 entry。

**解决方案**：

- **架构层面**：DataApi `/files/entries?origin=internal` 已经可以列出所有内部文件供选择；对话附件仅需在 `FileRef` 中加一条 `sourceType='chat_message'` 的引用即可复用既有 entry
- **UI 交付**：对话输入框"从已上传文件中选择"的 picker 是业务 PR 范围。新架构的 DataApi + IPC 双通道已为其准备好一切所需接口

**参考**：`architecture.md §3.1.2`（典型 renderer 调用流示例）。

---

## 9. 笔记文件管理与全局文件管理割裂 — 🚫 非目标（解耦设计）

**原问题**：笔记文件树独立管理，未纳入 db.files，对用户"文件能力不一致"。

**决策**：**采纳解耦设计，file module 不与笔记功能耦合**。

理由：

- Notes 是 FS-first 的编辑工作区，需要与外部编辑器无缝协作、本地路径可见——这是 Notes domain 的核心需求，与 file module "统一 entry 管理" 的职责不在同一层
- 强行镜像 Notes 文件到 `file_entry` 会引入双向同步复杂度（见原问题 §10 "问题" 部分，已验证得不偿失）
- **保留交叉引用能力**：业务侧如需，可为特定笔记文件创建 `origin='external'` 的 FileEntry，通过 `externalPath` 引用笔记路径；但这是**按需**而非默认
- Notes 的内部目录树改由 Notes domain 用 `createDirectoryWatcher()` 基于 FS 扫描实时构建（见 §6）

**对用户呈现的一致性**：

- 文件页展示 file module 管理的文件（chat / knowledge / painting 等）
- 笔记页展示 Notes domain 的文件树
- 两者是不同工作区视图，而非被分裂的同一视图

**参考**：`architecture.md §1.3`（Notes 不在范围内 + 注：同一物理文件可同时属于 FS-first domain 与 external FileEntry）。

---

## 10. 笔记文件树未纳入 DB 管理 — 🚫 非目标（同 §9）

**原问题**：笔记文件树不进 db.files，与其他文件管理割裂。

**决策**：**同 §9，保持解耦**。Notes 的文件树交由 Notes domain 基于 watcher 在内存中构建，不入 `file_entry` 表。

**原问题中已列出的 "问题" 在新架构下的处理**：

| 原文列出的问题                           | 新架构处理                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| "与 db.files 体系割裂，无法统一检索"     | 通过 FileRef 按来源聚合；笔记显式不参与统一检索（视图级分离）                                           |
| "业务维度难以叠加（来源、标签、引用）"   | 笔记域内的标签/引用由 Notes domain 自治；需要跨域引用时走 external FileEntry                            |
| "一致性依赖监听与扫描，逻辑分散在页面中" | 新架构提供 `createDirectoryWatcher()` 工厂作为通用 primitive，监听逻辑收敛在 Notes service 而非散在页面 |
| "未来引入单一节点表需要重建模或双向同步" | 明确不再追求"单一节点表"方向（见 §6 决策）                                                              |

**参考**：同 §9 / §6。

---

## 11. 跨进程一致性难以验证 — ✅ 已解决

**原问题**：缺少 "写入 + 登记" 事务；缺少启动期对齐机制。

**解决方案**：

- **写入事务**：`createInternalEntry` / `ensureExternalEntry` / `permanentDelete` 在 main 侧一次完成 FS + DB（或 DB + stat），错误路径整体回滚
- **启动期孤儿扫描**（`FileManager.runOrphanSweep`，Background）：
  - 扫描 `{userData}/files/` 下 UUID 文件名但 DB 无对应行的孤儿 → unlink
  - 清理 `*.tmp-<uuidv7>` 原子写残留
- **孤儿 ref 扫描**（`OrphanRefScanner`，延迟 30s 启动）：
  - 按 `Record<FileRefSourceType, SourceTypeChecker>` 编译期约束，每个 sourceType 必有 checker
  - 定期扫描 `file_ref` 中 `sourceId` 已不存在的行并清理
- **External dangling 检测**（`DanglingCache`）：
  - 内存反向索引 `Map<path, Set<entryId>>`
  - Watcher 事件 + 冷路径 stat 兜底，通过 File IPC `getDanglingState` / `batchGetDanglingStates` 按需暴露（不再走 DataApi——FS 副作用一律走 IPC）

**参考**：`file-manager-architecture.md §7`（三层 ref 清理）、§11（DanglingCache）、`architecture.md §5.1-5.2`（启动时序）。

---

## 12. 可扩展性受限 — ⚠️ 大部分已解决，目录树方向除外

**原问题**：FileMetadata 结构不易扩展到 "单一节点表 + 文件树"。

**解决方案**：

| 扩展方向          | 新架构提供的接入点                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------- |
| AI provider 上传  | 延后引入 `FileUploadService` + `file_upload` 表，FileEntry 结构不变，additive migration      |
| 新增业务引用来源  | 新增 `sourceType` 枚举值 + 注册 `SourceTypeChecker`（编译期强制）                            |
| 业务监控外部目录  | 通过 `createDirectoryWatcher()` 工厂；DanglingCache 自动同步                                 |
| Dangling 实时推送 | 当前走 DataApi query-time lookup；未来可在 DanglingCache 状态变化时触发 DataApi invalidation |
| 全文搜索          | `ops/search.ts` 基于 ripgrep；持久化索引由 Knowledge 等业务自行管理                          |

**目录树方向**：见 §6 非目标决策。新架构不追求 "单一节点表 + 文件树" 模型。

**参考**：`architecture.md §8`（扩展点）。

---

## 13. FileMetadata 生产不统一 — ✅ 已解决

**原问题**：`ext` / `type` 生成逻辑分散在多个入口，main 与 renderer 推断策略不一致。**深层原因**是 `FileMetadata` 为普通 interface，**对象字面量就能满足类型**——于是各处自拼，收口无从谈起。

**解决方案**：**旧 `FileMetadata` 整体被 `FileEntry` 替代**，并通过 **brand type** 在类型系统层禁止鸭子类型（参见 `migration-plan.md §1.1` "字段级退役" 主线）。

### 类型替代

renderer 与 main 共享的 v2 入口类型是 `FileEntry`（来自 `@shared/data/types/file`），旧的 `FileMetadata` 随各消费域切换逐步退役（见 `migration-plan.md §2` 字段退役清单 + §3 消费域切换计划）。

### Brand type 强化（核心）

`FileEntry` **有派生字段**——`name/ext` 由 basename 切分、`type` 由 `ext` 派生、`refCount/dangling/path/url` 是 DataApi 按需聚合。这些派生只有在 sanctioned 路径（main 侧）才能正确产生，renderer 或业务代码自拼对象就会破坏统一。

解法：**只给 `FileEntry` 加 brand**——让对象字面量无法满足类型：

```typescript
// packages/shared/data/types/file/fileEntry.ts
export const FileEntryIdSchema = z.uuid()  // 普通字符串，不 brand

export const FileEntrySchema = z
  .discriminatedUnion('origin', [InternalEntrySchema, ExternalEntrySchema])
  .brand<'FileEntry'>()

export type FileEntryId = z.infer<typeof FileEntryIdSchema>
export type FileEntry = z.infer<typeof FileEntrySchema>
```

效果：

- `const e: FileEntry = { id, origin, name, ... }` → **编译错误**（缺 brand，拒绝绕过派生的鸭子对象）
- `const e = FileEntrySchema.parse(raw)` → OK（parse 成功时自动施加 brand）
- `const e2: FileEntry = { ...e, name: 'new' }` → **编译错误**（spread 丢 brand）——修改必须走 `rename` IPC 等 sanctioned mutator，与"mutation 统一走 FileManager"天然对齐

**范围严控**：仅 `FileEntry` 一个类型加 brand。其他类型（`FileEntryId` / `FileRef` / `FileRefId`）保持普通 `z.infer` 类型——它们没有派生字段（ID 是纯字符串，FileRef 是纯行），加 brand 只会给测试和 main 内部代码增加无谓的 parse 样板，不换保护。

### 生产点仅三条

唯一能 emit 已 branded `FileEntry` 的路径：

| 生产者 | 位置 | parse 时机 |
|---|---|---|
| `createInternalEntry` / `ensureExternalEntry` / 批量版本 IPC | `FileManager` | 返回前 `FileEntrySchema.parse` |
| DataApi handler（row → DTO） | `src/main/data/api/handlers/files.ts` | 响应前 `FileEntrySchema.parse`；固定 shape，无 opt-in 派生字段 |
| File IPC enrichment（dangling / path）        | `FileManager` | 通过专用 IPC 返回（`getDanglingState` / `getPhysicalPath` 及其批量版本）；与 DataApi 边界互斥。`file://` URL 不再走 IPC——由共享纯函数 `toSafeFileUrl(path, ext)`（`@shared/file/urlUtil`）在进程内合成 |
| FileMigrator insert | `src/main/data/migration/v2/migrators/FileMigrator.ts` | 写入前转换并 parse |

renderer 不再在前端拼接 entry 对象，**类型系统层封堵"直接搓 FileMetadata 鸭子对象"的旧式入口**。

### 字段语义收敛（消除推断歧义）

- `ext`（不含前导点）与 `name`（不含扩展名）在 `createInternalEntry` / `ensureExternalEntry` 内由 main 侧统一切分（见 `migration-plan.md §2.7`）
- **`ext` 的运行期防御由 `SafeExtSchema`（`essential.ts`）集中保障**：禁前导点、禁 path separator、禁 null bytes、禁 whitespace-only——与 `SafeNameSchema` 的威胁模型对齐（都是会拼进 `{dir}/{name}.{ext}` 参与 `fs.*` 路径的字段）。类型层保持 `string | null`，不 brand、不加编译期 template literal 限制——convention first，`FileEntrySchema.parse` 是系统边界的权威检查
- `type` 不再持久化，改为读时派生（默认按 `ext`，`getMetadata` 时可 buffer 升级，见 §2.5）
- 推断逻辑集中在 main 的 `ops/metadata.ts`，renderer 不再自行判断 MIME / ext

### Test / mock 逃生舱

`tests/__mocks__/factories.ts` 提供 `makeFileEntry(overrides)`，内部仍走 `FileEntrySchema.parse`——mock 数据被强制经过 schema 校验。不设 unbranded 后门，严守"只有 parse 过的才是 FileEntry"。

### 运行期防线

brand 是编译期约束，运行期 `as FileEntry` 仍可绕（code review 可见）。**真正的运行时防线是 schema parse 本身**——IPC 边界、DataApi 响应边界都会施加 parse，保证即便 TS 被绕过，数据形状依然合法。

### 结果

不再存在"同一个文件在 renderer 和 main 得出不同 type/ext"的可能——renderer 拿到的始终是 main 已归一化**且经 Zod parse**的 branded `FileEntry`。

**参考**：`rfc-file-manager.md §4.5`（DTO 类型 + brand 设计）、`migration-plan.md §1.1`（两条主线）、§2.5（type 迁移）、§2.7（name/ext 切分）、§3（消费域切换）。

---

## 14. 补充决策：`createInternalEntry` 的 source discriminator（A-7 延伸）

> **关联**：本节是对 PR #13451 架构评审 A-7（`createEntry({ origin })` 拆分）的延伸决策——A-7 已拆出 `createInternalEntry` / `ensureExternalEntry` 两个语义方法，本节进一步收紧 `createInternalEntry` 的入参类型。

### 动机：旧签名的三个问题

原签名：

```ts
type CreateInternalEntryParams = {
  name: string
  ext?: string | null
  content: FileContent // FilePath | URLString | Base64String | Uint8Array
}
```

审视后发现：

1. **`name` 一刀切必填，造成全仓重复代码**。对 `FilePath` / `URLString` 两类 content，name 可由 `basename(path)` / URL 末段派生；Phase 2 的大头消费者（chat attach / knowledge ingest / painting download）都是这两类，却被迫每一处手写 basename，违反 DRY。
2. **`ext?` 的 JSDoc 写 "Derived from name if omitted"**，与 `CommonEntryFields.name` 的"不含扩展名"语义直接冲突——要从 name 派生 ext，就必须要求 name 携带后缀，反向破坏 FileEntry 不变量。真正应该派生 ext 的源是 `content`（path extname / URL 后缀 / mime / sniff），不是 name。
3. **四种 content 形态的派生能力完全不对称**，但被 `FileContent` union 压平成同一契约——调用方无法通过类型感知"我这个分支究竟允许省略什么"。

### 派生能力矩阵

| content 形态     | name 可派生？              | ext 可派生？             |
|-----------------|---------------------------|--------------------------|
| `FilePath`      | `basename(path)` ✅       | `extname(path)` ✅       |
| `URLString`     | URL 末段 / CD header ✅   | URL 后缀 / Content-Type ✅|
| `Base64String`  | ❌ 无原名                 | mime 查表 ✅             |
| `Uint8Array`    | ❌ 无原名                 | ❌（需 caller 提供或 sniff） |

### 决策：方案 B — 显式 `source` discriminator union

```ts
export type CreateInternalEntryIpcParams =
  | { source: 'path';   path: FilePath }
  | { source: 'url';    url: URLString }
  | { source: 'base64'; data: Base64String; name?: string }
  | { source: 'bytes';  data: Uint8Array;   name: string; ext: string | null }
```

**类型门约束**（对应上面的矩阵）：
- 能派生的字段 → **在该分支上不允许传**（从类型中 hide，避免调用方传入与派生结果冲突的值）
- 不能派生的字段 → **必填**（bytes 分支的 name/ext），或**可选含 UX override**（base64 的 name，调用方可能想指定 `Pasted Image {timestamp}`）

### 为什么用显式 `source` 字段（而非让 TS 按 content 字面量类型自动收窄）

考虑过"方案 A：保留单一 `content: FileContent` 字段，靠 template literal narrowing 推断分支"。否决喵，原因：

- `FilePath = '/${string}' | '${string}:\\${string}'` 与 `URLString = 'http://${string}' | 'https://${string}'` 都是 `string` 子类型。**TS 对动态 string 变量不会将其收窄到具体 template literal 分支**——只有字面量或显式 `as FilePath` 才生效。而调用点几乎都是动态 string（从 dialog / fetch / drag-drop 拿到），narrow 失败率极高。
- `Uint8Array` 与 `Base64String` 能被 narrow，但混合形态下类型行为不一致，读者心智负担大。
- 显式 `source: 'path'|'url'|'base64'|'bytes'` 是 literal union，narrow 100% 稳定；`switch (params.source)` 内部 dispatch 零歧义；调用点"声明自己在从什么创建"也与 audit 里旧 `uploadFile` / `saveBase64Image` / `savePastedImage` / `downloadFile` 四套 API 的分类天然对齐，语义更自解释。

### 代价与取舍

- **调用点多写一个 `source: '...'` 字面量** → 比"调用方手写 `basename(path)` + 自己推 ext"反而更轻量。
- **`copy()` 伪代码需同步调整**：原本 `copy` 直接塞 `{ name, content: readStream }`，新 API 里拿不到 stream 分支——`copy` 改为：先 `resolveFileHandle → absPath`，调 `createInternalEntry({ source: 'path', path })`，如有 `newName` 再 follow-up 调用 `rename`。语义更分离，`copy` 独有的 UX 需求（改名）不污染 `createInternalEntry` 核心 API。

### 落地范围

- `packages/shared/file/types/ipc.ts` — `CreateInternalEntryIpcParams` 重写为 discriminator union，附完整决策注释
- `src/main/file/FileManager.ts` — 本地 `CreateInternalEntryParams` 删除，改为 alias 自 shared 类型
- `v2-refactor-temp/docs/file-manager/rfc-file-manager.md §5.1 / §5.6 / §7.3` — 伪代码与 renderer 示例同步
- `docs/zh/references/file/file-manager-architecture.md §1.6.3` — facade 伪代码签名注释

**参考**：`packages/shared/file/types/ipc.ts` 头部 JSDoc、`rfc-file-manager.md §5.1`、`filemetadata-consumer-audit.md §4.1`（旧 API 到新 source 分支的对应）。

---

## 总览

| #   | 问题                     | 状态                                 |
| --- | ------------------------ | ------------------------------------ |
| 1   | 职责边界割裂             | ✅ 已解决                            |
| 2   | 上传与登记非原子         | ✅ 已解决                            |
| 3   | Renderer 可直写引用      | ✅ 已解决                            |
| 4   | 去重对用户可见性冲突     | ✅ 已解决                            |
| 5   | 引用计数语义不足         | ✅ 已解决                            |
| 6   | 缺少结构化目录树         | 🚫 DB 层非目标 / ⚠️ primitive 已预留 |
| 7   | 业务来源不可区分         | ⚠️ 架构已使能                        |
| 8   | 对话上传无法复用内部文件 | ⚠️ 架构已使能                        |
| 9   | 笔记与全局文件管理割裂   | 🚫 非目标（解耦）                    |
| 10  | 笔记文件树未纳入 DB      | 🚫 非目标（解耦）                    |
| 11  | 跨进程一致性难验证       | ✅ 已解决                            |
| 12  | 可扩展性受限             | ⚠️ 主要方向已解决                    |
| 13  | FileMetadata 生产不统一  | ✅ 已解决                            |

**结论**：13 项问题中，**架构层面的 7 项全部闭合**；3 项（6 / 9 / 10）经评估后作为解耦设计决策明确列为非目标并给出依据；3 项（7 / 8 / 12）的架构基础已就绪，剩余交付属业务 PR 范围。
