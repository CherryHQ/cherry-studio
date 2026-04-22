# File Manager Migration Plan

> **本文档覆盖**：把旧 `FileMetadata` / `FileStorage` 栈迁移到 v2 类型系统的**具体执行计划**。
>
> **框架**：v2 把旧 `FileMetadata` 同时承担的两个角色（DB 行 + 通用文件描述符）**显式拆分**：
>
> - **持久化角色** → `FileEntry`（`packages/shared/data/types/file/fileEntry.ts`）
> - **描述符角色** → `FileInfo`（`packages/shared/file/types/info.ts`）
> - **跨边界引用** → `FileHandle`（`packages/shared/file/types/handle.ts`）
>
> 本文档以**字段级退役**（字段归 FileEntry / FileInfo / 彻底删除）和**消费域切换**（消费者按 P/I/A 桶归属分流）两条主线组织。
>
> **不在本文档范围**：
>
> - **目标设计**（schema、API、架构原则）：见 [`rfc-file-manager.md`](./rfc-file-manager.md)
> - **FS 用法现状**（main process 直接 `fs` 调用清单）：见 [`fs-usage-audit.md`](./fs-usage-audit.md)
> - **FileMetadata 消费现状**（96 个文件的全量审计）：见 [`filemetadata-consumer-audit.md`](./filemetadata-consumer-audit.md)
> - **架构语义**：见 [`docs/references/file/architecture.md`](../../../docs/references/file/architecture.md) / [`file-manager-architecture.md`](../../../docs/references/file/file-manager-architecture.md)
>
> **本文档与 RFC 的关系**：RFC §10（迁移策略）和 §11（分阶段实施计划）描述**数据层迁移**（Dexie → SQLite 的一次性数据搬运）与**总体阶段划分**。本文档深入到**字段级 / 消费者级**的具体落地动作，是 RFC 的展开。

---

## 1. 全局结构

### 1.1 迁移的两条主线

| 主线           | 含义                                                                                                                                | 本文档对应章节 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **字段级退役** | 旧 `FileMetadata` 的每个字段"归到 FileEntry / 归到 FileInfo / 彻底删除"的决策与执行                                                 | §2             |
| **消费域切换** | 按业务域（messages / knowledge / painting / ...）把 renderer 侧旧 API 调用换到 v2；消费者先分 P/I/A 桶，再确定迁移到 FileEntry / FileInfo / 拆签名 | §3             |

这两条可以并行推进，字段退役为域切换扫清障碍（减少 shim 期的适配面积）。

### 1.2 FileMetadata 角色拆分与桶归属

#### 1.2.1 叙事校正：不是"替换"，是"完成那次 refactor"

`packages/shared/data/types/file/file.ts:1-4` 的类型注释写着：

```typescript
/**
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: this type need be refactored after FileSystem is designed
 * --------------------------------------------------------------------------
 */
```

`FileMetadata` 从诞生就同时承担两种角色——**DB 行**（Dexie `files` 表、`message_block.file` JSON）与**通用文件描述符**（OCR 输入、TokenService 入参、UI 渲染字段源）。v2 并不是"用 `FileEntry` 替换 `FileMetadata`"，而是**把两个角色显式拆开**：

| 旧 `FileMetadata` 的角色 | v2 对应类型      | 说明                                                                         |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------- |
| DB 行 / 持久化身份       | `FileEntry`      | 带 `id`、`origin`、`trashedAt`；有 lifecycle；Zod brand 强制走 sanctioned 生产路径 |
| 磁盘描述符 / 临时传参    | `FileInfo`       | 带 `path`、`modifiedAt`；live view；任意构造                                 |
| 跨边界引用（两者通用）   | `FileHandle`     | tagged union；IPC 边界首选签名                                               |

这决定了**字段的归宿不是统一的"搬到 FileEntry"**——需要逐字段判断它属于哪个角色（见 §2）。

#### 1.2.2 消费者三桶划分（P / I / A）

审计（[`filemetadata-consumer-audit.md`](./filemetadata-consumer-audit.md)）按**消费模式**把 96 个 `FileMetadata` 消费者分三桶：

| 桶 | 使用模式                                                     | 迁移目标                                                | 代表消费者                                                            |
| -- | ------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------- |
| **P** 持久化 | 把 `FileMetadata` 存进 Dexie / message_block / knowledge_item JSON；读取时期望完整 DB 行 | **→ FileEntry**（或其中的 `FileEntryId`）               | `databases/index.ts` Dexie 表、`KnowledgeMigrator`、`ImageMessageBlock.file` |
| **I** 描述符 | 只用 path / name / size / ext / type 驱动一次处理，不持久化任何身份 | **→ FileInfo**                                          | OCR（`SupportedOcrFile`、TesseractService）、TokenService、`isSupportedFile` |
| **A** 两栖   | 同一处既持久化又 pass-through，或者签名要完整 `FileMetadata` 但实际只用子集（"接口说谎"） | **→ 拆签名**：持久化路径接 FileEntry，处理路径接 FileInfo | `services/FileManager.ts:addFile/uploadFile`、`KnowledgeService` preprocessing、`InputbarCore:458` |

**关键规则**：

- **桶 P** 消费者迁移时直接目标 `FileEntry`（或对只需要 id 的场合用 `FileEntryId`），按业务域切分 PR
- **桶 I** 消费者迁移时直接目标 `FileInfo`，**不经过 FileEntry 中间层**——它们从未需要身份，shim 期也不需要适配
- **桶 A** 消费者是真正的工作量：要逐个把"接口说谎"拆成两段——持久化动作显式调 `createInternalEntry` / `ensureExternalEntry`，处理动作接 `FileInfo`
- **升格只有一条路**：`FileInfo → FileEntry` 必须走 FileManager 的 sanctioned 生产入口，不提供隐式 converter

#### 1.2.3 Shim 期的 scope 限定

原先打算的"双向 shim（FileEntry ↔ FileMetadata）"被这个拆分压缩了适用范围：

- **桶 I shim**：不需要——消费者从 `FileMetadata` 改吃 `FileInfo` 只是**字段瘦身**（丢 `id` / `count` / `origin_name` 这类身份字段），没有跨系统 boundary，直接改签名即可
- **桶 P shim**：需要，但只在**桶 P 迁移未完成的域**里保留，把 v2 `FileEntry` 投影回旧 `FileMetadata` 形状给尚未迁移的持久化消费者；反向（旧 `FileMetadata` 读出当 `FileEntry` 用）仅在兼容旧 Dexie 数据窗口期需要
- **桶 A shim**：**不提供**——A 桶必须拆签名解决，不能靠 shim 糊弄过去；否则两栖代码永远不会真正清理

See §4 for the shim function specifications.

### 1.3 调研依赖图

```
  filemetadata-consumer-audit.md  ──引用──▶  migration-plan.md
  (完整现状快照 96 files + P/I/A 桶标签)     (落地计划)
        │
        └──  每个字段 / 每个域都在 audit 里有具体 file:line
             本文档只重复"结论 + 动作"，不重复原始引用清单
```

对每个字段 / 域的迁移条目，先到 audit 查清楚现状，再写入本文档。写入时只保留**动作相关**的少量引用（具体行号），深度引用留在 audit。

---

## 2. 字段级退役计划

> **归宿规则**（按 §1.2.1 的角色拆分）：
>
> - 身份 / 持久化相关字段 → `FileEntry`（可能伴随重命名或格式变化）
> - 磁盘描述符相关字段 → `FileInfo`
> - 业务特化 / 死字段 / 本来就不该在文件对象上的字段 → **彻底删除**，归到各自合适的地方（upload 调用参数、`file_ref` 聚合、TokenService 内部 cache 等）
>
> 本章每个字段按"属于哪个角色 / 如何退役"展开。

### 2.1 字段退役总览

下表给出每个旧 `FileMetadata` 字段的归属决策（按 §1.2.1 的角色拆分）；详细迁移方案分别展开。

| 旧字段          | 角色          | v2 归属                                                                                     | 迁移方案 | 状态        |
| --------------- | ------------- | ------------------------------------------------------------------------------------------- | -------- | ----------- |
| `purpose?`      | 彻底删除      | 上移到 upload 调用参数（未来 `file_upload.metadata`）                                       | §2.2     | 📋 计划完成 |
| `count`         | 彻底删除      | `file_ref` 表按 source 聚合（身份语义变化，不再是文件对象字段）                             | §2.3     | 📋 计划完成 |
| `tokens?`       | 彻底删除      | 死字段，纯删除                                                                              | §2.4     | 📋 计划完成 |
| `type`          | FileInfo-only | `FileInfo.type`（ext 派生，默认）+ `ops.getMetadata` 的 `PhysicalFileMetadata.type`（按需）；`FileEntry` 不存此列 | §2.5     | 📋 计划完成 |
| `path`          | FileInfo-only | `FileInfo.path`（unmanaged 身份）；managed 侧由 `resolvePhysicalPath(entry)` 动态派生，`FileEntry` 无 `path` 列 | §2.6     | 📋 计划完成 |
| `name` (存储名) | 彻底删除      | `name = id + ext` 的冗余物理命名约定废弃；storage path 由 `resolvePhysicalPath(entry)` 派生 `{id}.{ext}` | §2.7     | 📋 计划完成 |
| `origin_name`   | FileEntry + FileInfo | 拆分并重命名：`FileEntry.name`（不含扩展名）+ `FileEntry.ext`（不含前导点）；`FileInfo.name` / `FileInfo.ext` 从 basename 派生 | §2.7     | 📋 计划完成 |
| `created_at`    | FileEntry-only | ISO string → `FileEntry.createdAt: number`（ms epoch），dayjs 天然兼容；`FileInfo` 走 `modifiedAt`（mtime），不持有 entry 级别的创建时间 | §2.8     | 📋 计划完成 |
| `id` (UUID v4)  | FileEntry-only | 保留原 v4 id；新 entry 走 v7；Schema 放宽为 `z.uuid()`；`FileInfo` 无 id 字段             | §2.9     | 📋 计划完成 |
| `size`（共享） | FileEntry + FileInfo | 字段名不变，但语义分裂：`FileEntry.size` 是注册时快照（external 可能 drift）；`FileInfo.size` 是 `fs.stat` 实时 | —        | N/A         |

**图例**：📋 = 调研完成且方案清晰；🔍 = 仅列点，待单独深入调研。

### 2.2 `purpose` 字段

`FileMetadata.purpose?: OpenAI.FilePurpose` 在旧模型里挂在"文件"上，但实际上它是**一次上传调用的参数**，不是文件本身的属性。v2 `FileEntry` 不保留此字段。

#### 现状调研

**生产方（0 个稳定 setter）**：

- renderer `FileManager.ts` / main `FileStorage.ts` 创建 FileMetadata 时**不写入** `purpose`——数据库中 99% 实例该字段为 undefined
- 唯一 setter：`src/renderer/src/aiCore/prepareParams/fileProcessor.ts:128-132`，对 qwen-long / qwen-doc 模型 spread 一个临时副本设 `purpose: 'file-extract'`，用完即扔，不回写 DB

**消费方（2 个）**：

- `src/main/services/remotefile/OpenAIService.ts:35` — `purpose: file.purpose || 'assistants'` 传给 `client.files.create`
- `src/renderer/src/aiCore/prepareParams/fileProcessor.ts:141-143` — 校验远端已上传文件的 purpose 和本地 `file.purpose` 是否一致（不一致抛错重传）

**Schema 化石**：

- `packages/shared/data/types/knowledge.ts:53` 把 `purpose` 塞进 `KnowledgeFileItem`，但 Knowledge 业务代码 **零消费**

#### 迁移目标

把 `purpose` 从"文件属性"改为"upload 调用参数"，符合以下两条原则：

1. FileEntry 只描述文件本身，不绑定某一次 upload 行为
2. 未来 `file_upload` 表记录"**当初用什么 purpose 上传**"，而不是文件永久持有一个模糊的 purpose

#### 迁移步骤

| #   | 文件                                                                                | 改动                                                                                                    |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `src/renderer/src/aiCore/prepareParams/fileProcessor.ts:121-132`                    | 不再 spread `file` 副本，改为提取 `purpose` 为独立变量（由 model 决定）传入 upload/retrieve 调用        |
| 2   | `src/main/services/remotefile/OpenAIService.ts:25`                                  | `uploadFile(file, options?: { purpose?: OpenAI.FilePurpose })`；内部 `options?.purpose ?? 'assistants'` |
| 3   | 对应 preload bridge（`window.api.fileService.upload`）                              | 签名加 `options?.purpose`，同步转发                                                                     |
| 4   | `src/renderer/src/aiCore/prepareParams/fileProcessor.ts:141`                        | cache mismatch 比较：`remoteFile.purpose !== purpose`（局部变量，非 `file.purpose`）                    |
| 5   | `packages/shared/data/types/knowledge.ts:53`                                        | 从 `KnowledgeFileItem` schema 删除 `purpose` 字段                                                       |
| 6   | `packages/shared/data/types/file/file.ts:28` + `src/renderer/src/types/file.ts:127` | `FileMetadata.purpose?` 字段移除                                                                        |

#### 执行时机

**可作为独立小 PR，在 v2 文件管理重构之前或之后均可**：

- **之前**（推荐）：提前把 purpose 从 FileMetadata 剥离，v2 `FileEntry` 天然不需要为此字段做任何决策；qwen-long 的 `'file-extract'` 行为在 upload 调用点清晰体现
- **之后**：作为 Phase 6 Cleanup 的一部分。缺点：Phase 4 consumer migration 期间 `FileEntry → FileMetadata` 的适配层还要补造一个 `purpose: undefined`，增加噪声

**PR 命名建议**：`refactor(file): move FilePurpose from FileMetadata to upload call sites`

#### 未来 `file_upload` 表对 purpose 的处理

当 AI SDK 稳定后引入 `file_upload` 表（见 [file-manager-architecture.md §9](../../../docs/zh/references/file/file-manager-architecture.md)），`purpose` 可作为 `metadata` JSON 字段的一部分记录：

