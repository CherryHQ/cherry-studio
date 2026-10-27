# Agent Note：原生保存自动化保持异步并归属当前用例

Status: implemented

[English](2026-10-27-regression-native-save.md) | 中文

## Problem

回归用例在 Playwright 工作进程中提供模型和图片 HTTP fixture。同步执行的原生保存子进程会阻塞工作进程并等待保存窗口，而图片导出可能需要先请求这些 fixture 才能打开窗口，造成互相等待。失败的导出还可能留下原生保存窗口，截获后续用例的下载；Windows 实测曾将 DOCX 内容保存到后续的 Python 文件名中。

## Decision

`saveNativeFile` 返回 promise，所有调用方均等待它完成。原生自动化等待所属窗口时保持工作进程事件循环可用。Windows 窗口发现为长图导出预留准备时间。Word 校验等待可读取且 CRC 正确的压缩包，不将文件出现当作写入完成。

用例清理只取消经核验、属于 driver 所有的 Electron 进程的 Windows 文件窗口，通过原生文件输入框和取消按钮识别，不关闭任意窗口，也不确认尚未完成的保存。

## Alternatives considered

- 增加同步超时仍会阻塞 fixture 服务器。
- 吞掉导出错误或接受任意非空文件会掩盖输出损坏和用例间污染。
- 每次失败后重启 Electron 会掩盖残留窗口，并丢失共享运行状态的验证。

## Consequences

调用方必须等待助手完成。清理在 Windows 上增加一次原生自动化调用，未提供等效的 macOS 文件窗口取消能力。产品断言和失败的导出仍正常判为失败。

## Verification

- Regression — `scripts/e2e/regression/__tests__/systemAutomation.test.ts`：原生保存尚未完成时，真实 HTTP fixture 仍能被读取；进程身份变化时禁止取消窗口。
- 本地 Windows ARM64 的 MP-47 校验 Markdown、Word 内容和长图；MP-128 校验截图保存及剪贴板像素。修复后两者均通过。未在本机重新执行 macOS 原生保存。
