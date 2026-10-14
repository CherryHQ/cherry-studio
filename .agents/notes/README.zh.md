# Agent Notes

[English](README.md) | 中文

**Agent Note** 记录影响本代码库的决策——*为什么*以及*放弃了什么*,这些是代码和文档承载不了的部分。

Note 位于 `{lifecycle}/{class}/yyyy-mm-dd-topic.md`:

- **生命周期**:`proposed/`(实现前先评审)· `implemented/`(已落地,保持同步)· `rejected/`(被否决,理由还能防错就保留)
- **类别**:`feature` · `bug-fix` · `simplification` · `architecture` · `process` · `testing`

每条 note 以 `# Agent Note: <title>` 和 `Status:` 行开头,先陈述 `## Problem`,并强制携带 `## Alternatives considered`。每条 note 都有结构镜像的 `.zh.md` 对照。

本系统正依照[文档治理方案](proposed/process/2026-08-18-docs-governance-and-spec-workflow.zh.md)引入,该方案定义了格式、什么决策值得记录的门槛以及推进计划。完整规则集与格式门禁随该方案的 Phase 1 落地。
