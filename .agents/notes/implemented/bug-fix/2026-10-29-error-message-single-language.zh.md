# Agent Note: 报错文案只显示一种语言

Status: implemented

[English](2026-10-29-error-message-single-language.md) | 中文

## Problem

报错 toast、内联提示、兜底页以及内嵌原因的文案，会把翻译后的摘要和原始原因拼在一起，例如 `添加失败: Request failed with status code 500`。在非英文界面下，结果混用了两种语言。部分位置明明有翻译文案，却只显示原始英文原因；还有部分文案缺少繁体中文。

## Decision

`src/renderer/utils/error.ts` 中的 `formatErrorMessageWithPrefix` 和 `localizedErrorDetail` 只在原因与界面语言一致时才附上原因，否则只显示翻译后的摘要。`src/shared/utils/languageScript.ts` 中的 `readsInLanguage` 按书写系统判断：中文、日文、俄文、希腊文和泰文要求出现各自的文字；英文接受拉丁字母文本；其他拉丁字母语言无法与英文区分，因此隐藏原因。`LocalizedError` 标记消息已经翻译过的渲染进程错误，这类错误始终显示。

原先显示 `err.message`、`formatErrorMessage(err)`、`t(key) + cause` 或 `` `${t(key)}: ${cause}` `` 的位置都改用这个工具函数。`common.error` 等笼统前缀以及只显示原始原因的位置补上了具体文案。原先内嵌原因（`{{message}}`、`{{error}}`、`{{reason}}`、`{{details}}`）的 key 不再内嵌；主进程文案在附加 CLI 或服务商诊断前先调用 `readsInLanguage`。错误详情的基本信息只显示翻译后的摘要，不再附带 `(原始原因)`。兜底页和未知类别的 toast 把原始文本放在默认收起的详情控件里。技术详情、复制操作和日志仍保留原始原因。

## Alternatives considered

- 一律隐藏原因：被否决，因为主进程已翻译的消息（例如 PDF 页数上限）会因此消失。
- 用类型标记所有已翻译的错误：被否决，因为主进程错误以普通 `Error` 和 `IpcError` 消息跨 IPC 传递；书写系统判断无需改动传输格式即可覆盖它们。
- 翻译原始的服务商和系统消息：被否决，因为这些消息不受应用控制。

## Consequences

在德语、法语等拉丁字母界面下，未使用 `LocalizedError` 的主进程已翻译原因会被隐藏，但摘要仍会说明失败的操作。如果原因同时含有界面语言的文字和英文（例如带英文路径的中文句子），仍会通过书写系统判断。去掉内嵌原因改动了所有语言中的现有文案，这些改动都是删除或标点调整；新增的 key 为全部 15 个语言提供了翻译。

## Verification

- Regression — `src/renderer/utils/__tests__/error.test.ts`：中文界面隐藏英文原因并保留中文原因，英文界面隐藏中文原因，德语界面隐藏无法区分的原因，`LocalizedError` 始终显示，存储的字符串遵循同一规则。
- Regression — `src/shared/utils/__tests__/languageScript.test.ts`：中文、日文、俄文、英文和德语的书写系统判断。
- Regression — 对改动源文件运行 `vitest related`，并对所有渲染进程和主进程语言包运行 `i18n-check`。
