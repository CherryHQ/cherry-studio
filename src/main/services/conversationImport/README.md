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
打开导入弹窗后自动扫描来源默认目录，支持环境变量覆盖；找不到时可手动指定。Claude 候选与预览优先显示来源标题，否则显示第一条非命令用户正文。只有本地命令的会话用来源名称和日期。Claude 命令标签、ANSI 控制码和工具 JSON 转为可读历史文本。旧导入记录通过消息读模型显示相同格式，不覆盖持久历史。
`codex.ts` 读取 legacy 完整 rollout。按 `session_meta.id` 区分线程，只用索引补名称。事件镜像不重复写入。分页继承、多物理副本、回滚和压缩／加密上下文在预览中拒绝。结构依据为 openai/codex 的 dbaead0106de82bd129a4f6f503d173ad5109f68；夹具标记 0.114.0，仅声明该布局，不承诺全部 0.x 发布版。
`opencode.ts` 在只读 SQLite 事务中读取同一快照。识别旧版 session/message/part，以及新版 session_v2/session_message，后者可带 session_part。按 seq 或旧版 time_created、id 排序。版本夹具为 1.2.0 和 2.2.5；新版结构依据 anomalyco/opencode 的 1bf08ae46a91f7793c756e4ee521e37b6b554064。旧版结构依据该提交的 v1-migration 源类型。夹具为合成数据，不能替代真实安装版验证。回退、继承 fork、压缩和未知表结构均明确拒绝。数据库指纹覆盖被选会话的逻辑快照，包含 WAL 已提交行，不要求复制数据库。