```json
{
  "file_entry_id": "...",
  "provider": "openai",
  "remote_id": "file-abc123",
  "content_version": "xxh128:...",
  "metadata": { "purpose": "file-extract" } // per-upload, not per-file
}
```

这样"同一文件用不同 purpose 上传到同一 provider"的场景能天然区分（甚至可以放宽 UNIQUE 约束改为 `UNIQUE(file_entry_id, provider, purpose)`），比旧模型单一字段准确得多。

### 2.3 `count` 字段

**决策**：

> **v2 不持久化 count**。`file_entry` 表无 count 列；引用计数由 DataApi handler 在查询时按需聚合 `file_ref` 表得出（opt-in `includeRefCount`）。没有缓存，没有双写，没有 trigger——每次查询都是一次纯 SQL 聚合。

**定性**：引用计数 → `file_ref` 表。旧 `count` 是"这个文件被多少个业务对象引用"的 Dexie-level 数字；v2 由 `file_ref` 表的 `COUNT(*) WHERE fileEntryId = ?` 取代，**完全按需计算**。

#### 2.3.1 数据面

**Dexie schema**（`src/renderer/src/databases/index.ts:45,49,55,62,71,80,92,105,117,128`）：

```
files: 'id, name, origin_name, path, size, ext, type, created_at, count'
```

v1-v10 每个版本都把 `count` 列为索引字段（用于 `orderBy('count')`）。

**初始化值**：文件创建时写入 `count: 1`。所有 setter：

| 位置                                                             | 场景                               |
| ---------------------------------------------------------------- | ---------------------------------- |
| `src/main/services/FileStorage.ts:274`                           | `selectFiles` 返回的 FileMetadata  |
| `src/main/services/FileStorage.ts:340`                           | `uploadFile` 单文件                |
| `src/main/services/FileStorage.ts:365`                           | `base64Image` 保存                 |
| `src/main/services/FileStorage.ts:705`                           | `saveBase64Image`                  |
| `src/main/services/FileStorage.ts:755`                           | `savePastedImage`                  |
| `src/main/services/FileStorage.ts:1552`                          | `download` 远程下载保存            |
| `src/main/utils/file.ts:151`                                     | 工具层构造 FileMetadata            |
| `src/main/knowledge/preprocess/MistralPreprocessProvider.ts:185` | OCR 预处理产物                     |
| `src/renderer/src/components/Popups/VideoPopup.tsx:110`          | 视频 popup 构造                    |
| `src/renderer/src/pages/knowledge/items/KnowledgeFiles.tsx:113`  | 知识库页构造（传入 uploadFile 前） |

#### 2.3.2 Increment（count++）路径

所有 `count++` 都走 renderer 的两条路径：

| 路径                                                                                 | 触发时机                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `src/renderer/src/services/FileManager.ts:20` (`addFile`)                            | 同一文件第二次挂到业务对象（record 已存在则 increment） |
| `src/renderer/src/services/FileManager.ts:50` (`addBase64File`)                      | 同上（base64 入口）                                     |
| `src/renderer/src/services/FileManager.ts:67` (`uploadFile`)                         | 同上（upload 入口）                                     |
| `src/renderer/src/services/db/DexieMessageDataSource.ts:397-424` (`updateFileCount`) | `delta`-based 通用更新                                  |
| `src/renderer/src/store/thunk/messageThunk.ts:1849`                                  | 消息 fork / clone 时对相关文件 `delta=+1`               |

#### 2.3.3 Decrement（count--）路径

| 路径                                                                                                        | 语义                                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/renderer/src/services/FileManager.ts:96-119` (`deleteFile(id, force=false)`)                           | `count > 1 → decrement`；`else → physical unlink + 删 Dexie` |
| `src/renderer/src/services/db/DexieMessageDataSource.ts:397-424` (`updateFileCount(-1, deleteIfZero=true)`) | 同上语义                                                     |

#### 2.3.4 关键调用方（decrement 路径）

以下业务在**业务对象被删除时**清理 file 引用，全部走 `force=false`（= 走 count decrement）：

| 调用方                                                                   | 业务场景                                 |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| `src/renderer/src/store/thunk/messageThunk.ts:607`                       | 删除 message block 时清理附件            |
| `src/renderer/src/store/knowledge.ts:46`                                 | 删除知识库 item                          |
| `src/renderer/src/services/MessagesService.ts:74,83`                     | `deleteMessageFiles` / `safeDeleteFiles` |
| `src/renderer/src/services/db/DexieMessageDataSource.ts:204,252,312,349` | block cleanup 的各入口                   |

#### 2.3.5 物理删除路径（force=true，绕过 count）

`src/renderer/src/services/FileAction.ts:45-94` (`handleDelete`) 是 **FilesPage 删除按钮**的后端。流程：

1. `FileManager.deleteFile(fileId, true)` — 不看 count，直接物理删
2. `db.message_blocks.where('file.id').equals(fileId).toArray()` — **手动扫关联 blocks**
3. 遍历 topics 重建 `messages[].blocks[]` 去除引用
4. `db.message_blocks.bulkDelete(blockIdsToDelete)`

这条路径**绕开了 count 机制**，揭示旧架构没有真正的引用完整性保证——count 只是个启发式数字，真正的引用扫描发生在 UI 删除按钮里。

#### 2.3.6 UI 消费

| 位置                                             | 消费方式                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `src/renderer/src/pages/files/FilesPage.tsx:52`  | `db.files.orderBy('count').toArray()` — **按引用次数排序全部文件**                      |
| `src/renderer/src/pages/files/FilesPage.tsx:54`  | `db.files.where('type').equals(fileType).sortBy('count')` — **按类型过滤 + count 排序** |
| `src/renderer/src/pages/files/FilesPage.tsx:111` | `count: file.count` 透传到 dataSource                                                   |
| `src/renderer/src/pages/files/FileList.tsx:102`  | `${item.count}${t('files.count')}` — **显示引用次数**（文件列表每行的 extra 信息）      |

#### 2.3.7 Migration 侧的残留

`src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts:103` 的 `hasCompleteFileMetadata` 校验要求 `typeof value.count === 'number'`。Knowledge 迁移完成后，**`KnowledgeItemData.file` 仍以 FileMetadataSchema 形状存入 SQLite**（详见 audit §5 和 RFC §10.6 前言），所以 `count` 作为 JSON 字段会在 SQLite `knowledge_item.data` 中化石化保留。

#### 2.3.8 v2 映射

**`count` 不进入 `fileEntryTable`**（`src/main/data/db/schemas/file.ts` 已确认无此列）。

v2 对应查询：

```sql
-- 旧 file.count
SELECT COUNT(*) FROM file_ref WHERE file_entry_id = ?

-- 旧 orderBy('count')
SELECT fe.*, (SELECT COUNT(*) FROM file_ref fr WHERE fr.file_entry_id = fe.id) AS ref_count
FROM file_entry fe
ORDER BY ref_count DESC
```

#### 2.3.9 迁移步骤

**Step A: FileMigrator 填充 file_ref（RFC §10.1-10.3 范围内）**

迁移器扫描 Dexie 每个文件的**所有引用源**并写入 `file_ref`：

| 引用源                                                       | 扫描方式                        | file_ref 字段                                                                                                   |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `message_blocks.where('file.id').equals(fileId)` → messageId | 循环 Dexie 查询                 | `sourceType='chat_message'`, `sourceId=messageId`, `role='attachment'`（FILE block）or `'image'`（IMAGE block） |
| Redux `paintings` state（localStorage export）               | JSON 扫描 `painting.files[].id` | `sourceType='painting'`, `sourceId=paintingId`, `role='asset'`                                                  |
| Knowledge items（KnowledgeMigrator 已处理）                  | `KnowledgeItemData.file.id`     | `sourceType='knowledge_item'`, `sourceId=itemId`, `role='source'`                                               |

**注意**：v2 message 迁移把 blocks 从表移入 `data.blocks` JSON，所以 post-migration 不能再用 Dexie-style `where('file.id')` 扫——必须在**迁移期**扫完写入 file_ref，之后只能靠 `sourceId='<messageId>'` 反查。

**未决点（见 §6 Q7）**：paintings 可能不参与本轮迁移（RFC §10.4 标注"不在本次范围内"），因此 paintings 对应的 file_ref 缺失直到 PaintingMigrator 单独上线。期间 OrphanRefScanner 不能误删 painting 引用的文件——好在 `sourceType='painting'` 已纳入注册式 checker（RFC §8.5），checker 会查 PaintingState 兜底。

**Step B: Renderer 消费改造**

按依赖顺序：

| #   | 文件 / 位置                                                                                                                                          | 改动                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `src/renderer/src/services/FileManager.ts:96-119`                                                                                                    | `deleteFile` 的 count 分支删除，改为走新 IPC `permanentDelete` / `trash`；语义变化见下                                                                                                                                                        |
| B2  | `src/renderer/src/services/FileManager.ts:16-27` (`addFile`)                                                                                         | 不再 `count++`；改为**业务侧**写 `file_ref` 记录引用                                                                                                                                                                                          |
| B3  | `src/renderer/src/services/FileManager.ts:43-57` (`addBase64File`), `:59-74` (`uploadFile`)                                                          | 同 B2                                                                                                                                                                                                                                         |
| B4  | `src/renderer/src/services/db/DexieMessageDataSource.ts:397-424` (`updateFileCount`)                                                                 | 删除；业务改为直接管理 file_ref                                                                                                                                                                                                               |
| B5  | `src/renderer/src/store/thunk/messageThunk.ts:1849`                                                                                                  | 去掉 updateFileCount 调用，改为 `fileRefService.create({ sourceType: 'chat_message', sourceId, fileEntryId, role })`                                                                                                                          |
| B6  | `src/renderer/src/store/thunk/messageThunk.ts:607`, `MessagesService.ts:74,83`, `DexieMessageDataSource.ts:204,252,312,349`, `store/knowledge.ts:46` | 清理语义：从 `FileManager.deleteFile(force=false)` 改为 `fileRefService.cleanupBySource(sourceType, sourceId)`；文件本体的"无引用清理"交给 `OrphanRefScanner`                                                                                 |
| B7  | `src/renderer/src/services/FileAction.ts:45-94` (`handleDelete`)                                                                                     | 评估：是否保留 FilesPage 的"强制删除 + 级联清消息 block"？v2 如果沿用"主动清引用"则 `fileRefService.cleanupByEntry(entryId)` + `FileManager.permanentDelete(entryId)`；message block JSON 侧的 stale 引用由 renderer 侧 UI 过滤 dangling 显示 |
| B8  | `src/renderer/src/pages/files/FilesPage.tsx:52,54,111`, `FileList.tsx:102`                                                                           | 排序 / 显示 `count` → DataApi query 带 `includeRefCount: true` + `sortBy: 'refCount'`；同一个 query 也可加 `includeDangling: true` 顺带展示失效标记                                                                                           |
| B9  | 所有构造 FileMetadata 字面量时写死 `count: 1` 的位置（§2.3.1 后半表）                                                                                | 字段删除（字段级退役完成后）                                                                                                                                                                                                                  |

**Step C: Schema 清理**

| #   | 位置                                                                        | 改动                                                                                           |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| C1  | `src/renderer/src/databases/index.ts`                                       | Dexie `files` 表的 `count` 索引删除（双写期后）                                                |
| C2  | `packages/shared/data/types/file/file.ts`, `src/renderer/src/types/file.ts` | `FileMetadata.count` 字段删除                                                                  |
| C3  | `src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts:103`    | `hasCompleteFileMetadata` 不再要求 count（但迁移器的 legacy 输入仍可能含 count，兼容接受即可） |
| C4  | main 侧 FileStorage 的 `count: 1` 写入                                      | 删除（FileStorage 本身最终会被 v2 FileManager 取代）                                           |

#### 2.3.10 语义变化（需要产品确认）

**旧语义**：`FileManager.deleteFile(id, force=false)` 在 `count === 1` 时立刻物理删除文件。

**v2 两种选择**：

- **选项 1（立即清理）**：当 `file_ref` 最后一行被删时，trigger FileManager 立即 `permanentDelete(fileEntryId)`。需要数据库 trigger 或业务层额外一步
- **选项 2（延迟清理，推荐）**：`OrphanRefScanner` 定期扫描 zero-ref 文件做清理。UX 变化：刚解除最后一个引用后，文件不会立刻消失（但也不再占业务列表）

推荐**选项 2**，理由：

- 删除操作原子性：业务侧只管 file_ref，不需要跨表 trigger
- 抗误删：短时间内重新引用该文件不会 fail（比如 "undo" 删除一条 message 时）
- 与 internal `trashedAt` 软删的哲学一致（延迟、可逆）；external 虽然没有软删状态，但延迟 orphan 清理仍然提供"重新引用不失败"的好处

#### 2.3.11 UI 变化

`FilesPage` 当前"按 count 排序"提供的价值是"**热门文件置顶**"。v2 走 **DataApi `includeRefCount`**（纯 SQL 聚合）：

```typescript
useQuery(fileApi.listEntries, {
  includeRefCount: true,
  includeDangling: true, // 同一次查询顺带拿 dangling 状态
  sortBy: "refCount",
  sortOrder: "desc",
});
// entry.refCount / entry.dangling 直接可用
```

DataApi 允许只读幂等副作用，所以 refCount（纯 SQL 聚合）和 dangling（DanglingCache + cache miss 时的 fs.stat）都可以作为 opt-in 字段。消费者一次 query 拿齐。

`FileList` 的 "$N 引用" 展示：保留此信息对用户有价值（知道哪些文件是被大量复用的），走同一个 `includeRefCount` 参数。

**建议**：`FilesPage` 默认开启 `includeRefCount` 保留现有排序 UX；`includeDangling` 开启后失效文件 UI 可加失效标记。查询成本由 DataApi 聚合 + DanglingCache 命中率决定，冷启动首次 list 可能有 N 次 stat（Promise.all 并行通常 <100ms）。

#### 2.3.12 执行时机

**此字段迁移强绑定域级迁移**，不能独立小 PR 完成（不像 `purpose`）：

- B1-B6 需要 file_ref 表 + FileManager + fileRefService 都就绪（Phase 2 尾部）
- B7-B8 依赖 Messages 域迁移（Batch E）完成——因为 `FileAction.handleDelete` 手动扫 `message_blocks` 的逻辑在 Batch E 中会被重写
- C1-C4 在 Phase 6 Cleanup

因此 `count` 字段的完整退役**贯穿 Phase 2 到 Phase 6**，无独立时间点。

#### 2.3.13 风险

| 风险                                                   | 缓解                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| FileMigrator 扫 ref 遗漏某源 → post-migration 孤儿文件 | 保守策略：migrator 失败就不删旧 Dexie `files` 表；OrphanRefScanner 延迟启用     |
| Paintings 迁移延后导致 painting 引用的文件被误删       | `sourceType='painting'` checker 查 PaintingState，painting 迁移前不清理这类引用 |
| "零 ref 自动删除"UX 变化用户不接受                     | 选项 2 + "最近解除引用"的 Trash 视图补偿；如反馈强烈可做选项 1                  |
| FilesPage count 排序是否用户常用？未调研               | 先保留 `includeRefCount` 能力；用户反馈驱动是否改默认                           |

### 2.4 `tokens?` 字段

**结论**：这是一个**100% 死字段**——从未写入、从未读取。直接删除，零功能影响。

#### 2.4.1 现状

**生产方**：**0 个**

- `src/main/services/FileStorage.ts` 所有 setter 都不写 `tokens`
- `src/renderer/src/services/FileManager.ts` 的 addFile / uploadFile / addBase64File 都不写
- `src/main/utils/file.ts` 不写
- 任何 `MistralPreprocessProvider` / `VideoPopup` / `KnowledgeFiles.tsx` 的字面量构造都没有 `tokens:` 赋值

**消费方**：**0 个**

- `src/renderer/src/services/TokenService.ts` 的 `estimateImageTokens(file)` 用的是 `file.size / 100`，不读 `file.tokens`
- `estimateTextTokens(text)` 直接从文本内容算（`tokenx` lib），不碰 FileMetadata
- UI 没有任何位置展示 `file.tokens`
- 业务逻辑没有任何地方读 `file.tokens`

**Dexie schema**：`src/renderer/src/databases/index.ts` v1-v10 的 `files: 'id, name, origin_name, path, size, ext, type, created_at, count'` **没有 tokens 索引**

**Migration 校验**：`KnowledgeMappings.hasCompleteFileMetadata` 不检查 `tokens`（可选字段，不参与 completeness 判断）

**Schema 化石**：

- `packages/shared/data/types/file/file.ts:27` — `tokens?: number`
- `src/renderer/src/types/file.ts:123` — `tokens?: number`
- `packages/shared/data/types/knowledge.ts:52` — `tokens: z.number().optional()` 在 `FileMetadataSchema` 里

#### 2.4.2 迁移目标

v2 **FileEntry 不保留此字段**。token 估算是 TokenService 的职责（消息构造期临时计算），不是文件的属性——这和 `purpose` 同样的设计原则。

#### 2.4.3 迁移步骤

**独立小 PR，纯删除**：

| #   | 文件                                         | 改动                                                              |
| --- | -------------------------------------------- | ----------------------------------------------------------------- |
| 1   | `packages/shared/data/types/file/file.ts:27` | 删除 `tokens?: number`                                            |
| 2   | `src/renderer/src/types/file.ts:123`         | 删除 `tokens?: number`                                            |
| 3   | `packages/shared/data/types/knowledge.ts:52` | 从 `FileMetadataSchema` 中删除 `tokens: z.number().optional()` 行 |

**完。** 无 adapter 改动，无 UI 改动，无业务逻辑改动。

#### 2.4.4 未来是否需要缓存 token 估算

**不需要在 FileEntry 上挂字段**。如果未来 TokenService 发现 `estimateTextTokens` 对大文件开销大，可以：

- 内存缓存：`Map<contentHash, number>` — content hash 作为 key（已经由 `ops.contentHash` 提供），避免相同内容重复算
- 持久化缓存（如需）：独立小表 `token_estimate_cache`，和 FileEntry 表解耦

这不是 Phase 1a 范围。先删掉现有 schema 上的死字段，有需要再按实际 profiling 数据加缓存。

#### 2.4.5 执行时机

**独立 PR，随时可做**。建议和 `purpose` 字段退役一起打包：`refactor(file): drop unused FileMetadata.tokens and .purpose fields`（2-3 个文件改动，纯删）。

#### 2.4.6 风险

**几乎零风险**。唯一可能的"惊喜"是外部消费方（非主项目代码）读了这个字段——但本仓的 FileMetadata 不作为公开 API 导出，所以这不是问题。

### 2.5 `type: FileType` 字段

**定性**：`type: 'image' | 'video' | 'audio' | 'text' | 'document' | 'other'` 从**持久化字段**变为**动态推导**。主路径：`getFileType(ext)` 按扩展名映射；冷路径：`isTextFile(path)` buffer 探测升级 OTHER → TEXT。

#### 2.5.1 现状

**生产方（FileStorage 的核心逻辑）**：

`src/main/services/FileStorage.ts:237-242` —— 双层推导：

```typescript
public getFileType = async (filePath: string): Promise<FileType> => {
  const ext = path.extname(filePath)
  const fileType = getFileTypeByExt(ext)
  return fileType === FILE_TYPE.OTHER && (await this._isTextFile(filePath))
    ? FILE_TYPE.TEXT
    : fileType
}
```

- **Ext 派生**：`src/main/utils/file.ts:106` `getFileType(ext)` → 查 `fileTypeMap`（纯函数）。映射表见 file.ts:20-28 的 `imageExts / videoExts / audioExts / textExts / documentExts`
- **Buffer 升级**：`FileStorage._isTextFile(filePath)` 用 `chardet` + `isbinaryfile` 探测（FS 副作用，读文件头 sample）。仅在 ext 归 OTHER 时触发，把"未知扩展名但内容是文本"的文件升级为 TEXT

**所有 FileMetadata setter 同时写 type**（连同 count: 1 等字段一起构造）：

- `FileStorage.ts:227, 273, 340, 365, 705, 755, 1552` —— 各上传 / 保存入口
- `src/main/utils/file.ts:136-145` —— `getAllFiles` 目录扫描（`getFileType(ext)` 派生，无 buffer 升级）
- `src/renderer/src/components/Popups/VideoPopup.tsx:110` —— 字面量硬编码 VIDEO
- `src/renderer/src/pages/knowledge/items/KnowledgeFiles.tsx:113` —— 字面量构造
- `src/main/knowledge/preprocess/MistralPreprocessProvider.ts:185` —— 预处理产物构造

**Dexie schema**：`files: 'id, name, origin_name, path, size, ext, type, created_at, count'` —— **`type` 是索引字段**，支持 `.where('type').equals(...)` 查询

**v2 占位**：`src/main/file/ops/metadata.ts` 已经保留 `getFileType(path) / isTextFile(path) / mimeToExt(mime)` 三个函数签名，目前 `throw new Error('Not implemented')`

#### 2.5.2 消费方（32 个文件，按类别）

**A. Dexie SQL query（1 个关键点，必须迁移）**：

| 位置                                            | 消费方式                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/pages/files/FilesPage.tsx:54` | `db.files.where('type').equals(fileType).sortBy('count')` —— 按类型过滤 + count 排序，是 FilesPage 左侧栏的核心 query |

