# Agent Note: Composer Markdown 实时预览

Status: proposed

[English](2026-11-08-composer-markdown-live-preview.md) | 中文

## Problem

用户会在 Composer 里写 Markdown，但它的行为和 textarea 一样。`**bold**` 始终是原文；围栏代码块也只是几行文字：回车发送消息，Tab 移走焦点，`/` 和 `@` 会打开面板，`${name}` 会变成提示词变量标签。目标是 Obsidian/Typora 的模型：输入时即显示格式，语法只在光标所在处可见，代码块能像代码一样编辑。

Composer 不能直接换编辑器。它的 Tiptap 文档承载原子 token 节点，QuickPanel、输入历史和粘贴处理都从中读取纯文本和偏移量，而 `{ text, tokens[textOffset] }` 是 18 个源文件中消息快照、草稿缓存和跨窗口交接共用的草稿契约。

一个一次性原型在无头 Chromium 中回答了风险最高的问题：光标跨越隐藏标记的移动、模拟输入法的稳定性、草稿逐字节不变。之后它在开发版应用中经过实际试用，作为交互模型获得认可。下文引用它的测量结果，但它不是正式实现。

## Proposal

### 1. 第一版范围

| 区域 | 包含 |
| --- | --- |
| 行内 | 粗体、斜体、删除线、行内代码、链接 |
| 块级 | 标题、无序和有序列表、引用、围栏代码块、分割线 |
| 编辑 | 选区的粗体和斜体快捷键、反引号行内代码，围栏代码块内的括号配对 |

不在范围内：

- 表格、图片和任务复选框保持源码原样。
- LaTeX 公式（包括 `$...$` 和 `$$` 块）不渲染，保持源码原样。
- 换行快捷键只插入普通的一行，列表不会自动延续。
- 代码块没有按语言缩进，缩进单位固定为两个空格。
- 选区格式只覆盖粗体、斜体和行内代码。
- 缩进代码（行首四个空格）在这里不算代码块，这些行保持普通文本。
- `renderInputMessageAsMarkdown` 消息气泡设置不变，也不新增关闭实时预览的偏好项。

### 2. 文档与草稿契约

文档保持纯文本加 token 原子节点。schema 不引入 Markdown 的 mark 或块节点；Markdown 只以装饰的形式存在，因此开启和关闭实时预览时，`serializeComposerDocument` 的输出逐字节相同。

每一行源文本成为一个独立段落，因为 ProseMirror 的 inline 装饰按子节点分别包裹，连续的代码区域需要在整行上使用 node 装饰。`composerDraft.ts` 和 `composerTokenMarkers.ts` 中的草稿与标记构建函数直接生成段落，换行快捷键则拆分块。来自非 Composer 自身构建的 HTML 的 `<br>`，在组字之外折叠为段落边界。

`serializeComposerDocument` 和 QuickPanel 的偏移量辅助函数本来就用 `\n` 连接块，所以 `text` 和 `textOffset` 含义不变，持久化数据也不变。这个行模型作用于所有 Composer 界面，只有渲染是按需开启的。placeholder 只在整个 Composer 为空时显示，否则每一个光标经过的空行段落都会显示它。

### 3. 解析与渲染

- **解析器。** 使用 `@lezer/markdown` 及其 GFM 扩展，每个编辑器持有一份，通过 `TreeFragment` 增量重解析。它直接提供标记节点（`EmphasisMark`、`CodeMark`、`ListMark`、`QuoteMark`），并且已经随 CodeMirror 进入依赖树，因此改为直接依赖。在 Node 中用同一份 40,000 字符的语料测量：remark 全量解析 48.85 ms，Lezer 全量解析 2.66 ms，Lezer 增量编辑 0.24 ms。
- **装饰。** 只重建发生变化的行和显隐状态变化的行。原型每次全部重建，40,000 字符时移动一次光标要花 21 ms。
- **显隐。** 行内标记在选区碰到其范围时显示，标题、引用和分割线标记在选区碰到该行时显示，代码围栏在选区碰到该代码块时显示。列表符号始终可见。
- **隐藏标记**使用 `font-size: 0`。使用 `display: none` 时，Chromium 会把光标规整到隐藏段之后，原型中左方向键最多跳过 14 个位置。
- **分割线。** 分割线在标记隐藏时画成一条线。紧贴文字下方的 `---` 仍是 Setext 标题的下划线。与 `===` 一样，选区碰到标题文字或下划线时才显示，否则下划线所在行收起。
- **组字。** 输入法组字期间，装饰只做映射，等 `compositionend` 稳定后再重算。
- **指针。** 鼠标按住期间冻结显隐状态，因为在指针下展开标记会让带抖动的点击落到错误的字符上。

