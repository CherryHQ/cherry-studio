# Agent Note：富文本笔记中 wiki 链接的逐字保真

Status: proposed

[English](2026-11-10-wiki-link-verbatim-fidelity.md) | 中文

## Problem

笔记以 Markdown 存储，`[[目标|别名]]` 是用户手写的 Obsidian 链接写法。Cherry 的富文本编辑器会解析这段文本，于是每次保存都要经过 `@tiptap/markdown` 的 `MarkdownManager` 往返一次。当前这趟往返会改写 token，而不是保留它：

- 普通的 `[[T]]` 在保存时被转义成 `\[\[T\]\]`，Obsidian 不再把它当链接。
- `**[[T]]**` 保存成 `[[T]]`，`*a [[T]] b*` 保存成 `*a* *[[T]]* *b*`——外层格式丢失或被拆开。解析侧从不给没有子节点的叶节点挂 mark，因为 `applyMarkToContent` 只递归有 children 的节点（`node_modules/@tiptap/markdown/src/MarkdownManager.ts:851`）。
- 文本提取直接丢链接：对 `before [[T|Alias]] after`，`editor.getText()`、`doc.textBetween()` 与默认纯文本剪贴板都返回 `before  after`。
- HTML 往返会丢 token：节点不输出 raw 属性，而 manager 的 HTML fallback 把整段 inline 交给 `generateHTML`（`patches/@tiptap__markdown@3.26.1.patch:150`），保存结果里只剩 `<span data-wiki-link>`。
- 自定义 tokenizer 会吞掉括号周围的普通正文：`[**重要**] [[T]]` 变成一个不可编辑的原子节点，未闭合的 `[` 还会吃到行尾。

结果就是：维护 Obsidian vault 的用户在 Cherry 里编辑笔记，链接与格式会被破坏。

## Proposal

富文本笔记在加载与保存之间逐字保留 wiki 链接，保住它周围的 mark，并让它出现在文本提取与剪贴板里。编辑链接、解析目标与导航仍各自独立。

### Responsibility split

- `@tiptap/markdown` 的 `MarkdownManager` 负责内联节点的 verbatim 输出与 mark 边界。Cherry 继续通过既有的 `patches/@tiptap__markdown@3.26.1.patch` 扩展它，该补丁同时修改 `dist/index.js`、`dist/index.cjs` 与 `src/MarkdownManager.ts`；三份产物必须一致，`pnpm-lock.yaml` 携带重新生成的 patch hash。
- renderer 的 wiki 链接扩展负责节点的自我呈现：`renderText`、schema 的 `leafText`、HTML 属性及其解析。
- Notes 域只负责目标解析。

### Contract

| 要求 | 验收 |
|---|---|
| 未编辑的 token 逐字保留 | 别名、空格、中文、`&`、反斜杠、表格转义管道与带目录的目标都原样保存；HTML fallback 不得把链接降成只剩属性的 span |
| 链接周围的格式保留 | `**[[T]]**`、`*a [[T]] b*`、嵌套 mark 与工具栏新加的 mark 都能往返 |
| 文本提取不丢链接 | `getText`、`textBetween`、选区导出与两种剪贴板格式都含该 token |
| tokenizer 不吞普通 Markdown | `[**重要**] [[T]]`、未闭合的外层括号、普通链接、代码与转义字面量都保留原有文字 |
| raw、显示与导航一致 | 局部编辑、undo/redo 之后，保存的 token 与显示的目标一致 |
| 唯一目标才导航 | 缺失、歧义或不支持的目标不导航 |

## Alternatives considered

- **保存前反解转义。** 解析之后，裸 `[[T]]` 与刻意转义的 `\[\[T\]\]` 已不可区分，字符串改写会把字面量静默变成链接。
- **只做阅读态导航。** 它能防止编辑破坏文件，但不交付保存保真，tokenizer 的缺陷也还在。
- **把节点改成 `text*`。** 文本子节点仍然走转义路径，mark 仍在节点边界被拆开，还引入了 child 文本与 raw 属性的双份真相。
- **在 renderer 里重写 mark 边界。** 那是为每个自定义节点重复 `MarkdownManager` 的逻辑，而不是一次修好所有内联节点。

## Acceptance criteria

- AC1 — 加载并保存含 `[[T]]`、`[[dir/T.md|Alias]]`，或别名含空格、中文、`&`、反斜杠的笔记后，token 在磁盘上逐字不变。（verification: renderer unit tests; owner: rich-text editor owner）
- AC2 — `**[[T]]**` 往返为 `**[[T]]**`，`*a [[T]] b*` 往返为 `*a [[T]] b*`；从工具栏给链接加粗后序列化为 `**[[T]]**`。（verification: renderer unit tests; owner: rich-text editor owner）
- AC3 — 对 `before [[T|Alias]] after`，`editor.getText()`、`doc.textBetween()`、选区导出与两种剪贴板格式都含完整 token。（verification: renderer unit tests; owner: rich-text editor owner）
- AC4 — HTML 往返（含粘贴 Cherry 自己的 HTML）恢复出精确的 raw token，而不是空节点。（verification: renderer unit tests; owner: rich-text editor owner）
- AC5 — `[**重要**] [[T]]` 的粗体文字仍可编辑、链接仍可导航；未闭合的 `[` 不吃掉行内其余内容。（verification: renderer unit tests; owner: rich-text editor owner）
- AC6 — 扩展名大小写不同的目标能解析到真实文件；缺失、歧义或不支持的目标不导航。（verification: renderer unit tests and Electron smoke; owner: notes domain owner）
- AC7 — 编辑无关段落后保存，文件等于基线加上那次编辑。（verification: Electron smoke; owner: rich-text editor owner）

## Risks

- 这个补丁是与上游越来越大的分歧。每次升级 `@tiptap` 都要核对它触及的解析、mark 边界与 HTML fallback 路径，那里若有静默行为变化，只有本特性的用例能抓到。
- 每次改补丁都会改 lockfile 的 patch hash。hash 过期会让 CI 的安装直接失败（很响），但也意味着补丁不能脱离一次完整安装流程去微调。
- verbatim 通道按节点类型启用，却改的是共享的 mark 边界代码。其他使用 `MarkdownManager` 的编辑器可能在自家内联节点上看到不同输出，所以回归套件必须留在闸门里。
- 对某些混合内联片段，HTML fallback 仍可能是唯一无损路径；它触发时 token 在 Cherry 内保住，但 Obsidian 看到的是 span 而非链接。
- 原子节点边界上的光标移动、Shift 选区、Backspace/Delete、中文输入法与 undo/redo 目前没有自动化覆盖，在跑完人工矩阵前都属于未验证。

## Verification

- 单元：契约表中每一行的 markdown 往返用例、resolver 的大小写处理、tokenizer 的边界用例。
- 回归：`nativeMarkdown.test.ts` 与 `markdownBold.test.ts` 必须保持通过，因为补丁必须让普通文本与 mark 逐字不变。
- Electron smoke：从链接导航、编辑无关段落并确认保存结果等于基线加上那次编辑；歧义目标不导航。
- 仍需人工验证：跨节点边界的光标移动、Shift 选区、Backspace/Delete、中文输入法、undo/redo、两种剪贴板格式、阅读/源码/富文本模式切换，以及用 Obsidian 本身打开保存后的文件。
