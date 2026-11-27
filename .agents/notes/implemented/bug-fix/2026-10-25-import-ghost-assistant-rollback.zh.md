# Agent Note: 失败的对话导入不再留下幽灵助手

Status: implemented

[English](2026-10-25-import-ghost-assistant-rollback.md) | 中文

## 问题

通过 设置 → 数据 → 导入外部应用数据 导入对话时，目标助手行会在解析文件之前创建。任何解析失败（空 `[]` 导出会让 `ChatgptImporter.validate` 空集恒真地放行）或持久化中途失败（消息父节点无法解析）都会返回错误 toast，但助手——以及中途失败时的部分话题和消息——被永久留在数据库里。重试同一文件，每次多一个幽灵助手。

## 决策

`importConversations` 现在先解析文件再创建任何东西，解析阶段失败零副作用。当助手已存在后持久化失败时，回滚只清除本次导入创建的数据，并且顺序与范围都为 surviving 其他窗口的并发用户操作而设计：

- `persistImport` 记录它实际创建的话题 id（`createdTopicIds`）；回滚只按这些 id 硬删，绝不删除助手的全部话题集——导入仍在进行时，用户可以把既有话题移动到新助手下，`deleteTopics: true` 的批量删除会连带销毁它们。
- 每个对象独立清理（best-effort）：先执行 active 态硬删（`trash.topic.delete_permanently`、`trash.assistant.delete_permanently`），收到 `TRASH_TARGET_NOT_FOUND`——即另一窗口用普通删除把对象归档了——再通过永久 DataApi 删除（`/topics/:id`、`/assistants/:id` 携带 `permanent: true`）清掉回收站里的行。两条路由都限定 `targetState: 'active'`，因此必须 有这个 fallback 才能触及已归档的残留。
- 被跳过的对象记录日志、绝不掩盖原始导入失败；调用方看到的仍是持久化错误；助手在两种状态下都不存在时视为已清理。

`ChatgptImporter.validate` 现在拒绝空对话列表，与 `AnthropicImporter` 对齐，两个入口在 validate 阶段的失败行为一致。

## 备选方案

- 一次调用 `deleteTopics: true` 连助手带话题删除：被否决——批量删除不以本次导入的话题为界，会硬删用户在导入进行中移入助手的既有话题（数据丢失）。
- 归档助手、依赖回收站清理任务：被否决——归档的话题会成为回收站里的无主行，等于把幽灵搬到另一个界面而不是清除。
- 把 `TRASH_TARGET_NOT_FOUND` 当作"已经不存在"：就清理目的而言被否决——普通 UI 删除是归档而非硬删，这些 active 限定路由的 not-found 不代表数据已消失。

## 后果

解析阶段的失败不产生任何写入。持久化阶段的失败按 best-effort 回滚：每条可达路径都会尝试完整清理，包括其他窗口的并发删除/归档；但回滚本身也可能失败（某次清理因非 not-found 原因报错时，该对象会残留），此类残留记入 warn/error 日志，且绝不掩盖导入自身的失败。同一文件重复导入在成功时仍每次创建一个助手（不去重）——行为未变，不在本修复范围。

## 验证

- Regression — `pnpm vitest run --project renderer src/renderer/services/import`：32 个测试覆盖 parse 先行（两个 importer 的空 `[]` 均不创建）、精确回滚 id 列表、归档残留清理、并发话题删除、清理调用失败不掩盖原始错误、进度单调性。
- Regression — 真实应用（dev 实例，service 级）：`importService.importConversations('[]', 'chatgpt')` 返回 `success: false` 与本地化的 invalid-format 文案，创建零助手。
