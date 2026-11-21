# Agent Note: Claude 独立提供商设置

Status: proposed

[English](2026-11-19-claude-scoped-provider-settings.md) | 中文

## 问题

Cherry 在 `~/.claude/settings.json` 中管理的 Claude Code 提供商设置也会影响直接运行的 `claude`，使用户无法独立使用自己的登录。

## 提案

仅为 Claude Code 增加覆盖该工具的可选模式。默认仍为关闭，使用全局 `~/.claude/settings.json`。启用后，受管理的提供商设置移至应用数据目录下由 Cherry 所有、权限为 0600 的文件。普通启动和自有登录启动使用 `--settings <absolute path>`；登录流程启动绝不使用该参数。独立设置文件缺失或格式错误时，启动会明确失败，不会回退到用户自己的登录。

启用时从全局文件移除 Cherry 管理的键。关闭时将当前提供商写回全局文件并彻底删除独立文件。两种转换均保留无关的用户键和权限规则。模式启用期间，网关协调会重写独立文件。

## 考虑过的替代方案

- 继续写入全局文件：直接运行 Claude 会继承所选提供商。
- 将全部全局设置复制到覆盖文件：无关用户设置会获得更高优先级。

## 验收标准

- AC1 — 模式默认关闭，继续使用全局设置 (verification: `src/renderer/hooks/__tests__/useCodeCli.test.ts`)
- AC2 — 有当前提供商时启用模式会移除受管理的全局键、保留无关键和权限、在 POSIX 上创建权限为 0600 的独立文件，并仅在成功后提交偏好设置 (verification: `src/main/services/codeCli/__tests__/configWriter.test.ts`, `src/renderer/pages/code/cliConfig/__tests__/scopeTransition.test.ts`)
- AC3 — 独立模式的普通启动传入带引号的设置文件绝对路径，且 argv 中没有凭据 (verification: `src/main/services/codeCli/__tests__/CodeCliService.test.ts`)
- AC4 — 关闭模式会将当前提供商恢复到全局文件、保留无关键和权限，并彻底删除独立文件 (verification: `src/renderer/pages/code/cliConfig/__tests__/scopeTransition.test.ts`)
- AC5 — 模式启用时自有登录启动使用独立设置；登录流程启动不带 `--settings` (verification: `src/main/services/codeCli/__tests__/CodeCliService.test.ts`, `src/renderer/pages/code/cliConfig/__tests__/scopeTransition.test.ts`)
- AC6 — 独立设置文件缺失或格式错误时启动明确失败 (verification: `src/main/services/codeCli/__tests__/CodeCliService.test.ts`)
- AC7 — 模式启用时网关协调只重写独立设置，并拒绝为另一目标位置准备的草稿（不检测同一目标位置的过期内容） (verification: `src/renderer/pages/code/hooks/__tests__/useLaunchDialogController.test.ts`, `src/main/services/codeCli/__tests__/configWriter.test.ts`)
- AC8 — 文档和翻译满足相应检查 (verification: `pnpm docs:check-notes`, `pnpm i18n:check`)

## 风险

转换对捕获到的失败尽力回滚；恢复失败会记录日志而不会抛出，且无法保证跨文件和偏好设置的崩溃原子性。独立模式启动依赖该文件。启用后 Cherry 存储提供商配置的位置会改变，因此直接运行 `claude` 会恢复使用用户自己的登录。Windows 参数传递、真实认证提供商路由和关闭后直接运行 `claude` 的恢复情况尚未验证。

- 跨窗口：现有偏好设置机制由渲染进程整体写入配置对象，因此过期窗口编辑其他工具时也可能覆盖 `claudeScopedSettings`（这是已有行为）。过期窗口重复执行同一转换不会产生操作，也不会再次修改文件。
- 在 Claude 启动时读取设置之前切换模式可能改变该次启动使用的设置；全局文件已有同样的时间窗口。
- 该开关属于工具级别，位于工具面板而非提供商对话框中，因此提供商模态编辑器打开时无法切换。
