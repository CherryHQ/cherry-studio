# Agent Note: Cherry 默认代码主题

Status: implemented

[English](2026-10-28-cherry-default-code-theme.md) | 中文

## Problem

代码主题设置默认为 `auto`，原先解析到的都是第三方主题：代码查看使用 `one-light` / `material-theme-darker`，CodeMirror 使用 `materialLight` / `dark`。这些主题都会绘制自己的实色编辑器背景，代码区始终和所在页面的底色不一致。暗色模式下问题最明显：应用背景叠在 macOS 窗口毛玻璃（vibrancy）上，是半透明的，任何实色都无法与之一致。

如果只替换第三方主题的背景，会破坏其语法配色原本按自身背景设计的对比度。因此，默认主题需要一套自己的调色板。

[Pierre 代码界面](../../proposed/architecture/2026-10-24-pierre-code-surfaces.md) 和 [消息代码块界面](../../proposed/architecture/2026-10-26-message-code-block-surfaces.md) 规定了由哪些设置选择主题，并保留 `auto` 默认值。本文档决定 `auto` 解析到哪个主题。

## Decision

### 一个主题，颜色由 CSS 决定

`cherryCodeTheme`（`packages/ui/src/lib/code-highlight/theme.ts`）是名为 `cherry` 的 Zed 格式 Highlights 主题，使用 CSS 变量调色板（`cssVariables: { prefix: '--cherry-code-', defaults }`）。Highlights 和 `getCodeBlockPalette` 输出 `var(--cherry-code-<role>, <默认色>)`，不输出固定颜色值，因此一个主题名即可同时用于亮色和暗色。切换明暗时由 CSS 重新着色，不需要重新分词，也不需要重新配置任何代码界面。`defaults` 重复亮色取值，使导出的 HTML 在没有应用 CSS 时仍保留颜色。

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

变量和属性不着色，颜色只用于标示语法。暗色下各彩色角色处于同一亮度带（OKLCH L 0.81–0.86），不会有某个色相格外突出。所有角色相对白色背景和半透明暗色宿主背景都满足 WCAG AA（≥ 4.5:1）。Diff 文字不使用 `success` / `error`，因为亮色 `success`（green-500）在白底上只有 2.3:1。

### 各代码界面

- **主题目录与设置：** `resolveCodeTheme` 接受 `cherry`，`CodeStyleProvider` 在亮色和暗色下都将 `auto` 解析为它。两个主题选择器都将 `auto` 显示为 Cherry 默认主题（`chat.settings.code_theme.cherry_default`）。
- **消息查看器、Tiptap 与 CodeMirror 语法色：** `getCodeBlockPalette` 将 CSS 变量主题映射为 `var(--cherry-code-*)` 引用。
- **Pierre 文件与 Diff：** `src/renderer/utils/pierreCodeTheme.ts` 在主线程通过 `registerCustomTheme(..., 'zed')` 注册一次 `cherry`；worker pool 在主线程解析主题后再发送给各 worker。
- **暗色判断：** 使用 `cherry` 时，`isCodeThemeDark` 跟随应用的明暗模式，而不是读取固定的 `appearance` 字段。
- **行号栏：** 行号栏透明，并在横向滚动时随代码一起移动，与消息查看器现有的行号行为一致。Pierre（`unsafeCSS`）和 CodeMirror（`gutters({ fixed: false })`）不再固定行号栏，代码不会从行号栏下方经过。Pierre 的浮动编辑器控件（如搜索框）的底色由 `--diffs-bg` 派生，因此改用不透明的 `popover` 表面。
- **CodeMirror 外观：** `chat.code.editor.theme_*` 为 `auto` 时，`getCherryCmTheme` 按需加载 Cherry 外观主题，不再使用 `materialLight` / `dark`。该主题背景透明，正文、光标、选区、行号栏和当前行颜色取自应用的颜色变量，语法色使用同一套调色板。

用户主动选择的第三方主题保留完整配色和背景。不改写已保存的设置值，也不需要迁移。

## Alternatives considered

- **只覆盖第三方主题的背景：** 已否决。第三方主题的语法色按其自身背景设计；放到浅色宿主或暗色半透明宿主上后，无法保证对比度。
- **两个使用固定颜色值的主题（`cherry-light` / `cherry-dark`）：** 已否决。切换明暗时需要重建分词器，用户也可能在暗色应用中配上亮色调色板。
- **固定行号栏：** 已否决。透明的固定行号栏会在横向滚动时让代码透出来；不透明的又无法与暗色半透明宿主一致：`var(--background)` 本身是半透明的，实色则显示为一条明显的竖条（用户于 2026-10-28 否决）。
- **CodeMirror 外观继续使用 `materialLight` / `dark`：** 用户于 2026-10-28 否决。否则编辑器仍是实色背景，与沉浸式的查看器并排时不一致。

## Consequences

- 使用 `auto` 的用户会看到 Cherry 主题，而不是 One Light / Material Darker；这些主题仍可主动选择。
- 长行横向滚动时，该行行号会随之移出视野。
- 消息编辑模式（共享语法的 CodeEditor）在所有主题下都不再固定行号栏，使阅读和编辑模式行为一致。
- 亮色颜色出现在两处：`product.css` 中的 CSS，以及 `cherryCodeTheme` 中用于导出的 `defaults`。两者不一致时 `cherry-theme.test.ts` 会失败。
- Pierre 仍用透明的 `--diffs-bg` 混合 Diff 和装饰色块；在 Electron 中，新增和删除行在两种模式下都清晰可读。

## Verification

- AC1 — 本地 Electron 运行（2026-10-28，未提交的 harness 挂载真实组件）：消息代码块、FileEditor、Agent Diff、Tiptap 代码块和 CodeMirror 在毛玻璃窗口的亮色和暗色下代码背景均为透明。
- AC2 — `pnpm test:pkg:ui packages/ui/src/lib/code-highlight/__tests__/cherry-theme.test.ts`：从真实 CSS 解析每个 `--cherry-code-*` 角色，对比度在白底或暗色半透明宿主上低于 4.5:1 时失败。
- AC3 — `pnpm test:renderer src/renderer/components/__tests__/CodeStyleProvider.test.tsx src/renderer/components/__tests__/LazyCodeEditor.theme.test.tsx` 及本地 Electron 运行：切换明暗后主题仍为 `cherry`，消息关键字节点保留而颜色改变，CodeMirror 保留编辑、选区和撤销。
- AC4 — `pnpm test:renderer src/renderer/components/__tests__/CodeStyleProvider.test.tsx src/renderer/components/__tests__/LazyCodeEditor.theme.test.tsx`：主动选择的 `nord` 查看器主题和 `dracula` CodeMirror 主题保留各自的配色。
- AC5 — 本地 Electron 运行：横向滚动 300px 后，Pierre 和 CodeMirror 的行号栏透明、不固定，并随代码移动。
- AC6 — `pnpm test:pkg:ui packages/ui/src/lib/code-highlight/__tests__/cherry-theme.test.ts`：导出的 HTML 带有 `var(--cherry-code-*, <亮色值>)`，且亮色默认值与 CSS 取值一致。
- AC7 — `pnpm test:renderer src/renderer/components/chat/settings/__tests__/ChatPreferenceSections.test.tsx` 与 `pnpm i18n:check`：两个选择器将 `auto` 显示为 Cherry 默认主题且保存值仍为 `auto`，所有语言都有翻译。