**B. UI 分派 by type（大量，按 type 分支）**：

| 位置                                                                                  | 关键分支                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/renderer/src/services/TokenService.ts:22, 96, 129`                               | `TEXT` → 读文本内容估 token；`IMAGE` → 按 size/100 估 token                             |
| `src/renderer/src/services/MessagesService.ts:145`                                    | `IMAGE` → image block；else → file block                                                |
| `src/renderer/src/aiCore/prepareParams/fileProcessor.ts:28, 56, 69, 207, 244, 271`    | 按 `TEXT / DOCUMENT / IMAGE` 派生 AI SDK FilePart 的不同构造（内联文本 / base64 / URL） |
| `src/renderer/src/aiCore/prepareParams/modelCapabilities.ts`                          | 模型能力匹配（支持图像、文档等）                                                        |
| `src/renderer/src/pages/home/Inputbar/context/InputbarToolsProvider.tsx:176`          | `files.some(f => f.type === IMAGE)` —— 决定能否 mention non-vision 模型                 |
| `src/renderer/src/pages/home/Inputbar/tools/components/useMentionModelsPanel.tsx:103` | 同上                                                                                    |
| `src/renderer/src/pages/home/Messages/MessageEditor.tsx:214`                          | `IMAGE` 走不同编辑逻辑                                                                  |
| `src/renderer/src/pages/home/Messages/MessageAttachments.tsx:47`                      | `type === undefined` 时跳过渲染                                                         |
| `src/renderer/src/pages/knowledge/items/KnowledgeVideos.tsx:112`                      | 筛选 `VIDEO`                                                                            |
| `src/renderer/src/utils/messageUtils/create.ts:108, 185`                              | IMAGE / 非 IMAGE 构造不同消息 block                                                     |
| `src/renderer/src/hooks/useAttachment.ts`                                             | 附件展示分类                                                                            |

**C. 类型守卫**：

- `src/renderer/src/types/file.ts:140` `isImageFileMetadata(file) => file.type === FILE_TYPE.IMAGE`

**D. Dexie upgrade migrator**：

- `src/renderer/src/databases/upgrades.ts:188` —— 历史 Dexie 升级脚本用 `file.type === IMAGE`

**E. Migration 校验**：

- `KnowledgeMappings.hasCompleteFileMetadata` 要求 `typeof value.type === 'string'`

#### 2.5.3 v2 映射

**v2 FileEntry schema 已经没有 `type` 列**（`src/main/data/db/schemas/file.ts` 确认）。迁移方案：

**Ext 派生（默认路径）**：

- `getFileType(ext)` 逻辑从 `src/main/utils/file.ts` 搬到 `packages/shared/file/types/` 或类似 shared 位置，renderer 和 main 都可用
- `src/main/file/ops/metadata.ts` 的 `getFileType(path)` 实现：从 path 提取 ext → 调 shared 的 `getFileType(ext)`
- 零 FS IO

**Buffer 升级（保留但收窄）**：

- `src/main/file/ops/metadata.ts` 的 `isTextFile(path)` 实现：复用 `chardet` + `isbinaryfile` 逻辑
- **只在 `FileManager.getMetadata(handle)` 时触发**——打开文件 / 预览 / 处理路径上；**list 查询不触发**
- 旧 FileStorage 在**创建**时做 buffer 升级；v2 在**读取时**做。语义微调：文件的 type 不再是"持久化属性"而是"每次 getMetadata 现算的派生"

#### 2.5.4 DataApi 的 type filter 与 includeType

`FilesPage` 的 `where('type').equals(...)` 必须有 DataApi 对应：

**方案**：DataApi query 支持 `type` 过滤 + `includeType` opt-in 字段：

```typescript
// DataApi handler（概念代码）
async function listEntries(query) {
  const extFilter = query.type ? extsOf(query.type) : null;
  const rows = await db
    .select()
    .from(fileEntry)
    .where(extFilter ? inArray(fileEntry.ext, extFilter) : undefined);

  if (query.includeType) {
    return rows.map((r) => ({ ...r, type: getFileType(r.ext) })); // ext → type 派生
  }
  return rows;
}
```

DataApi schema 改动（叠加在 §3.1 现有 `includeRefCount` / `includeDangling` 上）：

```typescript
'/files/entries': {
  GET: {
    query: {
      ...
      type?: FileType              // 按 type 过滤（handler 转成 ext 枚举）
      includeType?: boolean        // response 附加 type 派生字段
      sortBy?: ... | 'type'         // 可选：按 type 排序（字母序）
    }
  }
}
```

**优点**：

- 和 `includeRefCount` / `includeDangling` 对称设计，一致的 opt-in 模式
- 纯 SQL（`WHERE ext IN (...)`），无副作用
- 不需要物化派生列，不需要 SQLite generated column 特性

**代价**：

- list 查询拿不到 buffer-upgraded TEXT（OTHER 的自定义文本扩展名仍显示为 OTHER）
- 用户体验微降：某些历史 .log/.ini 类文件若无 ext 派生规则覆盖，列表里是 OTHER。用户实际使用（打开、send to chat）时 getMetadata 会给出正确 TEXT

#### 2.5.5 迁移步骤

**Step A: shared `getFileType` 提取**（独立小 PR）

| #   | 文件                                           | 改动                                                                                                            |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A1  | `packages/shared/file/types/fileType.ts`（新） | 把 `fileTypeMap` 和 `getFileType(ext)` 从 `src/main/utils/file.ts` 搬过来；导出给 main / renderer / shared 共用 |
| A2  | `src/main/utils/file.ts:106`                   | re-export shared 版本                                                                                           |
| A3  | `src/main/file/ops/metadata.ts`                | 实现 `getFileType(path)` 和 `isTextFile(path)`（搬 FileStorage.\_isTextFile 逻辑）                              |

**Step B: DataApi 加 type 支持**

| #   | 文件                                                            | 改动                                                                                                           |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| B1  | `packages/shared/data/api/schemas/files.ts`                     | query 加 `type?: FileType` + `includeType?: boolean`；response type 加 `type?: FileType` opt-in 字段           |
| B2  | DataApi handler（`src/main/data/api/handlers/files.ts` 或类似） | 实现 `type` 过滤 → `ext IN (...)`；实现 `includeType` → `map(row => ({ ...row, type: getFileType(row.ext) }))` |

**Step C: FileManager IPC `getMetadata` 升级**

| #   | 文件                                   | 改动                                                                  |
| --- | -------------------------------------- | --------------------------------------------------------------------- |
| C1  | `packages/shared/file/types/common.ts` | 确认 `PhysicalFileMetadata.type` 字段语义（含 buffer 升级）           |
| C2  | `src/main/file/FileManager.ts` + 实现  | `getMetadata(handle)` 返回的 `type` 先 ext 派生，OTHER 时 buffer 升级 |

**Step D: 消费者改造**（30+ 文件）

按子系统分批：

| 批次                 | 文件                                                                                                | 改造模式                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| D1 AI Core           | `aiCore/prepareParams/fileProcessor.ts`, `modelCapabilities.ts`                                     | `entry.type === ...` → `getFileType(entry.ext) === ...`；如需 buffer 升级的场景（TEXT detection）改调 `FileManager.getMetadata` |
| D2 Messages          | `MessagesService.ts`, `utils/messageUtils/create.ts`, `MessageEditor.tsx`, `MessageAttachments.tsx` | 同上，主要是纯替换                                                                                                              |
| D3 Token             | `TokenService.ts` (line 22 / 96 / 129)                                                              | `file.type === TEXT` → `getFileType(file.ext) === TEXT`；调 `window.api.file.read` 读文本前可以先 `getMetadata` 拿准确 type     |
| D4 Input/Attachments | `InputbarToolsProvider.tsx`, `useMentionModelsPanel.tsx`, `useAttachment.ts`                        | 纯替换                                                                                                                          |
| D5 Knowledge         | `KnowledgeVideos.tsx` + `KnowledgeFiles.tsx`                                                        | 筛选用 ext 派生；构造字面量的位置停止写 `type`                                                                                  |
| D6 FilesPage         | `FilesPage.tsx:54`                                                                                  | `db.files.where('type')` → DataApi `type` query param                                                                           |
| D7 Type guard        | `src/renderer/src/types/file.ts:140` `isImageFileMetadata`                                          | 改签名接 FileEntry：`(entry) => getFileType(entry.ext) === IMAGE`                                                               |

**Step E: Producer 改造（停止写入 type）**

| #   | 文件                                                                               | 改动                                                                                        |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| E1  | `FileStorage.ts` 所有 setter（:227, 273, 340, 365, 705, 755, 1552）                | v2 创建 FileEntry 时不写 type（schema 已无此列）；旧 FileMetadata 构造期间仍写（shim 兼容） |
| E2  | `VideoPopup.tsx:110`, `KnowledgeFiles.tsx:113`, `MistralPreprocessProvider.ts:185` | 字面量停止写 type                                                                           |
| E3  | `getAllFiles` / 类似枚举目录返回 FileMetadata 的 utils                             | 停止写 type                                                                                 |

**Step F: Schema 清理**

| #   | 文件                                         | 改动                                                                                                                      |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| F1  | `src/renderer/src/databases/index.ts` v11+   | files 索引去掉 `type`（Dexie 升级）                                                                                       |
| F2  | `packages/shared/data/types/file/file.ts:22` | `FileMetadata.type` 删除                                                                                                  |
| F3  | `src/renderer/src/types/file.ts:111`         | 同上                                                                                                                      |
| F4  | `src/renderer/src/databases/upgrades.ts:188` | 旧 Dexie 升级脚本用 `file.type === IMAGE`，保留（历史 script，不执行）或改为 `getFileType(file.ext) === IMAGE`            |
| F5  | `packages/shared/data/types/knowledge.ts:49` | `FileMetadataSchema.type` 删除（注意 knowledge domain 会改 schema 形状，如用 Zod strip 默认行为，旧数据 type 字段被忽略） |
| F6  | `KnowledgeMappings.hasCompleteFileMetadata`  | `typeof value.type === 'string'` 检查删除                                                                                 |

#### 2.5.6 Buffer 升级的未决点

旧 `_isTextFile` 在**创建**时触发 upgrade；v2 改为 `getMetadata` 在**读取**时触发。这个语义变更的影响：

| 场景                                        | 旧行为                                                       | v2 行为                                                                         | 评估                                                                    |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 用户上传 `foo.log`（.log 不在 textExts 中） | FileStorage.getFileType → OTHER → buffer 升级 TEXT → 存 TEXT | 上传时只存 ext 不存 type；list 展示为 OTHER；打开预览时 getMetadata 升级为 TEXT | 有 UX 微降：列表里是 OTHER 但预览能打开                                 |
| TokenService 对 OTHER 文件估 token          | `file.type === TEXT` 不匹配 → 当图片处理（size/100，错！）   | 同样的问题——除非 TokenService 先调 getMetadata                                  | **注意**：这里旧行为就有 bug，v2 需要先 getMetadata（值得加 test 覆盖） |
| aiCore 对 OTHER 文件处理                    | `file.type === TEXT / DOCUMENT` 不匹配 → 跳过（不内联文本）  | 同                                                                              | 无变化                                                                  |

**建议**：

- 确认 `textExts` 列表足够覆盖常见文本扩展名（目前 .txt/.md/.html/.json/.js/.ts/.css/.py 等）
- 在扩展名表里补充 `.log`、`.ini`、`.cfg`、`.yaml`、`.yml`、`.toml` 等"配置/日志"类常见文本
- 剩余罕见 ext 接受 list 显示 OTHER 的降级，打开时 getMetadata 升级

#### 2.5.7 复杂度与执行时机

| 维度       | 评估                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 触达文件数 | 32 + schema 3                                                                                                                |
| 改造性质   | 多数是"表达式替换"（`entry.type === X` → `getFileType(entry.ext) === X`），少量有逻辑调整（getMetadata 调用、DataApi query） |
| 最难点     | FilesPage Dexie filter 迁移 + TokenService 的 buffer 升级调用                                                                |
| **复杂度** | **L**                                                                                                                        |

**建议拆分**：

- PR1: Step A shared `getFileType` + `ops.getFileType` + `ops.isTextFile` 实现（独立基础设施）
- PR2: Step B DataApi `type` / `includeType`（独立 API 扩展）
- PR3: Step C `getMetadata` buffer 升级（独立 IPC 扩展）
- PR4-PR9: Step D 消费者迁移（按子系统 D1-D7 分 PR）
- PR10: Step E + F cleanup

#### 2.5.8 风险

| 风险                                                | 缓解                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| FilesPage 左侧栏按 type 筛选失效                    | PR2 DataApi 必须在 PR6(D6) 前 merge                                                 |
| TokenService 对 "未知 ext 但实际文本"的文件估算错误 | 在 D3 里对 TEXT detection 加调 getMetadata 一步；单测覆盖                           |
| Dexie upgrade script 引用 `file.type`               | upgrade script 是历史代码；保留原状不执行即可（v2 migration 不回走 Dexie 升级路径） |
| Buffer 升级 regression                              | 测试覆盖几种典型：`.log` 上升为 TEXT、`.bin` 不升级、大文件 sample size 合理        |

#### 2.5.9 执行时机

大部分改动需要 v2 FileManager / DataApi 基础设施就绪。基础 PR（A/B/C）可以在 Phase 2 完成，消费者迁移（D）贯穿 Phase 4 各 Batch，Schema 清理（F）在 Phase 6。

### 2.6 `path` 字段

**定性**：`path` 是最深的单一依赖。但调研显示**旧架构里 path 事实上已经是派生字段**——DB 里的 path 列在每次读取时被覆盖，真实 SoT 是 `id + ext + userData` 的运行时拼接。v2 只需要把"约定式派生"变成"显式 API 派生"。

#### 2.6.1 现状的意外发现

`src/renderer/src/services/FileManager.ts:80-89` 的 `getFile(id)`：

```typescript
static async getFile(id: string): Promise<FileMetadata | undefined> {
  const file = await db.files.get(id)
  if (file) {
    const filesPath = cacheService.get('app.path.files') ?? ''
    file.path = filesPath + '/' + file.id + file.ext   // 🔑 读出来就覆盖
  }
  return file
}
```

Dexie `files` 表虽然有 `path` 列（`'id, name, origin_name, path, size, ext, type, created_at, count'`），但**每次读出来 renderer 都覆盖为运行时计算值**。也就是：

- **存储的 path 是死数据**（旧值不会被消费，除非绕过 getFile 直接 db.files.get）
- **真正的 path 计算永远是**：`{userData/files}/{id}{ext}`（internal）
- `FileManager.getFilePath(file)` 和 `FileManager.getSafePath(file)` 在此基础上各自包装

所以迁移不是"引入 path resolution"，而是"**把隐式约定变成显式 API**"——v2 FileEntry 不存 path 列（`src/main/data/db/schemas/file.ts` 已确认），消费者显式通过 helper / IPC 拿 path。

#### 2.6.2 两层访问器

| 访问器                          | 位置                                           | 语义                                                                                               |
| ------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `FileManager.getFilePath(file)` | `src/renderer/src/services/FileManager.ts:91`  | 原始计算路径：`{filesPath}/{id}{ext}`                                                              |
| `FileManager.getSafePath(file)` | `src/renderer/src/services/FileManager.ts:140` | **危险文件防护**：对 `.sh/.bat/.cmd/.ps1/.vbs/reg` 返回 dirname 而非 file，避免 `file://` 误点执行 |
| `FileManager.getFileUrl(file)`  | `src/renderer/src/services/FileManager.ts:146` | 返回 `file://{filesPath}/{file.name}` —— 注意用的是 `file.name`（存储名 = `id+ext`），历史遗留     |

