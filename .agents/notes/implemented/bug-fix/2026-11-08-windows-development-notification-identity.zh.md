# Agent Note: 限定 Windows 开发通知身份的长度

Status: implemented

[English](2026-11-08-windows-development-notification-identity.md) | 中文

## 问题

工具包的应用身份辅助方法会在开发模式中改用 `process.execPath`。一轮 Windows 回归环境因此产生了 139 字符的身份。[Windows 将 AppUserModelID 限制为 128 字符，并禁止空格](https://learn.microsoft.com/en-us/windows/win32/shell/appids)，因此可执行文件路径不能作为可靠的应用身份。

通知 API 报告展示成功，历史中也保存了回复，但系统面板没有展示它。测试还存在另一项前置条件：隔离 `APPDATA` 后，需要显式完成 Shell 注册，详见[原生控制器说明](https://github.com/CherryHQ/cherry-studio/blob/bc41533e0868b65ceb817506ddb224a4efedd8c4/.agents/notes/implemented/testing/2026-11-07-native-controller-state-observation.md)。

## 决策

在生命周期启动前直接调用 Electron 的 Windows API。打包版本使用现有版本身份；开发版本在该身份后追加 `.Development`。两个版本的身份均保持固定长度，不受检出路径影响，开发实例也与已安装应用区分。

## 考虑过的替代方案

- 缩短 CI 检出路径，只会掩盖开发者路径更长或包含空格时的问题。
- 截断可执行文件路径，可能与另一安装产生冲突，也无法排除非法字符。
- 开发版直接使用正式版身份，会不必要地合并两者的 Windows 身份。

## 影响

开发版本的任务栏分组和通知使用所属版本的开发身份。打包版本继续与安装程序的身份保持一致。macOS 与 Linux 不调用 Windows API。

## 验证

- Regression — 八个应用版本消费者测试通过，包含与两套打包配置对齐的检查；Node 类型检查与限定范围的 lint 通过。
- Regression — Windows MP-110 在具备所需 Shell 前置条件后，通过真实系统通知展示、点击返回已完成话题、设置持久化及关闭分类后的通知抑制检查。原生适配器检查与所拥有快捷方式的清理审计也通过；专项证据不能替代完整双平台回归。
