# Agent Note: 在桌面对话中使用 MCP Apps

Status: proposed

[English](2026-11-24-desktop-mcp-apps.md) | 中文

## Problem

桌面端的智能体会话和助手话题可以调用 MCP 工具，但工具结果无法展示来源服务声明的交互界面。Cherry Studio 移动端已经提供显式打开入口和沙箱宿主。桌面端需要在对话内嵌入界面，并适配自身的工具执行、对话历史和 Electron 隔离边界。参见[产品需求](https://github.com/CherryHQ/cherry-studio/issues/16159)。

## Proposal

### 发现和打开 App

使用与当前 MCP 客户端兼容的官方 `@modelcontextprotocol/ext-apps` schema 和 `AppBridge` 实现 [MCP Apps 扩展](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)。在支持的桌面 MCP 连接上宣告 `io.modelcontextprotocol/ui` 及 HTML profile。发现工具时解析 `_meta.ui.resourceUri` 和工具可见性。仅供 App 使用的工具保留在来源目录中，以便检查策略和供 App 调用，并从面向模型的发现与调用路径排除，包括延迟加载的工具和转发给智能体运行时的工具目录。

同一个宿主支持按 [OpenAI 插件 UI 指南](https://developers.openai.com/plugins/build/chatgpt-ui)和 [Claude MCP Apps Quickstart](https://claude.com/docs/connectors/building/mcp-apps/quickstart)使用标准桥接协议的 App。OpenAI Todo 直接使用 JSON-RPC。Claude Dice 使用 `ext-apps` 1.x 界面 SDK，与宿主所用的 2.x SDK 共享同一桥接协议。通过现有 MCP 连接识别旧版服务提供的有效标准元数据。先发送完整工具输入，再发送结果，其中包含 `structuredContent` 和供界面使用的 `_meta`。沿用现有的模型输出路径，供界面使用的 `_meta` 不进入模型上下文。

声明了有效 App 的工具成功执行后，已保存的结果进入视口时会准备 App，重启后的历史结果也一样。未声明外部来源的 App 自动在对话内渲染，声明了外部来源的 App 在结果区等待确认后运行。主进程将 App 绑定到原始对话、工具调用、服务身份、连接配置和资源 URI。在宿主写入的工具消息片段元数据中记录绑定，并保留界面所需、大小受限的输入和结果。绑定来自实际调用和目录，包括展示结果可能经过投影的原生智能体运行时。工具返回的 JSON 无法声明 App 或提供绑定。缺少这类证据的已有结果沿用普通展示。

主进程读取指定结果，重新检查当前来源和该对话的策略，再通过原 MCP 服务读取声明的 UI。加载前校验 URI、MCP Apps HTML MIME 类型和响应大小。App 卡片展示加载和失败状态，普通工具结果仍可查看。打开和重新打开时读取 UI 资源，原工具调用不会重复执行。

### Renderer 与界面生命周期

从宿主写入的工具消息片段元数据投影 App 引用。助手和智能体共用 `MessagePartsRenderer` 的消息结果区，每个符合条件的调用以消息 ID 和真实工具调用 ID 为键，挂载一个 App 卡片。工具分组折叠、流式消息转入已完成历史时，结果区保持挂载。普通工具详情继续由 `MessageMcpTool` 展示。页面适配器通过消息列表 Provider 提供所属对话和输入框操作。没有打开操作的只读界面保持普通工具结果。

对话 Renderer 向主进程提交对话、消息和工具调用标识，收到用于挂载本地宿主页面的单次引用。结果区按需展示确认和加载状态，加载失败时提供重试操作。Guest 随消息行滚动和裁剪。尺寸变化时调整预留高度，保留运行中的实例。App 打开期间，即使滚出视口，消息列表也保留所在消息行。切换对话或卸载界面时，释放 Guest 并取消待处理操作。

### 宿主与授权

在隔离的 Electron 宿主中使用具有不透明来源的沙箱 iframe。脚本执行前，先为 UI 应用限制严格的 CSP。仅放行 App 声明且通过校验的 HTTPS 网络和资源来源，打开前展示这些来源，并阻止嵌套框架、导航、弹窗、下载及浏览器设备权限。App 与对话 DOM、Cherry Studio 存储、preload、Node 及小程序授权隔离。桥接消息须来自预期的框架和当前打开的实例，主进程操作限定在该 App 及其所属窗口。

当前主窗口关闭了 Electron 进程沙箱和 `webSecurity`。使用独立的内嵌 `<webview>` Guest 和非持久分区。主进程在挂载时验证并消费该窗口的单次引用，选定随应用打包的宿主页面，并强制启用沙箱、上下文隔离及 `webSecurity`。宿主页面承载 App iframe，并核对 `postMessage` 的发送框架。专用通道只允许 Guest 主框架与主进程持有的 `AppBridge` 通信。App 界面仅收到标准 JSON-RPC 桥接。主进程单独向 Guest 提供 UI 资源。

分别校验静态资源的 `resourceDomains` 和直连网络请求的 `connectDomains`。在执行 HTML 前，应用 `resources/read` 返回的匹配内容项中的声明。Claude Dice 从声明的静态资源来源 `https://unpkg.com` 导入界面 SDK。允许 iframe 触发 HTML 表单的 `submit` 事件，以便 OpenAI Todo 处理事件并调用 MCP 工具。通过 CSP `form-action 'none'` 阻止浏览器原生表单提交。

App 完成握手后，发送该次调用的输入和结果，以及语言、尺寸和主题。为 `tools/call` 和受支持的资源列举与读取注册显式的 `AppBridge` 处理器。请求通过 `McpRuntimeService` 中原始连接发出，每次均检查当前对话绑定、服务策略及适用的资源权限。工具调用须满足 App 可见性、参数校验，并由用户通过宿主的工具审批流程确认具体工具和参数。审批决定和调用结果记录在发起对话中。用户确认后重新检查来源和策略。这次确认独立于模型的自动审批设置。展示外部 HTTPS 链接并经用户确认后打开。面向用户的文本经确认后才放入发起对话的输入框。宿主只宣告已经实现的桥接能力。

在首次渲染前，宿主界面可以读取资源 URI、MIME 类型和已审核的网络来源。[MCP 安全检查器](https://github.com/CherryHQ/cherry-studio/issues/16128)可在上线后使用这些信息。检查器的报告和信任策略需要独立实现。

卸载界面、切换对话、所属窗口关闭或来源权限撤销时，关闭桥接并取消待处理审批和请求。请求可能已经送达服务时，按实际情况提示结果不确定，App 宿主不会重放该请求。

### 展示和扩展能力

对 App 宣告支持 `inline` 展示模式。根据界面报告的尺寸调整高度，并限制最大高度。容器、主题或语言变化时更新宿主上下文。界面初始化失败，或需要宿主尚未提供的展示模式和能力时，工具结果仍可查看。

全屏和画中画是可单独支持的标准展示能力。[Claude 侧栏](https://claude.com/docs/connectors/building/mcp-apps/display-modes)、[由运行中的界面注册的工具](https://claude.com/docs/connectors/building/mcp-apps/app-tools)、全局入口、嵌套网站、绑定到厂商域名的沙箱来源和文件下载，需要单独确定产品行为和权限。若要让模型调用界面注册的工具，还需跟踪运行中的工具目录及其生命周期。`ui/update-model-context`、自动开启对话轮次和持久化 App 状态留待后续支持。

### 交付顺序

1. 在 `McpCatalogService`、助手适配器及智能体 MCP 转发和投影链路接通工具发现和来源记录。验证发现和调用阶段的可见性，以及持久化来源绑定。宿主可用时再宣告支持 Apps。
2. 实现共用的桌面 App 卡片、隔离的 Electron 界面和 `AppBridge`。验证资源校验、CSP、原始输入和结果传递、尺寸调整、关闭和重新打开。
3. 将 App 调用、链接和草稿接入桌面审批及对话记录。在 Electron 中运行未经修改的 Todo 和 Dice 示例。使用真实 MCP 测试服务验证确认、撤销和取消，再在打包后的构建中验证隔离。

## Alternatives considered

- 整体复用桌面小程序运行时。MCP Apps 绑定到对话内的工具结果，使用独立协议。可复用合适的 Electron 隔离机制，小程序授权独立于这条路径。
- 在对话文档中渲染 App HTML，或用通用 MCP 客户端转发桥接调用。独立宿主与显式转发可隔离第三方代码，并对每次请求执行对话和来源策略。
- 直接使用移动端 WebView 外壳。其交互和权限设计可作参考。桌面端由 Electron 管理框架身份、请求策略和原生能力。
- 模拟旧版 ChatGPT 组件运行时。[Pizzaz](https://github.com/openai/openai-apps-sdk-examples/tree/main/pizzaz_server_node)使用 `openai/outputTemplate` 别名和 `text/html+skybridge`。宿主接受标准声明和标准 HTML MIME 类型，不注入 `window.openai`，也不识别仅 OpenAI 使用的启动元数据。

## Acceptance criteria

- AC1 — 真实 MCP 服务根据扩展协商启用 UI，启动工具可供模型使用，仅供 App 使用的工具可供界面调用。普通工具保留原有行为。 (verification: unit | Electron)
- AC2 — 助手话题和使用 Claude Code、Pi、Pi Durable 的智能体会话均可从已完成的工具结果在对话内打开 App，显示原始输入和结果。重启后再次打开会读取 UI，原工具只调用一次。 (verification: Electron)
- AC3 — 界面 HTML 缺失或无效、打开绑定被伪造、来源被移除、禁用或重新配置时，普通工具结果仍可查看，App 不会加载。不同服务上相同的 URI 仍各自绑定其来源。 (verification: unit | Electron)
- AC4 — 界面无法访问 Cherry Studio DOM、存储、preload 或浏览器设备权限。未声明的网络目的地和导航会被阻止，来自其他框架或已关闭实例的消息会被拒绝。 (verification: packaged artifact)
- AC5 — 获批的同源 App 工具调用会将结果返回给界面，并在对话中留下记录。被拒绝、已禁用、跨服务、仅供模型使用及撤销权限后的调用均不发出工具请求。等待确认时离开对话会清除待处理操作。 (verification: unit | Electron)
- AC6 — 链接和输入框消息均需要在宿主界面确认。确认后的文本成为草稿，由用户编辑和发送。 (verification: renderer | Electron)
- AC7 — stdio、Streamable HTTP 和 SSE 均支持相同的 App 打开行为。未经修改的上游示例 App 可在 Electron 中完成受支持的交互。 (verification: unit | Electron)
- AC8 — 未经修改的 [OpenAI Todo Quickstart](https://developers.openai.com/plugins/build/app-quickstart)能展示初始数据，并通过获批的 MCP 工具调用新增和完成待办。浏览器原生表单提交不会发出网络请求。 (verification: Electron)
- AC9 — 未经修改的 [Claude Dice Quickstart](https://claude.com/docs/connectors/building/mcp-apps/quickstart)加载声明的模块，展示第一次掷骰结果，经批准后按原骰子面数和数量再掷一次。静态资源来源未放行时，模块被拦截，普通工具结果仍可查看。 (verification: Electron)
- AC10 — 视口内已保存的结果自动渲染未声明外部来源的 App，工具详情折叠时也一样。声明了外部来源的 App 等待确认。工具分组折叠、尺寸变化或滚出视口再回来时，已打开的界面保留状态。 (verification: renderer | Electron)
- AC11 — 仅使用旧版 ChatGPT 协议的组件显示普通工具结果，不提供打开按钮，标准 App 界面没有注入的 `window.openai`。 (verification: renderer | Electron)

## Risks

当前助手结果保留的协议数据多于部分智能体投影。验收需要覆盖每个受支持运行时的实际调用和持久化消息片段，包括重启后的情况。App 兼容性取决于宿主支持的桥接能力和 Electron 的 CSP 执行。在开发环境使用真实 MCP 测试服务，并在打包后的 Electron 中验证隔离边界。