**`getSafePath` 的危险文件防护必须在 v2 保留**——否则 `<img src="file://...sh">` 可能导致用户通过预览触发 shell 脚本。

#### 2.6.3 消费方分类（~20 个文件）

**C1. `file://` URL 用于 UI 展示**（3 个，高频）：

| 位置                                                                  | 用途                          |
| --------------------------------------------------------------------- | ----------------------------- |
| `src/renderer/src/pages/home/Inputbar/AttachmentPreview.tsx:109, 112` | 鼠标悬停附件 tooltip 图片预览 |
| `src/renderer/src/pages/home/Messages/MessageAttachments.tsx:39`      | 消息内附件图片                |
| `src/renderer/src/pages/home/Messages/Blocks/ImageBlock.tsx:22`       | 行内图片 block 渲染           |

这些都是同步拿 `file://` URL 渲染 `<img>`。**不能改成 async IPC**（大列表下 async 会产生大量 waterfall 延迟）。

**C2. 系统级 open / reveal**（3 个）：

| 位置                                                                 | 操作                             |
| -------------------------------------------------------------------- | -------------------------------- |
| `src/renderer/src/pages/files/FilesPage.tsx:105`                     | `openPath(getFilePath(file))`    |
| `src/renderer/src/hooks/useAttachment.ts:26`                         | 非文本 → `openPath(path)`        |
| `src/renderer/src/pages/home/Inputbar/AttachmentPreview.tsx:127-129` | 点击文件名 → preview 或 openPath |

可以改为 `FileManager.open(handle)` IPC（已在 `packages/shared/file/types/ipc.ts` 定义）。

**C3. FS 内容读取**（4 个）：

| 位置                                                                   | 操作                                       |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| `src/renderer/src/pages/translate/TranslatePage.tsx:501, 528, 531`     | `isTextFile` / `readExternal` / `readText` |
| `src/renderer/src/pages/home/Inputbar/AttachmentPreview.tsx:159`       | `isTextFile(path)`                         |
| `src/renderer/src/pages/home/Inputbar/components/InputbarCore.tsx:465` | `readExternal(path, true)` 读内联 txt      |
| `src/renderer/src/utils/file.ts:113`                                   | `isSupportedFile(path, extensionSet)`      |

可以改为 `FileManager.read(handle)` 或 `FileManager.getMetadata(handle)`（已定义）。

**C4. 系统路径 interop**（2 个）：

| 位置                                                                    | 操作                                                                                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx:395` | `files.map(f => f.path).join('\n')` 作为消息文本传给 agent                                                                                    |
| `src/renderer/src/services/NotesService.ts:191-193`                     | 收集 path 上传 —— **注意**：这里是 Electron 扩展的 `File.path`（浏览器 File 对象 + `.path` 属性），**不是 FileMetadata.path**。和本次迁移无关 |

C4 的 AgentSessionInputbar 是真的需要 FileMetadata.path，因为 agent 的上下文里要让 LLM 看到本地路径。

**C5. Path 派生信息**（可直接用 ext）：

| 位置                                                            | 操作                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| `src/renderer/src/pages/translate/TranslatePage.tsx:492`        | `getFileExtension(file.path)` —— 但 `file.ext` 已经有  |
| `src/renderer/src/components/ObsidianExportDialog.tsx:110, 289` | fullPath 作为 key，`files.find(f => f.path === value)` |

**C6. OCR / 第三方库（main 侧）**（5 个）：

| 位置                                                              | 操作                      |
| ----------------------------------------------------------------- | ------------------------- |
| `src/renderer/src/services/ocr/OcrService.ts:17`                  | log                       |
| `src/renderer/src/services/ocr/clients/OcrExampleApiClient.ts:13` | example                   |
| `src/main/services/ocr/builtin/TesseractService.ts:74`            | `fs.stat(path)`           |
| `src/main/services/ocr/builtin/OvOcrService.ts:123`               | `ocrImage(path, options)` |
| `src/main/utils/ocr.ts:27`                                        | `readFile(file.path)`     |

第三方 OCR 库只能接受路径参数——这是 `FileManager.withTempCopy(handle, fn)` 的经典场景（已在 IPC 定义）。

**C7. Main 侧 knowledge readers**（3 个）：

| 位置                                                                   | 操作                         |
| ---------------------------------------------------------------------- | ---------------------------- |
| `src/main/services/knowledge/readers/KnowledgeFileReader.ts:16, 40-45` | `reader.loadData(file.path)` |
| `src/main/knowledge/embedjs/loader/index.ts:60, 78`                    | `filePath: file.path`        |
| `src/main/knowledge/preprocess/PreprocessingService.ts:24, 29`         | log                          |

Main 侧消费者可以直接用 main 的 `resolvePhysicalPath(entry)`（`src/main/data/utils/pathResolver.ts`），无需 IPC。

#### 2.6.4 v2 映射策略

**不引入新 IPC**。现有 File IPC 已经覆盖所有需求：

| 旧 renderer 代码                            | v2 替代                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `'file://' + FileManager.getSafePath(file)` | 新 renderer helper `entryToFileUrl(entry)` —— 同步拼接                                  |
| `FileManager.getFilePath(file)`             | 新 renderer helper `entryToAbsolutePath(entry)` —— 同步拼接                             |
| `window.api.file.openPath(path)`            | `window.api.fileIpc.open(createManagedHandle(entry.id))`                                |
| `window.api.file.isTextFile(path)`          | `window.api.fileIpc.getMetadata(handle)` 返回 type（含 buffer 升级）                    |
| `window.api.file.readText(path)`            | `window.api.fileIpc.read(handle, { encoding: 'text' })`                                 |
| `window.api.file.readExternal(path, true)`  | `window.api.fileIpc.read(handle, { encoding: 'text' })` —— unmanaged handle 走 ops 直读 |
| `getFileExtension(file.path)`               | `file.ext`                                                                              |
| OCR `thirdPartyLib(file.path)`              | `fileManager.withTempCopy(entryId, path => thirdPartyLib(path))`                        |

#### 2.6.5 Path resolution 通过 DataApi 统一提供

**原则**：Renderer **不知道**内部存储布局（`{id}.{ext}` 拼接方式、userData 路径）。所有 path 来源归到 main 的 `resolvePhysicalPath(entry)`，通过 **DataApi 的 opt-in 字段**暴露给 renderer。

两个 opt-in 字段覆盖所有 renderer 需要 path 的场景：

| Opt-in            | 返回形态                             | 服务场景                                                        |
| ----------------- | ------------------------------------ | --------------------------------------------------------------- |
| **`includePath`** | 原始绝对路径字符串                   | C4 agent 上下文、drag-drop、subprocess spawn 等需要 path 的场景 |
| **`includeUrl`**  | `file://` URL + 危险文件 safety wrap | C1 `<img src>` / `<video src>` 显示                             |

