# Agent Note: Web Core 加固

Status: proposed

[English](2026-10-23-web-core-hardening.md) | 中文

## Problem

设计文档的 M5 里程碑在发布前加固 Web 版:隔离测试、内容安全策略(CSP)、浏览器兼容性和压力测试。之前的 Spec([数据库](2026-10-20-web-core-database.md)、[应用](2026-10-20-web-core-app.md)、[Agent](2026-10-21-web-core-agent.md)、[本地文件夹](2026-10-23-web-core-local-folder.md))留下了这些缺口:

- **没有内容安全策略。** 页面只下发 COOP 和 COEP。应用保存的一切(数据库、附件、偏好设置里的服务商 API Key)都能被页面里运行的任何脚本读到,所以通过模型回复或依赖注入的脚本可以拿到全部数据。
- **不支持的浏览器失败得晚,原因也不清楚。** 页面不检查浏览器能力就启动 Core Worker。浏览器没有 OPFS 同步访问句柄、页面没带隔离响应头、或者无痕窗口里 OPFS 不可用时,结果是带着底层报错的"Cherry Studio 无法启动",或者一直转圈。
- **浏览器可能清除数据。** 页面从不申请持久化存储,存储空间紧张时浏览器可能不经询问就删除账号的 OPFS 目录。在备份(M4,等企业后端)完成之前,删了就找不回来。
- **不可信内容没有针对账号数据做过测试。** Python 沙箱测过(Agent Spec AC4);对话预览里生成的 HTML、模型回复里的 Markdown 和 QuickJS 脚本都没有测过。
- **没有长时间会话的测量。** 数据库 Spec 测了 5 万条消息时的启动;没有测过长对话或长 Agent 会话,而内存泄漏和变慢只会在这种场景出现。
- **没有能力清单。** #21728 要求向用户说明哪些桌面功能不支持;README 只列出被替换的模块,没有说明用户能做什么、不能做什么。

## Proposal

所有改动都在 `packages/web-core` 内,不改桌面端源码。

1. **内容安全策略。** web-core 在一处定义策略,开发服务器和 `vite preview` 把它和 COOP、COEP 一起作为响应头下发;README 给出静态托管时的写法。
   - `default-src 'self'`;`object-src 'none'`;`base-uri 'self'`;`form-action 'self'`;`frame-ancestors 'none'`。
   - `script-src 'self' 'wasm-unsafe-eval'`,加上 Pyodide 的 CDN(`https://cdn.jsdelivr.net/pyodide/`)。内联脚本只按哈希放行:构建时对 Pyodide 沙箱 iframe 的脚本取哈希,这是应用唯一需要的内联脚本。脚本不允许 `'unsafe-eval'`,也不允许 `'unsafe-inline'`。
   - `worker-src 'self' data:`(Pyodide worker 从 `data:` URL 启动,见 Agent Spec);预览用 `frame-src 'self' data: blob:`。
   - `style-src 'self' 'unsafe-inline'`:桌面端渲染层在运行时注入样式;样式不能执行脚本。
   - `img-src`、`media-src` 和 `font-src`:`'self' data: blob:`,图片和媒体再加上 `https:`,因为模型回复和服务商图标可能从任何地方加载。
   - `connect-src 'self' data: blob: https:`:社区版在浏览器里直接向用户配置的服务商发送模型请求,所以必须能访问任何 HTTPS 地址。各版本通过同一个函数收窄它(企业版收窄到自己的后端和网关)。
   每个 e2e 页面都记录 `securitypolicyviolation` 事件,出现任何违规测试就失败,所以被策略拦住的功能不会悄悄发布出去。
2. **启动检查。** 启动 Core Worker 之前,页面检查自己是否处于跨域隔离状态,以及模块 Worker、WebAssembly 和 OPFS 是否可用;Worker 再检查能否打开同步访问句柄。检查失败时,用启动界面支持的语言把转圈换成具体原因:
   - 没有跨域隔离:站点没有带必需的响应头(部署问题,附 README 相应章节的链接);
   - 缺少功能:浏览器不受支持,并列出支持的浏览器;
   - OPFS 被拒绝(例如某些无痕窗口):浏览器不允许这个站点存储数据。
   支持的浏览器是 Chrome、Edge、Firefox 和 Safari 的当前和上一个大版本,也就是 e2e 测试运行的版本;检查按功能进行,所以具备这些功能的其他浏览器也能启动。
3. **持久化存储。** 账号打开时,页面申请持久化存储(`navigator.storage.persist()`)。浏览器拒绝时,页面对每个账号只弹一次警告提示:存储空间紧张时浏览器可能删除数据,不要清除站点数据。Worker 把存储已满(`QuotaExceededError`、`SQLITE_FULL`)当作已知错误,页面弹出"浏览器为这个站点分配的存储空间已满"的提示,而不是笼统的失败。
4. **隔离测试**(e2e,三个浏览器):
   - 模型回复里试图运行脚本的 HTML(`<script>`、`<img onerror>`、`javascript:` 链接)一个都不会执行。
   - HTML 代码块的预览不运行脚本,也读不到页面的存储:桌面端受限的预览沙箱已经保证这一点,测试负责把它固定下来。
   - QuickJS 脚本里没有 `fetch`、`indexedDB`、`navigator` 和 `postMessage`。
   - Python 的不透明源和 Agent 的审批已有测试覆盖。
