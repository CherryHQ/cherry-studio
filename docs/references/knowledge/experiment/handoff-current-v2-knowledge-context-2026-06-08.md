# Handoff: 当前 v2 知识库改造上下文快速对齐

Date: 2026-06-08

## 1. 用途

这份 handoff 给新加入的 agent 快速理解当前任务背景。它不是评审报告，也不是实现计划，不要求 agent 立刻评审或改代码。

当前目标是让 agent 先对齐：

- 为什么当前 v2 知识库要改。
- 已经确认了哪些关键决策。
- 哪些文档是 source of truth。
- 飞书通俗版在哪里。
- 原始会话在哪里。
- 当前仓库里已经有哪些评审材料。

## 2. 当前任务状态

> 状态(2026-06-08): 原 handoff 写于「实现尚未开始」的前提，该前提已部分失效。baseline 在按 v2 原本计划正常实现、并为后续接入顺手做了一些改动后，**未来计划所需的不少地基已经具备**；但**核心索引层（material 模型 / `KnowledgeIndexStore`）仍未开始，仍是要执行的计划**。下面按 as-built 现状重列。

文档与评审已完成：

- 完整 `index.sqlite` schema 设计。
- 当前 v2 改造技术方案。
- 面向产品和工程沟通的飞书通俗版文档。
- 10-subagent 评审协议 handoff。
- 10 个 subagent 的评审报告和最终共识报告。

已具备的地基（baseline / 顺手已实现，后续在其上继续）：

- file leaf 数据模型 `{ source, relativePath, indexedRelativePath? }`，`fileEntryId` 已从 knowledge 移除。
- 中心化路径模块 `pathStorage.ts`（函数模块，非 class）+ 相对路径安全校验 `assertSafeKnowledgeRelativePath`（主进程 helper 层）。
- 用户上传文件已拷入 `KnowledgeBase/{baseId}/`，create 不再写 knowledge `file_ref`；`index.sqlite` 已在 `{baseId}/.cherry/index.sqlite`。
- path-based 文件处理（`FileHandle` / `output.kind = path` / `context.dataId`）+ 持久化恢复 + 原子写 markdown + MinerU 仅 dataId；job payload 已去 FileEntry。
- 编排服务 `KnowledgeService`（IPC + 恢复）+ `KnowledgeWorkflowService`（调度）；目录导入保留子树路径、跳过 dotfile；删除 / 启动恢复顺序正确。
- v1 迁移把上传文件拷入 base 目录、写 relativePath、不写 knowledge file_ref；渲染层去 FileEntry。

仍待执行（核心计划，尚未开始）：

- 9 表 `index.sqlite` + material 模型 + `KnowledgeIndexStore`（`rebuildMaterial` / `deleteMaterial` / `listMaterialUnits`）+ `index_meta` + `unit_id` + chunk offset + embedding GC。当前运行时仍是旧单表 `libsql_vectorstores_embedding` + `external_id` API。
- url / note 的 Markdown 快照（`captures/url`、`captures/note`）：当前 url 每次 reindex 联网抓取、note 读 inline `data.content`。
- material scanner、Agent-first material result、`read(locator)`（不属于当前 v2 必做项）。
- v1 迁移写新 `index.sqlite` 形态（向量孤立 bug 已修复 `a6128a6da9`；仍写旧单表格式，见第 8 节）。
- 没有拆实现 PR；没有知识库 E2E（index 相关测试因模型未建而无法写）。

当前边界：

- 不要直接修改产品代码、测试代码、schema 或迁移，除非任务明确要求推进 material 层。
- 如果要继续推进，应先阅读本文第 3 节全部入口，再确认下一步是「评审」「拆 issue」还是「做 POC A（material 层）」。

## 3. 必读材料

### 3.1 本地技术文档

优先阅读顺序：

1. [当前 v2 知识库改造技术方案](./current-v2-knowledge-index-migration-plan.md)
2. [知识库 index.sqlite 表结构设计](./index-sqlite-schema-design.md)
3. [当前 v2 知识库改造可行性评审 handoff](./handoff-current-v2-knowledge-review-2026-06-06.md)
4. [最终评审报告](./reviews/0608/final.md)
5. [Agent 10 总架构师评审](./reviews/0608/subagents/10-chief-architect.md)

产品和上下游背景：

- [Agent 管理型知识库产品文档](./agent-managed-knowledge-product.md)
- [Knowledge UI Presentation](./knowledge-ui-presentation-options.md)
- [KnowledgeService](../knowledge-service.md)
- [Knowledge Operation Guards](../operation-guards.md)
- [Knowledge Workflow Architecture](../workflow-architecture.md)
- [Knowledge Base Product Handoff](./handoff-knowledge-base-product-2026-06-06.md)

