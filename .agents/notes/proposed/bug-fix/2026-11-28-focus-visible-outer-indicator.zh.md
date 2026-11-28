# Agent Note: 键盘焦点使用 ring 色边框加半透明外圈

Status: proposed

[English](2026-11-28-focus-visible-outer-indicator.md) | 中文

## 问题

[#17436](https://github.com/CherryHQ/cherry-studio/pull/17436)（2026-08-01 合并）规定键盘焦点复用控件自身的边框、填充或内嵌指示，`DESIGN.md` § Focus 禁止外圈和正向的 outline 偏移。这个 PR 正确地删除了指针和展开态的反馈（`focus:ring-*`、`aria-expanded:` 和 `data-[state=open]:` 的光圈与边框），同时也删掉了约 80 处只对键盘生效的 `focus-visible:ring-*`。

只画在控件内部的焦点要和状态争夺同一块位置，因为状态也表现在边框、填充和内嵌区域上（[#24947](https://github.com/CherryHQ/cherry-studio/issues/24947)）：

- Tailwind v4 把 `data-*`、`aria-*` 和自定义的 `dark:` 变体排在 `focus-visible:` 之后，且特异性相同，所以同一属性上状态规则胜出。勾选后的 `Checkbox` 会用 `border-foreground` 覆盖 `focus-visible:border-primary`，智能体永久删除弹窗里的复选框勾选后就看不到焦点。
- 状态和焦点取值或色相相同时，变化看不出来：选中的单选项本来就是 `border-primary`；`Switch` 开启时，内嵌光圈叠在轨道上，焦点前后对比度只有 1.16:1。
- `--ring` 是 40% 透明度的主题色，所以 #25041 尝试的内嵌光圈只有约 1.3:1。
- `SelectItem` 在 shadcn 的 `focus:bg-accent` 之上加了 `data-[state=checked]:bg-primary/10`（0b3cefb125），聚焦已选中的选项时没有任何变化。
- `src/renderer/assets/styles/index.css` 声明了 `@layer app { *:focus { outline-style: none } }`。`app` 层排在 `utilities` 之后，所以在所有引入这个文件的窗口里，它会压掉一切 outline 工具类。

## 提案

键盘焦点沿用 shadcn 的两段式设计：不透明的 `--ring` 边框负责对比度，控件外的半透明外圈负责在状态占用边框时依然标出焦点。

1. `packages/ui/src/styles/tokens/colors/providers.css` 里的 `--cs-ring` 继续从品牌色派生，不跟随用户主题色，这与设计 token 体系的文档一致，用户选了极端颜色也不会让焦点消失。它改为不透明：亮色主题为 `var(--cs-brand-700)`（对白色 4.37:1），暗色主题为去掉透明度的现有值 `oklch(0.76 0.204 131)`（对暗色背景 8.79:1）。`--ring` 在自定义 CSS 文档和小程序 `/__cherry/theme.css` 约定里的含义不变，仍是焦点颜色，只改它的值。
2. packages/ui 的 base 层（由 `packages/ui/scripts/build-theme-css.ts` 生成）为所有元素绘制外圈：在 `:focus-visible` 时画一圈 3px、40% 透明度的 `--ring` 实线 outline，不偏移。外圈用 outline 而不是 `box-shadow`，因此不会和 `shadow-*` 工具类互相影响，强制颜色模式也会保留它。删除 app 层的 `*:focus` 重置。所有渲染进程窗口都通过 `@cherrystudio/ui/styles/theme.css` 获得这条规则，包括只引入 `tailwind.css` 的截图、划词工具栏和划词胶囊窗口。
3. 有可见边框的控件在键盘聚焦时用 `focus-visible:border-ring` 把边框换成 `--ring`，替换原来的 `focus-visible:border-primary`。包括 Input、Textarea、Select 触发器、Checkbox、RadioGroup 选项和 outline 样式的 Button。状态占用边框时（例如勾选的复选框、选中的单选项、无效的输入框），状态胜出，只剩外圈标出焦点。这个损失予以接受。
4. 没有可见边框的控件保留现有的聚焦填充或文字变化，并加上外圈。包括填充、幽灵和链接样式的 Button、Tabs 触发器，以及 `menu-list` 的按钮。删除 `Switch` 的内嵌光圈，Switch 只靠外圈标出焦点。
5. 控件去掉会隐藏外圈的 `outline-none` 或 `outline-hidden`。文本输入控件在指针点击后也会匹配 `:focus-visible`，这是浏览器行为，予以接受。
6. Radix 当作焦点落脚点来聚焦的弹出容器，在各自的 packages/ui primitive 里用 `outline-none` 退出：菜单、右键菜单、Popover、HoverCard、Dialog、AlertDialog、Sheet、Drawer 和 Select 的内容容器。Radix Menu 每次打开都会聚焦内容容器，而 Chromium 在键盘输入之后或尚无任何输入时，会把脚本聚焦标记为 `:focus-visible`。
7. 在弹出列表内获得焦点的条目沿用 shadcn 的做法，即菜单、Select 和 Command 里的 `menuitem` 与 `option` 条目：用 accent 背景表示当前项，不画外圈。选中态不使用背景：`SelectItem` 删除 `data-[state=checked]:bg-primary/10`，保留对勾。
8. 容器裁切外圈时（滚动视口、`overflow: hidden`），给容器加内边距；相邻元素盖住外圈时，提升获得焦点的控件的层级。两者都在键盘走查中确定。
9. 按以上规则重写 `DESIGN.md` § Focus。

这项工作以 PR 栈交付：（1）本 Spec、`DESIGN.md`、全局规则、token 和 packages/ui primitive；（2）渲染进程调用点；（3）键盘走查、内边距和层级修正。

走查路线为：设置的常规、外观、划词助手和模型服务页面；聊天页的侧边栏、消息操作和输入框工具栏；智能体永久删除弹窗；划词工具栏窗口。

## 考虑过的替代方案

- 不透明外圈（2px，偏移 2px）对所有控件、所有状态都能达到 3:1，包括没有边框的控件和状态占用边框的情况。维护者更喜欢半透明外圈的观感；接受的代价列在“风险”中。
- 只靠半透明外圈撑不起对比度：40% 透明度下，即使是纯黑，对白色背景也只有 2.85:1。
- 只复用边框或填充，也就是 `DESIGN.md` 现行的规则：状态变体会覆盖同一属性，或者本来就用同一个值，而且没有边框的控件无边框可用，因此不可行。
- 内嵌光圈（#25041，已关闭）不会被覆盖，但会和填充混在一起：勾选的复选框和单选项约 1.3:1，开启的 Switch 1.16:1。
- 恢复 #17436 之前逐个调用点的 `focus-visible:ring-*`：约 80 处调用点，每处都画一圈 `box-shadow`，而 MDN 记载强制颜色模式会去掉 `box-shadow`。一条全局 outline 规则能让外圈保持一致。
- shadcn 新版的 Radix、Base UI 和 React Aria 样式用 `:where()` 定义 `data-checked` 和 `data-selected`，让焦点边框胜过这些状态。本次不采用，因为边框被状态占用是可以接受的。按 vega 样式实测，在那套实现里无效状态的复选框聚焦时仍然没有任何变化。
- 另设 `--primary-focus` token 会和 `--ring` 重复，而自定义 CSS 文档和小程序约定已经把 `--ring` 定义为焦点颜色。
- 从用户主题色派生并按亮度夹紧（亮色主题为 `oklch(from var(--primary) min(l, 0.55) c h)`）在 38 色扫描中都能达到 3:1。没有采用，因为设计 token 体系让焦点色独立于运行时主题色，维护者选择保留这个边界。
- 全局 `:not([tabindex="-1"])` 排除被否决，因为 `tabindex` 并不能说明元素是不是落脚点。Select 选项和 roving 组里未获焦的条目同样带 `tabindex="-1"`。知道自己的容器是落脚点的，是弹出组件的 primitive。
- 给弹出列表条目画外圈，会被滚动视口裁切，也会压到相邻条目。由 `aria-activedescendant` 驱动的列表从不把 DOM 焦点移到条目上（cmdk `Command`、`EntitySelector`），那里只能靠高亮。

## 验收标准

- AC1 — 在走查路线上，用键盘到达的每个控件在所有状态下都在边缘外侧紧贴显示一圈 3px、40% 透明度的 `--ring` 外圈，包括智能体永久删除弹窗里勾选后的复选框、开启的 Switch、选中的单选项、无效的输入框和当前标签页，亮色和暗色主题均如此。（verification: Electron 键盘走查）
- AC2 — 键盘聚焦时，有可见边框且边框未被状态占用的控件把边框换成 `--ring`，没有边框的控件保留其聚焦填充或文字变化。（verification: Electron 键盘走查）
- AC3 — 用指针点击按钮、复选框、单选项、Switch、标签页或弹出触发器时，不画外圈，也不出现 `--ring` 边框；弹出层打开时，触发器上也不出现这两者。（verification: Electron 指针走查）
- AC4 — 用键盘或指针打开菜单、右键菜单、Popover、Dialog、Sheet、Drawer 或 Select 时，弹出容器周围不画外圈。（verification: Electron 走查）
- AC5 — 在菜单、Select 和 Command 列表中，accent 背景表示当前项，当前项是已选中项时也一样；已选中的 Select 选项显示对勾，没有背景。（verification: Electron 走查）
- AC6 — 在亮色和暗色主题下，无论用户选择什么主题色，不透明的 `--ring` 对页面背景的对比度都至少为 3:1。（verification: 基于构建后 token 的无头 Chromium 对比度检查；macOS 上 Electron 暗色主题抽查）
- AC7 — 在走查路线上，没有外圈被滚动视口或溢出容器裁切，也没有相邻元素盖住外圈。（verification: Electron 键盘走查）
- AC8 — `DESIGN.md` § Focus 写明 `--ring` 边框、外圈、弹出容器的退出方式和弹出列表的高亮方式，不再禁止外圈。（verification: 文档检查）

## 风险

- 状态占用边框时，以及在没有边框的控件上，焦点只靠外圈和已有的填充变化。外圈在这些地方低于 3:1（白色背景上约 1.7:1，暗色背景上约 2.4:1），因此这些情况不满足 WCAG 1.4.11 对焦点指示的要求。这是为观感有意接受的。
- 读取 `--ring` 的用户自定义 CSS 和小程序会拿到不透明颜色，而不是 40% 透明度。发布说明里会提示这项变更。
- 暗色主题的对比度是按 `#181818` 叠加半透明背景 token 计算的。macOS 开启毛玻璃效果时，实际背景取决于桌面，所以 AC6 包含 Electron 抽查。
- 内容元素为 `contenteditable` 的内嵌编辑器（例如 `CodeViewer` 和 `PromptEditorField` 里的 CodeMirror）可能开始匹配全局规则。第 2 层逐个检查，编辑器外框已经表示焦点的就退出。
- 指针驱动的 Radix 流程仍可能产生被 Chromium 标记为 `:focus-visible` 的脚本聚焦（见 [tooltip 指针焦点 note](../../implemented/bug-fix/2026-11-19-tooltip-pointer-focus-restore.md)）。AC3 和 AC4 在真实窗口里覆盖这些流程。
- 强制颜色模式保留 outline 这一点来自文档，尚未在 Windows 上验证。
