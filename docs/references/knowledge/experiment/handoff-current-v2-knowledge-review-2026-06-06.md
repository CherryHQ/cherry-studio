# Handoff: 当前 v2 知识库改造可行性评审

Date: 2026-06-06

## 1. 这份 handoff 给谁看

这份文档给后续参与评审的 agents 使用，目标是评估当前 v2 知识库改造的代码量、可行性、风险和拆分方式。

不要把这份文档当作最终技术方案。完整方案已经沉淀在现有文档里，本 handoff 只负责解释背景、评审目标和应该重点看的地方。

## 2. 必读材料

请优先阅读这些材料，不要只看本 handoff：

- [当前 v2 知识库改造技术方案](./current-v2-knowledge-index-migration-plan.md)
- [知识库 index.sqlite 表结构设计](./index-sqlite-schema-design.md)
- [Agent 管理型知识库产品文档](./agent-managed-knowledge-product.md)
- [Knowledge UI Presentation](./knowledge-ui-presentation-options.md)
- [KnowledgeService](./knowledge-service.md)
- [Knowledge Operation Guards](./operation-guards.md)
- 飞书通俗版文档：[当前 v2 知识库改造方案（通俗版）](https://mcnnox2fhjfq.feishu.cn/docx/A96gdWCKGov1XRx0lmecOCbYnvb)
- 原始会话记录：`/Users/eeee/.codex/sessions/2026/06/06/rollout-2026-06-06T15-54-41-019e9bed-5052-7cd1-bafd-b54be98032a5.jsonl`

相关提交：

- `c68ec2fdc docs(knowledge): add current v2 migration plan`

## 3. 背景一句话

当前 v2 仍处于开发阶段，向量库 schema、文件导入方式、`knowledge_item.data` 都可以改。目标是在 v2 阶段先把底层数据形态改成未来 v2.x 文件夹型知识库可以直接接上的样子，减少用户后续从 v2 切到 v2.x 时的文件搬迁、索引重建和重嵌入成本。

当前 v2 要做到：

```text
KnowledgeBase/
  {baseId}/
    index.sqlite
    user-file.pdf
    user-file.md
    captures/
      url/
      note/
```

未来 v2.x 再移动为：

```text
KnowledgeBase/
  {baseId}/
    .cherry/
      index.sqlite
    user-file.pdf
    user-file.md
    captures/
      url/
      note/
```

## 4. 已确认的核心决策

当前 v2：

- 继续保留全局 `knowledge_base`。
- 继续保留全局 `knowledge_item`，因为当前 v2 UI 仍依赖它。
- `knowledge_item.id = index.sqlite.material.material_id`。
- 用户上传文件直接复制到 `KnowledgeBase/{baseId}/`。
- `index.sqlite` 位于 `KnowledgeBase/{baseId}/index.sqlite`。
- 不再用 FileManager `file_entry` 作为知识库材料身份。
- URL 和 note 都落成本地 Markdown 快照。
- MinerU 当前只保存最终 Markdown，不保存 artifacts、assets、页面缓存。
- PDF 处理后，当前 v2 UI 仍显示 PDF item，但索引读取 Markdown。
- 当前 v2 搜索结果仍保持旧 chunk-oriented shape。
- 当前 v2 仍要求 embedding model 和 dimensions 有效。
- 当前 v2 不启用 watcher、FTS-only、内容索引 UI、`material_relation` 正式维护。
- 删除或重建以 material 为单位，不再支持单 chunk 删除。

v2.x：

- 真实文件夹逐步成为材料事实。
- `index.sqlite` 移动到 `.cherry/index.sqlite`。
- watcher / scan 自动发现文件。
- embedding 可以成为增强项，FTS-only 可用。
- Markdown 处理产物成为独立 visible material。
- `content_index_entry`、`material_relation`、Agent-first material result 和 `read(locator)` 再正式启用。

## 5. 评审目标

本轮不是实现任务。所有 subagents 只做方案规划、代码量评估、风险识别和执行计划设计，不修改任何产品代码、测试代码、schema 或迁移文件。允许新增或更新评审报告文档。

请评审以下问题：

- 这个改造是否可以在当前 v2 阶段落地？
- 代码改动范围是否被低估？
- 哪些模块必须一起改，哪些可以分阶段？
- 是否存在无法兼容当前 UI / JobManager / DataApi / fileProcessing 的硬阻塞？
- 是否有更小的阶段切分方式，既能保证 v2 可用，又不破坏 v2.x 兼容目标？
- 是否应该先做 POC 验证 `KnowledgeIndexStore` 和 path-based file processing？

## 6. 需要重点评审的代码区域

请重点看这些模块。这里列的是评审入口，不是完整文件列表。

所有 agents 都必须先做全项目级调研，不能只看局部文件。每个 agent 在进入自己模块前，至少要用 `rg` / `rg --files` 建立知识库相关调用图，覆盖：

- `knowledge`
- `Knowledge`
- `knowledge_item`
- `knowledge_base`
- `fileEntryId`
- `file_ref`
- `replaceByExternalId`
- `processedFileEntryId`
- `sourceFileEntryId`
- `FileProcessing`
- `document_to_markdown`
- `MinerU`
- `deleteItemChunk`
- `SaveToKnowledge`
- `KnowledgeBase/{baseId}`

每份 subagent 报告必须包含 `Codebase Survey` 小节，说明：

- 实际搜索过哪些关键词或路径。
- 读过哪些核心文件。
- 发现了哪些跨模块依赖。
- 哪些区域没有覆盖，为什么没有覆盖。
- 是否发现与自己模块外相关的风险，并指派给哪个 agent 交叉 review。

| 区域 | 评审重点 |
| --- | --- |
| `src/shared/data/types/knowledge.ts` | `knowledge_item.data` 从 `fileEntryId` / inline content 改成 `relativePath` 后，schema、Create DTO、Runtime DTO 是否能自洽。 |
| `src/main/data/services/KnowledgeItemService.ts` | 当前 create、delete、file_ref 维护逻辑是否能彻底移除 FileEntry 作为 knowledge material identity。 |
| `src/main/services/knowledge/KnowledgeWorkflowService.ts` | add、schedule、reindex、delete 是否能以 base 目录文件为事实运行。 |
| `src/main/services/knowledge/utils/sources/*` | directory / sitemap expansion 是否能复制文件、生成 URL snapshot，而不是继续创建 FileEntry 或只保存 URL child。 |
| `src/main/services/knowledge/readers/*` | file / URL / note reader 是否能统一改成读取 `KnowledgeBase/{baseId}/{relativePath}`。 |
| `src/main/services/fileProcessing/*` | `StartFileProcessingJobInput` 改为 `FileHandle + output target + context` 后，对现有调用方和 Job recovery 的影响。 |
| `src/main/services/fileProcessing/processors/mineru/*` | MinerU provider 的 `data_id`、幂等重试、path output、Markdown 原子写入。 |
| `src/main/services/knowledge/vectorstore/*` | 旧 `BaseVectorStore` / `external_id` 抽象替换为 `KnowledgeIndexStore` 的代码量。 |
| `packages/vectorstores/libsql/*` | 是直接改 libSQL vectorstore，还是新增 knowledge 专用 store。 |
| `src/main/services/knowledge/jobs/*` | `processedFileEntryId`、`sourceFileEntryId`、`replaceByExternalId`、reindex completed 快路径等旧假设。 |
| `src/main/services/knowledge/KnowledgeService.ts` | delete base、restore base 当前是否只处理旧 vector store 和旧 item data。 |
| `src/main/data/migration/v2/*` | v1 migration 是否能直接生成 base 目录、Markdown snapshot、新 `index.sqlite`，而不是迁旧向量表。 |
| `src/preload/index.ts` | knowledge / fileProcessing IPC contract 是否需要同步改。 |
| `src/renderer/pages/knowledge/*` | UI 是否还请求 `/files/entries/:id`，是否还暴露单 chunk 删除。 |
| `src/renderer/components/Popups/SaveToKnowledgePopup.tsx` | 保存到知识库入口是否仍创建 FileEntry 或提交 inline note content。 |

## 7. 初步代码量判断

这不是一个“小改 schema”的任务，而是跨数据模型、文件管理、任务系统、索引库、迁移和 UI 的系统性改造。

建议按阶段评估，不建议单 PR 一次做完：

| 阶段 | 代码量 | 风险 |
| --- | --- | --- |
| 目录路径服务和 `index.sqlite` 初始化 | 中 | 路径安全、旧 `KnowledgeBase/{baseId}` 文件与新目录冲突 |
| `knowledge_item.data` 和导入落盘 | 中到大 | DTO、DataApi、UI、service 都会受影响 |
| fileProcessing path mode | 大 | Job recovery、remote poll、MinerU provider contract、其他调用方兼容 |
| `KnowledgeIndexStore` 替换旧 vectorstore | 大 | schema、事务、FTS、embedding、search result 兼容 |
| reader / chunk / embed offset 改造 | 中到大 | chunk offset 正确性、重复文本匹配、旧 result shape |
| delete / reindex / restore / duplicate | 中到大 | 崩溃恢复、文件残留、index store close |
| v1 migration | 大 | 迁移终态稳定性、旧向量复用策略、合法旧 id 保留 |
| UI / preload / IPC 收尾 | 中 | FileEntry 依赖散落、单 chunk 删除入口 |
| 测试补齐 | 大 | 数据库、文件系统、Job、迁移、UI 都需要覆盖 |

整体判断：可行，但需要分阶段落地，并且至少需要一个窄 POC 验证新 `KnowledgeIndexStore` 和 path-based file processing。

## 8. 关键可行性风险

### 8.1 FileEntry 依赖可能比预期更散

当前 v2 代码中 FileEntry 影响至少包括：

- item create 校验
- `file_ref`
- file reader
- file processing input
- processed artifact output
- UI 展示和 preview
- 保存到知识库弹窗
- 附件按钮

评审时不要只看 `knowledge_item.data.fileEntryId`，要按调用链检查。

### 8.2 path-based file processing 的恢复语义必须先想清楚

path output 不能只存在内存里。否则远程处理、轮询、进程重启、JobSnapshot rehydrate 后会丢失输出路径。

需要明确：

- job input 持久化 `file: FileHandle`
- job input 持久化 `output: FileProcessingOutputTarget`
- job input 持久化 `context.dataId`
- job output 持久化实际输出 path
- MinerU 重试要幂等写同一目标 Markdown

### 8.3 `KnowledgeIndexStore` 不是简单改名

旧 vectorstore 是 `external_id` 抽象。新方案是 material 级索引：

- `material`
- `content`
- `search_unit`
- `search_text`
- `embedding`
- `search_text_fts`

还要支持：

- `rebuildMaterial` 原子替换
- embedding hash 复用和 GC
- FTS rowid 正确回表
- search 结果兼容当前 v2 旧 chunk shape
- 未来 locator/read 能接上

### 8.4 v1 migration 是稳定终态，不是开发期临时迁移

当前开发中的 v2 数据可以重建，但 v1 迁到 v2 的终态必须稳定。

评审时重点看：

- 是否保留合法旧 `knowledge_item.id`
- 是否生成 base 目录和 Markdown snapshot
- 是否不再写 knowledge `file_ref`
- 是否不再迁旧 `libsql_vectorstores_embedding`
- 是否按新 schema 重建索引

### 8.5 删除和恢复容易漏文件

删除必须最后删 `knowledge_item` row，因为 row 里保存 `relativePath` / `indexedRelativePath`。如果先删 row，崩溃后就失去清理依据。

restore / duplicate 不能重新依赖外部 `source`，必须复制知识库目录内的材料文件。处理过的 PDF 要同时复制 PDF 和 Markdown。

## 9. 10 个 subagents 的评审编排

本次评审需要使用 10 个 subagents。不要只让少量 agents 粗略看一遍，也不要让所有 agents 做重复审查。每个 subagent 必须有明确分工、明确报告文件和交叉 review 责任。

报告目录固定为：

```text
docs/references/knowledge/reviews/
  subagents/
    01-original-session-audit.md
    02-data-model-and-schema.md
    03-file-storage-and-paths.md
    04-file-processing-and-mineru.md
    05-index-store-and-search.md
    06-workflow-jobs-and-recovery.md
    07-migration-delete-restore.md
    08-ui-preload-ipc.md
    09-testing-and-rollout.md
    10-chief-architect.md
  final.md
```

### 9.1 Agent 01：原始会话审计

职责：

- 只负责审计原始会话记录和当前文档是否一致。
- 必须读取原始会话：`/Users/eeee/.codex/sessions/2026/06/06/rollout-2026-06-06T15-54-41-019e9bed-5052-7cd1-bafd-b54be98032a5.jsonl`
- 对照 [当前 v2 知识库改造技术方案](./current-v2-knowledge-index-migration-plan.md) 和 [知识库 index.sqlite 表结构设计](./index-sqlite-schema-design.md)。

重点问题：

- 是否遗漏用户已经拍板的决策。
- 是否把 v2.x 能力错误写成当前 v2 必做。
- 是否有材料 ID、FileEntry、MinerU、snippet、embedding、删除、迁移等关键决策冲突。

输出：

- `docs/references/knowledge/reviews/subagents/01-original-session-audit.md`

### 9.2 Agents 02-09：八个模块评审

这 8 个 agents 分别评审一个模块，不要互相重复。

| Agent | 报告文件 | 评审范围 | 必看入口 |
| --- | --- | --- | --- |
| 02 | `02-data-model-and-schema.md` | `knowledge_base`、`knowledge_item.data`、全局 DB、per-base `index.sqlite` schema、`material_id` 规则 | `src/shared/data/types/knowledge.ts`, `src/main/data/db/schemas/knowledge.ts`, `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md` |
| 03 | `03-file-storage-and-paths.md` | base 目录、路径安全、文件复制、URL/note snapshot、directory/sitemap expansion、`.cherry` 边界 | `src/main/core/paths/README.md`, `src/main/services/knowledge/utils/sources/*`, path registry |
| 04 | `04-file-processing-and-mineru.md` | `FileHandle`、path output、JobSnapshot recovery、MinerU provider contract、Markdown 原子写入 | `src/shared/file/types/handle.ts`, `src/main/services/fileProcessing/*`, `src/main/services/fileProcessing/processors/mineru/*` |
| 05 | `05-index-store-and-search.md` | `KnowledgeIndexStore`、libSQL vectorstore、FTS、embedding、chunk offset、旧 search result 兼容 | `src/main/services/knowledge/vectorstore/*`, `packages/vectorstores/libsql/*`, `src/main/services/knowledge/utils/indexing/*` |
| 06 | `06-workflow-jobs-and-recovery.md` | add/reindex/delete/index/check-processing jobs、JobManager、幂等、崩溃恢复、base mutation lock | `src/main/services/knowledge/KnowledgeWorkflowService.ts`, `src/main/services/knowledge/jobs/*` |
| 07 | `07-migration-delete-restore.md` | v1 migration、KnowledgeVectorMigrator、delete base、restore/duplicate、文件清理、旧 id 保留 | `src/main/data/migration/v2/*`, `src/main/services/knowledge/KnowledgeService.ts`, `src/main/data/services/KnowledgeBaseService.ts` |
| 08 | `08-ui-preload-ipc.md` | UI FileEntry 依赖、SaveToKnowledgePopup、AttachmentButton、preload、IPC contract、delete chunk 入口 | `src/preload/index.ts`, `src/renderer/pages/knowledge/*`, `src/renderer/components/Popups/SaveToKnowledgePopup.tsx` |
| 09 | `09-testing-and-rollout.md` | 测试策略、POC 顺序、PR 拆分、回滚方案、上线风险、验收标准 | `tests/`, `docs/references/data/`, 本 handoff 第 7-8 节 |

每个模块评审必须回答：

```text
1. 结论
   - 可行 / 有条件可行 / 暂不建议

2. Codebase Survey
   - 使用过的 rg / rg --files 搜索关键词
   - 阅读过的核心文件
   - 发现的跨模块调用链
   - 未覆盖区域和原因

3. 代码量评估
   - small / medium / large / very large
   - 最重的 3 个文件或模块
   - 预计新增 / 修改 / 删除的文件数量级
   - 预计核心代码改动行数区间
   - 预计测试代码改动行数区间

4. 必须改的代码点
   - 具体文件
   - 具体函数 / 类型 / job / IPC

5. 阻塞问题
   - 必须先决策或 POC 的问题

6. 阶段拆分建议
   - 哪些可以先做
   - 哪些必须一起做
   - 每个阶段预计代码量

7. 测试建议
   - 必须新增的测试

8. 对其他模块的依赖
   - 需要哪个 agent 的结论
```

### 9.3 Agent 10：总架构师

Agent 10 是总架构师，不直接替代其他 agents 的评审。

职责：

- 在 8 个模块 agents 完成交叉 review 并修订报告后，再阅读 01-09 的全部报告。
- 基于已经交叉 review 过的报告做最终架构评审。
- 找出仍然存在的相互冲突、重复、遗漏、阶段顺序不一致的地方。
- 如仍有 blocker 冲突，要求相关 agents 再次修正；否则输出最终拍板意见。
- 输出最终拍板意见。

输出：

- `docs/references/knowledge/reviews/subagents/10-chief-architect.md`
- `docs/references/knowledge/reviews/final.md`

`10-chief-architect.md` 记录总架构师自己的审查过程和冲突处理。

`reviews/final.md` 是最终共识报告，必须是 10 个 subagents 达成共识后的方案，不是单个 agent 的个人意见。

## 10. 交叉 review 流程

评审必须按下面流程执行：

1. Agent 01 先完成原始会话审计，确认文档是否忠实于用户决策。
2. Agents 02-09 并行完成模块评审。
3. Agents 02-09 先互相交叉 review，不要先交给 Agent 10。
4. 每个模块 agent 完成初稿后，至少交叉阅读两个相邻模块报告：
   - 02 读 03、05
   - 03 读 02、04
   - 04 读 03、06
   - 05 读 02、06、09
   - 06 读 04、05、07
   - 07 读 03、06、09
   - 08 读 02、06、09
   - 09 读 05、06、07、08
5. 交叉 review 后，每个 agent 必须在自己的报告里追加 `Cross Review Notes`，并根据收到的意见修订自己的结论。
6. Agents 02-09 完成互审和修订后，才把 01-09 的报告交给 Agent 10。
7. Agent 10 读取所有报告，列出剩余冲突矩阵。
8. 如果仍有 blocker 冲突，Agent 10 指定对应 agents 再修订报告。
9. 所有冲突关闭后，Agent 10 生成 `reviews/final.md`。

禁止：

- 只生成最终报告，不生成 subagent 报告。
- 只看局部文件，不做全项目调用图调研。
- 只做代码扫描，不读设计文档。
- 只按原始技术方案复述，不评估代码量和可行性。
- 把 v2.x 能力误判为当前 v2 必须实现。
- 忽略原始会话审计。
- 修改产品代码、测试代码、schema、迁移或 UI 文件。本轮只允许写评审报告文档。
- 直接开始 POC 或实现。

## 11. `reviews/final.md` 必须包含的内容

最终报告必须包含：

```text
1. Executive Summary
   - 最终结论：可行 / 有条件可行 / 不建议当前做
   - 最大风险
   - 建议先做的 POC

2. Consensus Decisions
   - 10 个 subagents 已达成一致的判断

3. Codebase Survey Coverage
   - 10 个 subagents 实际覆盖的路径和关键词
   - 跨模块依赖图摘要
   - 尚未覆盖或需要后续确认的代码区域

4. Code Volume Estimate
   - 按模块估算 small / medium / large / very large
   - 总体复杂度
   - 预计修改文件数区间
   - 预计核心代码改动行数区间
   - 预计测试代码改动行数区间

5. Proposed Implementation Phases
   - 每个阶段目标
   - 涉及文件
   - 验收标准
   - 是否可单独 PR
   - 每个阶段预计代码量
   - 推荐执行顺序

6. Blockers and Open Questions
   - 必须先解决的问题
   - 需要用户再拍板的问题

7. Risk Register
   - 风险
   - 影响
   - 缓解方案

8. Test Plan
   - 单元测试
   - 集成测试
   - 迁移测试
   - UI / IPC 测试

9. Subagent Report Index
   - 链接 01-10 的报告

10. Execution Plan
   - 推荐拆成哪些 POC / PR / issue
   - 每一步的输入、输出和停止条件
   - 哪些阶段可以并行，哪些必须串行
```

## 12. 建议优先问的问题

评审 agents 可以重点回答这些问题：

```text
1. 结论
   - 可行 / 有条件可行 / 暂不建议

2. 代码量评估
   - 按阶段给出 small / medium / large
   - 指出最重的 3 个模块

3. 阻塞问题
   - 是否存在必须先做 POC 的点
   - 是否存在设计冲突

4. 推荐拆分
   - 建议拆成哪些 PR / issues
   - 每个阶段的验收标准

5. 漏项
   - 当前文档没覆盖或低估的模块

6. 测试建议
   - 哪些测试必须先补
```

## 10. 建议优先问的问题

评审 agents 可以重点回答这些问题：

- 是否应该先新增 `KnowledgeIndexStore`，还是直接重写 `packages/vectorstores/libsql`？
- path-based file processing 是否会破坏现有非知识库调用方？
- 当前 v2 是否可以完全移除 knowledge file_ref，还是需要过渡期？
- URL / note snapshot 生成应该放在 workflow、reader，还是单独 source material service？
- directory import 是先复制整棵树再建 child item，还是按 leaf 边复制边建 item 更稳？
- `indexedRelativePath` 写回后，`material.relative_path` 是否始终指向实际索引文件？
- PDF -> Markdown 在 v2.x 拆分时，当前 material_id 归属 Markdown 是否会影响 UI 历史引用？
- v1 旧 embedding 是否值得复用，还是直接明确全部重嵌入更简单？
- `deleteItemChunk` 是彻底移除还是保留 unsupported stub？
- 这次改造是否需要先冻结当前 v2 知识库 UI 的新增功能？

## 13. 建议 skills

建议后续 agents 使用：

- `grill-with-docs`：继续对照现有文档和术语评审方案，不要偏离已确认决策。
- `zoom-out`：评估这个改造在整个 v2 / v2.x 架构中的位置和阶段切分。
- `improve-codebase-architecture`：从代码架构角度评估模块边界、服务拆分和长期维护成本。
- `diagnose`：如果评审过程中发现具体 blocker，用诊断流程定位真实依赖链。
- `gh-pr-review` 或 `pr-review-toolkit`：后续有实现 PR 后，用代码审查视角检查回归风险。

## 14. 当前状态

已完成：

- 完整 `index.sqlite` schema 设计文档。
- 当前 v2 改造技术方案文档。
- 飞书通俗版文档。
- 文档已提交到 Git：`c68ec2fdc docs(knowledge): add current v2 migration plan`。

未完成：

- 尚未开始代码实现。
- 尚未拆 issue / PR。
- 尚未做 POC。
- 尚未跑实现相关测试。

当前下一轮目标：

- 只做方案规划评审。
- 输出可执行计划。
- 输出预计修改代码量。
- 不做代码实现。

下一步建议：

1. 启动 10 个 subagents，按第 9 节分工生成报告。
2. 先让 Agents 02-09 完成交叉 review，并修订各自报告。
3. 再把 01-09 的报告交给 Agent 10 做最终架构评审。
4. 由 Agent 10 生成 `docs/references/knowledge/reviews/final.md`。
5. 根据 `reviews/final.md` 决定是否先做 `KnowledgeIndexStore + index.sqlite 初始化` 或 path-based file processing 的 POC。
6. 再评估是否进入完整 v2 改造实现。
