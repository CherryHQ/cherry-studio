# Agent Note: 对话框入场时避免缩放内容层

Status: implemented

[English](2026-10-24-dialog-entrance-raster.md) | 中文

## 问题

打开包含长 emoji 列表的对话框时，例如 50 行的助手选择器，260 ms 的入场动画会丢掉大部分帧。在设备缩放因子为 1.5 的 2.1.7 打包版本上，CDP trace 记录了 56–61 次掉帧和 241.6 ms 的栅格化耗时。主线程大部分时间空闲，脚本执行约 12 ms，因此开销来自合成器栅格化。

1% 的 `zoom-in-99` 缩放会让对话框图层每一帧都改变栅格化比例。选择器每行渲染两份彩色 emoji 字形，即前景一份加上放大后的 `EmojiIcon` 背景，因此每次栅格化都很昂贵。

## 决策

从共享的 `DialogContent` 动效中移除 `zoom-in-99` 和 `zoom-out-99`。入场和退场保留 260/200 ms 的淡入淡出以及 16 px 的方向位移。`fade-scale` 变体现在只淡入不缩放；名称保持不变以兼容现有 API。

由共享 primitive 承担修复，因为缩放是每个对话框的触发点，而不只是助手选择器。图层比例稳定后，同样的内容只需栅格化一次。

## 考虑过的替代方案

- 给 `DialogContent` 添加 `will-change: transform`：实测同样降到 9 次掉帧，但每个打开的对话框都会常驻一个合成层，并且文字可能切换为灰度抗锯齿。因此不设为默认方案。
- 移除选择器行里重复的模糊 emoji 背景：实测同样有效，但会改变图标设计，而且其他 emoji 密集的对话框仍保留缩放触发点。
- 只对大对话框保留缩放：需要让不掌握内容的 primitive 按对话框内容做判断。

## 后果

对话框动效失去一个用户无法感知的 1% 缩放；淡入和方向位移保留。以后若在对话框内容上添加缩放动画，必须考虑整个图层的栅格化失效，尤其是包含彩色 emoji 的内容。

## 验证

- Regression — `pnpm exec vitest run packages/ui/src/components/primitives/__tests__/dialog.test.tsx packages/ui/src/components/composites/confirm-dialog/__tests__/confirm-dialog.test.tsx`：22 个测试通过，并断言 `zoom-in-99`/`zoom-out-99` 不再出现，同时淡入和位移仍在。
- Regression — 在 2.1.7 打包版本上对助手选择器做 CDP trace：把 `--tw-enter-scale` 和 `--tw-exit-scale` 固定为 `1` 后，掉帧从 56–61 降到 9，栅格化耗时从 241.6 ms 降到 2.5 ms。
- Regression — 对三个改动文件运行 `oxfmt --check`、`oxlint --deny-warnings` 和 `eslint`：全部通过。
