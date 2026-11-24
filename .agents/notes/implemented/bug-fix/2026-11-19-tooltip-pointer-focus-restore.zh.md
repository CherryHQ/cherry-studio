# Agent Note：鼠标选完菜单项、焦点回到触发器时不弹出 tooltip

Status: implemented

[English](2026-11-19-tooltip-pointer-focus-restore.md) | 中文

## 问题

有多处调用把 DropdownMenu、Popover 或 ContextMenu 的触发器包在 `Tooltip` 里。如果打开菜单前没有任何元素获得焦点，用户用鼠标打开菜单并选中一项，菜单关闭后触发器上会弹出 tooltip。Radix 在 `pointerdown` 时阻止触发器获得焦点，菜单用脚本 `focus()` 聚焦自身，关闭时调用 `trigger.focus()`。Chromium 在此前没有焦点时会把脚本聚焦标记为 `:focus-visible`，这个状态一直延续到恢复给触发器的焦点，因此 `TooltipTrigger` 里的 `:focus-visible` 判断会放行。

## 决策

`packages/ui` 在 document 的捕获阶段追踪最近一次输入方式：`pointerdown` 记为指针输入；不带 Meta、Ctrl、Alt，且不是单按 Shift 的 `keydown` 记为键盘输入。`TooltipTrigger` 在最近一次输入是指针时不因焦点打开 tooltip，其余情况保留原有的 `:focus-visible` 判断。还没有任何输入时，行为不变。

修饰键不算键盘输入：Cmd+Tab、Alt+Tab 和快捷键都不是焦点导航，而切回窗口时焦点会恢复到触发器，否则 tooltip 会再次弹出。Shift+Tab 仍算键盘输入，因为它的按键是 `Tab`。

## 考虑过的替代方案

- 在每个调用处加 `onCloseAutoFocus={(e) => e.preventDefault()}`（Radix 社区常用的绕法）会让菜单关闭后焦点丢失，影响键盘用户，而且要改每个调用方。
- 只看 `:focus-visible` 就是原来的判断，在 Chromium 上漏掉了这个场景。
- 像 Zag 那样任何焦点打开都要求键盘输入，会连「还没有任何输入时的焦点」也一起拦下，还要给现有只 mock `:focus-visible` 的测试补键盘事件。
- `@react-aria/interactions` 或 `@zag-js/focus-visible` 能提供同样的追踪，但对这个需求过重，而且 Zag 会全局改写 `HTMLElement.prototype.focus`。

## 影响

唯一新增被拦下的情况是指针输入之后的焦点。Tab、Shift+Tab 以及用键盘开关菜单仍会弹出 tooltip。监听器在模块级注册，随窗口存续。

## 验证

- 回归 — `packages/ui/src/components/primitives/__tests__/tooltip.test.tsx` 中，没有焦点时用指针打开 DropdownMenu 再选中一项，修复前失败，修复后通过。指针选择后按 Cmd+Tab、Alt+Tab、Ctrl+C 和 Shift 的用例，在没有修饰键过滤时同样失败。Tab、指针点击后的 Shift+Tab，以及键盘选择，仍会弹出 tooltip。