**DataApi schema 新增字段**：

```typescript
// packages/shared/data/api/schemas/files.ts
'/files/entries': {
  GET: {
    query: {
      ...
      includePath?: boolean   // opt-in: 附加绝对路径
      includeUrl?: boolean    // opt-in: 附加 file:// URL，危险文件走 safety wrap
    }
    response: OffsetPaginationResponse<FileEntryView>
    // FileEntryView.path?: FilePath
    // FileEntryView.url?: FileURLString
  }
}
```

Handler 实现：

```typescript
// 每条 entry 经过 main 的统一路径解析
const path = includePath ? resolvePhysicalPath(entry) : undefined;
const url = includeUrl ? "file://" + resolveSafeUrl(entry) : undefined;
```

**Main 侧基础函数**：

```typescript
// src/main/data/utils/pathResolver.ts (existing)
export function resolvePhysicalPath(entry): string { ... }  // 绝对路径

// 新增：带 safety 的 URL 包装
export function resolveSafeUrl(entry): string {
  const abs = resolvePhysicalPath(entry)
  return isDangerExt(entry.ext) ? dirname(abs) : abs
}
```

**为什么不需要单独的 IPC `resolvePath(handle)` 方法**：

| 场景                     | 以为需要 IPC | 实际                                                    | 结论    |
| ------------------------ | ------------ | ------------------------------------------------------- | ------- |
| Agent compose 需要路径   | ✅           | `useQuery({ ids, includePath: true })` 天然 batch       | DataApi |
| Drag-drop 拖出 Cherry    | ✅           | 同上（已有 entry 列表）                                 | DataApi |
| Unmanaged handle 查 path | ✅           | 调用方本来就持有 path（unmanaged 的定义就是"外部路径"） | 无需查  |
| 单条 entry 查 path       | ✅           | `useQuery(getEntry, { id, includePath: true })`         | DataApi |

所有场景都可以归到 DataApi。单独的 IPC `resolvePath` 没有不可替代的价值——**不引入**。

**收益**（相比 renderer helper 方案）：

| 维度                                  | Renderer helper（作废）  | DataApi 统一方案（本方案）        |
| ------------------------------------- | ------------------------ | --------------------------------- |
| Renderer 知晓存储布局                 | ✅ 是                    | ❌ 否                             |
| Main 改存储格式（如 subdir sharding） | renderer 需同步改        | renderer 无感                     |
| 危险文件 safety 责任                  | 重复在 renderer          | 集中在 main                       |
| Null byte 安全检查                    | renderer 需补            | `resolvePhysicalPath` 已有        |
| C1 性能                               | 同步 O(1) 拼接           | 同步（随 query 返回，无额外 IPC） |
| C4 性能                               | 同步                     | 同步（随 query 返回）             |
| API 表面                              | renderer 新 service 文件 | DataApi 两个 opt-in 字段          |

Renderer helper 方案已作废。

#### 2.6.6 迁移步骤

**Step A: Path resolution 基础设施**（独立 PR）

| #   | 文件                                        | 改动                                                                                                                                |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `src/main/data/utils/pathResolver.ts`       | 已有 `resolvePhysicalPath(entry)`；**新增** `resolveSafeUrl(entry)`（危险文件 → dirname wrap）+ `isDangerExt(ext)` helper           |
| A2  | `packages/shared/data/api/schemas/files.ts` | query 加 `includePath?: boolean` + `includeUrl?: boolean`；`FileEntryView` 加 `path?: FilePath` + `url?: FileURLString` 字段（branded，Phase 1a C3 收紧）         |
| A3  | DataApi handler（entry 查询）               | `includePath` → 每条 entry 调 `resolvePhysicalPath(entry)`；`includeUrl` → 每条调 `resolveSafeUrl(entry)` 并 `'file://' + ...` 包装 |

**Step B: C1 显示 URL 迁移**

| #   | 文件                                  | 改动                                                                                    |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| B1  | `AttachmentPreview.tsx:109, 112, 127` | `'file://' + FileManager.getSafePath(file)` → query 带 `includeUrl:true` 拿 `entry.url` |
| B2  | `MessageAttachments.tsx:39`           | 同上                                                                                    |
| B3  | `ImageBlock.tsx:22`                   | 同上                                                                                    |

所有 C1 消费者的上游 query（useQuery / useLiveQuery 等）需要传 `includeUrl: true`。

**Step C: C2 open/reveal 迁移**

| #   | 文件                            | 改动                                                                                                                |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| C1  | `FilesPage.tsx:105`             | `window.api.file.openPath(FileManager.getFilePath(file))` → `window.api.fileIpc.open({ kind: 'managed', entryId })` |
| C2  | `useAttachment.ts:26`           | 同上                                                                                                                |
| C3  | `AttachmentPreview.tsx:127-129` | `preview(path, name, type, ext)` → 改 preview 签名接 FileEntry 或 handle                                            |

**Step D: C3 FS 内容读取迁移**

| #   | 文件                              | 改动                                                                                                                             |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `TranslatePage.tsx:501, 528, 531` | 所有 `isTextFile(path)` / `readExternal(path, true)` / `readText(path)` → `fileIpc.getMetadata(handle)` / `fileIpc.read(handle)` |
| D2  | `AttachmentPreview.tsx:159`       | `isTextFile(file.path)` → `fileIpc.getMetadata(handle)`                                                                          |
| D3  | `InputbarCore.tsx:465`            | `readExternal(targetPath, true)` → `fileIpc.read(handle)`                                                                        |
| D4  | `utils/file.ts:113`               | `isSupportedFile(file.path, ...)` → 改签名接 ext（`isSupportedFileExt(ext, ...)`），因为真正只需要 ext                           |

**Step E: C4 Agent 上下文**

| #   | 文件                           | 改动                                                                                             |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| E1  | `AgentSessionInputbar.tsx:395` | `files.map(f => f.path)` → DataApi query 带 `includePath: true`，直接 `entries.map(e => e.path)` |

**Step F: C5 Path 派生消除**

| #   | 文件                                | 改动                                                             |
| --- | ----------------------------------- | ---------------------------------------------------------------- |
| F1  | `TranslatePage.tsx:492`             | `getFileExtension(file.path)` → `file.ext`                       |
| F2  | `ObsidianExportDialog.tsx:110, 289` | 用 `entry.id` 或 `entry.name` 作为 key，不再依赖 path 字符串匹配 |

**Step G: C6 OCR 第三方库迁移（main 侧）**

| #   | 文件                                                                            | 改动                                                                         |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| G1  | `src/main/services/ocr/builtin/TesseractService.ts:74`                          | 通过 `fileManager.withTempCopy(entryId, path => ocrLogic(path))` 隔离        |
| G2  | `src/main/services/ocr/builtin/OvOcrService.ts:123`                             | 同上                                                                         |
| G3  | `src/renderer/src/services/ocr/OcrService.ts:17` 和 `OcrExampleApiClient.ts:13` | log / example，非关键路径，直接传 entry                                      |
| G4  | `src/main/utils/ocr.ts:27`                                                      | `readFile(file.path)` → 接收 FileEntry，通过 `resolvePhysicalPath(entry)` 读 |

**Step H: C7 Main 侧 knowledge readers**

| #   | 文件                                       | 改动                                                    |
| --- | ------------------------------------------ | ------------------------------------------------------- |
| H1  | `KnowledgeFileReader.ts:16, 40-45`         | `file.path` → `resolvePhysicalPath(entry)`（main 直调） |
| H2  | `knowledge/embedjs/loader/index.ts:60, 78` | 同上                                                    |

**Step I: Legacy accessor 移除**

| #   | 文件                                                                                   | 改动                         |
| --- | -------------------------------------------------------------------------------------- | ---------------------------- |
| I1  | `FileManager.getFilePath`, `getSafePath`, `getFileUrl`, `getFile` 的 `file.path = ...` | 全部删除（或留 shim 期过渡） |
| I2  | `FileMetadata.path` 字段                                                               | 最终删除                     |
| I3  | Dexie `files` 索引 `path` 字段                                                         | 删除                         |

#### 2.6.7 `readExternal` 语义（已统一到 `read`）

`window.api.file.readExternal(path, asText)` 是旧 API。v2 **统一到 `FileIpcApi.read(handle)`，不保留别名**：

- 旧 `readExternal(path, true)` → `read({ kind: 'unmanaged', path }, { encoding: 'text' })`
- 上下文已经是 FileEntry 时：`read({ kind: 'managed', entryId }, ...)`

所有调用方**必须替换**（不存在过渡兼容层）。

#### 2.6.8 Agent 的批量 path 查询

C4 的 `AgentSessionInputbar.tsx:395` 当前是 `files.map(f => f.path).join('\n')`——多个文件路径一次拿到。

v2 直接通过 DataApi query 带 `includePath: true` 批量拿：

```typescript
const { data: entries } = useQuery(fileApi.listEntries, {
  ids: selectedFileIds,
  includePath: true,
});
const filePaths = entries.map((e) => e.path).join("\n");
```

**无额外 batch API**——DataApi 本身就是 list 查询，天然 batch。

#### 2.6.9 关键风险

| 风险                                       | 缓解                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **危险文件防护丢失**                       | `entryToSafePath` 必须继承 `isDangerFile` 逻辑；FileManager IPC `open(handle)` 对 danger ext 应该 refuse 或 open dirname                                               |
| **Image render 性能**（C1 大列表）         | Helper 同步拼接，比原 `getSafePath` 还快（无 db.files.get 调用）                                                                                                       |
| **路径字符串作为 key 的代码**（C5 F2）     | Obsidian dialog 等改为用 entry.id 作为 key，避免 path 字符串字面比较                                                                                                   |
| **主 `readExternal` 的调用签名迁移**       | `readExternal` 可以临时保留（别名到 `read({unmanaged,path})`），逐步淘汰                                                                                               |
| **历史 message block 里内嵌 FileMetadata** | ChatMigrator 抽取 `file.id` 建立 file_ref（`sourceType='chat_message'`）；新 message block JSON 只存 `fileEntryId`；渲染时查 FileEntry。**不需要 shim**，见 §2.6.10 Q3 |
| **Drag-drop 出 Cherry 给 OS**              | Electron drag-drop 需要绝对路径；用 `entryToAbsolutePath(entry)` 获取                                                                                                  |

#### 2.6.10 复杂度与执行时机

| 维度       | 评估                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 触达文件数 | ~20 + main side 5                                                                                  |
| 改造性质   | 大多数是"调用 API 替换"，不是数据模型改动                                                          |
| 最大复杂点 | 旧 FileMetadata → FileEntry 的适配层（shim 期）；危险文件防护的迁移；OCR providers 改 withTempCopy |
| **复杂度** | **L–XL**（比 type 重，因为触达了 UI 渲染链路 + main 侧多个子系统）                                 |

**建议拆分 8-10 个 PR**（Step A-I 各一）：

- Step A（helper）和 Step B-F（renderer 消费者）可 Phase 2 起步
- Step G-H（main 侧）依赖 FileManager 实现就绪
- Step I（legacy 清理）Phase 6

#### 2.6.11 关键决策记录

**Q1: `readExternal` 的 IPC 别名** ✅ **已决定**

统一到 `read(handle)`，不保留 `readExternal` 别名。FileHandle 自身区分 managed 和 unmanaged，旧 `readExternal(path, text)` 相当于 `read({ kind: 'unmanaged', path }, { encoding: 'text' })`。

影响：Step D 所有 `readExternal` 调用**必须替换**（不能留过渡别名），配套 `readText` / `isTextFile` 等旧 IPC 也走 `read` / `getMetadata`。

**Q2: 哪些消费路径**真的**需要路径字符串？**

对前述 C1–C7 逐个审查，只有**2 个 renderer 类别**真的需要路径：

