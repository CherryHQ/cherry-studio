# Agent Note: 回归测试在 Windows 重启前正常退出应用

Status: implemented

[English](2026-10-28-regression-windows-restart.md) | 中文

## 问题

Windows 回归控制器对启动器执行 `taskkill /T /F` 来重启 Electron。因此，持久化场景实际经历的是强制终止，可能中断正常退出流程及待写入的状态。单凭重启后的失败，无法区分产品持久化缺陷与该测试前置条件的影响。

## 决策

Windows 重启前，验证受控 Electron 进程及主进程检查器的归属，请求 `app.quit()`，并等待该 Electron 进程退出，最长 30 秒。在检查器请求得到响应后调度退出，让控制器能够断开连接。随后才清理受控启动器，并使用同一配置目录启动替代实例。退出超时会使重启失败，不会强制结束 Electron 或启动替代实例。

## 考虑过的替代方案

- 在测试中逐一刷新存储 API 会绕过产品的正常退出路径。
- 回退到强制终止会悄然将持久化验收变成崩溃恢复测试。

## 影响

Windows 持久化场景现在请求应用正常退出。最终清理保留原有的受控进程终止策略。macOS 行为不变。正常退出后的产品失败仍然保留为失败；此修复不代表草稿、文件预览或会话选择已满足各自的验收契约。

## 验证

- 回归 — `scripts/e2e/regression/__tests__/gracefulRestart.test.ts`：正常退出保存待写入状态，拒绝其他进程的检查器，退出受阻时保留运行中的应用及待写入状态。
- 回归 — 显式指定的 `debugBridge.test.ts`、`lifecycle.test.ts`、`launch.test.ts` 和 `process.test.ts` 相关调用方与新增测试一起通过（共 39 项测试）。
