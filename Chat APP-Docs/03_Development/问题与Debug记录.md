# 问题与 Debug 记录（索引）

> 滚动 issue 列表。每条 `D-NNN` 一行；详细诊断在对应的任务文件夹下的 `诊断.md`。
> 命名空间与任务 ID 独立 —— D 是 issue（问题），T 是 task（工程）。一个 issue 通常对应一个或多个 task。

## 当前 open 问题

（暂无新 open）

## 待终态确认（自动化已修，手动验证 pending）

| ID | 标题 | 复现 | 关联任务 | 诊断文档 | 状态 |
|---|---|---|---|---|---|
| D-001 | v2 fresh install 创建 Topic 立即 FK 失败 | 删 `~/Library/Application Support/CherryStudioDev` → `pnpm dev` → 新建 topic | [T-003](./tasks/T-003_BaselineDebug/) 诊断；[T-004](./tasks/T-004_修复DefaultAssistantSentinel/) 修复 | [tasks/T-003_BaselineDebug/诊断.md](./tasks/T-003_BaselineDebug/诊断.md) | ⏳ 待 `rm + pnpm dev` 手动验证 |
| D-002 | assistant message 写入 SQLite FK 失败（model_id='qwen' 非 UniqueModelId） | T-004 后发送任意消息 → AI 回复瞬间报 FK | [T-005A](./tasks/T-005A_AssistantMessageFK/) 诊断；[T-005B](./tasks/T-005B_修复ModelIdFK/) 修复 | [tasks/T-005A_AssistantMessageFK/诊断.md](./tasks/T-005A_AssistantMessageFK/诊断.md) | ⏳ 待 `rm + pnpm dev + 发消息` 手动验证 |

## 已 closed 问题

（暂无）

## 命名约定

- `D-NNN` —— issue 编号，单调递增，跨任务跨日不重置
- 一条 issue 在被工程任务关闭前，始终列在「当前 open」
- 关闭时移到「已 closed」并记录关闭日期 + 关闭 commit / 任务

## 模板（新增 issue 时）

```markdown
| D-XXX | 简短标题 | 一句话复现步骤 | 🔴阻塞 / 🟡 影响功能 / 🟢 小毛刺 | T-YYY | tasks/T-YYY_*/诊断.md |
```
