# Agent Note: Cherry 默认代码主题

Status: proposed

[English](2026-10-28-cherry-default-code-theme.md) | 中文

## Problem

代码主题设置默认为 `auto`，解析结果都是第三方主题：代码查看使用 `one-light` / `material-theme-darker`，CodeMirror 使用 `materialLight` / `dark`。这些主题都会绘制自己的实色编辑器背景，代码区始终和所在页面的底色不一致。暗色模式下问题最明显：应用背景叠在 macOS 窗口毛玻璃（vibrancy）上，是半透明的，任何实色都无法与之一致。

如果只替换第三方主题的背景，会破坏其语法配色原本按自身背景设计的对比度。因此，默认主题需要一套自己的调色板。

[Pierre 代码界面](../architecture/2026-10-24-pierre-code-surfaces.md) 和 [消息代码块界面](../architecture/2026-10-26-message-code-block-surfaces.md) 规定了由哪些设置选择主题，并保留 `auto` 默认值。本文档决定 `auto` 解析到哪个主题。

## Proposal

### 一个主题，颜色由 CSS 决定

新增一个 Zed 格式的 Highlights 主题 `cherry`，使用 CSS 变量调色板（`cssVariables: { prefix: '--cherry-code-', defaults }`）。Highlights 为每个 token 输出 `color: var(--cherry-code-<role>, <默认色>)`，因此一个主题名即可同时用于亮色和暗色。应用切换明暗时，颜色随之变化，不需要重新分词，也不需要重新配置任何代码界面。`defaults` 保存亮色取值，使导出的 HTML 在没有应用 CSS 时仍保留颜色。

调色板放在 `packages/ui/src/styles/product.css` 的富文本与代码区域：亮色取值写在 `:root`，暗色取值写在 `.dark`，只使用已有的 `--cs-*` 基础色和语义角色。

### 调色板

| 角色 | 亮色 | 暗色 |
|---|---|---|
| 背景 | `transparent` | `transparent` |
| 正文、变量、属性、运算符 | `foreground` | `foreground` |
| 注释（斜体）、标点 | `muted-foreground` | `muted-foreground` |
| 关键字、预处理、`this`/`self` | violet-700 | violet-300 |
| 字符串 | emerald-700 | emerald-300 |
| 数字、布尔值、常量、属性名（attribute） | amber-700 | orange-300 |
| 类型、类、命名空间 | cyan-700 | cyan-300 |
| 函数 | blue-600 | blue-300 |
| 标记语言标签 | rose-700 | rose-300 |
| 链接 | `link` | `link` |
| Diff 新增 / 删除 | green-700 / red-600 | green-400 / red-400 |
| 无效内容 | red-600 | red-400 |

变量和属性不着色，颜色只用于标示语法。暗色下各彩色角色处于同一亮度带（OKLCH L 0.81–0.86），不会有某个色相格外突出。所有角色相对白色背景和半透明暗色宿主背景都满足 WCAG AA（≥ 4.5:1）。

### 各代码界面

- **主题目录与设置：** 在共享代码高亮目录中注册 `cherry`。`auto` 在亮色和暗色下都解析为 `cherry`，设置中 `auto` 的标签标明它是 Cherry 默认主题。
- **消息查看器、Tiptap 与 CodeMirror 语法色：** `getCodeBlockPalette` 将 CSS 变量主题映射为 `var(--cherry-code-*)` 引用，不再写入固定颜色值。
- **Pierre 文件与 Diff：** 在主线程通过 `registerCustomTheme(..., 'zed')` 注册一次 `cherry`；worker pool 在主线程解析主题后再发送给各 worker。
- **暗色判断：** 使用 `cherry` 时，`isCodeThemeDark` 跟随应用的明暗模式，而不是读取固定的 `appearance` 字段。
- **行号栏：** 行号栏透明，并在横向滚动时随代码一起移动，与消息查看器现有的行号行为一致。Pierre（通过 `unsafeCSS`）和 CodeMirror（`gutters({ fixed: false })`）不再固定行号栏，代码不会从行号栏下方经过。
- **CodeMirror 外观：** `chat.code.editor.theme_*` 为 `auto` 时，CodeMirror 编辑器不再使用 `materialLight` / `dark`，改用 Cherry 外观主题。该主题背景透明，正文、光标、选区、行号栏和当前行颜色取自应用的颜色变量，语法色使用同一套调色板。

用户主动选择的第三方主题保留完整配色和背景。不改写已保存的设置值，也不需要迁移。

## Alternatives considered

- **只覆盖第三方主题的背景：** 已否决。第三方主题的语法色按其自身背景设计；放到浅色宿主或暗色半透明宿主上后，无法保证对比度。
- **两个使用固定颜色值的主题（`cherry-light` / `cherry-dark`）：** 已否决。切换明暗时需要重建分词器，用户也可能在暗色应用中配上亮色调色板。
- **固定行号栏：** 已否决。透明的固定行号栏会在横向滚动时让代码透出来；不透明的又无法与暗色半透明宿主一致：`var(--background)` 本身是半透明的，实色则显示为一条明显的竖条（用户于 2026-10-28 否决）。
- **CodeMirror 外观继续使用 `materialLight` / `dark`：** 用户于 2026-10-28 否决。否则编辑器仍是实色背景，与沉浸式的查看器并排时不一致。

## Acceptance criteria

- AC1 — 使用默认设置时，消息代码块、文件预览与编辑、Agent Diff、Tiptap 代码块和 CodeMirror 编辑器在亮色、暗色模式下均不显示代码主题背景，包括 macOS 暗色半透明窗口。(verification: Electron; owner: appearance implementer)
- AC2 — Cherry 的每个彩色角色相对亮色背景和暗色半透明宿主背景均满足 WCAG AA 4.5:1；变量和属性使用正文颜色。(verification: unit; owner: palette author)
- AC3 — 应用切换明暗时代码重新着色，但不重新分词，并保留编辑器的选区和撤销历史。(verification: renderer and Electron; owner: appearance implementer)
- AC4 — 用户主动选择的第三方查看器主题或 CodeMirror 主题使用其自身颜色和背景，已保存的设置值保持不变。(verification: renderer; owner: appearance implementer)
- AC5 — 显示行号且代码行超出宽度时，横向滚动过程中代码文字不会透过 Pierre 或 CodeMirror 的行号栏显示出来。(verification: Electron; owner: appearance implementer)
- AC6 — 为 HTML 或 Markdown 导出生成的高亮代码，在没有应用 CSS 时仍保留语法颜色。(verification: unit; owner: export implementer)
- AC7 — 所有语言下，主题选择器都将 `auto` 显示为 Cherry 默认主题。(verification: renderer and i18n check; owner: appearance implementer)

## Risks

- Pierre 的 Diff、分隔条和装饰颜色由 `color-mix` 与 `--diffs-bg` 混合得到。背景透明后，这些色块可能过淡；发布前需要在亮色和暗色下检查 Diff。
- 行号栏随代码滚走后，横向滚动到长行右侧时看不到该行行号。
- 依赖 `auto` 显示为 One Light 或 Material Darker 的用户会看到新的默认主题；他们仍可主动选择这些主题。