| 类别                                                             | 需要 path?                                      | 替代/说明                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| **C1 `file://` URL 显示**（`<img src="file://...">` × 3 个文件） | ✅ **需要**（renderer 直接吃路径字符串）        | `<img>/` `<video>` 只能给 URL；可用 `entryToFileUrl` 同步拼接                        |
| C2 系统 open / reveal                                            | ❌ 不需要                                       | `fileIpc.open(handle)` / `showInFolder(handle)`                                      |
| C3 FS 内容读取                                                   | ❌ 不需要                                       | `fileIpc.read(handle)` / `getMetadata(handle)`                                       |
| **C4 Agent 上下文 embedding**                                    | ✅ **需要**（LLM 要看到本地绝对路径才能调工具） | 需要 path 字符串，但低频（一次 compose），可接受 async IPC 或用 renderer 同步 helper |
| C5 Path 派生信息（ext / basename）                               | ❌ 不需要                                       | 用 `entry.ext` / `entry.name`                                                        |
| C6 OCR 第三方库（main 侧）                                       | ✅ main 内部需要                                | `withTempCopy(entryId, fn)` 给隔离的临时 path；renderer 不接触                       |
| C7 Knowledge reader（main 侧）                                   | ✅ main 内部需要                                | main 直调 `resolvePhysicalPath(entry)`；renderer 不接触                              |

**结论**：**只有 C1 和 C4 两个 renderer 场景真的需要路径字符串**。其中：

- **C1 必须同步**（image render 路径频繁，不能 async）
- **C4 低频**（一次消息构造），async IPC 也可以；但如果 C1 已经要做同步 helper，C4 顺带复用即可

这意味着 renderer 侧的 path helper 是**必要但最小**的：仅为这两个场景存在，不做其他扩展。

**Q3: 历史 message block 里内嵌 FileMetadata 的兼容方式** ✅ **已决定**

**迁移到 file_ref**：历史 message blocks 的 `file: FileMetadata` 字段在 v2 消息模型里不再内嵌文件对象，而是通过 `file_ref` 表建立关系（`sourceType='chat_message'`, `sourceId=messageId`, `fileEntryId=...`, `role='attachment' | 'image'`）。

- FileMigrator / ChatMigrator 在迁移时对每个 MessageBlock 的 `file.id` 建立 file_ref 行
- V2 message block JSON 只存 `fileEntryId: string`（或直接引用），渲染时通过 id 查 FileEntry
- 不需要 shim 反推 path——block JSON 里连 path 都没了

这条和 §2.3（count 用 file_ref 取代）+ RFC §10（FileMigrator 设计）一致。

**Q4: Path 暴露到 renderer 的方式** ✅ **已决定**

**统一通过 DataApi 两个 opt-in 字段**——renderer 不知道内部存储布局，main 作为 path 的唯一来源。

- `includePath: true` → `entry.path` 原始绝对路径（agent / drag-drop / subprocess）
- `includeUrl: true` → `entry.url` `file://` URL + 危险文件 safety wrap（`<img src>` / `<video src>`）

**无单独 IPC `resolvePath` 方法**——所有需要 path 的场景都能归到 DataApi 的 list / get query。IPC 保持做 mutation + 不便 REST 的操作。

**已作废的设计**：

- Renderer-side `entryToFileUrl / entryToAbsolutePath` helper（暴露存储布局给 renderer）
- IPC `resolvePath(handle)` 方法（和 DataApi `includePath` 功能重复）

收益：

- API 表面更窄（只有 DataApi opt-in，无独立 IPC）
- Main 改存储格式（subdir sharding 等）不影响 renderer
- 危险文件 safety 集中在 main
- Null byte 检查自然包含

### 2.7 `name` / `origin_name` 字段

**定性**：两个字段语义完全不同，需要分别处理。

| 旧字段        | 旧语义                                       | v2 归属                                                                                  |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `name`        | 存储名 = `{id}.{ext}`（文件系统上的文件名）  | **删除**（由 `resolvePhysicalPath(entry)` 派生 `{id}.{ext}`，应用层不再看）              |
| `origin_name` | 用户可见原名 = `My Document.pdf`（含扩展名） | **拆分** → `FileEntry.name='My Document'`（无扩展名）+ `FileEntry.ext='pdf'`（无前导点） |

#### 2.7.1 `name`（存储名）现状

**Producer（FileStorage 统一构造）**：所有 `FileStorage.ts` 的 setter 里 `name: uuid + ext` 或 `path.basename(...)` 模式，统一是"id + ext"形态。由 `createInternalEntry` / `ensureExternalEntry` 返回给 renderer。

**Renderer 中的真实消费者**：

| 位置                                                                          | 用途                                                                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/services/FileManager.ts:148` `getFileUrl`                   | `file://${filesPath}/${file.name}` 构造 URL——但 `getFileUrl` 本身很少被直接调用，多数地方用 `getFilePath` 或 `getSafePath`（已在 §2.6 覆盖） |
| `src/renderer/src/services/KnowledgeService.ts:135`                           | `[${item.file.origin_name}](http://file/${item.file.name})` 构造 markdown 链接                                                               |
| `src/renderer/src/utils/knowledge.ts:211, 222`                                | XML 序列化 `<file filename="${fileBlock.file.name}">` —— 传给 LLM                                                                            |
| `src/renderer/src/pages/knowledge/components/KnowledgeSearchItem/hooks.ts:54` | `href: http://file/${item.file.name}`                                                                                                        |
| `src/renderer/src/hooks/useKnowledge.ts:134, 138`                             | `window.api.file.delete(file.name)` 传存储名给删除 API                                                                                       |

**注意**：很多 `file.name` 实际是 **Electron 扩展的 browser `File` 对象 `.name`**（非 FileMetadata）：`PasteService.ts:72-73`, `useRichEditor.ts:493`, `ObsidianExportDialog.tsx:112`, `VideoPopup.tsx:98-109`, `NotesService.ts:321`（Dirent）等。这些和本次迁移**无关**。

#### 2.7.2 `origin_name`（用户可见原名）现状

**Producer**：
| 位置 | 语义 |
|---|---|
| `FileStorage.ts:215, 267, 315, 358, 698, 748, 1545` | `path.basename(filePath)` 或类似——用户上传时的原始 basename |
| `src/main/utils/file.ts:152` | `getAllFiles` 目录扫描的 basename |
| `knowledge/utils/directory.ts:71` | Knowledge 目录扫描 |
| `knowledge/preprocess/Mistral/Mineru/Paddleocr` 等 | 预处理产物继承或改写（如 `.pdf` → `.md`）|
| `VideoPopup.tsx:111`, `KnowledgeFiles.tsx:114` | renderer 字面量构造 |

**Consumer**：
| 位置 | 用途 |
|---|---|
| `src/renderer/src/services/FileAction.ts:18, 19, 37` | `tempFilesSort` 识别 `temp_file` 前缀；`sortFiles` 按 name 排序 |
| `src/renderer/src/services/FileAction.ts:100-102` | rename 操作：`newName` 通过 popup 修改 `origin_name` |
| `src/renderer/src/services/FileManager.ts:159-175` `formatFileName` | 展示名格式化：`pasted_text` / `temp_file image` 特殊 i18n；否则返回 origin_name |
| `src/renderer/src/services/FileManager.ts:151-157` `updateFile` | 自愈逻辑：若 `origin_name` 没包含 ext，补上 ext |
| `src/main/services/remotefile/OpenAIService.ts:31, 46, 57` | OpenAI 上传 `name: file.origin_name` / `displayName` |
| `src/main/services/remotefile/GeminiService.ts:38, 60, 79` | Gemini 上传 `displayName` |
| `src/main/services/remotefile/MistralService.ts:28, 36, 47` | Mistral 上传 `fileName` / `displayName` |
| `src/renderer/src/aiCore/prepareParams/messageConverter.ts:82, 149, 159, 161, 162` | AI SDK FilePart `fileName`；log / toast |
| `src/renderer/src/services/KnowledgeService.ts:135` | markdown 链接 `[${item.file.origin_name}](...)` |
| `src/renderer/src/services/ApiService.ts:473` | `fileBlocks.map(fb => fb.file.origin_name)` 列表 |
| `src/renderer/src/components/RichEditor/useRichEditor.ts:523` | `alt: fileMetadata.origin_name` |
| `src/main/knowledge/preprocess/*` 多处 | `file.origin_name.replace('.pdf', '.md')` 派生产物名 |

**Dexie schema**: `files: 'id, name, origin_name, path, size, ext, type, created_at, count'`——两个都是 indexed column。

**Migration 校验**: `KnowledgeMappings.hasCompleteFileMetadata` 要求 `typeof value.origin_name === 'string'`。

#### 2.7.3 v2 FileEntry 的新字段语义

```typescript
// packages/shared/data/types/file/fileEntry.ts (already set up)
interface FileEntry {
  id: string; // UUID v7
  origin: "internal" | "external";
  name: string; // 用户可见名字，**不含扩展名**（'My Document'）
  ext: string | null; // 扩展名，**不含前导点**（'pdf'），无扩展名时 null
  size: number;
  externalPath: string | null;
  // trashedAt 仅 internal 可非空；external 恒为 null（fe_external_no_trash CHECK）
  trashedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
```

语义变化：

- `name` 语义**完全改变**：从"存储名（id+ext）"变为"用户可见名（不含扩展名）"
- `ext` 语义**微调**：从"含前导点的扩展名（`.pdf`）"变为"不含前导点（`pdf`）"——见 §2.5 type 字段的 `ext` 变化
- 派生的完整显示名 = `name + (ext ? '.' + ext : '')`

#### 2.7.4 派生工具

增加一个集中式工具（shared 或 renderer 均可，逻辑纯函数）：

```typescript
// packages/shared/file/utils/displayName.ts（新）
export function entryDisplayName(entry: FileEntry): string {
  return entry.ext ? `${entry.name}.${entry.ext}` : entry.name;
}
```

所有旧消费 `file.origin_name` 的位置改为 `entryDisplayName(entry)`。

#### 2.7.5 迁移步骤

**Step A: `entryDisplayName` 工具**（独立 PR）

| #   | 文件                                              | 改动                           |
| --- | ------------------------------------------------- | ------------------------------ |
| A1  | `packages/shared/file/utils/displayName.ts`（新） | 导出 `entryDisplayName(entry)` |

**Step B: Producer 改造（设值方）**

| #   | 文件                                                                                   | 改动                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `FileStorage.ts` 所有 setter（:215, 267, 315, 358, 698, 748, 1545）                    | v2 entry 创建时：`name` 写不含扩展名的 basename；`ext` 写不含前导点的扩展名；不再写 storage name `name=id+ext`（storage path 通过 `resolvePhysicalPath` 派生） |
| B2  | `src/main/utils/file.ts:152`                                                           | 同上                                                                                                                                                           |
| B3  | `src/main/knowledge/utils/directory.ts:71`                                             | 同上                                                                                                                                                           |
| B4  | `src/main/knowledge/preprocess/*`（Mistral / Mineru / Paddleocr / OpenMineru / Doc2x） | 预处理产物构造：`name` 派生（去扩展名），`ext` 新扩展名                                                                                                        |
| B5  | `VideoPopup.tsx:98-111`, `KnowledgeFiles.tsx:113-114`                                  | renderer 字面量构造同步                                                                                                                                        |

**Step C: Consumer 改造 —— 存储名使用点**

| #   | 文件                                | 改动                                                                                           |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| C1  | `FileManager.getFileUrl` (line 148) | 已在 §2.6 `includeUrl` 覆盖，删除旧 helper                                                     |
| C2  | `KnowledgeService.ts:135`           | `http://file/${file.name}` → `http://file/${entry.id}`（用 id 作为资源标识）                   |
| C3  | `utils/knowledge.ts:211, 222`       | XML 的 `filename="..."` 用 `entryDisplayName(entry)`                                           |
| C4  | `KnowledgeSearchItem/hooks.ts:54`   | `href: http://file/${item.file.name}` → `${entry.id}`                                          |
| C5  | `useKnowledge.ts:134, 138`          | `window.api.file.delete(file.name)` → `fileIpc.permanentDelete(createManagedHandle(entry.id))` |

**Step D: Consumer 改造 —— 原名使用点**

| #   | 文件                                                                                         | 改动                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `FileAction.ts:18, 19`                                                                       | `origin_name.startsWith('temp_file')` → `entry.name.startsWith('temp_file')`（v2 name 无扩展名）                                          |
| D2  | `FileAction.ts:37`                                                                           | `a.origin_name.localeCompare(b.origin_name)` → `a.name.localeCompare(b.name)` 或 `entryDisplayName(a).localeCompare(entryDisplayName(b))` |
| D3  | `FileAction.ts:100-102` rename                                                               | popup 编辑 `entry.name`（不含扩展名），保存时只更新 `name`；`ext` 独立                                                                    |
| D4  | `FileManager.formatFileName` (renamed/ rewritten)                                            | 重写：`entry.name.includes('pasted_text')` 等识别，组合 `entryDisplayName`；替换旧 formatFileName                                         |
| D5  | `FileManager.updateFile:151-157` 自愈逻辑                                                    | 删除（v2 name 和 ext 分离，不需要修正）                                                                                                   |
| D6  | `OpenAIService.ts:31, 46, 57`, `GeminiService.ts:38, 60, 79`, `MistralService.ts:28, 36, 47` | `file.origin_name` → `entryDisplayName(entry)`                                                                                            |
| D7  | `messageConverter.ts:82, 149, 159, 161, 162`                                                 | 同上                                                                                                                                      |
| D8  | `KnowledgeService.ts:135` markdown 链接                                                      | 链接文本 `[${entryDisplayName(entry)}](...)`                                                                                              |
| D9  | `ApiService.ts:473`                                                                          | `fileBlocks.map(fb => entryDisplayName(fb.file))`                                                                                         |
| D10 | `useRichEditor.ts:523` alt                                                                   | `alt: entryDisplayName(entry)`                                                                                                            |
| D11 | `knowledge/preprocess/*` 派生产物名                                                          | `file.origin_name.replace('.pdf', '.md')` → 拆成 `name: entry.name, ext: 'md'` 或 `entryDisplayName` 后 replace                           |

**Step E: Schema / 迁移**

| #   | 文件                                                                        | 改动                                                                    |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| E1  | `packages/shared/data/types/file/file.ts`, `src/renderer/src/types/file.ts` | FileMetadata 的 `name` / `origin_name` 删除（Phase 6）                  |
| E2  | `src/renderer/src/databases/index.ts`                                       | Dexie `files` 索引中 `name`, `origin_name` 移除（v11+ upgrade）         |
| E3  | `packages/shared/data/types/knowledge.ts:45`                                | `FileMetadataSchema` 中 `name` / `origin_name` 删除                     |
| E4  | `KnowledgeMappings.hasCompleteFileMetadata`                                 | 不再校验 `origin_name`；改为校验 `name`（新语义）+ `ext`                |
| E5  | `FileMigrator`                                                              | 迁移映射：`origin_name` → 拆出 `name` 和 `ext`；旧 `name`（存储名）丢弃 |

