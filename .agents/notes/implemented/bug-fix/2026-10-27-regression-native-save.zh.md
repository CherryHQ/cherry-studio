# Agent Note：原生保存自动化保持异步并归属当前用例

Status: implemented

[English](2026-10-27-regression-native-save.md) | 中文

## Problem

回归用例在 Playwright 工作进程中提供模型和图片 HTTP fixture。同步执行的原生保存子进程会阻塞工作进程并等待保存窗口，而图片导出可能需要先请求这些 fixture 才能打开窗口，造成互相等待。失败的导出还可能留下原生保存窗口，截获后续用例的下载；Windows 实测曾将 DOCX 内容保存到后续的 Python 文件名中。

Windows 目录选择还可能因进程激活未聚焦原生窗口而接受默认目录。通过 SendKeys 输入路径会将花括号等字符解释为键盘命令。

## Decision

`saveNativeFile` 返回 promise，所有调用方均等待它完成。原生自动化等待所属窗口时保持工作进程事件循环可用。Windows 窗口发现为长图导出预留准备时间。Word 校验等待可读取且 CRC 正确的压缩包，不将文件出现当作写入完成。

用例清理只取消经核验、属于 driver 所有的 Electron 进程的 Windows 文件窗口，通过原生文件输入框和取消按钮识别，不关闭任意窗口，也不确认尚未完成的保存。

Windows 目录选择聚焦该窗口，打开地址输入框，再通过 ValuePattern 设置路径原文。提交前回读校验输入值，等待同一窗口关闭或退出地址编辑模式后才确认选择。调用方保留所选目录必须完全匹配的断言。

## Alternatives considered

- 增加同步超时仍会阻塞 fixture 服务器。
- 吞掉导出错误或接受任意非空文件会掩盖输出损坏和用例间污染。
- 每次失败后重启 Electron 会掩盖残留窗口，并丢失共享运行状态的验证。
- 延长按键延迟不能验证焦点，也不能保留路径字符原文。

## Consequences

调用方必须等待助手完成。清理在 Windows 上增加一次原生自动化调用，未提供等效的 macOS 文件窗口取消能力。产品断言和失败的导出仍正常判为失败。

## Verification

- Regression — `scripts/e2e/regression/__tests__/systemAutomation.test.ts`：原生保存尚未完成时，真实 HTTP fixture 仍能被读取；进程身份变化时禁止取消窗口。
- 本地 Windows ARM64 的 MP-47 校验 Markdown、Word 内容和长图；MP-128 校验截图保存及剪贴板像素。修复后两者均通过。未在本机重新执行 macOS 原生保存。
- Regression — `CODE-01` 在启动前检查所选工作目录完全匹配；原生 Windows 目录输入还使用中文、引号和花括号进行验证。