### 4. 代码块

代码块行为只对围栏代码块（Lezer `FencedCode`）生效，绝不作用于缩进代码（`CodeBlock`）。围栏代码块渲染为一个连续的整宽区域（包括空行），样式与消息代码块一致，并在角落显示语言标签。高亮复用 `codeHighlightService.highlightRange` 和 `useCodeStyle` 提供的 `--code-syntax-*` 调色板，所以颜色和语言加载都与消息代码块相同，解析也不占用主线程。结果以不进入历史的装饰应用，组字期间跳过。

围栏代码块内（包括围栏行）的按键：

| 按键 | 行为 |
| --- | --- |
| 任意回车组合 | 插入换行。无论快捷键如何设置，都不会发送或 steer |
| 在代码行回车 | 保持缩进，在 `{`、`[`、`(` 之后多缩进一级 |
| 在紧邻的 `{}`、`[]` 或 `()` 中间回车 | 把右括号移到第三行并回到原缩进，光标落在中间行，多缩进一级 |
| 在文档末尾未闭合的开始围栏行尾回车 | 补上结束围栏，光标落在两者之间的空行 |
| 在结束围栏行回车 | 在下方新开一行并离开代码块 |
| Tab / Shift+Tab | 将所有选中行缩进或反缩进两个空格 |

围栏代码块之外，回车和 Tab 沿用现有的快捷键设置和路由。

在代码行上，光标位于行尾，或位于空白、`)`、`]`、`}`、`:`、`;`、`,` 之前时，输入 `(`、`[`、`{`、`"` 或 `'` 会补上对应的右半边，光标留在两者之间。紧跟在单词字符后的引号不配对。输入自动补上的右半边时会跳过它，在自动补上的空括号内退格会一起删除，有选区时输入这些字符会包裹选区。光标离开该行后，自动补上的右半边不再被记住。反引号不配对，这样手动输入的围栏保持原样。

代码保持字面内容。围栏代码块内不触发 QuickPanel；粘贴的文本按纯文本插入，不生成提示词变量、链接、skill 或知识库 token；输入的 `${name}` 保持为文本。文档级检查读取解析出的代码范围。文本级路径（粘贴整段围栏、拖放、文件文本、面板插入、草稿恢复）都会经过 `createComposerTokenMarkerInlineContent`，它在实时预览界面上跳过围栏代码内的匹配。行内代码保持现有的 token 转换行为。

### 5. 选区格式

在实时预览界面上，Cmd/Ctrl+B 和 Cmd/Ctrl+I 通过编辑源文本切换粗体和斜体。样式由文本两侧连续的星号数量判断，所以 `**` 和 `*` 可以独立叠加。每个选中行单独处理，跳过空行、围栏代码、`# `、`- ` 这类块前缀，以及选区边缘的空白。如果所有行都已有该样式，按键会去掉它；否则给没有该样式的行加上。选区保持在文本上。选区为空或完全位于围栏代码内时，按键保持原有含义，所以 Cmd/Ctrl+I 仍然聚焦 Composer。Composer 处理按键时，会先于应用级快捷键消费该按键。

选区在围栏代码之外时输入反引号，会按同样的逐行规则切换行内代码，判断依据从星号换成反引号。选区为空、位于围栏代码内或处于组字期间时，反引号是普通输入。

### 6. 可复用核心与接入

`createComposerEditorPreset` 新增 `markdownLivePreview` 选项，由 `ComposerSurface` 透传。

| 界面 | 实时预览 |
| --- | --- |
| `ChatComposer`、`AgentComposer`、`MissingAgentHomeComposer`、`SelectionAgentComposeBar` | 开启 |
| `PaintingComposer`、`WebviewAnnotationControls` | 关闭，因为图片提示词和网页批注不是 Markdown 文档 |

核心暴露 `isMarkdownFencedCodePosition(state, position)`。Chat 和 Agent 把 token、QuickPanel、steer 留在各自的层，只使用这个查询和上述选项。

```text
src/renderer/components/composer/markdownLivePreview/
├── markdownSession.ts      incremental parse and source/document position map
├── livePreviewPlugin.ts    decorations, reveal, composition and pointer freeze
├── codeBlockPlugin.ts      code regions and worker highlighting
├── codeBlockKeys.ts        Enter and Tab inside code blocks
├── codeBlockPairs.ts       bracket pairing inside code blocks
└── selectionFormatKeys.ts  bold, italic, and inline code on a selection
```

样式并入 `richtext.css` 中的 `.composer-tiptap` 规则，并使用设计令牌。原型的调试面板和 `.prototype` 模块不会保留。

### 7. 交付

