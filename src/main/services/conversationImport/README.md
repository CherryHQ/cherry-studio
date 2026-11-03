# 本地会话历史导入

- `ConversationImportService.ts` 管理窗口归属、只读预览、取消和逐会话提交。
- `claudeCode.ts` 解析 Claude Code 2.1 系列的 UUID／父链 JSONL 布局。当前夹具版本为 2.1.284。未知布局须报告，不代表已验证全部发布版本。
- `files.ts` 限制输入体积。预览快照只留在内存。
- 跨进程契约位于 `src/shared/ipc/schemas/conversationImport.ts`。来源身份由数据服务写入，界面不能提交数据库记录。
- Pi 历史初始化位于 `src/main/ai/runtime/pi/importedSessionHistory.ts`。失败后保留可读历史，禁止空上下文续聊。

首版只支持 Pi 目标。保留原时间；时间倒退和未来时间在预览及提交前拒绝。
来源文件不写入。每个会话单独使用同步事务。复制清除会话级导入身份，备份恢复保留身份。

测试位于 `__tests__/`。数据库用例使用生产迁移和真实 Pi 历史；模型输入用本地网关夹具捕获。
产品方案见 [本地历史导入方案](../../../../.agents/notes/proposed/feature/2026-11-02-local-agent-history-import.md)。