5. **压力测试**(e2e,Chromium,它能用 `performance.measureUserAgentSpecificMemory()` 测内存):
   - **长对话:** 在一个话题里对模拟服务商进行 200 轮对话。每 50 轮记录一次从发送到收到第一个流式 token 的时间,以及页面和 Worker 的内存。
   - **长 Agent 会话:** 50 轮 Agent 对话,每轮写入并读取一个文件。记录同样的测量值。
   - 这份 Note 改为 implemented 时写入测量结果。
6. **能力清单。** README 新增一张表,按用户能感知的功能(对话、附件、Agent 工具、Python、JavaScript、本地文件夹、MCP、知识库、小程序、备份等)列出 Web 版能做什么、哪些仍只在桌面端,以及每项需要的浏览器。Web 版不支持的功能已经会返回 `WebUnsupportedError`;这张表是用户和管理员查阅的地方。

不在范围内:企业版 Web 应用的加固(它的 CSP `connect-src`、只放在 Worker 内存里的 access token、不同个人资料之间的隔离)在企业仓库里做;后端鉴权随企业后端跟进;备份与恢复(M4);以及 #21728 验收项中依赖备份的那些证据。

## Alternatives considered

- **用 CSP `<meta>` 标签代替响应头。** 任何静态托管都不用配置就能生效,但不能设置 `frame-ancestors`,而且要等标签解析后才生效。部署本来就要设置 COOP 和 COEP 响应头,CSP 和它们放在一起。
- **内联脚本用 nonce 代替哈希。** nonce 需要服务器逐个渲染响应;应用是静态文件。
- **在社区版里限制 `connect-src`。** 模型请求发往用户自己添加的服务商,任何白名单都会让自定义服务商失效。
- **只在用户操作时申请持久化存储。** Chrome 和 Edge 不弹窗直接决定;Firefox 会弹出自己的提示。打开账号时就申请,能从第一次访问起保护数据。
- **在所有浏览器里做压力测试。** 只有 Chromium 能测 Worker 的内存;WebKit 和 Firefox 的耗时来自现有的规模测试。

## Acceptance criteria

- AC1 — 开发服务器和 `vite preview` 下发上述 CSP 以及 COOP、COEP。完整的 e2e 测试在 Chromium、WebKit 和 Firefox 中在该策略下通过,且没有记录到任何 `securitypolicyviolation` 事件;README 给出静态托管时的响应头。(verification: packaged artifact)
- AC2 — 没有隔离响应头的页面、没有 OPFS 同步访问句柄的浏览器(模拟)和被拒绝的 OPFS(模拟),各自显示自己的启动界面提示,而不是转圈或笼统的错误。(verification: packaged artifact)
- AC3 — 打开账号时会申请持久化存储;申请被拒绝时(模拟),每个账号只出现一次警告提示,重新加载后不再出现。存储已满导致的数据库写入失败会显示存储已满的提示。(verification: packaged artifact)
- AC4 — 在三个浏览器中,模型回复的 HTML 和 HTML 代码块预览里的脚本都不会运行,也读不到 OPFS;QuickJS 脚本看不到 `fetch`、`indexedDB`、`navigator` 和 `postMessage` 中的任何一个。(verification: packaged artifact)
- AC5 — 长对话和长 Agent 会话测试在 Chromium 中运行,每 50 轮记录发送到首个 token 的时间以及页面和 Worker 的内存,记录写在这份 Note 里。第 200 轮(对话)和第 50 轮(Agent)之后的内存,最多是第 50 轮(对话)和第 10 轮(Agent)之后的 1.5 倍;最后一轮的首个 token 时间最多是第一轮的两倍。(verification: packaged artifact)
- AC6 — README 有能力清单,清单中标为仅桌面端的每条路由都返回 `WebUnsupportedError`。`src/main`、`src/preload`、`src/renderer` 和 `src/shared` 下没有文件改动。(verification: change-scope report 和 code review)

## Risks

- **样式允许 `'unsafe-inline'`。** 理论上 CSS 仍能通过选择器和背景图片泄露数据;这比脚本注入的风险小得多,而去掉它就要改桌面端渲染层的样式方式。
- **社区版的 `connect-src https:`。** 万一真有注入的脚本运行,它仍能把数据发到任何地方。CSP 让脚本很难运行起来,但不限制数据发往哪里。
- **是否持久化由浏览器决定。** Chrome 按站点使用情况决定是否授予,第一次访问的用户经常被拒绝;在备份完成之前,警告是唯一的缓解办法。
- **压力测试的阈值基于模拟服务商。** 真实服务商流式输出更慢、回复更长;这些测试检测的是应用本身的泄漏和变慢,不是真实环境下的速度。
- **依赖 CDN。** Pyodide 仍从 jsDelivr 加载;屏蔽它的部署会失去 Python。把 Pyodide 随应用一起托管留给以后的改动。
