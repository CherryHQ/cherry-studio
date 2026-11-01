# Agent Note: 在 Agent 文件面板中评论文件

Status: proposed

[English](2026-10-30-file-pane-comments.md) | 中文

## Problem

Agent 文件面板可以把 Word、Excel、PDF 或 PowerPoint 文件的一部分引用到输入框：用户打开选取器，点选一个段落、单元格区域、形状或页面，再点击 **引用选区**。输入框会得到一个 `reference` 引用块，其提示文本是一个 `selection-ref` 代码块，包含文件路径、由预览插件计算的结构化锚点（`packages/file-preview/src/documentAnchor.ts`）、摘录和文件快照。office-transform 技能从中读取锚点，定位要修改的位置。

仍有两个缺口：

- 引用不带诉求。用户要在输入框里写下想做什么，还得再说明这句话针对的是哪个引用。像代码评审那样在一个文件里留下多条针对性意见，没有直接的途径。
- 文本文件（源代码、纯文本、编辑模式下的 Markdown/HTML/SVG 源码）完全无法引用，用户只能手动复制行内容和行号。

## Proposal

范围：Agent 文件面板和 Agent 输入框，它们是目前唯一接入选区引用的界面。评论是发给 Agent 的消息，不会修改文件；评论在发送前只存在于输入框草稿中。

### 评论模型

- 一条评论由位置、摘录和用户的文字组成，作为一个输入框 `reference` 引用块插入。多条评论累积为多个引用块，与用户输入的其他内容一起在一条消息中发出。
- `SelectionReference` 新增可选字段 `comment`（去除首尾空白，不能为空）。
- 引用块的描述显示评论内容，没有评论时显示摘录。带评论的引用块显示评论图标；不带评论的文档引用显示引用图标。图标名称写在引用块持久化的 `icon` 字段中，因此发出的消息会保留它。

### 文本文件

- 面板的文本编辑器（`FileEditor`，即 Pierre `File`，可编辑或只读）开启 Pierre 的行号栏工具。悬停某一行时，行号旁出现评论按钮，点击即评论该行。
- 在行号上拖动可选中多行（`enableLineSelection`），按钮会评论整个范围（`onGutterUtilityClick(range)`）。
- 评论框通过 Pierre 的行注释（`lineAnnotations` + `renderAnnotation`）在范围最后一行下方内联展开：只有一个带内边距的输入框，位于编辑器本身的背景上，宽度跟随可见的编辑器，代码横向滚动时仍保持可见；输入框内有一个提交按钮，背后也不高亮行；占位文字会写明快捷键。点击按钮或 Cmd/Ctrl+Enter 提交；Escape 或点击窗口内其他位置会取消，切换到其他窗口则保留草稿。Escape 取消后焦点回到文件；提交后焦点移到输入框，所有引用块插入时都是如此。同一时间只有一个草稿。
- 评论框打开期间，上方的编辑会让它随文本移动：Pierre 编辑器会在文档变化时重新映射行注释。
- 提交后插入一个标签为 `name · L19` 或 `name · L19–21` 的引用块。其提示文本是普通 Markdown，而不是 `selection-ref` 代码块：绝对路径、行范围、放在代码块中的原样行内容（按 `SELECTION_EXCERPT_MAX_LENGTH` 截断），以及评论。
  - office-transform 脚本会拒绝 xlsx、docx、pdf、pptx 以外的锚点格式（`office_extract.py`），文本文件也不能被引导到该技能。
  - 行号以提交时为准。原样行内容让 Agent 在发送前文件发生变化时仍能重新找到这些行。
- 渲染后的预览（Markdown 预览、HTML 预览）不在范围内；它们的源码可在编辑模式下评论。

### 文档（docx、xlsx、pdf、pptx）

- 选取器和插件的锚点保持不变，渲染器无需改动：每个插件都已把用户点选的内容映射为文档自身结构中的锚点。
- **引用选区** 改为 **评论**。它在原位置打开同样的评论输入框；由于浮在文档之上，输入框带有自己的背景。填写文字后提交会附带评论；不填直接提交则与现在一样只引用选区。
- 引用块保留 `selection-ref` 代码块，在顶层 `anchor` 旁新增 `comment`。技能只把 `anchor` 传给脚本，因此脚本无需修改。`SKILL.md` 说明新字段。

