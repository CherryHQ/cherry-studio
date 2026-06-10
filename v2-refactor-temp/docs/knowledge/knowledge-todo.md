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

- 扩展 rerank provider 覆盖。
  - 当前知识库 rerank 运行时走 `AiService`，可用范围取决于 ai-core / provider 层的 rerank 支持。
  - 后续如需支持 Voyage / TEI 等 provider，应优先在 provider 层补齐运行时能力。
  - 参考：`src/main/services/knowledge/utils/indexing/rerank.ts`

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
  - 参考：`src/renderer/pages/knowledge.v2/components/addKnowledgeItemDialog/sources/NoteSourceContent.tsx`

- 继续保持 `directory` 展开由 main runtime 负责。
  - renderer 只提交 owner item 语义，不在页面里展开目录。
  - 如果未来允许 nested directory，需要先重新设计 interrupt / reconcile 语义。
  - 参考：`src/renderer/pages/knowledge.v2/plans/add-source-confirm-submit.md`

## 3. UI 交互补齐

- 重新接通「知识库文件附加到聊天输入」。
  - 该入口此前在 `AttachmentButton` 通过 v2→v1 的 `KnowledgeRuntime.getFileMetadata` 桥（main 侧产出 legacy `FileMetadata`）实现；为避免在 v2 新增 `FileMetadata` 生产者，当前已先断开，仅保留本地文件上传。
  - 重新接通依赖聊天附件管线整体迁出 `FileMetadata`（迁到 `FileEntry` / `FileHandle`），属跨域改动。
  - 参考：`src/renderer/pages/home/Inputbar/tools/components/AttachmentButton.tsx`、`v2-refactor-temp/docs/file-manager/filemetadata-consumer-audit.md`

- 补齐数据源列表的大数据量能力。
  - 当前列表按 root items 查询，缺少完整分页、排序、子分组筛选和批量操作。
  - 非终态 item 目前靠轮询刷新。
  - 后续应根据数据规模和 UI 稿补分页 / 虚拟列表 / 排序 / 批量处理等能力。
  - 参考：`src/renderer/hooks/useKnowledgeItems.ts`

- 补齐更多语言的 `knowledge_v2` 翻译。
  - 当前主要覆盖 `zh-cn` / `zh-tw` / `en-us`。
  - 后续需要确认其他 locale 的回退策略或补齐翻译。
  - 参考：`src/renderer/i18n/locales/`

## 4. Runtime 与任务队列

- ✅ 持久化任务表 + 自动恢复（Phase 4 已落地）。
  - knowledge.prepare-root / knowledge.index-leaf 走 `JobManager`，`jobTable` 持久化。
  - 默认 per-base 并发 5、全局 cap 50；同一 base 的写入仍通过 `KnowledgeRuntimeService.runWithBaseWriteLockForBase` 串行。
  - `recovery: 'retry'` + `JobManager.onAllReady` 启动后 60s 跑 startup recovery，自动重新 dispatch 未完成 job。
  - 参考：`src/main/services/knowledge/tasks/prepareRootJobHandler.ts`、`src/main/services/knowledge/tasks/indexLeafJobHandler.ts`。

- 收敛失败清理与恢复体验。
  - shutdown 不再 fail items；重启后由 startup recovery 自动重新 dispatch（handler 入口对 `item.status === 'completed'` 早退）。
  - delete / reindex 走业务层 list + filter + `jobManager.cancel`，残留 vectors 由 `LibSQLVectorStore.replaceByExternalId` 的单事务原子性保证不出现双倍 chunk。
  - 后续若需要更明确的用户可见恢复入口或后台修复任务，可在此基础上构建。
  - 参考：`src/main/services/knowledge/runtime/KnowledgeRuntimeService.ts`

- 处理 base 删除后的 artifact 清理风险。
  - 当前删除 base 会删除 SQLite 记录和向量 artifact。
  - 如果 artifact 清理失败，可能留下孤立向量文件。
  - 后续可以补 pending cleanup / 重试清理策略。
  - 参考：`src/main/services/knowledge/KnowledgeService.ts`

## 5. 迁移与存储边界

- 明确 V1 迁移跳过项的用户影响。
  - 当前 V1 `memory` / `video` item 不迁移。
  - 旧知识库层级不重建，迁移 item 默认进入 root。
  - 后续需要在 release note 或迁移说明中明确这些行为。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-schema.md`

- 向量迁移仍按“保留可映射旧向量”策略执行。
  - 不重新切块、不重新 embedding、不重新生成业务 item，也不校正旧知识库业务配置。
  - v1 legacy 向量 DB 原地保留不动；迁移成功后作为孤儿文件留在磁盘上，当前不会自动清理。
  - 后续如果要释放磁盘，需要在用户确认放弃 v1 后单独增加 cleanup 策略、实现和测试。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-vector-migrator.md`

- 拆分临时镜像的文件类型。
  - `src/shared/data/types/knowledge.ts` 中仍有知识域临时镜像的 `FileMetadata`。
  - 后续等独立 file domain schema 稳定后，应迁移到专属文件领域类型。
  - 参考：`src/shared/data/types/knowledge.ts`

## 6. 发布与文档收尾

- ✅ Knowledge V2 首条 breaking changes 已落地（`2026-05-20-knowledge-job-auto-recovery.md`）。
  - 后续若再有用户可感知的 v2 变更，继续写入 `v2-refactor-temp/docs/breaking-changes/`。
  - 参考：`v2-refactor-temp/docs/breaking-changes/README.md`

- 更新后端决策文档中已落地的变化。
  - 例如 RAG 清空配置、recall stale guard、queue reset/write-lock 语义等近期修复。
  - 后续只有行为真正落地后再更新决策文档，避免文档提前承诺。
  - 参考：`v2-refactor-temp/docs/knowledge/knowledge-backend-decisions.md`