#### 2.7.6 `ext` 的前导点问题（关联 §2.5）

旧 `FileMetadata.ext = '.pdf'`（**含**前导点）；v2 `FileEntry.ext = 'pdf'`（**不含**）。

所有做字符串比较的消费者要更新：

- `file.ext === '.pdf'` → `entry.ext === 'pdf'`
- `file.ext.replace('.', '')` 之类的 hacky 写法可以删除
- Producer 停止写前导点（`path.extname()` 返回 `.pdf`，需要 `.slice(1)` 或 `.replace(/^\./, '')`）

这个和 §2.5 `type` 字段迁移**同步进行**，可以合并到一个 PR 里。

#### 2.7.7 `FileMigrator` 的字段拆分逻辑

Dexie `origin_name: 'My Doc.pdf'` + `ext: '.pdf'` → v2:

```typescript
const oldExt = oldFile.ext.startsWith('.') ? oldFile.ext.slice(1) : oldFile.ext
const oldOriginName = oldFile.origin_name
const newName = oldExt && oldOriginName.endsWith('.' + oldExt)
  ? oldOriginName.slice(0, -(oldExt.length + 1))
  : oldOriginName
const newExt = oldExt || null

newFileEntry = {
  ...
  name: newName,  // 'My Doc'
  ext: newExt,    // 'pdf'
}
```

注意：旧 `origin_name` 不一定真的包含 `ext`（可能是 bug 或用户手动改过），做防御性处理。

#### 2.7.8 Rename 行为的语义变化

旧：`updateFile({ ...file, origin_name: newName })` 更新**含扩展名**的原名。用户输入 `'My New Doc.pdf'` 整个被保存。

v2：rename popup 只编辑 `name`，`ext` 不变。用户看到输入框里是 `'My New Doc'`（无扩展名），保存后 `entry.name = 'My New Doc'`，`ext='pdf'` 保留。

**UX 注意**：

- Rename popup 的输入框 placeholder / tip 应该提示"不含扩展名"
- 对于 internal 文件：保存 `name` 只是 DB 更新，物理文件路径（`{id}.{ext}`）不变
- 对于 external 文件：物理 rename 需要重新组合 `{newName}.{ext}`，rename `externalPath`

这个逻辑在 §2.6 Step I 的 FileManager rename 实现里体现。

#### 2.7.9 复杂度与执行时机

| 维度          | 评估                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- |
| 触达 producer | ~10 文件                                                                                            |
| 触达 consumer | ~15 文件                                                                                            |
| 改造性质      | 多数是字段访问替换；少数需要语义调整（ext 前导点、rename 行为）                                     |
| 最难点        | Remote upload 服务（OpenAI/Gemini/Mistral）对 display name 的格式预期；预处理 provider 的产物名派生 |
| **复杂度**    | **M**（介于 count 和 path 之间）                                                                    |

**建议拆分**：

- PR1: Step A（工具）
- PR2: Step E4 + E5（FileMigrator 映射 + schema 校验）—— 迁移基础设施
- PR3-PR5: Step B（Producer）分 main 侧 / 预处理 / renderer 字面量三个 PR
- PR6-PR9: Step D consumer 按子系统分 PR（FileAction / TokenService / Remote upload / aiCore & RichEditor 等）
- PR10: Step E1-E3 cleanup schema

#### 2.7.10 风险

| 风险                                                 | 缓解                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Remote upload 的 `displayName` 期望含扩展名          | `entryDisplayName` 默认返回含扩展名形态                                                                                   |
| 预处理 `.pdf` → `.md` 硬编码替换                     | 改为拆解 ext 后独立设置新 ext，逻辑更清晰                                                                                 |
| 旧 `origin_name` 不含 ext（bug 数据）                | FileMigrator 防御性处理：ext 为 null 或 name 用整个 origin_name                                                           |
| `formatFileName` 的 `pasted_text` / `temp_file` 识别 | 测试数据确认 `origin_name='pasted_text_xxx.txt'` 迁移后 `name='pasted_text_xxx'`，identifier 保留但无扩展名前缀匹配要调整 |
| Dexie 索引删除                                       | 先停止写入，再 v11 upgrade 删索引（可多版本阶段化）                                                                       |

### 2.8 `created_at: string` 字段

**结论**：低复杂度。ISO 8601 string → `FileEntry.createdAt: number`（ms epoch）。所有消费者已经通过 `dayjs` 读取，`dayjs()` 同时接受 string 和 number，所以消费侧改动极小，主要是 Producer 改写 setter 和 Migrator 做一次类型转换。

#### 2.8.1 现状

**v2 目标 schema**：`FileEntry.createdAt: number`（ms epoch），和其他 v2 表一致（见 `src/main/data/db/schemas/file.ts`）。

**Producer（写 ISO string 的位置，通过 `.toISOString()` / `birthtime.toISOString()`）**：

| 位置                                                                  | 来源                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/main/services/FileStorage.ts:224, 270, 336, 361, 701, 751, 1548` | 各 setter：`stats.birthtime.toISOString()` 或 `new Date().toISOString()` |
| `src/main/utils/file.ts:154, 325, 361`                                | `new Date().toISOString()` / `stats.birthtime.toISOString()`             |
| `src/main/knowledge/utils/directory.ts:37, 51, 74`                    | `stats.birthtime.toISOString()`                                          |
| `src/main/knowledge/preprocess/MistralPreprocessProvider.ts:181`      | `new Date().toISOString()`                                               |
| `src/main/knowledge/preprocess/BasePreprocessProvider.ts:57`          | `processedStats.birthtime.toISOString()`                                 |
| `src/renderer/src/components/Popups/VideoPopup.tsx:113`               | renderer 字面量 `new Date().toISOString()`                               |
| `src/renderer/src/pages/knowledge/items/KnowledgeFiles.tsx:116`       | renderer 字面量                                                          |

**Consumer（通过 `dayjs` 读）**：

| 位置                                                                            | 用法                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/renderer/src/services/FileManager.ts:164`                                  | `dayjs(file.created_at).format('YYYY-MM-DD')` — `formatFileName` 里显示 pasted_text 日期 |
| `src/renderer/src/services/FileAction.ts:31`                                    | `dayjs(a.created_at).unix() - dayjs(b.created_at).unix()` — 按创建时间排序               |
| `src/renderer/src/pages/files/FilesPage.tsx:114, 115`                           | `dayjs(file.created_at).format('MM-DD HH:mm')` + `dayjs(file.created_at).unix()`         |
| `src/renderer/src/pages/home/Inputbar/tools/components/AttachmentButton.tsx:79` | `dayjs(fileContent.created_at).format('YYYY-MM-DD HH:mm')`                               |

**关键事实**：**`dayjs(x)` 同时接受 `string` (ISO) 和 `number` (ms epoch)**。v2 切换为 number 后，所有 `dayjs` 消费者**代码不变**就能工作。

**Dexie upgrades**（历史修复脚本）：

- `src/renderer/src/databases/upgrades.ts:48-49` — 历史 bug 修复：若 `created_at instanceof Date`，转成 `toISOString()`。v2 迁移后 Dexie 不再使用，保留原状即可（不执行）。

**Migration 校验**：

- `KnowledgeMappings.hasCompleteFileMetadata`、`KnowledgeMigrator.ts:71` — `typeof value.created_at === 'string'` 要求是字符串（这是**输入侧**校验，对应旧 Dexie 数据）
- `store/knowledge.ts:74` — 已有 pattern：`new Date(item.created_at).getTime()` 转换到 ms epoch

#### 2.8.2 迁移步骤

**Step A: Producer 改造**（都是 mechanical 替换）

| #   | 文件                                                    | 改动                                                                       |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| A1  | `FileStorage.ts:224, 270, 336, 361, 701, 751, 1548`     | `.toISOString()` → `.getTime()`；`new Date().toISOString()` → `Date.now()` |
| A2  | `src/main/utils/file.ts:154, 325, 361`                  | 同上                                                                       |
| A3  | `knowledge/utils/directory.ts:37, 51, 74`               | 同上                                                                       |
| A4  | `knowledge/preprocess/MistralPreprocessProvider.ts:181` | 同上                                                                       |
| A5  | `knowledge/preprocess/BasePreprocessProvider.ts:57`     | `processedStats.birthtime.toISOString()` → `processedStats.birthtimeMs`    |
| A6  | `VideoPopup.tsx:113`, `KnowledgeFiles.tsx:116`          | 同上                                                                       |

**Step B: Consumer 适配（实际上几乎 no-op）**

`dayjs(x)` 接受 number，所以：

- `dayjs(file.created_at).format(...)` —— 无需改，自动工作
- `dayjs(a.created_at).unix()` —— 无需改

唯一可以简化的：`.unix()` 换 `Math.floor(x / 1000)` 更直接，但非必需。

**Step C: Schema / Migrator**

| #   | 文件                                                                               | 改动                                                                                                           |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| C1  | `packages/shared/data/types/file/file.ts:25`, `src/renderer/src/types/file.ts:116` | `FileMetadata.created_at: string` → `number`（或保留 string，v2 新 FileEntry 自己用 number；Phase 6 删旧字段） |
| C2  | `KnowledgeMappings.hasCompleteFileMetadata`、`KnowledgeMigrator.ts:71`             | 校验改为 `typeof value.created_at === 'string' \|\| typeof value.created_at === 'number'`（兼容输入）          |
| C3  | FileMigrator mapping                                                               | `new Date(oldFile.created_at).getTime()` 转换，处理可能的无效 string                                           |
| C4  | `src/renderer/src/databases/index.ts` Dexie schema                                 | 不需要变（仅是类型约束，Dexie 不强约束类型）                                                                   |

#### 2.8.3 复杂度与风险

| 维度          | 评估                               |
| ------------- | ---------------------------------- |
| 触达 Producer | ~11 位置                           |
| 触达 Consumer | ~4 位置（全是 dayjs 无需改）       |
| **复杂度**    | **S**（仅次于 tokens，几乎纯替换） |

**风险**：

- **极低**。`dayjs` 天然兼容；FileMigrator 的 `new Date(iso).getTime()` 有成熟 pattern
- 唯一潜在坑：historical bug 数据可能是 `Date` 对象而非 string（见 upgrade script :48）——FileMigrator 对 `created_at` 做 `typeof` 分支兜底，所有不合法值回退到 `Date.now()`

**执行时机**：独立小 PR，与 §2.4 tokens 类似，可以打包到"字段清理"合并 PR，甚至和 ext 前导点迁移合并。

### 2.9 `id: UUID v4 → UUID v7` 迁移

**决策**：

> **保留原 v4 ID**；新 entry 自动用 v7。放宽 `FileEntryIdSchema` 为 `z.uuid()` 接受两种。跨表引用零翻译。

#### 2.9.1 现状

**v2 设计**（当前代码）：

- **DB schema**（`src/main/data/db/schemas/file.ts:25`）：`id: uuidPrimaryKeyOrdered()` —— 新 entry 自动生成 **UUID v7**（`_columnHelpers.ts:26`）
- **Zod 校验**（`packages/shared/data/types/file/fileEntry.ts:64`）：`FileEntryIdSchema = z.uuidv7()` —— **严格要求 v7**
- **测试**（`fileEntry.test.ts:188-199`）：明确断言 v4 校验失败

**旧 FileMetadata ID 全部是 v4**：
| 位置 | 生成方式 |
|---|---|
| `src/main/services/FileStorage.ts:266, 314, 357` | `uuidv4()` |
| `src/main/utils/file.ts:145` | `uuidv4()`（getAllFiles）|
| `src/main/services/knowledge/utils/directory.ts:32, 46, 70` | `uuidv4()` |
| `src/renderer/src/store/thunk/knowledgeThunk.ts:42` | `uuidv4()` |

DB 层面 `id: text()`（`_columnHelpers.ts:18, 27`）——**SQLite TEXT 列不约束 UUID 版本**，v4/v7 字符串都能存。冲突点是 Zod runtime 校验。

#### 2.9.2 两种迁移策略对比

**Option A: 保留原 v4 + 放宽 Schema**（推荐）

- FileMigrator 直接把旧 v4 id 写入 `file_entry.id`
- 跨表引用（message_blocks、paintings、knowledge_items、file_ref）**无需翻译**——原 id 原封不动
- 放宽 `FileEntryIdSchema` 从 `z.uuidv7()` 到 `z.uuid()`（接受 v4 和 v7 两种）
- 新建 entry 仍由 `uuidPrimaryKeyOrdered()` 默认生成 v7

**Option B: 重生成 v7 + ID 映射**

- FileMigrator 对每个旧 entry 生成新 v7 id，维护 `oldId → newId` 映射
- 所有引用 file 的表（message_blocks.file.id、paintings.files[].id、knowledge_items.data.file.id、file_ref.fileEntryId）都必须改写
- 保证 strict v7 invariant

**取舍**：

| 维度                  | Option A（保留 v4）                                                      | Option B（重生 v7）             |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| Migrator 复杂度       | 低（直接复制）                                                           | **高**（映射表 + 跨表改写）     |
| 迁移失败风险          | 极低                                                                     | 中（一个引用漏改就是 dangling） |
| DB-level 正确性       | v4/v7 共存，但 SQLite TEXT 不关心                                        | 纯 v7                           |
| v7 time-ordering 好处 | 新 entry 享有；历史 entry 按 v4 存入（无时序优势但不是问题，已经是历史） | 全部享有                        |
| Schema 严格性         | `z.uuid()` 接受任何 UUID                                                 | `z.uuidv7()` 严格               |
| 性能影响              | 无（SQLite 对 v4/v7 检索一样快）                                         | 无（同）                        |

**选 Option A 的理由**：

