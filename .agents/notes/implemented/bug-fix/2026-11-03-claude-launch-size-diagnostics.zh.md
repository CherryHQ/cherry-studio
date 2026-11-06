# Agent Note：Claude Code 启动大小诊断

Status: implemented

[English](2026-11-03-claude-launch-size-diagnostics.md) | 中文

## 问题

Claude Code 同步启动进程时发生 `ENAMETOOLONG` 或 `E2BIG` 失败，之前只记录 `error.message`，并将其分类为 `unknown`。在冷启动路径上，原始错误会传到渲染进程，因此启动数据超过操作系统限制的 Windows 用户只看到未知错误，没有可采取的操作指引。修复涉及 `src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts`、`processExitDiagnostics.ts` 和新增的 `claudeCodeLaunchSize.ts`；`src/shared/utils/errorCategory.ts`、`src/shared/ai/executionFailure.ts`、`src/renderer/utils/errorToast.ts` 和渲染进程语言目录负责分类与展示。

## 决策

在进程启动边界，仅对大小类失败记录安全的启动度量：argv 数量及 UTF-16/UTF-8 总长度、命令在两种编码下的长度、环境变量条目数、块大小及字符串字节数、cwd 长度及其是否继承，以及三个最大参数和粗粒度白名单归属。这些信息保存在 `terminalReason`、结构化警告日志和内存诊断数据中；向外展示的错误绝不包含这些信息或启动输入。

共享的 `launch_size` 类别展示无操作按钮的警告，全部 15 个渲染进程语言目录均提供翻译后的诊断文本，并投射为现有远程原因 `invalid_input`。同步大小类失败会以现有安全的 `ClaudeCodeProcessExitError` 重新抛出：冷启动路径在 `ClaudeCodeRuntimeDriver.ts:373` 调用 SDK 的 `query()`，早于 `:405` 的 `runQueryLoop()`，因此 `:717-726` 的包装 catch 无法捕获构造阶段的失败。启动输入绝不被修改。

## 备选方案

- 复用 `payload`、`context_length` 或 `bad_request`：这些类别描述 HTTP 或历史记录问题，会误导用户。
- 仅丰富消息并保留 `unknown`：这不满足分发验收要求，且消息无法在安全包装后保留。
- 为归属实现完整的 SDK argv 语法：对所需证据而言过度设计。
- 修饰原始错误：这会引入第二套投射模式，而非复用安全投射。
- 新增远程协议原因码：该枚举是封闭的，现有 `invalid_input` 已覆盖此情况。

## 后果

大小类失败的错误对象和消息会变为安全投射，并携带诊断引用。这些度量是输入大小的近似指标，并非平台限制的计算结果：Windows 引号和终止符扩展以及原生代码添加的环境变量不可见，POSIX 指针表和内核开销也未计入。非大小类同步失败保留完全相同的错误对象、消息和分类。没有任何内容被裁剪、移动或阻止。报告问题的 Windows 用户实际超限的字段仍未确认；缩减该字段属于后续工作。

## 验证

- 回归 — 旧版本的 prefix probe 报告 `unknown` 而非 `launch_size`，且没有 `launchSize`；其断言为 RED。修改前，先前的 manager 测试也因缺少安全类别和引用而失败。
- 回归 — main Vitest 文件 `ClaudeCodeProcessManager`、`claudeCodeLaunchSize`、`processExitDiagnostics` 和 `ClaudeCodeRuntimeDriver` 的 137 项测试通过；renderer 文件 `errorClassifier`、`toast` 和 `doctorContent` 的 136 项通过；shared 文件 `executionFailure` 和 `errorCategory` 的 103 项通过。
- 回归 — node 和 web TypeScript 检查、`i18n-check`（97,346 条翻译）、针对更改文件的 Oxlint、ESLint 和 Oxfmt 检查通过。Agent Note 格式、配对、结构、frontmatter、链接、术语及索引文档检查通过；之前的文档检查运行时此三件套尚不存在。
- 回归 — 本阶段未在 Windows 上复现，也未运行 Electron 端到端测试。
