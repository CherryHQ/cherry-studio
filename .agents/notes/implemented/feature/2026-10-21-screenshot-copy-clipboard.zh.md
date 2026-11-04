# Agent Note: 复制屏幕截图

Status: implemented

[English](2026-10-21-screenshot-copy-clipboard.md) | 中文

## 问题

屏幕截图工具栏可以保存图像，也可以在复制图像时关闭截图会话，但没有复制带注释截图并继续使用覆盖层的操作。

## 决策

工具栏提供单独的复制操作。该操作将当前选区（包括注释）导出为 PNG，并通过校验发送方的截图 IPC 路由写入系统剪贴板。现有的复制并关闭操作保持原有行为。

## 考虑过的替代方案

- 键盘快捷键：未采用，因为该问题请求一个可见的工具栏操作。
- 保存或确认菜单项：未采用，因为独立按钮可让用户直接使用此操作。

## 后果

用户无需保存文件即可粘贴截图，然后继续编辑或选择其他工具栏操作。新增 IPC 操作沿用现有截图结果格式和剪贴板写入器。

## 验证

- Regression — `pnpm test:renderer src/renderer/windows/screenshot/__tests__/Toolbar.test.tsx src/renderer/windows/screenshot/__tests__/geometry.test.ts`：23 项测试通过，其中包括复制后工具栏仍可用的检查。
- Regression — `pnpm test:main src/main/ipc/handlers/__tests__/screenshot.test.ts src/main/services/screenshot/__tests__/ScreenshotOverlayService.test.ts`：102 项测试通过，其中包括剪贴板输出、覆盖层会话保持和发送方校验。
