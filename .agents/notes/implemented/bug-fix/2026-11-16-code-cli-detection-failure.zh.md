# Agent Note: CLI 检测失败不能证明未安装

Status: implemented

[English](2026-11-16-code-cli-detection-failure.md) | 中文

## 问题

Code 页面等待远程版本信息后才发布本地 CLI 快照。快照请求失败并耗尽重试次数后，状态映射仍为空，卡片会将其解释为未安装。响应中缺少条目也有相同后果。后端 application 为 `unknown` 时，重试按钮还会调用安装，尽管未知的归属状态并不授权安装（#22887）。

## 决策

快照检测和后端 application 保持为独立事实。Code 页面先发布可用的本地快照，再等待版本信息。检测中或检测失败都不能证明未安装，也不能授权安装；重试会重新读取快照。刷新失败时，在现有 hook 状态中保留最后已知的可执行文件可用性，同时明确显示检测的不确定性。不新增持久化缓存，也不推测本地安装状态。

后端 application 为 `unknown` 时使用检测重试；经过验证的可运行状态仍允许启动。确认未安装时保留正常安装操作，已知损坏的安装保留修复路径。检测不确定时，当前选中的 Gemini 页面仍可访问，以便用户重试。缺少最新版本信息时不能显示已是最新的标记。

## 考虑过的替代方案

- 将每次读取失败视为未安装，会在没有证据的情况下提供安装操作。
- 使用安装重试处理检测失败，执行了错误的操作，无法建立可靠状态。
- 等待远程信息后才发布本地可用性，会让网络故障掩盖独立确认的本地事实。
- 持久化另一份安装缓存会增加一个事实来源，而且可能在文件系统变化后仍然残留。

## 后果

刷新失败时可以显示最后已知的可用性，但不保证可执行文件仍然存在。后续快照会替换该状态，执行时仍由主进程验证。即使保留的快照含有旧的进行中操作，检测重试仍然可用。本修复不改变二进制安装配方、版本选择或主进程快照推导。

提前发布快照与 PR #21088 存在重叠。整合两者时，除提前发布行为外，还需保留持续失败和缺失条目的处理。

## 验证

- Regression — `src/renderer/pages/code/hooks/__tests__/useCliVersionStatuses.test.ts`：版本信息延迟或失败、快照失败与恢复、缺失条目、确认未安装以及本地可用性的保留。
- Regression — `src/renderer/pages/code/components/__tests__/VersionStatusCard.test.tsx` 和 `src/renderer/pages/code/__tests__/CodeCliPage.test.tsx`：检测重试与安装操作分离，状态不确定的已选工具仍可访问。
- Regression — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`：现有测试验证后端列表查询失败时独立确认的 mise/system/bundled 可用性，以及忽略失败的最新版本结果。

Renderer 验证使用确定性的 IPC 夹具，不能证明真实 Windows 离线行为。当前工作区无法执行 Electron 运行时验证，因为原生 system-speech 构建要求 Swift tools 6.2.0，而已安装的工具链为 6.0.3。
