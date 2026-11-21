# Agent Note: Web Core Worker 对话层

Status: proposed

[English](2026-10-20-web-core-ai.md) | 中文

## Problem

Web 版(issue #21728)是免安装试用,范围是登录、对话、Agent 和简单设置。[数据库 Spec](2026-10-20-web-core-database.md) 已让数据服务在浏览器的 Core Worker 里运行。对话还需要主进程的 AI 层也在那里运行:`AiStreamManager`(管理流、把回复写入数据库)和 `AiService`(通过 aiCore 和 AI SDK 调用模型服务商)。两者都依赖只能在桌面端运行的功能。原样打包给浏览器时,`AiStreamManager` 和 `AiService` 会牵连 96 个 `src/main` 文件和 55 个包,它们引用了 Node 内置模块、Electron 或原生模块(技能、内置工具、Agent 会话、渠道、文件处理、Copilot、写入磁盘的追踪、`sharp` 等)。其中大部分来自少数几个功能的入口模块,而不是对话路径本身。

## Proposal

在 Core Worker 里用原样的 `AiStreamManager` 和 `AiService` 跑通一轮对话,并把试用对话以外的东西都挡在打包产物之外。所有改动都在 `packages/web-core` 里;`src/main` 下没有文件被修改。

1. **构建时替换功能入口模块。** 构建插件 `replace-desktop-modules` 按 `src/main` 下的路径,把模块换成 `packages/web-core/src/disabled/` 里的替身。替身导出同样的名字,被调用时抛出 `WebUnsupportedError`;换掉入口模块,它后面的代码就都不会进入打包产物。被替换的有:技能(`SkillService`、`builtinSkills`)、内置工具、Agent 会话的分发和工作区、渠道监听器、附件文字提取和文件处理、`@main/utils/file` 入口(只有工具输出的文件存储会用到它)、模型列表拉取、网页搜索、Copilot / Grok CLI / Ollama 的服务商辅助代码、追踪存储和 Node 追踪运行时、AI SDK devtools、图片下载和改图输入整理,以及 `LifecycleManager`。
2. **对话路径确实用到的运行时接口,换成浏览器版本**,通过别名或替换完成:`customFetch`(用 Worker 自带的 `fetch`;仍为 HTTP 追踪记录最终请求体)、`appEdition`(固定为 `global`)、服务商注册表加载器和 `registryDataPaths`(使用打包进来的目录,而不是磁盘上的 JSON 文件)、`electron`(只有 `ipcMain` 和 `app.getLocale()`)、`node:os`、`node:path`(`pathe`)、`node:crypto`(用 `@noble/hashes` 实现 `createHash` / `createHmac`)、来自 `buffer` 包的全局 `Buffer`,以及 `sharp`(测量图片尺寸时抛错;token 计数本来就有兜底)。数据库 Spec 曾把 `registryDataPaths` 和 `appEdition` 列为不会替换;对话会经由 `ProviderService` 和 `ProviderRegistryService` 用到它们,所以本 Spec 替换它们。
3. **账号打开时在 Worker 里注册的服务**:执行 `onInit` 的 `AiStreamManager`(它会把关闭的标签页遗留为 `pending` 的回复标记为失败)、不执行桌面端 `onInit` 的 `AiService`(内置工具、技能、Electron 的 User-Agent 钩子、图片任务处理器)、`WebPreferenceService`(数据库里保存的设置覆盖默认值,目前只读)、`WebCacheService`(内存层和共享层,暂不同步给页面),以及一个丢弃追踪数据的追踪存储。`close` 会先停止正在进行的流,再关闭数据库。除了话题和消息,服务商、模型和助手的 DataApi 路由也一并提供。
4. **Worker 的入口文件不被任何模块引用。** Worker 构建把所有启动时就加载的模块放进一个 `core` 分块。当懒加载的分块从模块 Worker 的入口脚本导入时,WebKit 会把这个脚本再执行一遍,结果在第二轮对话时启动了第二个没有打开数据库的 Core Worker。
5. **用本地的 OpenAI 兼容接口测试**(`e2e/mockProvider.ts`,支持 CORS),在 Chromium、WebKit 和 Firefox 中运行。

不在本 Spec 范围内:页面侧的流式协议和对话界面、登录、Agent(它的工具、会话和文件存储)、设置的写入、附件、MCP 和话题自动命名的验证。

## Alternatives considered

- **修改桌面端的调用位置**(改成懒加载、拆分模块),让打包工具丢掉桌面端功能。维护者允许小范围修改调用位置,但模块替换完全不需要改,也让已经验证过的桌面端逻辑保持原样。
- **给 Node 内置模块打补丁**(`vite-plugin-node-polyfills`、空壳模块)。会把在浏览器里根本用不了的桌面端功能打包进来,增大下载量,并把失败从构建时推迟到运行时。
- **用桩代码执行 `AiService.onInit`。** 内置工具和技能需要文件系统和命令行;全部写桩比跳过这个钩子的代码更多。
- **在服务端运行 AI 层。** 需要为每个用户开服务端进程,设计评审已因成本否决。
- **关闭 Worker 的代码分块**来避开 WebKit 的重复执行。会把 2 MB 的 `o200k_base` 分词表放进首次下载。

## Acceptance criteria

- AC1 — Worker 构建打包了 `AiStreamManager` 和 `AiService`,其中没有 Node 内置模块、Electron 或原生模块的引用,且 `src/main` 和 `src/renderer` 下没有文件被修改。(verification: 打包产物及变更范围报告)
- AC2 — 在 Chromium、WebKit 和 Firefox 中,持久话题上的一轮对话从 OpenAI 兼容接口流式收到文字片段,用户消息和回复都以 `success` 写入数据库,请求里带上保存的 API 密钥和之前的对话轮次,刷新页面后对话仍在。(verification: 打包产物)
- AC3 — 服务商返回错误时,这一轮以错误结果结束,回复以 `error` 写入数据库,而不是停在 `pending`。(verification: 打包产物)
- AC4 — 标签页关闭时仍在流式输出的回复,在下次打开该账号时以 `error` 写入数据库。(verification: 打包产物)
- AC5 — 记录 Worker 首次下载的 gzip 大小,以及一轮对话会拉取的每个懒加载分块的 gzip 大小。(verification: 打包产物,结果记入 implemented 笔记)

## Risks

- **页面体积。** Worker 的首次下载从约 600 KB 增加到约 1 MB(gzip 后;Worker JavaScript 603 KB,`sqlite3.wasm` 402 KB)。第一轮对话还会拉取约 104 KB 的服务商代码;`o200k_base` 分词表(gzip 后 1 MB)不会被加载。仅打包进来的服务商目录压缩前就约 1.6 MB;改由后端提供可以缩小首次下载。
- **CORS 和浏览器里的密钥。** 模型请求从用户的浏览器发出,所以每个接口都必须允许页面的来源,API 密钥对页面也是可见的。试用时预期使用企业后端的模型网关;直接调用第三方服务商只在它们允许浏览器调用时可行。
- **按路径匹配的替换。** 替换按文件路径匹配。被替换的桌面端模块一旦挪位置,真实模块就会回到打包产物里:如果它引用了 Node 内置模块或 Electron,构建会失败;但如果它在浏览器里也能加载,就会悄悄打包进去。替身如果缺少桌面端代码导入的名字,构建会失败。
- **跳过了 `AiService.onInit`。** 以后加进这个钩子的启动工作,在加入 Worker 的启动流程之前都不会在 Worker 里执行。
- **设置只读,共享缓存不同步。** 修改设置需要能写入的 `WebPreferenceService`;读取共享缓存的流状态提示需要同步到页面;两者属于界面和设置的 Spec。
- **工具输出的文件存储被禁用。** 大到需要存成文件的工具结果会抛错。普通对话不带工具;Agent 的 Spec 必须决定这些输出存到哪里。
- **构建配置里写死了 Worker 入口的名字。** `core` 分块按路径排除了测试页的入口;每个新的 Worker 入口都要同样排除,否则 WebKit 的重复执行问题会再次出现。
