# Agent Note: Mermaid 图表改用 Merman，并新增文件预览

Status: proposed

[English](2026-10-30-merman-mermaid.md) | 中文

## Problem

Mermaid 图表目前在两处通过 `mermaid` JavaScript 包渲染：代码块用的 `MermaidPreview`（聊天、快捷助手、划词、翻译、Markdown 文件预览），以及 `@cherrystudio/ui` 中的 `withMermaid()` Streamdown 预设。`MermaidPreview` 为绕开 `mermaid` 的缺陷做了不少处理：在屏幕外元素中测量、修补 `translate(undefined, NaN)` 输出、监听折叠容器，让隐藏的图表等容器有尺寸后再渲染。图表使用 Mermaid 自带的 `default`/`dark` 配色和字体，与设计系统不一致，节点还带有装饰性投影。

Agent 文件面板把 `.mmd`、`.mermaid` 文件当作纯文本打开，没有图表预览。

## Proposal

### 渲染器

- 用 [Merman](https://github.com/Latias94/merman) `@mermanjs/web-render` 0.9.2（锁定精确版本）替换 `mermaid` 和 `@streamdown/mermaid`。Merman 用 Rust 重新实现 Mermaid 并编译为 WASM，对齐 Mermaid 12.1 的行为。`mermaid` 包仅作为 `streamdown` 的类型依赖继续安装；应用代码不再引用它，因此不会再被打包。
- 新增 `@cherrystudio/ui/mermaid` 子路径负责渲染引擎，可在任何 realm 中运行。`loadMermaidRuntime()` 在首次使用时为每个 realm 加载并初始化一次 WASM。`renderMermaidSvg(source, { theme, diagramId })` 用 `OffscreenCanvas` 测量标签；在真实图表会请求的所有测量操作上（包括中日韩文字换行），结果与 Merman 基于 DOM 的浏览器测量相差不到半个像素。Merman 的结构化错误会转成带 Merman 原始信息的普通 `Error`。
- 渲染在专用 Web Worker（`src/renderer/workers/mermaid.worker.ts`）中进行，由 `mermaidRenderService` 管理，沿用代码高亮 worker 的模式。服务同一时间只运行一个渲染；同一图表在队列中等待的旧请求会被新请求替换，其所有调用方都拿到新的 SVG；超过 10 秒的渲染会通过终止 worker 来停止；崩溃的 worker 会在下一次请求时重建。
- worker 看不到页面通过 `@font-face` 加载的字体，因此主题会携带其字体列表对应的页面字体，worker 在测量前先加载这些字体。否则标签会用后备字体测量，导致溢出。
- `MermaidPreview` 调用该服务，并通过现有经过净化的 Shadow DOM 路径挂载结果。屏幕外测量、NaN 修补和可见性监听都已移除：Merman 不依赖容器尺寸。删除 `useMermaid`。
- `withMermaid()` 返回由同一渲染器驱动的 Streamdown 图表插件。

### 主题：沉浸式

图表遵循设计系统，而不是 Mermaid 的配色：

- `resolveMermaidTheme(element)` 把 Merman 的语义角色映射到设计 token：`--muted` 为节点填充，`--secondary` 为备用填充，`--foreground` 为文字，`--muted-foreground` 为次要文字和连线，`--border-strong` 为边框，`--background-subtle`/`--border` 为分组，`--warning-subtle`/`--warning-border` 为注释，`--success`，以及 `--chart-1` 至 `--chart-5` 为分类序列。
- 画布颜色取预览背后实际绘制的颜色：把所有半透明祖先背景叠加到第一个不透明背景上。SVG 背景为透明，因此图表直接位于所在表面（文件面板、聊天代码块）之上，浅色和深色模式均如此。
- 标签使用文档正文字体，而不是外层代码块的等宽字体。
- 关闭 Mermaid 默认的节点投影（`site_config.themeVariables.dropShadow = 'none'`）。
- token 值是 `oklch`，因此每个值都通过在 1 像素画布上绘制解析为不透明的十六进制颜色。
- 应用主题切换时预览会重新渲染。

### 文件预览

- 新增 `mermaid` FilePreview 插件，处理 `.mmd` 和 `.mermaid`。插件读取文件，并以 `contain` 适配方式用 `MermaidPreview` 渲染：图表填满预览区域并居中，按宽高同时缩小以适配，但不会放大到超过自身尺寸。空文件显示空状态，无法读取的文件显示加载错误。共享的预览工具栏（平移、缩放、复制、下载、展开）同样适用。
- 由于该插件属于渲染型预览，Agent 文件面板以预览方式打开这些文件，并提供现有的编辑/预览切换；编辑时使用实时编辑器编辑源码。
- `renderSvgInShadowHost` 新增 `fit: 'width' | 'contain'`。`width` 为原有行为，代码块、PlantUML、Graphviz 和 SVG 仍默认使用它。

### 限制

- Merman 的 `interactive` 资源档位会拒绝 200 个节点的流程图；在主线程渲染 400 条消息的时序图会让窗口卡住 260 ms。worker 沿用该档位，只放宽布局计算量上限（4 亿单位），改由 10 秒期限限制耗时。应用内实测：300 个节点的流程图和 400 条消息的时序图渲染时，主线程没有任何长任务。
- WASM 约 11 MB（gzip 后 4.4 MB）。开发环境下冷启动初始化实测 37 ms。
- 文件编辑器的高亮器没有 Mermaid 语法，因此 `.mmd` 源码没有语法高亮，与之前一致。

## Alternatives considered

- **保留 `mermaid`，只新增文件预览：** 用户于 2026-10-30 否决。两个引擎渲染出的图表不同，而且都要打包。
- **先做文件预览，代码块以后再迁移：** 曾提出，未采用；一次切换所有路径可以只保留一个渲染器。
- **通过 `site_config.themeVariables` 映射 token：** 已否决。Merman 的 `presentation.theme` 直接接受语义角色和序列配色，与设计 token 一一对应。
- **沿用代码块周围的字体：** 测试后否决。代码块继承等宽字体，图表看起来像代码。
- **编辑时左右分屏显示源码和实时预览：** 未采用；面板保留现有的编辑/预览切换。

## Acceptance criteria

- AC1 — 代码块中的 Mermaid 图表（聊天 Markdown 和 Markdown 文件预览）通过 Merman 渲染，应用代码不再引用 `mermaid` 或 `@streamdown/mermaid`。(verification: renderer and Electron; owner: implementer)
- AC2 — 图表的节点、文字、边框、连线和分类颜色取自设计 token，使用正文字体，没有投影，并位于其背后实际的背景之上；浅色和深色模式下均如此，包括在半透明代码块内。(verification: Electron; owner: implementer)
- AC3 — 在 Agent 文件面板中打开 `.mmd` 或 `.mermaid` 文件时，图表居中并适配预览区域且不会被放大，并提供编辑/预览切换；空文件和无法读取的文件显示对应状态。(verification: renderer and Electron; owner: implementer)
- AC4 — 源码无效时显示 Merman 的解析错误；较新的源码渲染失败时，保留之前的图表。(verification: renderer and Electron; owner: implementer)
- AC5 — 渲染（包括 300 个节点的流程图）不会阻塞主线程；超过期限的渲染会被停止并报告，之后的图表仍能渲染。(verification: renderer and Electron; owner: implementer)

## Risks

- Merman 不保证与浏览器 Mermaid 的输出逐像素一致；文本测量、HTML 标签和部分图表类型可能与用户以前看到的不同。
- Merman 0.9.2 是较新的依赖（2026-10-22 发布）。升级时应按其升级指南的建议对比渲染结果。
- canvas 测量是对 DOM 测量的近似；它不覆盖的字体或测量操作会回退到 Merman 的确定性测量。
- 用户在面板中编辑的 `.mmd` 文件没有语法高亮。
