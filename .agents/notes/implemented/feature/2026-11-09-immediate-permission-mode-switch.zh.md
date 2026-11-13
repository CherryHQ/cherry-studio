# Agent Note: 权限模式切换作用于正在执行的轮次

Status: implemented

[English](2026-11-09-immediate-permission-mode-switch.md) | 中文

## 问题

权限模式保存在智能体上，可以在对话过程中从输入框切换。Claude Code、Pi 和 Pi Durable 三个运行时都会在轮次执行期间冻结模式变更，直到下一条用户消息触发连接对齐时才应用。Claude 驱动给出的理由是：SDK 的 `set_permission_mode` 控制请求可能终止正在进行的工作。

输入框立即显示新模式，但正在执行的轮次仍按旧模式审批（或跳过审批）工具调用。从完全访问切回执行前询问，并不能阻止该轮的下一次工具调用在无人确认的情况下执行。

这一理由对当前锁定的 SDK 不成立。用脚本化的本地 Messages API 驱动 SDK 0.3.311 CLI，在工具调用之间切换模式（default → bypass → default、bypass → default → bypass、default → plan → default、plan → bypass → plan），并在 `canUseTool` 决定待处理时、Bash 工具执行期间切换。每个轮次都成功完成，下一次工具调用都遵循新模式。CLI 的无头处理逻辑只替换工具权限上下文，不发出中断。

## 决策

连接的 `reconcile` 在三个运行时上都立即应用权限模式变更，执行中的轮次也不例外，变更从该轮的下一次工具调用起生效：

- Claude Code 启动时启用 SDK 切入完全访问所需的能力，初始模式仍由智能体设置决定。`setPermissionMode` 获得 SDK 确认后才更新本地审批模式，工具目录独立刷新。
- Pi 和 Pi Durable 替换审批闸门在每次工具调用时读取的模式，并调用 `permissionModeChanged()` 唤醒行为包的空闲驱动器；该驱动器仍只在对话空闲时动作。
- 禁用工具的处理不变：执行中的轮次只追加新禁用的工具。
- 已在等待用户的审批继续等待，不按新模式重新判定。
- 实时应用失败时返回 `failed`，宿主按失败即收紧处理：暂停该轮次并关闭连接。

从输入框菜单或 Shift+Tab 切换普通模式时直接生效。完全访问在任何状态下都保留范围确认。

## 备选方案

- 保留延后：轮次剩余时间内显示的模式与实际执行的模式不一致，放宽和收紧两个方向都受影响。
- 执行中切换普通模式时确认：会打断直接切换的流程，包括 Shift+Tab 规划切换。需求方选择仅保留完全访问确认。
- 按新模式重新判定待处理审批：守卫规则产生的 `ask` 在完全访问下也必须保留，但待处理审批没有记录来源。等这一来源信息存在后再考虑。
- Pi 立即生效、Claude Code 保持延后：同一个智能体设置会因运行时不同而语义不同。

## 后果

模式变更会作用于该智能体的所有活动会话，包括其他窗口中运行的会话。

实时应用被拒绝时，现在会暂停正在执行的轮次，而不是等到下一条消息才暴露。如果未来的 SDK 让 `set_permission_mode` 中断轮次，Claude Code 集成回归测试中的轮次将无法完成，测试会失败。

## 验证

- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts`：使用真实 SDK 子进程，轮次中途从 bypass 切到 default 会拒绝下一次 Bash 调用，从 default 切到 bypass 会执行它；两种情况在延后实现上都失败。
- Regression — `pnpm test:main src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`：任一方向的中途切换都会改变该轮下一次写入是否请求审批；在延后实现上失败。
- Regression — `pnpm test:main src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`：Pi Durable 的同样两个方向；在延后的桌面宿主上失败。
- Regression — `pnpm test:renderer src/renderer/components/composer/tools/definitions/__tests__/permissionModeTool.test.tsx`：普通模式直接切换，完全访问需要确认，取消后保留原模式。

受影响的五个主进程测试文件（包括 `ClaudeCodeRuntimeDriver.test.ts` 和 `AgentSessionRuntimeService.test.ts`）共 309 个测试通过。`pnpm typecheck:node`、`pnpm typecheck:web`、`pnpm i18n:check`、`pnpm docs:check` 以及限定范围的 Oxfmt、Oxlint、ESLint 均通过。