| 层 | 内容 | 覆盖 |
| --- | --- | --- |
| 1 | 每行一段的模型和 placeholder | AC1、AC6、AC7、AC14 |
| 2 | 解析器、装饰、按界面开启 | AC2、AC3、AC4、AC5、AC15、AC16、AC17、AC18、AC19、AC21 |
| 3 | 代码区域、高亮、代码块按键、括号配对 | AC8、AC9、AC10、AC11、AC20、AC22、AC23 |
| 4 | token 和 QuickPanel 路径上的代码字面保留 | AC12、AC13 |
| 5 | 选区格式 | AC24、AC25 |

## Alternatives considered

- Milkdown/Crepe：否决。Milkdown 7.23 在往返转换中转义了 19 条普通样本里的 14 条（`2 * 3 * 4` 变成 `2 \* 3 \* 4`，`Array<string>` 变成 `Array\<string>`），Crepe 引入 Vue 3 运行时，也没有找到光标显隐语法的能力。
- 在 Tiptap schema 中加入 Markdown 节点和 mark（Notion 式）：第一版否决，因为序列化需要 Markdown 写出器，无法再保证草稿逐字节不变。如果装饰方案在真实输入法下行不通，它是后备方案。
- 用 CodeMirror 6 实时预览替换 Tiptap：未做原型即否决，因为 token 节点视图、QuickPanel、粘贴和偏移量处理都绑定在 Tiptap 文档上。
- 在每个代码块内嵌 CodeMirror：第一版否决。它能提供完整的代码编辑，但代码必须变成独立节点，与源文本行模型相悖，光标进出、撤销和输入法也都要重新验证。
- 单段落加硬换行（现有模型）：否决，因为装饰无法跨硬换行形成一个连续的代码区域。
- remark 全量重解析：否决，因为在 40,000 字符时，原型每次按键约 57 ms 中有 48.85 ms 是解析本身。
- 允许在代码块内由用户配置的快捷键发送：否决。固定规则可以保证无论用户绑定了哪个按键，写到一半的代码片段都不会被误发。
- 把代码块行为也应用到缩进代码：否决。粘贴一段带缩进的日志会悄悄失去回车发送、QuickPanel 和 token，而且没有结束围栏可以离开。

## Acceptance criteria

