# 文档 vs 代码 漂移报告(v2 知识库)

Date: 2026-06-08
方法:8 个子系统并行审计,以**代码为准**核对 `experiment/` 下方案文档(migration-plan / schema-design / handoff / reviews/0608/*)与顶层 `knowledge-service.md`、`workflow-architecture.md`。每条结论均带 `file:line` 证据(见各子系统 raw 输出)。

> 用途:本报告供确认。确认后据此更新本地 markdown + 飞书通俗版文档。本报告本身不改产品代码。

---

## 0. 一句话结论

方案文档写于"**实现尚未开始 / 先做 POC**"的前提下,**这个前提已彻底失效**:大部分实现已落地并有测试。但更关键的是 —— **代码在落地时做出了几个偏离 plan 的战略决策**,文档没有跟上。所以这不是"补几个状态",而是要把文档从"前瞻规划"改写为"as-built 现状 + 剩余 TODO"。

---

## 1. 状态图例

- ✅ **已落地**:代码与 plan 一致
- 🔀 **已偏离**:做了,但与 plan 描述不同(常常是更干净的做法,或被另一种方案取代)
- ⏳ **待办**:plan 描述了,代码未做
- ⚠️ **疑似缺陷**:不只是文档问题,可能是真实 bug,需单独核实

---

## 2. 子系统总览

| 子系统 | 总体状态 | 一句话 |
| --- | --- | --- |
| 数据模型 & DTO | partially | file leaf 已用 relativePath;**url/note 仍是 inline/url**;material 模型不存在 |
| 路径 & 存储 | partially | 中心化 path helper 已有(`pathStorage.ts`,函数模块非 class);**index.sqlite 已在 `.cherry/`**;keep-both 未做(改为冲突报错) |
| 文件处理 & MinerU | mostly | path 化最彻底;**`managed_artifact` 被整个删除**(非 plan 的"附加模式");MinerU 仅 `dataId` |
| 索引 & 搜索 | **barely** | **9 表 / KnowledgeIndexStore / material 模型完全没建**;仍是旧 `libsql_vectorstores_embedding` + `external_id` |
| Workflow/Jobs/Reader | mostly | 编排/恢复/删除顺序都已落地;job payload 已去 FileEntry;url/note reader 仍联网/读 inline |
| 迁移/删除/恢复 | partially | v1 拷文件+relativePath+无 file_ref 已做;旧向量迁移仍写旧单表格式;孤立路径 bug 已修复(`a6128a6da9`) |
| UI/Preload/IPC | mostly | 渲染层去 FileEntry 已完成;**deleteItemChunk 仍全链路可用**(plan 要求删除);chat 附件被删而非迁移 |
| 测试 & rollout | partially | 已落地部分测试充分;**无知识库 E2E**;index 相关测试因模型不存在而无法写 |

---

## 3. 重大战略偏离(文档改写的核心,需你拍板)

这 5 条是"代码故意没按 plan 走"的地方,决定了文档是改成"**已放弃/被取代**"还是"**仍是未来 TODO**"。

### 3.1 ⏳/🔀 整个 `index.sqlite` 9 表 + `KnowledgeIndexStore` + material 模型 —— 没建,仍用旧向量库

plan 与 schema-design 的**核心赌注**(material/content/search_unit/search_text/embedding/index_meta/...、`rebuildMaterial`、`unit_id`、chunk offset、embedding GC、`knowledge_item.id == material_id`)在代码里**一个都不存在**(grep 零命中)。运行时仍是单表 `libsql_vectorstores_embedding(external_id,...)`,API 仍是 `replaceByExternalId` / `listByExternalId` / `deleteByIdAndExternalId`。

- 证据:`packages/vectorstores/libsql/src/LibSQLVectorStore.ts:24,166-178`;`src/main/services/knowledge/vectorstore/types.ts:3-14`;`indexDocumentsJobHandler.ts:161-164`。
- 影响:**schema-design 整篇、migration-plan §8 全节、§3.2 表状态(标"使用/只创建"全错,实际 0 张表)、final.md "POC A" 全部需重定位。**
- **决策点:** index.sqlite/material 模型是 **(a) 已放弃**(向量库成为 v2 终态)、**(b) 仍是目标**(标"已设计未实现 / 未来工作")、还是 **(c) 未决**?

### 3.2 🔀 `index.sqlite` 已经在 `{baseId}/.cherry/index.sqlite`(plan 说当前 v2 应在 `{baseId}/index.sqlite`)

代码直接跳过了"当前 v2 放根目录、v2.x 才移进 `.cherry/`"这一步,**现在就用 v2.x 的隐藏布局**。`.cherry/` 同时是材料禁止前缀。

- 证据:`pathStorage.ts:8-28`(`CHERRY_META_DIR='.cherry'`);`LibSqlVectorStoreProvider.test.ts:61-63`。
- 影响:plan §1 两棵 ASCII 树、§3.2、§5(含代码块)、§6.1、§17 边界表"index.sqlite 位置"行 —— **当前 v2 与 v2.x 的位置区分已不存在,"升级时移动"这步已多余**。
- 这条基本是**陈述事实即可**,无需决策(除非你想回退到根目录,不建议)。

### 3.3 🔀 embedding 模型/维度变更 = 整库 restore 重建(plan 说用 `index_meta` snapshot 选择性重嵌)

commit `87bb416530` 把 embedding 配置设为**每库不可变**;改模型/维度会触发把整库 restore 进一个新库,而不是 plan §8.4 的 snapshot 比对 + 选择性重嵌。

- 证据:`KnowledgeVectorStoreService.ts:37-39` 注释;`RagConfigPanel` restore 流程。
- **决策点:** restore 方案是否为接受的终态?(若是,§8.4 标"被取代";`index_meta` snapshot 机制随 3.1 一起处理)

### 3.4 🔀 文件处理 intake 收敛为**单一 path 模型**,`managed_artifact` 被整个删除

plan/review 建议"**附加模式**:保留 FileEntry + managed_artifact 作默认"。代码反其道:`FileProcessingOutputTarget` 只有 `{kind:'path'}`(无 union),`document_to_markdown` 入队前强制要求 path output,MinerU 只认 `dataId`(无 `fileEntryId` 回退)。结果更干净,但与 plan 写法相反。

- 证据:`src/shared/data/types/fileProcessing.ts:28`;`FileProcessingService.ts:80-82`;`mineru/document-to-markdown/handler.ts:88-90`。
- 影响:plan §7 的 union 定义、第二个 `managed_artifact` startJob 示例都要删/改。这条是"**已落地,但比 plan 更激进**",基本陈述事实即可。

### 3.5 🔀/⏳ 只有 **file** item 迁到 relativePath;**url 仍每次联网抓取、note 仍读 inline content**;`captures/` 快照完全没做;`sitemap` 类型被删

- `UrlItemData = {source,url}`(无 relativePath),`KnowledgeUrlReader.ts:13` 每次 reindex 都 `fetchKnowledgeWebPage`。
- `NoteItemData = {source,content,sourceUrl}`(inline),`KnowledgeNoteReader.ts` 读 `data.content`。
- `captures/url`、`captures/note` 全代码零命中。
- `KNOWLEDGE_ITEM_TYPES = ['file','url','note','directory']` —— **无 sitemap**;v1 sitemap 迁移成 `url`。
- 影响:plan §4.3/§4.4/§4.5/§6.4/§6.5/§6.6/§9 大量段落作废。
- **决策点:** url/note 快照模型是 **(a) 放弃**(接受 live-fetch/inline 为 v2 行为,快照归 v2.x)还是 **(b) 仍是 v2 TODO**?sitemap 是否确认从 v2 移除?

---

## 4. ✅ 已修复缺陷:迁移后的向量运行时读不到(已 diagnose 实证;已在 `a6128a6da9` 修复)

(修复前)`KnowledgeVectorMigrator` 把重建的向量 DB 写到 **legacy 扁平路径** `getLegacyDbPath(legacyBaseId) = {root}/{legacyBaseId}`;但运行时读的是 `{newBaseId}/.cherry/index.sqlite`。两维度都不一致(legacy id vs 新 id;扁平 vs `.cherry` 嵌套),**全仓无桥接、无搬运、迁移后无 reindex**。结论:**迁移后的向量被孤立,运行时读到一个自动新建的空库,迁移库搜索返回空**,`KnowledgeVectorMigrator` 的全部工作被废掉。

- 根因:顺手把 index.sqlite 挪进 `.cherry/` + 换新 base id 时,**没同步改 `KnowledgeVectorMigrator`**(典型的"顺手改动破坏了 sibling"回归)。
- 证据:写入 `KnowledgeVectorMigrator.ts:481,567-572` + `KnowledgeVectorSourceReader.ts:30-32`;读取 `LibSqlVectorStoreProvider.ts:29` + `pathStorage.ts:19-28`;无桥接(`getKnowledgeVectorStoreFilePath` 在 migration 目录零引用);迁移后无 reindex(`KnowledgeMigrator.ts:735` 注释假设迁移项直接可读)。
- **实证**:临时回归测试断言"重建在 legacy 路径存在 + 运行时 `.cherry` 路径不存在"→ 通过(已跑过并删除,未留在仓库)。
- 漏检原因:迁移器测试从 **legacy 路径**读回校验(`KnowledgeVectorMigrator.test.ts:745`),从不检查运行时 `.cherry` 路径 —— 错误 seam,假信心。
- 处置:**已在 `a6128a6da9` 修复**。做法:把读源(legacy,仅用于 `.embedjs.bak` 备份)与写目标(`getRuntimeVectorStorePath` = 运行时 `{newBaseId}/.cherry/index.sqlite`,按新 id)分开;`execute()` 先 `mkdir .cherry`、rename 前删运行时自建空库(跨平台);`validate()` 改读运行时路径;回归测试断言运行时路径可读、legacy 扁平路径不再有 live 库。**残留**:迁移器仍写旧单表 `libsql_vectorstores_embedding` 格式(9 表 material 终态仍是未来工作)。

---

## 5. 已按 plan 落地的部分(文档应标 ✅ 完成)

- ✅ file leaf `relativePath`/`indexedRelativePath` 数据模型;`fileEntryId` 已从 knowledge 移除(`knowledge.ts:210-232`)
- ✅ 中心化路径边界 `pathStorage.ts`(注意:是**函数模块**,不是 plan 假设的 `KnowledgeBaseFileService` class;`resolveMaterialPath` 实际叫 `getKnowledgeBaseFilePath`)
- ✅ 相对路径安全校验 `assertSafeKnowledgeRelativePath`(禁绝对/`..`/`.cherry`/NUL)—— 但在**主进程 helper**,不在 zod schema(plan §4.6/§15 暗示 schema 层)
- ✅ 文件拷入 base 目录;create 不再 `ensureExternalEntry`、不写 knowledge `file_ref`;`updateIndexedRelativePath` 取代 `replaceFileRef`
- ✅ path-based 文件处理 + 持久化恢复(remote-poll / 重启 / snapshot rehydrate)+ 原子写 markdown
- ✅ MinerU `context.dataId`;job payload 去掉 `sourceFileEntryId`/`processedFileEntryId`,归属用 `context.dataId === itemId` 校验
- ✅ 编排服务 `KnowledgeService` + `KnowledgeWorkflowService`(rename 已完成;顶层 `workflow-architecture.md`/`knowledge-service.md` 基本准确)
- ✅ 目录导入保留子树路径(`{ownerId}/<subtreePath>` 命名空间防撞名)、跳过 dotfile
- ✅ 删除 leaf/容器/base 顺序正确(向量→文件→最后删 row;删目录前先 close store);启动恢复 deleting items
- ✅ v1 迁移把上传文件拷入 base 目录、写 relativePath、不写 knowledge file_ref(`73f0a2a742`)
- ✅ 渲染层去 FileEntry:无 `/files/entries/:id`、add-items DTO 拆分(`KnowledgeRuntimeAddItemInput` 用绝对路径作 command input)、`fileProcessing.startJob` 用 `FileHandle`

---

## 6. 与 plan 相反的小偏离(需在文档改"现状",或重开决策)

| # | plan 要求 | 代码现状 | 证据 |
| --- | --- | --- | --- |
| 6.1 | 删除单 chunk `deleteItemChunk` 移除/unsupported | **仍全链路可用**(UI→preload→IPC→`deleteByIdAndExternalId`) | `KnowledgeService.ts:295-309,543`;`preload/index.ts:358`;`KnowledgeItemChunkDetailPanel.tsx:186` |
| 6.2 | 冲突默认 keep-both,生成 `_2/_3` | 实时 add **冲突直接报错** "Knowledge file already exists";仅 v1 迁移去重,用 `-1/-2`(连字符) | `pathStorage.ts:122-133`;`KnowledgeMigrator.ts:115-130` |
| 6.3 | v1 迁移不写旧 `libsql_vectorstores_embedding` | **仍写**(见 §4) | `KnowledgeVectorMigrator.ts:23` |
| 6.4 | 保留合法旧 `knowledge_item.id` 作 material_id | **全部重新生成** uuidv4/uuidv7;只留 legacy→new remap | `KnowledgeMappings.ts:253,400` |
| 6.5 | 缺文件标 `material.status = missing` | **无 material 表、无 missing 状态**;缺文件 → item failed | `knowledge.ts:51-58` 状态枚举无 missing |
| 6.6 | restore 复制源文件 + `indexedRelativePath` 产物 | 只复制源文件,**不复制已处理 markdown**,改为重新处理;`duplicateBase` **不存在** | `KnowledgeService.ts:484-508` |
| 6.7 | 附件按钮改用 knowledge material handle | **chat 附件直接删除**(`cb29aa3d19`),待 chat 管线迁移后再接 | `AttachmentButton.tsx:65-81` |

---

## 7. 文档级修正(已实现但文档错的"事实陈述")

- `knowledge-service.md` ~line 180:"item 级删除会清 file_ref" —— **错**。`deleteItemsByIds` 不碰 file_ref;只有 base 删除清。(`KnowledgeItemService.ts:350-374` vs `KnowledgeBaseService.ts:231-247`)
- `KnowledgeBaseService.delete` 仍删 knowledge `file_ref` 行(残留的 legacy 清理,虽然新建已不写)—— 文档应注明这是遗留清理。
- 存在 `v2-refactor-temp/docs/knowledge/knowledge-todo.md`,已记录"附件断开""note 占位"等 —— 更新时应与之**对账,避免重复/冲突**。

---

## 8. 按目标文档的更新清单(确认后据此执行)

### 8.1 `handoff-current-v2-knowledge-context-2026-06-08.md`
- 删除"尚未开始 / 没有产品代码 / 没有 POC / 先做 POC A/B"整块,换成"as-built 现状"小节(指向已实现+已测的子系统,以及唯一未建的 KnowledgeIndexStore)。

### 8.2 `current-v2-knowledge-index-migration-plan.md`(改动最大)
- §1/§3.2/§5/§6.1/§17:index.sqlite 位置统一改 `{baseId}/.cherry/index.sqlite`;两棵树同步;删"升级移动"步。
- §3.2 + §8 全节:按 §3.1 决策标"已放弃/被取代"或"已设计未实现"。
- §4.3/§4.4/§4.5/§6.4/§6.5/§6.6/§9:url/note/sitemap 按 §3.5 决策改写。
- §4.6/§15:澄清安全校验在 `pathStorage`,zod 仅形状。
- §5:服务改名为 `pathStorage.ts` 函数模块,列真实导出函数,删 keep-both/snapshot 责任(或标 TODO)。
- §6.2:冲突策略改"reject-on-conflict";补 reservedPaths 预检。
- §7:`FileProcessingOutputTarget` 改单臂 `{kind:'path'}`;删 managed_artifact 示例;补 MinerU 仅 dataId。
- §8.1/§8.4/§12:`deleteItemChunk` 仍在;embedding 改 restore 方案;external_id API 仍是运行时主路径。
- §10.4/§10.5:restore 现状(不复制 indexed 产物、无 duplicate)。
- §11:KnowledgeVectorMigrator 现状(孤立向量 bug 已修复 `a6128a6da9`,仍写旧单表);id 不保留只 remap;note 仍 inline。
- §13 改造清单:逐行更新"已做/未做/改名"。
- §14 阶段:阶段 1-3/5 多数已完成;阶段 4(KnowledgeIndexStore)未开始。

### 8.3 `index-sqlite-schema-design.md`
- 顶部加显著状态横幅:**整篇为"设计稿,尚未实现"**(按 §3.1 决策可能改为"已放弃")。§4 表状态列全部更正(0 张已建)。

### 8.4 `reviews/0608/final.md`
- §1/§6/§10:POC-gated 结论标历史;POC B 已完成,POC A 概念被向量库方案取代;blockers 多数已解。

### 8.5 `reviews/0608/subagents/*.md`
- 每篇顶部加 `STATUS 2026-06-08: 历史/部分被取代` 注记(02/03/04/05/06/07/08 各有具体陈旧点,见 raw 输出)。

### 8.6 顶层 `knowledge-service.md` / `workflow-architecture.md`
- 基本准确。仅修 `knowledge-service.md` 的 file_ref 误述;补 `deleteItemChunk`、reservedPaths 预检、文件处理轮询/超时常量。

### 8.7 飞书通俗版(`A96gdWCKGov1XRx0lmecOCbYnvb`)
- 同步:删"POC/尚未开始"叙事;index.sqlite 已在 `.cherry/`;向量库未换成 material 模型;url/note/sitemap 现状。按通俗版口吻改,细节以本地为准。

---

## 9. 需要你拍板的决策(汇总)

1. **index.sqlite/material 模型(§3.1):** 放弃 / 仍是目标(标未来) / 未决?
2. **url/note 快照模型 + sitemap(§3.5):** 放弃归 v2.x / 仍是 v2 TODO?sitemap 确认移除?
3. **embedding restore 方案(§3.3):** 确认为终态(`index_meta` snapshot 作废)?
4. **deleteItemChunk(§6.1):** 接受保留(改文档)/ 仍要移除?
5. **✅ 迁移孤立向量(§4):** 已用 `diagnose` 复核确认为真实 bug,并已在 `a6128a6da9` 修复。
6. **更新范围:** 全量(本地全部 + 飞书)/ 仅 migration-plan + schema + handoff + 飞书 / 仅本地不动飞书?