### 3.2 飞书文档

通俗版飞书文档：

- [当前 v2 知识库改造方案（通俗版）](https://mcnnox2fhjfq.feishu.cn/docx/A96gdWCKGov1XRx0lmecOCbYnvb)

用途：

- 给产品、工程、架构评审参与者快速理解背景。
- 不替代本地技术方案。
- 如果飞书文档和本地 Markdown 有差异，以本地 Markdown 技术文档为准。

### 3.3 原始会话

原始会话记录：

```text
/Users/eeee/.codex/sessions/2026/06/06/rollout-2026-06-06T15-54-41-019e9bed-5052-7cd1-bafd-b54be98032a5.jsonl
```

用途：

- 校验用户真实决策。
- 检查是否把讨论中的某个 v2.x 能力误写成当前 v2 必做。
- 检查 `knowledge_base`、`knowledge_item`、FileEntry、MinerU、snippet、embedding、删除、迁移等关键决策是否被正确保留。

### 3.4 评审报告

10-subagent 评审产物：

- [01 原始会话审计](./reviews/0608/subagents/01-original-session-audit.md)
- [02 数据模型与 schema](./reviews/0608/subagents/02-data-model-and-schema.md)
- [03 文件存储与路径](./reviews/0608/subagents/03-file-storage-and-paths.md)
- [04 FileProcessing 与 MinerU](./reviews/0608/subagents/04-file-processing-and-mineru.md)
- [05 IndexStore 与搜索](./reviews/0608/subagents/05-index-store-and-search.md)
- [06 Workflow、Jobs 与恢复](./reviews/0608/subagents/06-workflow-jobs-and-recovery.md)
- [07 迁移、删除与恢复](./reviews/0608/subagents/07-migration-delete-restore.md)
- [08 UI、Preload 与 IPC](./reviews/0608/subagents/08-ui-preload-ipc.md)
- [09 测试与 rollout](./reviews/0608/subagents/09-testing-and-rollout.md)
- [10 总架构师](./reviews/0608/subagents/10-chief-architect.md)
- [最终共识报告](./reviews/0608/final.md)

## 4. 一句话背景

当前 v2 仍在开发阶段，向量库 schema、文件导入方式和 `knowledge_item.data` 都可以改。现在要趁 v2 还未稳定，把底层数据形态先改成未来 v2.x 文件夹型知识库能直接接上的结构，降低后续用户切换时的迁移、复制和重嵌入成本。

## 5. 核心目标

> 状态(2026-06-08): baseline 已直接采用隐藏布局，`index.sqlite` 已在 `{baseId}/.cherry/index.sqlite`，原先「v2 放根目录、v2.x 再移动」的区分已作废。`captures/url`、`captures/note` 快照仍待实现（当前 url 每次联网抓取、note 读 inline）。

当前 v2 的目录（已采用 v2.x 隐藏布局）：

```text
KnowledgeBase/
  {baseId}/
    .cherry/
      index.sqlite
    user-file.pdf
    user-file.md
    captures/          # 仍待实现
      url/
      note/
```

索引库已在 `.cherry/` 下，v2 -> v2.x 切换无需再移动 `index.sqlite`。整体目标仍是：用户文件无需重复复制、chunk 无需重切、向量无需重嵌（material 层落地后由 `index_meta` snapshot 选择性重嵌保证）。

## 6. 已确认的关键决策

当前 v2：

- 保留全局 `knowledge_base`。
- 保留全局 `knowledge_item`，当前 v2 UI 仍依赖它。
- `knowledge_item.id = material.material_id`。
- 用户上传文件直接复制到 `KnowledgeBase/{baseId}/`。（已具备）
- `index.sqlite` 位于 `KnowledgeBase/{baseId}/.cherry/index.sqlite`。（已具备，baseline 已采用隐藏布局）
- FileManager `file_entry` 不再作为知识库材料身份。（已具备）
- URL 和 note 计划保存成本地 Markdown 快照。（仍待执行：当前 url 每次 reindex 联网抓取、note 读 inline `data.content`）
- 同路径冲突采用 reject-on-conflict（报错），仅 v1 迁移器去重；sitemap 已不作为独立 item 类型，v1 sitemap 迁移为 `url`。（已具备）
- MinerU 当前只保存最终 Markdown，不保存 artifacts、assets、页面缓存。
- PDF 处理后，当前 v2 UI 仍显示 PDF item，但索引读取 Markdown。
- 当前 v2 搜索结果仍保持旧 chunk-oriented shape。
- 当前 v2 仍要求 embedding model 和 dimensions 有效。
- 当前 v2 不启用 watcher、FTS-only、内容索引 UI、`material_relation` 正式维护。
- 删除或重建以 material 为单位，不支持单 chunk 删除。

v2.x：

- 真实文件夹逐步成为材料事实。
- watcher / scan 自动发现文件。
- embedding 可以成为增强项，FTS-only 可用。
- Markdown 处理产物成为独立 visible material。
- `content_index_entry`、`material_relation`、Agent-first material result 和 `read(locator)` 再正式启用。

## 7. 最终评审结论摘要

最终评审结论见 [reviews/0608/final.md](./reviews/0608/final.md)。

摘要：

- 结论：有条件可行。
- 这不是小型 schema 改动，而是跨数据契约、路径所有权、file processing、JobManager recovery、index/search、migration、UI/preload 的系统迁移。
- 当时建议先做两个窄 POC：
  - `KnowledgeIndexStore` over `{baseId}/.cherry/index.sqlite`
  - path-based file processing with `FileHandle`、`output.kind = path`、`context.dataId`

> 状态(2026-06-08): POC B（path-based file processing）的地基已在 baseline 落地（`FileHandle` / `output.kind = path` / `context.dataId` 已就绪），其验证目标基本由正常实现覆盖。POC A（`KnowledgeIndexStore` / material 模型）**仍未开始，仍是要执行的计划**——运行时仍是旧单表 `libsql_vectorstores_embedding` + `external_id`。

估算：

- 生产代码涉及约 45-75 个文件。
- 核心代码改动约 4,500-8,500 LOC。
- 测试代码改动约 6,000-11,000 LOC。

## 8. 新 agent 不要误解的点

不要误解为：

- “现在要开始写代码”。当前仍是上下文对齐和规划阶段。
- “只要改向量表”。实际涉及导入、路径、FileProcessing、Job、Reader、Search、Migration、UI。
- “可以删掉 `knowledge_item`”。当前 v2 必须保留。
- “FileEntry 只是一处字段”。FileEntry 依赖分散在 service、reader、file processing、UI、migration、tests。
- “MinerU 产物要保存 artifacts/assets”。当前只保存最终 Markdown。
- “v2 要做 watcher / FTS-only / content index UI”。这些是 v2.x 能力，不是当前 v2 必做。
- “旧 v2 开发期数据必须兼容”。稳定目标是 v1 -> 最终当前 v2 的迁移终态。
- “v1 向量迁移已写成 9 表 material 终态”。孤立路径 bug（写 legacy 扁平路径、运行时读 `{newBaseId}/.cherry/index.sqlite` 读不到）已在 `a6128a6da9` 修复，迁移后向量现在写到运行时读得到的位置；但迁移器**仍写旧单表 `libsql_vectorstores_embedding` 格式**，不要当作已写成 9 表 material 终态。

## 9. 如果下一步是继续推进

建议先确认下一步是哪一种：

1. 继续方案讨论：阅读第 3 节文档，围绕 open questions 继续问。
2. 拆 issue / PR：从 [reviews/0608/final.md](./reviews/0608/final.md) 的 implementation phases 拆。
3. 做 POC A：只验证 `KnowledgeIndexStore` / material 模型，不要碰 UI 和 migration。这是当前仍未开始、最关键的未来工作。
4. 做正式实现：material 层落地后接上索引 / 搜索 / 迁移写新形态。

> 状态(2026-06-08): 原 POC B（path-based file processing）地基已在 baseline 落地，不再作为独立待验证项；剩余焦点是 POC A（material 层）。

## 10. 建议 skills

建议新 agent 根据任务选择：

- `grill-with-docs`：继续对照已沉淀文档和原始决策讨论方案。
- `zoom-out`：快速理解当前改造在 v2 / v2.x 架构中的位置。
- `improve-codebase-architecture`：评估模块边界、服务拆分和长期维护成本。
- `diagnose`：遇到具体代码依赖 blocker 时定位调用链。
- `gh-pr-review` 或 `pr-review-toolkit`：后续有实现 PR 后再做代码审查。

## 11. 当前 Git 状态提示

已提交的方案文档提交：

```text
c68ec2fdc docs(knowledge): add current v2 migration plan
```

当前工作区可能还有未提交文档：

- `docs/references/knowledge/handoff-current-v2-knowledge-review-2026-06-06.md`
- `docs/references/knowledge/reviews/`
- 本 handoff 文件

新 agent 接手前应先运行：

```bash
git status --short
```

不要覆盖用户或其他 agents 的未提交文档改动。

