# Agent Note: Web Core Agent

Status: proposed

[English](2026-10-21-web-core-agent.md) | 中文

## Problem

Web 版的首个版本包含 Agent 会话(issue #21728;设计文档第 2 节、第 3.3 节和 M2 阶段):Agent 在浏览器里的工作区中编辑文件,在沙箱里运行 Python 和 JavaScript,遇到有风险的操作会先征求用户同意。Web 应用通过 Core Worker 运行桌面端主窗口([Web 应用 Spec](2026-10-20-web-core-app.md)),但 Worker 把 Agent 的所有入口模块都换成了替身,所以 Agent 页面无法发起一轮对话。

桌面端的 Agent 通过运行时驱动(Claude Code、Pi)运行,它们共用一个会话宿主 `AgentSessionRuntimeService`。两个驱动都需要 Node、命令行和本地磁盘;光是 Pi 的运行时就有 1937 个模块、56 个 Node 依赖。宿主本身可以移植。把宿主、`AgentChatContextProvider`、工作区解析和提示词构建打包到浏览器时,只有两处会引入 Node 依赖:

- 会话分叉(fork),它会引用 Pi 的会话文件;
- `fs` 和 `fs/promises`,用于 Agent 数据目录(`SOUL.md`、记忆)、工作区和内置 Agent 模板。

桌面端会预置两个内置 Agent:Cherry 小助手和 Cherry Support,都是 Claude Code 类型,在浏览器里跑不了。

## Proposal

在浏览器运行时驱动之上,运行原样的桌面端 Agent 会话宿主和 Agent 界面。所有改动都在 `packages/web-core` 里;`src/main`、`src/preload`、`src/renderer` 和 `src/shared` 下没有文件被修改。

1. **Worker 里的文件系统。** `fs` 和 `fs/promises` 解析到 ZenFS 及其 OPFS 后端。账号打开时,把账号的 OPFS 目录挂载到 `/web`(`application.getPath` 的根目录),关闭时卸载。
   - ZenFS 会在内存里保留一份挂载内容的副本,所以调用 `existsSync`、`readFileSync` 的桌面端代码也能工作。异步写入要等 OPFS 写好后才返回。
   - ZenFS 的异步 `rename` 在目标路径不存在时,文件其实已经改名了,却会报 `ENOENT`。所以兼容层把它转给同步的 rename。
2. **桌面端 Agent 会话宿主跑在 Worker 里。** `AgentSessionRuntimeService` 随账号启动。`AgentChatContextProvider` 和工作区解析不再被替换。工作区存储服务(用户自选工作区)和生命周期服务(删除和归档,需要工作区打包)仍然替换掉。会话分叉换成替身,答复 Web 版不支持该功能。
3. **一个以 `pi` 类型注册的浏览器运行时驱动**,替换 `registerDrivers.ts`。新建的 Agent 本来就默认是 Pi 类型,所以 Agent 界面、权限模式和工具卡片都不用改,Agent 数据也和桌面端兼容。每一轮:
   - 读取会话里保存的消息,用 `buildAgentRuntimePrompt` 构建提示词;
   - 用会话选定的模型运行桌面端的 AI SDK Agent 循环(`ai/runtime/aiSdk` 里的 `Agent`),服务商解析方式和对话一样;
   - 把循环输出的内容片段转成 Pi 事件,交给桌面端的 `PiStreamAdapter`,所以片段带有 Pi 的传输标记,最后发出 `turn-complete`。

   工具审批通过共用的 `toolApprovalRegistry` 和现有的 `ai.tool.respond_approval` 路由完成。这个驱动没有恢复令牌、中途插话(steering)、上下文压缩和分叉;一轮进行中发来的消息排到下一轮,这是宿主本来就有的后备做法。
4. **浏览器里的工具**,沿用 Pi 原生的工具名和参数格式:
   - **会话工作区里的文件工具:** `read`、`write`、`edit`、`ls`、`find`、`grep`。没有 `bash`。
   - **Python:** `python_execute`,由原样的桌面端 `PythonService` 提供。它通过桥接调用页面里的 Pyodide Worker。
   - **JavaScript:** `js_execute` 在一个独立 Worker 中的 QuickJS-WASM(`quickjs-wasi`,桌面端已经在用)里运行,超时就直接终止这个 Worker。

   审批直接用桌面端的 Pi 规则(`createPiToolAuthorizer`),按 Agent 的权限模式执行:
   - 在工作区或 Agent 数据目录里使用读取类工具(`read`、`ls`、`find`、`grep`),不用询问;
   - 修改文件在 `default` 模式下要询问,在 `acceptEdits` 模式下不用询问;
   - 运行代码在 `default` 和 `acceptEdits` 模式下要询问;
   - `auto` 模式只在文件工具访问这些目录以外的路径时询问,`bypassPermissions` 模式从不询问。

   规则里防止访问 Cherry SQLite 文件的检查被替换掉:数据库是 `/web` 以外的一个 OPFS 文件,任何工具路径都碰不到它。
5. **预置一个 Web 版 Cherry 小助手。** 一个 Web 专用的 seeder 创建一个名为 Cherry 小助手的 Pi 类型 Agent,带一个系统工作区和第一个会话。桌面端的 Cherry 小助手和 Cherry Support seeder 不运行。
6. **界面。** Web 版侧边栏加上 Agent。构建时替换两个 `src/shared` 模块,让运行时能力表只提供 Pi,为它隐藏心跳、技能、知识库和 MCP,并在 Agent 编辑器里列出浏览器里的工具。
7. **测试。** 模拟服务商学会用工具调用来回复;`e2e/agent.spec.ts` 在 Chromium、WebKit 和 Firefox 中驱动 Agent 页面。

实现放在一个 PR 里,接在本 Spec 之上。

不在本 Spec 范围内:来自 `configurations` 的远程 MCP、技能、定时和心跳运行、IM 频道、会话分叉、删除和归档 Agent 及会话、用户自选工作区、附件,以及把工作区文件纳入备份(M4 阶段)。

## Alternatives considered

- **在浏览器里运行 Pi。** 它需要命令行、Node 流和会话文件存储;设计文档的测量结果已经排除了这条路。
- **在 `src/shared` 里新增一个 `web` Agent 类型。** 这样 Web 版的 Agent 有自己的身份,但要改共享的数据结构、能力描述表和渲染进程的多语言文案,而且桌面端会列出一个它跑不了的运行时。这交给维护者决定;以 `pi` 注册可以让桌面端保持不变。
- **自己写一个 OPFS 文件系统。** 可以不把挂载内容放进内存,但要重新实现 Node `fs` 的语义,包括同步调用。ZenFS 有人维护,并且在三种浏览器中通过了写入、同步读取、列目录、改名和刷新后读取的检查。
- **用 IndexedDB 存文件。** OPFS 已经存放了数据库,也能直接处理文件内容。
- **在页面里运行 Agent 循环。** Worker 已经负责 AI 层和数据库;放在页面里,运行工具时会卡住界面。

## Acceptance criteria

- AC1 — 在 Chromium、WebKit 和 Firefox 中,Agent 页面列出预置的 Web 版 Cherry 小助手,新建 Agent 时只提供 Pi 运行时。(verification: 打包产物)
- AC2 — 在 `default` 模式下,一轮 Agent 对话通过 OpenAI 兼容接口调用 `write`,等用户同意后在会话工作区里创建文件。刷新页面后,回复、工具调用和文件都还在。(verification: 打包产物)
- AC3 — 用户拒绝审批时,这次工具调用以拒绝结束,文件不会被写入。在工作区里调用 `read`、`ls`、`find` 和 `grep` 不需要审批。(verification: 打包产物)
- AC4 — `python_execute` 在页面的 Pyodide 中运行 Python 并返回输出。`js_execute` 返回脚本的结果,并在超时时停止死循环。(verification: 打包产物)
- AC5 — 现有的 Web Core 测试仍然通过,Worker 构建中没有 Node 内置模块、Electron 或原生模块的引用,`src/main`、`src/preload`、`src/renderer` 和 `src/shared` 下没有文件被修改。记录 Worker 首次下载增加的大小和 QuickJS 模块的大小。(verification: 打包产物及变更范围报告,结果记入 implemented 笔记)

## Risks

- **挂载内容常驻内存。** 账号打开时,ZenFS 会把挂载里的每个文件都复制到内存,所以启动时间和内存占用会随工作区增大。预计试用版的工作区不大;启动时间会被测量并记录。
- **同步写入稍后才落盘。** 同步写入在 OPFS 写好之前就返回了,所以写完马上刷新页面可能会丢失。
- **没有上下文压缩和中途插话。** 很长的会话可能超出模型的上下文窗口;一轮进行中发来的消息要等到下一轮。
- **关掉标签页 Agent 就停。** 和设计文档说的一样,关闭页面会结束正在运行的这一轮。
- **数据里是 Pi 类型。** 如果以后 Web 数据同步到桌面端,桌面端会用真正的 Pi 运行这些 Agent,而它还有 `bash`。
- **Pyodide 从 CDN 加载。** 页面从 jsDelivr 加载它;跨域隔离的页面要求 jsDelivr 一直返回 CORS 头,私有部署可能需要自己托管。
- **工作区文件还没有备份。** 在备份(M4)完成之前,清除网站数据会丢失这些文件。