1. v7 的核心优势是"**新 insert 按时间顺序**"，对索引 B-tree 友好；历史数据已经插入完成，v7 优势对它们不适用
2. 跨表 ID 翻译极易出 bug（每个引用源都要改，一个漏掉就是 orphan）
3. `z.uuid()` 仍然能拦住 garbage 字符串（真正的 schema validation 目的）
4. 符合 `pathResolver` 类似决策（信任输入 + 最小化改动面）

#### 2.9.3 迁移步骤

**Step A: 放宽 Schema**（独立小 PR，可在 FileMigrator 之前做）

| #   | 文件                                                             | 改动                                                                                                            |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A1  | `packages/shared/data/types/file/fileEntry.ts:64`                | `FileEntryIdSchema = z.uuidv7()` → `z.uuid()`                                                                   |
| A2  | `fileEntry.ts:56-63` JSDoc                                       | "File entry ID: UUID v7" → "File entry ID: UUID (v4 for legacy migrated entries, v7 for entries created in v2)" |
| A3  | `packages/shared/data/types/__tests__/fileEntry.test.ts:188-199` | 现在 assert v4 **pass**（不再 fail）；v7 pass；非 UUID 字符串 fail                                              |

**Step B: FileMigrator 实现**

```typescript
// 概念代码
async function migrateFileEntry(oldFile: DexieFileRow): Promise<FileEntryRow> {
  return {
    id: oldFile.id, // 保留原 v4 id
    origin: isInternalPath(oldFile.path) ? "internal" : "external",
    name: stripExt(oldFile.origin_name, oldFile.ext),
    ext: normalizeExt(oldFile.ext), // '.pdf' → 'pdf'
    size: oldFile.size,
    externalPath:
      oldFile.origin === "external"
        ? canonicalizeExternalPath(oldFile.path)
        : null,
    trashedAt: null, // Dexie 没软删除字段；external 也不允许 trashed（fe_external_no_trash）
    createdAt: toMs(oldFile.created_at), // ISO → ms
    updatedAt: toMs(oldFile.created_at), // Dexie 无 updatedAt，用 createdAt
  };
}
```

**External path 去重（强制）**：新 schema 的 `UNIQUE(externalPath)` 禁止同路径两条行。如果 Dexie 里存在多条指向同一 canonical path 的 external FileMetadata（由 case / NFD / 拼写差异合并后），FileMigrator 必须：

1. 按 `canonicalizeExternalPath(path)` 分组
2. 每组保留一条（建议取 `createdAt` 最早的）作为 surviving row
3. 把组内其他 id 收集到 id-remap 表，在迁移 `file_ref`（以及其他引用 FileMetadata.id 的业务表）时将旧 id 重路由到 surviving id
4. 被合并掉的 FileMetadata.id 不产生 `file_entry` 行

这条 invariant 用 schema 层的 UNIQUE index 强制，任何漏网的重复插入都会在 migrator 内抛出并中止迁移——这是期望行为，引导开发者补全 remap 逻辑而不是让脏数据进库。

**Step C: 引用表迁移**（对应各自 Migrator）

| 引用表                              | 对应 Migrator                          | 改动                                           |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------- |
| `message_blocks` 的 `file.id`       | ChatMigrator                           | 原 id 原封写入 file_ref.fileEntryId（Q3 已定） |
| `paintings` 的 `files[].id`         | PaintingMigrator（延后，见 RFC §10.4） | 同上                                           |
| `knowledge_items` 的 `data.file.id` | KnowledgeMigrator（已有）              | `FileItemData.file.id` 保持原值                |
| file_ref 表（迁移时新建）           | FileMigrator / 各引用源 Migrator       | 所有 fileEntryId 用原 v4 id                    |

**无跨表 ID 翻译**——这是 Option A 的主要简化点。

#### 2.9.4 风险

| 风险                                      | 缓解                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Renderer 或其他校验点期望严格 v7          | 全仓 grep `FileEntryIdSchema`、`z.uuidv7()` 使用；除 fileEntry.ts 外应该没有其他场景专门依赖 v7 形态                |
| v7 time-ordering 混入 v4 导致"排序不连续" | 历史 entry 永远排在 v7 前面（v4 第三段第一位是 4，v7 是 7）——实际上天然把新旧分开；如需时间排序按 createdAt 而非 id |
| 未来写入路径误写入 v4                     | `uuidPrimaryKeyOrdered()` 保证新 entry 是 v7；不存在其他 insert 入口（API/IPC 都走 FileManager）                    |

#### 2.9.5 复杂度与执行时机

**S**。唯一实质改动是 schema 放宽 + test 更新。FileMigrator 的 id 字段处理是"直接拷贝"。

**执行时机**：Schema 放宽（Step A）可**随时独立 PR**；FileMigrator 实现（Step B）在 Phase 3 FileMigrator 整合时落地。

---

## 3. 消费域切换计划

> 总览：详见 [`filemetadata-consumer-audit.md §6`](./filemetadata-consumer-audit.md)。本节聚焦**具体切换顺序和动作**。

### 3.1 域切换顺序

| 批次    | 域                                   | 复杂度 | 依赖                                | 预期 PR 数 |
| ------- | ------------------------------------ | ------ | ----------------------------------- | ---------- |
| Batch A | Translate / Agent workspace / Export | S      | 字段级退役（§2.6 path）             | 1-2        |
| Batch B | Paste / 临时文件 / OCR               | M      | §2.6 path                           | 2-3        |
| Batch C | Painting                             | L      | §2.3 count                          | 2-3        |
| Batch D | Knowledge                            | L      | §2.3 count + KnowledgeMigrator 就绪 | 2-4        |
| Batch E | Messages（attachments / images）     | XL     | 所有字段级退役完成                  | 3-5        |

**顺序依据**：

- 从小到大，先在低风险域验证适配层设计
- Messages 最后——它的数据模型最深，且量最大
- 字段级退役与域切换交错：某域阻塞的字段先做退役，再做域切换

### 3.2 每个域的切换模板

每个域的切换 PR 遵循相同步骤，逐个域展开时填入具体内容：

1. **入口枚举**：列出该域触发文件操作的所有 UI 入口（哪个 component）
2. **当前数据结构**：该域如何持有 FileMetadata（直接内嵌？数组？hashmap？）
3. **当前 API 调用**：调 `window.api.file.*` 的哪几个方法
4. **新 API 映射**：每个旧调用对应到 v2 哪个 IPC / DataApi
5. **数据迁移器**：如果该域有 Dexie → SQLite 数据搬运，对应的 Migrator 位置
6. **UI / 行为变化**：是否有用户可感知的行为差异（例如 dangling 文件展示）
7. **测试点**：关键集成测试用例
8. **回滚策略**：如果发现严重问题，如何短时间回退

### 3.3 Batch A-E 详细计划（待调研后逐个展开）

（占位——每个 Batch 按 §3.2 模板展开）

---

## 4. 适配层（Shim）设计

> **Scope 限定**：shim **只服务桶 P**——给还没迁移到 `FileEntry` 的持久化消费者（Dexie / message_block 内嵌 / knowledge_item JSON）临时的"看起来像 `FileMetadata`"视图。
>
> **不提供的 shim**：
>
> - **桶 I 无 shim**——`FileMetadata → FileInfo` 是同端字段瘦身，直接改签名
> - **桶 A 无 shim**——两栖消费者必须拆签名解决（持久化动作走 `createInternalEntry` / `ensureExternalEntry` 显式升格，处理动作接 `FileInfo`），用 shim 糊弄会让 A 桶永远清不掉
> - **反向 shim（FileMetadata → FileEntry）**——不提供；`FileInfo → FileEntry` 必须走 FileManager sanctioned 生产入口（brand 强制），伪造的 `FileEntry` 会被 Zod 拒收

### 4.1 `toFileMetadata(entry: FileEntry, physicalPath: FilePath): FileMetadata` —— 桶 P 过渡期专用

```typescript
// 概念代码。仅在未迁移的桶 P 消费者落地点使用；迁移完成后随消费者一起删除
function toFileMetadata(entry: FileEntry, physicalPath: FilePath): FileMetadata {
  return {
    id: entry.id,
    name: entry.ext ? `${entry.id}.${entry.ext}` : entry.id, // 旧的"存储名"约定
    origin_name: entry.ext ? `${entry.name}.${entry.ext}` : entry.name,
    path: physicalPath, // via FileManager.resolveForSystem / resolvePhysicalPath
    size: entry.size,
    ext: entry.ext ? `.${entry.ext}` : "", // 注意加回前导点（旧约定）
    type: getFileTypeFromExt(entry.ext), // ops.getFileType
    created_at: new Date(entry.createdAt).toISOString(),
    count: 0, // 需要时查 file_ref；旧消费方大多不读
    // tokens / purpose 不填——新系统已剥离
  }
}
```

**注意点**：

- `ext` 的前导点差异（旧带点，新不带）在此处归一
- `count` 需要时查 `file_ref`，默认 0（旧消费方大多不读）
- `path` 需要由 main 侧 `resolvePhysicalPath(entry)` 预先解析；renderer 侧不应自拼

### 4.2 反向 shim：**不提供**

> 旧代码产出的 `FileMetadata` 不能通过同步转换变成 `FileEntry`——`FileEntrySchema` 的 Zod brand 会挡住伪造。正确路径：
>
> - 若旧 `FileMetadata` 源自**Dexie 持久化数据**：在 FileMigrator 阶段一次性搬运到 `file_entry`（见 §6）
> - 若旧 `FileMetadata` 源自**runtime 生产**（如 `FileStorage.uploadFile` 新建）：Phase 2 把对应 producer 直接替换成调用 `createInternalEntry` IPC
> - 若**仅需要用文件属性**（OCR / TokenService / 渲染等）：这是桶 I 或桶 A 的处理路径——`FileMetadata` 瘦身成 `FileInfo`，签名改掉就好

### 4.3 Shim 的生命周期

- Phase 2 双读双写期：引入 `toFileMetadata`（仅桶 P 用）
- Phase 4 consumer migration 期：随桶 P 消费者逐个迁移到 `FileEntry`，shim 调用点递减
- Phase 6 Cleanup：**最后删掉 `toFileMetadata`** 与 `FileMetadata` 类型本身；`FileInfo` / `FileEntry` / `FileHandle` 成为唯一表达

---

## 5. 执行约束与里程碑

### 5.1 硬约束

- **不移动物理文件**：所有 internal 文件物理位置保持 `{userData}/files/{id}.{ext}`，FileMigrator 只建表、不动盘
- **不破坏用户数据**：每次迁移保留 Dexie 备份直到 Phase 6
- **可逐域回滚**：任何一个域的切换 PR 都能独立回滚，不影响其他域

### 5.2 里程碑（tentative）

| 里程碑 | 内容                                                                  | 依赖                            |
| ------ | --------------------------------------------------------------------- | ------------------------------- |
| M1     | §2.2 purpose 退役 PR 合入                                             | 本文档 §2.2 落地                |
| M2     | Shim 双向适配实现（§4）                                               | FileEntry schema 稳定（已完成） |
| M3     | 字段级退役全部完成（§2.3-§2.9）                                       | 每个字段一个独立 PR             |
| M4     | Batch A 完成                                                          | M2 + §2.6 path                  |
| M5     | Batch B-D 完成                                                        | M4                              |
| M6     | Batch E 完成                                                          | M5 + 所有字段退役               |
| M7     | Cleanup：删 Dexie `files` 表 / `FileStorage.ts` / `FileMetadata` 类型 | M6                              |

### 5.3 每个 PR 的最小描述模板

切换 PR 应在描述中包含：

- **对应字段 / 域**（引用本文档章节号）
- **改动范围**（文件清单）
- **是否破坏旧消费方**（如有，明确适配层处理）
- **回滚方法**

---

## 6. 开放问题与决策追踪

| #   | 问题                                                                             | 状态                                                  | 决策            |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------- |
| 1   | `id` v4 → v7 是否保留原 ID？                                                     | 倾向保留                                              | §2.9            |
| 2   | `path` 的 renderer-side 消费能否全部改为"不缓存 + 按需查"？                      | 未决                                                  | §2.6 展开时讨论 |
| 3   | Shim 层放 renderer 还是 main？                                                   | 倾向 main（靠近数据源）                               | §4              |
| 4   | Phase 2 双读双写期时长                                                           | 未决                                                  | 配合产品节奏    |
| 5   | 零 ref 文件自动清理：立即（旧）vs 延迟（v2 推荐选项 2）？                        | 倾向延迟                                              | §2.3.10         |
| 6   | FilesPage 按 ref_count 排序是否保留为默认？                                      | 倾向保留能力，默认关闭                                | §2.3.11         |
| 7   | PaintingMigrator 延后期间 painting 引用的孤儿判定                                | `sourceType='painting'` checker 查 PaintingState 兜底 | §2.3.9 Step A   |
| 8   | `FilesPage.handleDelete` 的"强制删除 + 级联清消息 block"是否仍由 renderer 驱动？ | 未决                                                  | §2.3.9 B7       |

---

## 附录 A：术语对照

| 旧术语                | 新术语                                       | 备注               |
| --------------------- | -------------------------------------------- | ------------------ |
| `FileMetadata`        | `FileEntry` + `FileRef` + 派生信息           | 字段拆解见 §2      |
| `FileStorage.ts`      | `FileManager.ts` + `ops/*` + `DanglingCache` | 职责拆分           |
| `window.api.file.*`   | `window.api.fileIpc.*` + DataApi `/files/*`  | 新合约见 RFC §9    |
| `Dexie.files` 表      | SQLite `file_entry` 表 + `file_ref` 表       | 数据搬运见 RFC §10 |
| `file.count` 引用计数 | `file_ref` 多态外键                          | §2.3               |
| `file.path` 物理路径  | `FileHandle` + 运行时 resolve                | §2.6               |

## 附录 B：修订记录

| 日期       | 版本 | 变更                                                   |
| ---------- | ---- | ------------------------------------------------------ |
| 2026-04-19 | 0.1  | 初稿：从 RFC §10.6 抽出，建立字段退役 + 域切换两线框架 |
