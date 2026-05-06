# Knowledge V2 后续待办

本文档记录当前 Knowledge V2 UI 完成后，仍需要继续收敛的限制与后续工作。

只记录已经能从当前代码、计划文档或后端决策文档确认的事项；未确认 UI 稿、未确认产品语义和推测性功能不写入本文。

## 1. 模型与 RAG 配置

- 创建 / 恢复知识库时，不应继续由 renderer 维护固定 `dimensions`。
  - 后续需要从选中的 embedding model 或上游模型能力解析真实维度。
  - 在该能力完成前，RAG 面板中的 embedding model 与 dimensions 继续保持只读。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-ui.md`

- 收敛 embedding model 的可选范围与 runtime 支持范围。
  - 当前运行时 embedding provider 只明确支持 Ollama。
  - 后续要么接入更多 provider 的运行时能力，要么在 UI / 创建流程中限制不可运行的 provider。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-backend-decisions.md`

- 完成 rerank runtime 接入。
  - 当前 `rerankModelId` 可以配置和持久化，但搜索运行时尚未真正启用 rerank。
  - 后续需要补齐 provider / model runtime 解析和实际 rerank 调用链。
  - 参考：`src/main/services/knowledge/rerank/rerank.ts`

- 为 chunk / RAG 配置变更提供明确 reindex 流程。
  - `chunkSize` / `chunkOverlap` 可更新，但不会自动重建已有 chunk 和向量。
  - 后续需要在 UI 中明确提示并触发 reindex，避免配置与旧索引长期不一致。
  - 参考：`src/main/data/services/KnowledgeBaseService.ts`

## 2. 文件处理与数据源

- 接入 `fileProcessorId` 到实际处理链路。
  - 当前字段已持久化，但 runtime 处理链路仍未完整消费该配置。
  - 后续需要让文件解析、OCR / 预处理 provider 选择真正受该配置控制。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-backend-decisions.md`

- 接入 note 数据源。
  - 当前添加数据源里的 note 是占位状态，提交不可用。
  - 后续需要接入真实 note picker / note 数据源 API，并替换占位 UI。
  - 参考：`src/renderer/src/pages/knowledge.v2/components/addKnowledgeItemDialog/sources/NoteSourceContent.tsx`

- 继续保持 `directory` / `sitemap` 展开由 main runtime 负责。
  - renderer 只提交 owner item 语义，不在页面里展开目录或 sitemap。
  - 如果未来允许 nested directory / sitemap，需要先重新设计 interrupt / reconcile 语义。
  - 参考：`src/renderer/src/pages/knowledge.v2/plans/add-source-confirm-submit.md`

## 3. UI 交互补齐

- 补齐数据源列表的大数据量能力。
  - 当前列表按 root items 查询，缺少完整分页、排序、子分组筛选和批量操作。
  - 非终态 item 目前靠轮询刷新。
  - 后续应根据数据规模和 UI 稿补分页 / 虚拟列表 / 排序 / 批量处理等能力。
  - 参考：`src/renderer/src/pages/knowledge.v2/hooks/useKnowledgeItems.ts`

- 统一 sitemap 的用户可见文案。
  - 当前语义已经收敛到 `sitemap`，但部分中文文案仍可能显示为“网站”。
  - 后续需要按最终产品命名统一 i18n。
  - 参考：`src/renderer/src/pages/knowledge.v2/plans/add-source-confirm-submit.md`

- 补齐更多语言的 `knowledge_v2` 翻译。
  - 当前主要覆盖 `zh-cn` / `zh-tw` / `en-us`。
  - 后续需要确认其他 locale 的回退策略或补齐翻译。
  - 参考：`src/renderer/src/i18n/locales/`

## 4. Runtime 与任务队列

- 明确 in-memory queue 的产品边界。
  - 当前队列是单进程内存队列，默认并发 5。
  - 同一 base 的写入通过 per-base write lock 串行化。
  - 当前没有持久化任务表、自动重试、重启后自动恢复。
  - 后续如果需要可靠任务恢复，应增加持久化任务模型和恢复策略。
  - 参考：`src/main/services/knowledge/queue/KnowledgeQueueManager.ts`

- 收敛失败清理与恢复体验。
  - 运行中任务在 shutdown / delete / reindex 中断后会尝试清理向量并标记 item failed。
  - 部分失败状态持久化和清理属于 best-effort。
  - 后续需要决定是否提供更明确的用户可见恢复入口或后台修复任务。
  - 参考：`src/main/services/knowledge/runtime/KnowledgeRuntimeService.ts`

- 处理 base 删除后的 artifact 清理风险。
  - 当前删除 base 会删除 SQLite 记录和向量 artifact。
  - 如果 artifact 清理失败，可能留下孤立向量文件。
  - 后续可以补 pending cleanup / 重试清理策略。
  - 参考：`src/main/services/knowledge/KnowledgeOrchestrationService.ts`

## 5. 迁移与存储边界

- 明确 V1 迁移跳过项的用户影响。
  - 当前 V1 `memory` / `video` item 不迁移。
  - 旧知识库层级不重建，迁移 item 默认进入 root。
  - 后续需要在 release note 或迁移说明中明确这些行为。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-schema.md`

- 向量迁移仍按“保留可映射旧向量”策略执行。
  - 不重新切块、不重新 embedding、不重新生成业务 item，也不校正旧知识库业务配置。
  - `.embedjs.bak` 主要用于迁移 retry，成功后当前不会自动清理。
  - 后续如果要释放磁盘，需要单独增加 cleanup 策略、实现和测试。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-vector-migrator.md`

- 拆分临时镜像的文件类型。
  - `packages/shared/data/types/knowledge.ts` 中仍有知识域临时镜像的 `FileMetadata`。
  - 后续等独立 file domain schema 稳定后，应迁移到专属文件领域类型。
  - 参考：`packages/shared/data/types/knowledge.ts`

## 6. 发布与文档收尾

- 补 Knowledge V2 的 breaking changes 记录。
  - 用户可感知的 v2 变更应写入 `v2-refactor-temp/docs/breaking-changes/`。
  - 当前尚未看到 Knowledge V2 专项条目。
  - 参考：`v2-refactor-temp/docs/breaking-changes/README.md`

- 更新后端决策文档中已落地的变化。
  - 例如 RAG 清空配置、recall stale guard、queue reset/write-lock 语义等近期修复。
  - 后续只有行为真正落地后再更新决策文档，避免文档提前承诺。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-backend-decisions.md`
