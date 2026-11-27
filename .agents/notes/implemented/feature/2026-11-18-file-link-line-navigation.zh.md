# Agent Note: 文件链接行级定位

Status: implemented

[English](2026-11-18-file-link-line-navigation.md) | 中文

## 问题

聊天中的文件引用可以包含源码位置，但 `ClickableFilePath` 会移除冒号后缀中的行列号，Markdown 文件链接解析也会丢弃片段。文件打开动作和预览插件收到的只有路径，没有位置信息。因此，指向第 42 行的链接只会打开文件，不会显示该行。智能体文件打开流程还会在源码预览之前将 HTML 路由到浏览器面板。

## 决策

文件引用包含文件系统路径和可选的渲染进程 `FileLocation`。内联路径和本地 Markdown 链接支持 `path:42`、`path:42:5`、`path#L42` 和 `path#L42-L48`。行号从一开始，范围包含两端；列号会被保留，但导航高亮整行。Markdown 在百分号解码前解析坐标，使编码后的文件名标点保持字面含义。保留现有 URI scheme 安全规则：单段冒号目标必须使用 `./file.ts:42`；普通片段沿用现有处理方式。

Markdown 打开器、`ClickableFilePath`、消息动作和预览导航使用同一位置契约。只有纯路径传入文件系统操作或外部应用。本次不增加外部编辑器行号协议。

右侧面板所有者为每次接受的点击创建新的位置，包括同文件点击，并将位置存入当前选择而非保留的标签页。现有元数据请求代次会拒绝过期打开操作，未保存编辑确认仍控制是否接受切换。普通打开和标签页激活会清除位置。带位置的 HTML 绕过浏览器路由；Markdown 和 HTML 显示源码。二进制预览及没有应用内预览的界面保留现有行为。

`FileEditor` 使用 Pierre 的 `onPostRender`、`VirtualizedFile.getLinePosition`、`setSelectedLines` 和 `Virtualizer.scrollTo`。逻辑坐标稳定且目标可见后才完成导航。卸载会取消已安排的任务。这能处理源码延迟加载、自动换行和虚拟化目标，无需查询屏幕外行的 DOM。超出范围的正数位置收敛到已加载文档边界；错误坐标不产生定位请求。

## 考虑过的替代方案

- 将带后缀的原始字符串传给文件 API：否决，因为元数据和读取操作需要真实文件系统路径。
- 为 Markdown 和可点击路径分别添加解析器：否决，因为路径解码、Windows 盘符和行号语法会产生分歧。
- 查找行元素并调用 `scrollIntoView`：否决，因为屏幕外的虚拟化行可能没有 DOM 节点。
- 将所有带位置的链接交给外部编辑器：否决，因为本版面向现有应用内预览，不涉及编辑器专用协议。

## 影响

源码位置指向当前加载的文件，而不是聊天中引用的历史版本。内联冒号数字文件名仍然存在歧义；显式 Markdown 目标可以对字面标点进行编码。源码高亮使用 Pierre 现有的行选择样式。公开解析和导航参数对仅传路径的调用方保持可选。

渲染进程测试覆盖路由、过期元数据和未保存文件切换取消。Electron 证据来自开发应用内的隔离组件测试界面，使用真实聊天 Markdown、文件预览插件、文件系统读取和 Pierre；这不是打包产物或完整会话测试。用户明确授权对 Spec #24746 的 `dfc4838e3b3d81ba524a983a5c691f1ea16e27c8` 直接实现，豁免通常要求的 GitHub 人类审批。

## 验证

- AC1 — `src/renderer/utils/__tests__/filePath.test.ts` 和 `src/renderer/components/chat/messages/markdown/plugins/__tests__/rehypeBareFilePaths.test.ts`：77 项测试通过，覆盖支持的坐标、编码文件名、URI 拒绝和 POSIX 正文扫描。
- AC2 — `ClickableFilePath.test.tsx`、`ChatMarkdown.test.tsx`、`openFileTarget.test.ts` 和文件预览消费者测试通过；Electron 中点击真实聊天 Markdown 和内联路径，在实际文件加载后显示及高亮源码行。
- AC3 — `src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx`：同文件重复导航、普通打开清除位置、过期元数据及未保存文件切换取消测试通过；Electron 中手动滚走后再次点击同一行链接。
- AC4 — Markdown/HTML 插件和右侧面板路由测试通过；Electron 中带位置的 Markdown 和 HTML 在第 42 行打开源码，现有不带位置的路由测试保持通过。
- AC5 — macOS Electron 在 4000 行自动换行文件中显示第 3000–3003 行、返回第 42 行、将第 99999 行收敛到第 4000 行，并在普通打开时清除高亮；样本内容保持不变。
- AC6 — 定向渲染进程测试、`pnpm typecheck:web`、变更文件 Oxlint/ESLint 与格式检查、文档影响审查、双语配对和 `pnpm docs:check` 通过。报告已有 ESLint 警告；未运行 Windows/Linux 和打包产物运行时检查。