- AC1 — 在实时预览界面上，任意草稿（包括 `2 * 3 * 4`、`Array<string>` 这类容易被转义的输入）序列化后的 `text` 和 token `textOffset`，与关闭实时预览时相同编辑序列的结果逐字节相同。 (verification: renderer)
- AC2 — 粗体、斜体、删除线、行内代码、链接、标题、无序和有序列表、引用都以样式呈现，选区未碰到时隐藏其语法标记。 (verification: renderer)
- AC3 — 选区进入样式范围、标题或引用时显示其标记，移出时隐藏，并且左右方向键经过的位置与未装饰的文档相同。 (verification: Electron)
- AC4 — 鼠标单击落在指针下的字符上，松开前不显示标记；鼠标拖选能跨越隐藏标记选中预期的源文本范围。 (verification: Electron)
- AC5 — 使用真实的 macOS 中文输入法，在样式范围的开头、中间、结尾以及高亮代码内组字，都恰好提交一次，且不会中断组字。 (verification: Electron)
- AC6 — 换行快捷键、撤销与重做、行首 Backspace、行尾 Delete、多行粘贴和输入历史导航，产生的序列化文本与行模型变更前相同。 (verification: renderer)
- AC7 — 光标在代码块之外时，回车组合完全按配置的发送、换行和 steer 快捷键工作，与之前一致。 (verification: renderer)
- AC8 — 围栏代码块渲染为一个连续的整宽区域（包括空行），显示语言标签，且只有选区在代码块内时才显示围栏。 (verification: Electron)
- AC9 — 代码高亮使用消息代码块的 Worker 和调色板，切换代码主题时颜色随之变化，无需重新加载草稿。 (verification: Electron)
- AC10 — 代码块内任意回车组合都插入换行，绝不发送或 steer；新行保持缩进并在开括号后多缩进一级，文档末尾未闭合的开始围栏会补上结束围栏，在结束围栏行回车会移到代码块下方的新行。 (verification: renderer)
- AC11 — 代码块内 Tab 和 Shift+Tab 对所有选中行缩进或反缩进两个空格且不移动焦点，代码块外的 Tab 保持现有行为。 (verification: renderer)
- AC12 — 在实时预览界面上，围栏代码块内的 `${name}` 在输入、粘贴、拖放、文件文本、面板插入和草稿恢复时都保持字面内容（包括围栏代码块整段到达的情况），在围栏代码块之外仍会变成 token。 (verification: renderer)
- AC13 — 光标在代码块内时，`/` 和 `@` 不打开 QuickPanel，粘贴的 URL、skill 标记和知识库标记保持纯文本。 (verification: renderer)
- AC14 — placeholder 只在整个 Composer 为空时出现在第一行，清空 Composer 后重新出现。 (verification: renderer)
- AC15 — token 原子节点在样式范围和标题内保持原有的渲染、选择和删除行为，并在原来的 `textOffset` 处完成往返。 (verification: renderer)
- AC16 — Chat、Agent 和划词智能体输入条显示实时预览，绘画提示词和网页批注输入保持纯文本。 (verification: renderer)
- AC17 — 复制和剪切导出选中的源文本（包括其中隐藏的标记），并保留 token。 (verification: renderer)
- AC18 — 在基准机器 MacBook Pro M5 上的生产构建中，与同一时段、同一份不开实时预览的草稿对照，实时预览让每次按键或移动光标时主线程最长单个任务的中位数最多增加 33 ms；草稿包括 40,000 字符的长段落草稿（约 340 行）和 40,000 字符、每行都很短且带格式的最坏情况草稿（约 2,400 行）。 (verification: production build)
- AC19 — 表格、图片和 LaTeX 公式保持源码原样，没有专门的渲染，并逐字发送。 (verification: renderer)
- AC20 — 仅靠四空格缩进构成代码的行渲染为普通文本，没有代码区域，回车按配置的快捷键工作，QuickPanel 触发和 `${name}` 的 token 转换与其他行相同。 (verification: renderer)
- AC21 — 分割线（`---`、`***` 或 `___`）在选区不在该行时画成一条线，选区在该行时显示源码；紧贴文字下方的 `---` 或 `===` 构成标题，其下划线所在行在选区离开标题时收起，选区碰到标题时显示；发送的文本保持原样。 (verification: renderer)
- AC22 — 在代码行上，按后随字符和单词规则，输入 `(`、`[`、`{`、`"` 或 `'` 会补上右半边；输入自动补上的右半边会跳过它；在自动补上的空括号内退格会一起删除；有选区时包裹选区；反引号和围栏行不受影响；围栏代码之外和组字期间都不配对。 (verification: renderer)
- AC23 — 在代码行紧邻的 `{}`、`[]` 或 `()` 中间回车，会把右括号移到第三行并回到原缩进，光标落在中间行，多缩进一级。 (verification: renderer)
- AC24 — 选区在围栏代码之外时，Cmd/Ctrl+B 和 Cmd/Ctrl+I 在每个选中行上添加和去掉 `**` 与 `*`，粗体和斜体独立叠加，块前缀和边缘空白留在标记之外，选区保持在文本上，选区为空时按键保持原有行为。 (verification: renderer)
- AC25 — 选区在围栏代码之外时，输入反引号会在每个选中行上添加和去掉一对反引号，块前缀、边缘空白和选区保持的规则与 AC24 相同；选区为空、完全位于围栏代码内或处于组字期间时，反引号按普通字符输入。 (verification: renderer)

## Risks

- 真实的 macOS 输入法和鼠标拖选没有经过自动化验证，原型只在无头 Chromium 中模拟了组字。AC4 和 AC5 是这项工作的把关条件，基于 schema 的模型是后备方案。
- LaTeX 不被解析，所以 `$2*3*4$`、`\frac{a*b}{c*d}` 和 `$$` 块这类公式里的 `*` 会被当作强调，其标记在光标到达之前处于隐藏状态。发送的文本不受影响。在支持公式之前接受这一点。
- Composer 的解析器与消息渲染器的解析器不同，边缘情况下的 Markdown 预览可能与发送后的消息不一致。源文本永远不会被改动。
- 代码块位于消息末尾时，发送需要点击发送按钮或先离开代码块，而离开代码块会在草稿末尾多一个换行。
- 隐藏的标记仍在无障碍树和选区中，屏幕阅读器会读出它们。这是保持源文本完整的结果。
- 显示标记会让光标所在行的文字发生位移。这是这一模型固有的特性。
- 行模型会改变所有 Composer 界面，现有测试也固定了硬换行的文档结构。AC1 和 AC6 保护这些行为。
- 手写的代码块按键只做到缩进。如果事实证明不够用，内嵌 CodeMirror 是需要重新考虑的路径。
- 预览的开销增长得比行数快。在基准机器上，338 行时每次按键约多 1 ms，2,366 行带格式的短行时约多 25 ms，所以较慢的机器粘贴几千行时可能感觉得到。低配硬件没有实测；AC18 采用相对值，是因为不开预览的 Composer 在最坏情况草稿上本身就要约 17 ms。
