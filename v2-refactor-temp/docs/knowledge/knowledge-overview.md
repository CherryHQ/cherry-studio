# Knowledge Overview

> **最后更新**: 2026-02-06

## 概览

Knowledge v2 重构目标是将知识库读写能力统一到 Data API 与 `useKnowledge` hooks，逐步移除 renderer 侧的 Redux 兼容层与历史桥接代码。

当前建议分层：

- 基础数据读取与知识库元数据管理：`@renderer/data/hooks/useKnowledges`
- 知识条目增删改查：`@renderer/hooks/useKnowledge`
- 文件域能力（文件清理、占用治理等）：文件管理模块（非知识库 hook）

## Changelog

### 2026-02-06

- **移除 `useKnowledgeFiles.tsx`（旧全局知识库文件统计/清理 hook）**
  - 原因：该能力属于文件生命周期管理，不属于知识库领域建模。
  - 调整：`DataSettings` 中相关入口下线，后续由文件管理模块提供替代能力。

- **删除知识库时不再联动清理 assistant/preset 引用**
  - 原因：该副作用不应耦合在知识库基础 hook 内。
  - 调整：调用方按业务边界决定是否处理引用清理，而不是由知识库 hook 隐式执行。

- **移除 `useKnowledge.ts` Redux 兼容层（旧版）并统一到新 `useKnowledge` Data API hooks**
  - 调整：相关调用点迁移到新 `useKnowledge` 与 `@renderer/data/hooks/useKnowledges`。
  - 结果：`updateKnowledgeBases` 等仅服务旧 store 的接口随迁移下线。
