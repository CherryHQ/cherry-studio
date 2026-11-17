# Agent Note: 粘贴时保留用户手动设定的输入框高度

Status: implemented

[English](2026-11-09-composer-manual-height.md) | 中文

## 问题

输入框的 auto、manual 和 expanded 三种显示态共用 `manualHeight` 尺寸状态。`src/renderer/components/composer/ComposerSurfaceRuntime.tsx` 中的粘贴处理器在分流剪贴板内容之前调用 `fitContentHeight()`。缺少手动模式判据时，`src/renderer/components/composer/useComposerEditorFrameSizing.ts` 中的该函数会无条件清除 `requestedManualHeight` 并退出 expanded。于是粘贴长文本会丢弃用户通过顶部把手设定的高度，让 frame 退回 auto-fit，超出可用高度的内容遮住消息列表（Issue #23966）。

PR #21595 有意选择了粘贴后自动适配，包括手动调整之后。manual 模式下，用户设定的尺寸优先于这一既有选择。

## 决策

手动设定的高度是用户约束。键入与任何粘贴均保持该高度，溢出由 frame 内的 ScrollArea viewport 滚动承担。只有显式还原、点击展开、再次调整把手，或可用高度上限变小才改变该高度。

`fitContentHeight()` 在 `!isExpanded && requestedManualHeight !== null` 时立即返回。只有处于 expanded 或没有请求手动高度时，才执行原有清理。expanded 下粘贴仍然回到 auto-fit。判据必须包含 `!isExpanded`：`toggleExpanded(true)` 会保留 `requestedManualHeight`，仅判断高度非空会同时改变 expanded 模式的粘贴行为。

## 考虑过的替代方案

- 在粘贴调用点加门控：把高度策略分散到消费者，而不是保留在 sizing hook 中。
- 给 `fitContentHeight()` 增加调用来源参数：当前没有第二个消费者需要不同策略，这样的接口属于推测性设计。
- 保留手动高度，但内容变短时自动收缩：尺寸会变得不稳定，也违背了手动高度作为约束的语义。

## 后果

手动调大的 frame 在粘贴短文本后不再自动缩小；显式还原可使其回到 auto-fit。`maxHeight` 的动态夹取及 expanded/restore 状态转换保持不变。auto 模式没有行为变化。

## 验证

- Regression — `src/renderer/components/composer/__tests__/useComposerEditorFrameSizing.test.tsx`：适配内容时保留首次、连续手动调整和手动设定的最大高度；expanded 下粘贴仍回到 auto，包括先手动调整再展开的情况。可用高度缩小时仍会夹取手动 frame 的高度。
- Regression — `src/renderer/components/composer/__tests__/ComposerSurface.test.tsx`：真实编辑器保留完整的大文本粘贴和选区替换结果，长文本粘贴后手动还原控件仍然可用。
- Regression — `tests/e2e/smoke/composerManualHeight.test.ts`：一条真实 Electron smoke 使用鼠标拖动把手、原生剪贴板粘贴和键盘输入；frame 的高度与顶部位置相对手动基线的偏差均不超过 1 px，与参考消息的相对位置保持稳定，内部 viewport 可用滚轮滚动。反例是还原并清空草稿后，在无手动高度时粘贴相同长文本，frame 仍会长高至上限，之后在框内滚动。
