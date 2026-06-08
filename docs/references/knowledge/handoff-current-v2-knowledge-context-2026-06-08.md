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

已完成：

- 完整 `index.sqlite` schema 设计。
- 当前 v2 改造技术方案。
- 面向产品和工程沟通的飞书通俗版文档。
- 10-subagent 评审协议 handoff。
- 10 个 subagent 的评审报告和最终共识报告。

尚未开始：

- 没有开始产品代码实现。
- 没有开始 POC。
- 没有拆实现 PR。
- 没有跑实现相关测试。

当前边界：

- 现在仍是方案规划和上下文对齐阶段。
- 不要直接修改产品代码、测试代码、schema 或迁移。
- 如果要继续推进，应先阅读本文第 3 节全部入口，再确认下一步是“评审”“拆 issue”还是“做 POC”。

## 3. 必读材料

### 3.1 本地技术文档

优先阅读顺序：

1. [当前 v2 知识库改造技术方案](./current-v2-knowledge-index-migration-plan.md)
2. [知识库 index.sqlite 表结构设计](./index-sqlite-schema-design.md)
3. [当前 v2 知识库改造可行性评审 handoff](./handoff-current-v2-knowledge-review-2026-06-06.md)
4. [最终评审报告](./reviews/final.md)
5. [Agent 10 总架构师评审](./reviews/subagents/10-chief-architect.md)

产品和上下游背景：

- [Agent 管理型知识库产品文档](./agent-managed-knowledge-product.md)
- [Knowledge UI Presentation](./knowledge-ui-presentation-options.md)
- [KnowledgeService](./knowledge-service.md)
- [Knowledge Operation Guards](./operation-guards.md)
- [Knowledge Workflow Architecture](./workflow-architecture.md)
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

- [01 原始会话审计](./reviews/subagents/01-original-session-audit.md)
- [02 数据模型与 schema](./reviews/subagents/02-data-model-and-schema.md)
- [03 文件存储与路径](./reviews/subagents/03-file-storage-and-paths.md)
- [04 FileProcessing 与 MinerU](./reviews/subagents/04-file-processing-and-mineru.md)
- [05 IndexStore 与搜索](./reviews/subagents/05-index-store-and-search.md)
- [06 Workflow、Jobs 与恢复](./reviews/subagents/06-workflow-jobs-and-recovery.md)
- [07 迁移、删除与恢复](./reviews/subagents/07-migration-delete-restore.md)
- [08 UI、Preload 与 IPC](./reviews/subagents/08-ui-preload-ipc.md)
- [09 测试与 rollout](./reviews/subagents/09-testing-and-rollout.md)
- [10 总架构师](./reviews/subagents/10-chief-architect.md)
- [最终共识报告](./reviews/final.md)

## 4. 一句话背景

当前 v2 仍在开发阶段，向量库 schema、文件导入方式和 `knowledge_item.data` 都可以改。现在要趁 v2 还未稳定，把底层数据形态先改成未来 v2.x 文件夹型知识库能直接接上的结构，降低后续用户切换时的迁移、复制和重嵌入成本。

## 5. 核心目标

当前 v2 改造后的目录：

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

未来 v2.x 目录：

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

期望 v2 -> v2.x 切换时尽量只移动：

```text
KnowledgeBase/{baseId}/index.sqlite
  -> KnowledgeBase/{baseId}/.cherry/index.sqlite
```

不重新复制用户文件，不重新切 chunk，不重嵌入。

## 6. 已确认的关键决策

当前 v2：

- 保留全局 `knowledge_base`。
- 保留全局 `knowledge_item`，当前 v2 UI 仍依赖它。
- `knowledge_item.id = material.material_id`。
- 用户上传文件直接复制到 `KnowledgeBase/{baseId}/`。
- `index.sqlite` 位于 `KnowledgeBase/{baseId}/index.sqlite`。
- FileManager `file_entry` 不再作为知识库材料身份。
- URL 和 note 都保存成本地 Markdown 快照。
- MinerU 当前只保存最终 Markdown，不保存 artifacts、assets、页面缓存。
- PDF 处理后，当前 v2 UI 仍显示 PDF item，但索引读取 Markdown。
- 当前 v2 搜索结果仍保持旧 chunk-oriented shape。
- 当前 v2 仍要求 embedding model 和 dimensions 有效。
- 当前 v2 不启用 watcher、FTS-only、内容索引 UI、`material_relation` 正式维护。
- 删除或重建以 material 为单位，不支持单 chunk 删除。

v2.x：

- 真实文件夹逐步成为材料事实。
- `index.sqlite` 移动到 `.cherry/index.sqlite`。
- watcher / scan 自动发现文件。
- embedding 可以成为增强项，FTS-only 可用。
- Markdown 处理产物成为独立 visible material。
- `content_index_entry`、`material_relation`、Agent-first material result 和 `read(locator)` 再正式启用。

## 7. 最终评审结论摘要

最终评审结论见 [reviews/final.md](./reviews/final.md)。

摘要：

- 结论：有条件可行。
- 这不是小型 schema 改动，而是跨数据契约、路径所有权、file processing、JobManager recovery、index/search、migration、UI/preload 的系统迁移。
- 不建议直接进入完整实现。
- 建议先做两个窄 POC：
  - `KnowledgeIndexStore` over `KnowledgeBase/{baseId}/index.sqlite`
  - path-based file processing with `FileHandle`、`output.kind = path`、`context.dataId`

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

## 9. 如果下一步是继续推进

建议先确认下一步是哪一种：

1. 继续方案讨论：阅读第 3 节文档，围绕 open questions 继续问。
2. 拆 issue / PR：从 [reviews/final.md](./reviews/final.md) 的 implementation phases 拆。
3. 做 POC A：只验证 `KnowledgeIndexStore`，不要碰 UI 和 migration。
4. 做 POC B：只验证 path-based file processing，不要改完整知识库 workflow。
5. 做正式实现：必须等 POC A/B 的 stop/go criteria 通过后再开始。

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