### 不在范围内

- 在渲染后的文档上显示已提交的评论。这需要把每种格式的锚点反向映射回渲染后的 DOM，也就是唯一需要改动渲染器的部分。
- 把评论写入文件：Word 批注、Excel 备注、PDF 注释。
- 非 Agent 的聊天输入框、评论讨论串，以及草稿之外的持久化。

## Alternatives considered

- **重写 Office 和 PDF 渲染器来负责评论定位：** 不需要。插件已经生成结构化锚点，缺的只是评论输入。
- **把评论作为原生批注写入文档：** 这是另一个功能。它会修改用户文件，并且需要为每种格式编写写入逻辑。
- **在文件上保留已提交评论的标记：** 暂缓。引用块被编辑或删除后，标记会与输入框不一致；输入框始终是评论唯一的存放位置。
- **把文本文件评论作为带新 `text` 锚点格式的 `selection-ref` 发送：** 已否决。技能脚本会拒绝未知格式，而且这个代码块会诱导 Agent 把代码文件交给 Office 技能处理。
- **在每个点选的文档部分旁显示浮动评论按钮：** 暂不采用。它需要每种格式提供几何位置；现有的固定操作位置对所有格式都适用。
- **维持现状（先引用，再到输入框里描述）：** 诉求会丢失位置信息，文本文件也完全无法引用。

## Acceptance criteria

- AC1 — 在 Agent 文件面板中，悬停文本文件的某一行时行号旁出现评论按钮，可编辑和只读文本均如此；点击后在该行下方打开评论框。(verification: renderer and Electron; owner: implementer)
- AC2 — 在行号上拖动选中多行后点击按钮，会评论整个范围，评论框位于最后一行下方。(verification: renderer and Electron; owner: implementer)
- AC3 — 提交文本文件评论会插入一个以文件名和行号或行范围为标签的输入框引用块；发出的消息包含绝对路径、行范围、原样行内容和评论，且不含 `selection-ref` 代码块。(verification: renderer; owner: implementer)
- AC4 — 文本文件的空评论无法提交；Escape 或点击窗口内其他位置会关闭评论框且不插入任何内容，Escape 还会让焦点回到文件；切换到其他窗口会保留草稿；Cmd/Ctrl+Enter 提交。(verification: renderer; owner: implementer)
- AC5 — 评论框打开期间，在其上方插入或删除行时，评论框仍位于相同的行内容下方。(verification: renderer; owner: implementer)
- AC6 — 对 Word、Excel、PDF 或 PowerPoint 文件中点选的部分，面板的引用操作会打开评论框；填写文字后提交会插入一个引用块，其 `selection-ref` 代码块包含未改变的锚点和 `comment`；不填直接提交插入的引用块与现在的引用选区相同。(verification: renderer and Electron; owner: implementer)
- AC7 — office-transform 脚本原样接受带评论的 `selection-ref` 中的锚点，且 `SKILL.md` 说明 `comment` 字段。(verification: unit and docs gate; owner: implementer)
- AC8 — 对一个或多个文件的多条评论累积为独立的引用块，并在一条消息中全部发出。(verification: renderer; owner: implementer)

## Risks

- Pierre 在 `File` 上提供行号栏工具；编辑器附加时它是否仍能工作尚未验证。实现的第一步就是检查这一点。如果不能，修复应提交到上游或现有的 `@pierre/diffs` 补丁中，并在采用任何变通方案前提交评审。
- 如果文件在提交评论和发送消息之间发生变化，行号会过时。原样行内容可以缓解，但无法完全避免。
- 较长的范围会按摘录上限截断，Agent 可能需要读取文件才能看到其余内容。
- 每条评论都会把摘录加入提示；大量较长的评论会使消息变大。
- 现有锚点的限制依然存在：PDF 评论只能指向整页；Word 的页眉、页脚、脚注和表格单元格没有锚点，因此无法评论。
- 这会新增一个选区操作，而 [Pierre 代码界面 Spec](../architecture/2026-10-24-pierre-code-surfaces.md) 在其迁移范围中排除了此类操作。
