# Agent Note: 换行代码行在宽度变化后保留实测高度

Status: implemented

[English](2026-10-25-code-viewer-wrapped-row-heights.md) | 中文

## Problem

`CodeViewer` 对代码行做虚拟化，并按字符数启发式估算换行后的行高。每次 scroller 宽度变化都会调用 `virtualizer.measure()`，清空全部已缓存行高；而已挂载的行不会重新执行 `measureElement`，因此它们的行高回落到估算值，直到自身布局再次变化。对 CJK 为主的代码行，启发式会低估换行数，虚拟列表短于绝对定位的行内容，折叠态 scroller 因而溢出。随后 6px 的经典滚动条压缩内容宽度，再次翻转估算，代码块以帧率在七行和八行之间振荡。React 还在绘制之后才提交修正后的列表高度，所以即使没有循环，陈旧高度也会闪出一帧滚动条。仅回填并不够：`measure()` 之后基线是估算值，若直接回填所有已挂载行，就会把估算误差当成行增长，滚动已经在阅读位置的视图。

## Decision

`measure()` 之后，组件先用估算重建 measurements，再用每一已挂载行的真实 `offsetHeight` 回填，使列表高度始终覆盖已渲染的行，滚动条无从出现。丢弃缓存之前，组件先把这些真实高度写回旧缓存，使真实换行变化保持阅读锚点；重建本身在禁用 `shouldAdjustScrollPositionOnItemSizeChange` 的状态下执行，结束后恢复原值，因为此时剩余的差值都是估算误差。宽度 ResizeObserver 改为观察一个零高度宽度探针，而不是 scroller 本身：在会改变被观察元素尺寸的回调里同步列表高度会触发 ResizeObserver 循环错误。该回调同时直接写入修正后的列表高度，因为 React 的提交发生在绘制之后；随后的渲染会写入同一个值。图片捕获期间渲染全部行，此时跳过重测量。

## Alternatives considered

- `scrollbar-gutter: stable` 能打断宽度反馈，但列表高度仍然错误，瞬态滚动条也照旧会被绘制。
- `flushSync` 能同时消除高度与 transform 的一帧延迟，但会强制整棵组件同步渲染，且被仓库 lint 规则拒绝。
- 改进宽度启发式只能收窄失配区间，无法让估算在任意字体与断行机会下都与布局一致。
- 宽度变化时不做 `measure()` 能保留已挂载行的实测高度，但会让未挂载行保留过期尺寸并重新引入滚动偏移漂移。
- 快照并恢复 `scrollTop` 会连带撤销重建前已做的真实补偿，并且需要分别处理元素滚动与窗口滚动。
- 从首个可见行重算锚点等于重写 TanStack 的锚定逻辑，还要处理 scroll margin 与边界钳制。

## Consequences

每次宽度或布局变化后，已挂载行都是权威来源；未挂载行在挂载前继续使用宽度感知估算。一次宽度变化会为每个已挂载行（视口加 overscan）读取一次 `offsetHeight`。真实高度变化在重建缓存之前就已补偿，因此锚点保持不再依赖 ResizeObserver 的交付顺序或 layout-effect 路径，估算误差也永远不会滚动视图。同步高度不会更新锚定的 transform，后者会随下一次 React 提交更新；这在代码块顶部不可见，滚动时会自行校正。捕获仍然渲染完整文档。

## Verification

- Regression — `pnpm test:renderer src/renderer/components/__tests__/CodeViewer.test.tsx`：两行高的行在宽度变化后保留实测高度，且列表高度在 React 提交前的观察者回调内完成同步；移除回填或同步写入任一项都会失败。
- Regression — `pnpm test:renderer src/renderer/components/__tests__/CodeViewer.test.tsx`：行高不变的已滚动视图在宽度变化后保持 `scrollTop`；若抑制补偿缺失，该检查会从 `450` 跳到 `1710`。
- Regression — `pnpm test:renderer src/renderer/components/CodeBlockView/__tests__/CodeBlockView.test.tsx`：折叠态与展开态代码块集成仍通过。
- Regression — Manual Electron：在原先的阈值处拖动侧边栏，不再在七行与八行之间振荡，也不再闪出滚动条。
