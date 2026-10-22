# Agent Note: 关闭最后一个标签页统一回到启动台

Status: implemented

[English](2026-10-20-last-tab-close-launchpad.md) | 中文

## 问题

同一个"关闭当前标签页"的意图，在最后只剩一个标签页时有两种结果。标签栏的 X 按钮关闭标签页后，由 `TabsProvider` 补上启动台回退标签；`tab.close` 快捷键却直接请求 `window.close`，因为 `handleCloseActiveTab` 对 `tabs.length === 1` 做了特判（#21144 修复 #21134 时引入）。

这一分歧在还剩多个标签页时看不出来，只有关到最后一个才暴露：同一次关闭操作，要么停在设计好的空态，要么直接退出窗口。

## 决策

`tab.close` 一律通过与标签栏相同的 `closeTab` 路径关闭当前标签页。因此把标签栏关空时会产生启动台回退标签，与 X 按钮一致。关闭主窗口只保留窗口关闭快捷键（`app.window.close`，`CommandOrControl+Shift+W`）和标题栏关闭按钮。

分离出的子窗口仍把 `tab.close` 映射为 `window.close`：它只承载一个标签页、不绘制标签栏，也没有可回退的启动台空态。

## 考虑过的替代方案

- 保留 #21144 的分裂行为虽然与 Safari/Chrome/Zed 一致，但同一操作会有两种结果，快捷键与 X 按钮互相矛盾。
- 反向统一（X 按钮也关窗口）会彻底移除启动台空态并改变 `TabsProvider` 的零标签契约，改动远大于本次报告的不一致。

## 影响

只剩一个标签页时，`CommandOrControl+W` 不再关闭主窗口，而是停留在启动台。关闭窗口仍有专属快捷键与标题栏按钮，关闭到托盘的行为不变。本次改动有意回退 #21144，后续维护者若要恢复关窗口特判，必须同时移除启动台回退。

## 验证

- Regression — `src/renderer/components/layout/__tests__/AppShell.test.tsx`：在最后一个标签页上触发 `tab.close` 会走 `closeTab`，且不会请求 `window.close`；标签栏路径保持同样的路由。
- Regression — `src/renderer/components/layout/__tests__/TabsProvider.test.tsx`：关闭唯一标签页仍会打开 `/app/launchpad`（回退逻辑的既有覆盖）。
