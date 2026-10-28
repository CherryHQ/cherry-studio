# Agent Note: 打开导出到笔记的内容

Status: implemented

[English](2026-10-27-open-exported-note.md) | 中文

## Problem

将对话、消息或翻译内容保存到笔记后，成功提示没有提供直达新笔记的入口。

## Decision

现有的笔记导出成功提示提供持续五秒的“打开笔记”操作。它使用 `addNote` 返回的路径，包含重名处理和目标目录回退的结果，而不自行拼接文件名。保存本身不会切换页面；写入失败仍走错误处理，不提供打开操作。

主窗口导航复用笔记标签页。可选的 `notePath` 查询参数接受绝对路径，但页面只选择当前笔记目录树中已存在的文件。它等待目录发现和输入法组合输入结束，再消费该参数。手动选择文件会取消尚未找到目标的待处理请求。未保存草稿和自动保存仍由现有文件编辑会话负责。

## Alternatives considered

- 每次保存后自动切换页面会打断对话。
- 显示绝对目标路径既不能直接导航，也会在提示中额外暴露文件系统信息。
- 将笔记加入侧栏或增加最近导出视图会超出保存确认的需求范围。

## Consequences

共用笔记导出函数的调用方获得相同操作。不新增偏好设置、数据库结构、文件格式或凭据访问。缺失或目录树之外的目标不会触发任意文件读取；后续手动选择会清除待处理请求。

## Verification

- Regression — `src/renderer/services/__tests__/ExportService.test.ts`：只有点击操作才导航至实际创建的文件名，写入失败不会显示成功操作。
- Regression — `src/renderer/pages/notes/__tests__/NotesPage.test.tsx`：目录发现延迟、组合输入、目录树之外的目标及手动取消保持选择和草稿归属。
- Regression — `src/renderer/hooks/tab/__tests__/useMainWindowNavigation.test.tsx`：保存后的打开请求复用已有笔记标签页，也复用下一次 React 渲染前刚创建的标签页。
