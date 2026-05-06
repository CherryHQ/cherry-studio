# V2 Breaking Changes

本文档是 V2 重构期间破坏性变更的汇总目录。每个破坏性变更应使用独立 Markdown 文件记录，方便 review、迁移验收、发布说明和最终 V2 收尾清理。

## 存放约定

- 每个破坏性变更放在 `v2-refactor-temp/docs/breaking-changes/` 目录下。
- 文件名使用日期加简短 kebab-case 描述：`YYYY-MM-DD-short-description.md`。
- 新增 breaking change 时，需要同步在本文档的“变更索引”中增加一行。

## 记录要求

每个破坏性变更都应包含：

1. **变更内容**：被移除、重命名或行为变化的能力/数据/接口。
2. **影响范围**：影响用户、迁移数据、Renderer、Main、插件/API 或测试的具体范围。
3. **兼容/迁移策略**：旧数据如何处理，是否降级、忽略、迁移或需要用户手动处理。
4. **验证点**：review 和测试时需要重点确认的路径。
5. **关联 PR/提交**：如果已知，补充 PR 或 commit，便于追踪上下文。

## 变更索引

| Date | Change | Document |
| --- | --- | --- |
| 2026-04-23 | Web Search 移除本地搜索引擎与 RAG 压缩配置 | [2026-04-23-web-search-remove-local-providers-and-rag.md](./breaking-changes/2026-04-23-web-search-remove-local-providers-and-rag.md) |
