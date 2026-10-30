# Agent Note: 让 Sortable 基于 @dnd-kit/react

Status: proposed

[English](2026-10-30-sortable-on-dnd-kit-react.md) | 中文

## 问题

`@cherrystudio/ui` 的 `Sortable` 运行在 `@dnd-kit/core` 6.3.1 上，该版本最后发布于 2024 年 12 月。这套 API 没有把嵌套控件排除在拖拽激活之外的选项，所以 `Sortable` 要继承 sensor，每个调用方还要用 `data-no-dnd` 标记控件。它还同时注册了 `PointerSensor` 和 `TouchSensor`，而 dnd-kit 文档把这两者写成二选一：`PointerSensor` 配 `touch-action: none`，或者 `MouseSensor` 配 `TouchSensor`。

PR #23117 暴露了这个代价。移除 `@hello-pangea/dnd` 后，内置的交互元素拦截和长按处理都没有了，三轮 review 逐个发现缺口：鼠标按操作按钮会触发拖拽，触摸按住同一按钮也会；随后的 Chromium 探针又发现，手指按住行拖动永远排不了序，`main` 上的 `Sortable` 同样如此。`PointerSensor` 抢到触摸后，行仍是 `touch-action: manipulation`，浏览器平移时发出 `pointercancel`。其他 `Sortable` 列表都使用同一组 sensor。

同一个 Chromium 151 探针用相同手势测试了 `@dnd-kit/react` 0.5.1，没有自定义 sensor，也没有拖拽手柄：手指按住拖动能排序，手指快速滑动会滚动且不进入拖拽，按住按钮不拖动，轻点按钮能触发点击，鼠标和键盘排序都正常。探针用的是简化页面，不是 Electron 应用。

## 方案

用 `@dnd-kit/react` 替换 `Sortable` 及其列表项渲染的内部实现，锁定精确版本，按需引入 `@dnd-kit/helpers` 和 `@dnd-kit/collision`。`ReorderableList` 的 API 不变。交互元素排除和触摸激活使用库的 `PointerSensor` 默认行为或文档化选项。

| 当前 `Sortable` 能力 | 目标 |
| --- | --- |
| `DndContext` + `SortableContext` + 排序策略 | `DragDropProvider`；`@dnd-kit/react/sortable` 的 `useSortable` |
| `PortalSafePointerSensor`、`TouchSensor`、`KeyboardSensor` | 库自带的 `PointerSensor` 和 `KeyboardSensor` |
| `restrictions.windowEdges` | `RestrictToWindow` |
| `restrictions.scrollableAncestor` | 绑定最近可滚动祖先的 `RestrictToElement` |
| 轴向 modifier | `RestrictToVerticalAxis` / `RestrictToHorizontalAxis` |
| `accessibility` | `Accessibility` 插件选项 |
| `DragOverlay`、ghost、`adjustScale` | 保持现有外观的 `DragOverlay` 和 `Feedback` 选项 |
| `collisionDetection` | 列表项上的 `collisionDetector` |
| 对外暴露的 `Active`、`Over`、`Modifier`、`CollisionDetection` 类型 | 由 `@cherrystudio/ui` 拥有的中性 props |
| `dragHandleProps` 的 `{ ref, attributes, listeners }` | 基于 `handleRef` 的 `{ ref }`；四个 `dragHandle` 调用方去掉展开 |

`BlurCancelPointerSensor` 继续导出，供下面仍用 `@dnd-kit/core` 的调用方使用，`Sortable` 不再使用它。`@dnd-kit/react` 0.5.1 没有窗口失焦取消，所以 `Sortable` 用 window `blur` 监听通过拖拽 manager 取消操作，不继承 sensor。

不在范围内、继续使用 `@dnd-kit/core` 的有：`GroupedSortableVirtualList`、知识库导航和共用的 `arrayMove` 调用方。移除 `@dnd-kit/core` 需要单独的 Spec，因为新 API 没有 `SortableContext`，列表项在挂载时才注册，滚出屏幕会卸载行的列表还没有验证过。`useDndState` 没有应用侧调用方，继续使用 `@dnd-kit/core`。

PR #23117 叠在实现层之上，去掉 `PortalSafeTouchSensor` 和划词助手操作区的 `data-no-dnd` 标记，保留整行拖拽。

## 备选方案

- 在 `PortalSafePointerSensor` 中拒绝 `pointerType === 'touch'`：只加一个条件就通过了探针，但保留了不受支持的 sensor 组合，只是绕开它。
- `MouseSensor` + `TouchSensor` 配自定义子类：通过了探针，也符合旧版文档，但每种输入都要保留自定义激活器，要在 `MouseSensor` 上重写失焦取消，每个调用方仍要手动标记控件。
- 给划词助手列表加独立拖拽手柄：无需新依赖就能解决该列表的嵌套控件问题，但把整行拖拽改成了抓手，也修不好其他列表的 sensor 组合。作为不希望的产品变更而否决。
- 这个列表继续用 `@hello-pangea/dnd`：所有手势都通过，但放弃了 PR #23117 的单库目标，还留下它的无用依赖。
- 一次迁移所有 dnd-kit 调用方：要改 14 个源文件，并把未验证的虚拟列表和已验证的路径放在同一次改动里。虚拟列表一旦失败，全部都得等。

## 验收标准

- AC1 — 在 `Sortable` 列表中，手指按住行拖动能完成排序，手指在行上快速滑动会滚动且不触发拖拽。 (verification: Electron)
- AC2 — 在行内按钮或其他交互控件上按下、按住或拖动时，鼠标和触摸都不触发拖拽，点击或轻点仍能激活控件。 (verification: Electron)
- AC3 — `Sortable` 不注册任何 sensor 子类，`PortalSafePointerSensor` 不再存在。 (verification: unit)
- AC4 — 用 Space 和方向键仍能完成键盘排序，嵌套输入框中的 IME 组合键不触发拖拽。 (verification: renderer)
- AC5 — 窗口失焦时进行中的 `Sortable` 拖拽会取消，之后的点击能到达页面。 (verification: renderer)
- AC6 — Provider 列表、launchpad 网格和每个 `dragHandle` 调用方保持现有排序结果、轴向和边界限制、overlay 与 ghost。 (verification: Electron)
- AC7 — 通过 `accessibility` 传入的本地化拖拽播报仍能到达 live region。 (verification: renderer)
- AC8 — 在划词助手设置中，整行可拖，分隔行和最后一个启用的操作不可拖动，但仍接受放置。 (verification: Electron)
- AC9 — `GroupedSortableVirtualList` 和知识库导航继续在 `@dnd-kit/core` 上正常工作。 (verification: renderer)

## 风险

- `@dnd-kit/react` 尚未到 1.0，小版本可能破坏 API。锁定精确版本可以让升级保持可控。上游有与这条路径相关的未关闭问题：#1723 报告跨列拖动时的触摸问题，#2118 报告键盘 sensor 锁死鼠标。
- 单行级别的控制尚未验证。划词助手的分隔行和最后一个启用的操作必须保持可放置且不可拖动，探针没有在 `@dnd-kit/react` 上覆盖这一点。
- `@dnd-kit/react` 0.5.1 没有 `restrictToFirstScrollableAncestor` 的对应项，所以 `RestrictToElement` 映射要自己找到可滚动祖先。有六个调用方传入 `restrictions`。
- 拖拽 overlay 外观、放置动画、右键行为和通过 portal 渲染的菜单都没有探测过。无法保持一致的差异要回到本 Spec 处理。
- 在后续 Spec 移除旧版之前，`Sortable` 和仍用 `@dnd-kit/core` 的相邻代码会同时带上两代 dnd-kit，包体增量尚未测量。
- 针对 `Sortable` 行为 mock `@dnd-kit/core` 的测试需要重写，改动期间回归覆盖会变弱。回滚方式是 revert 实现 PR，不涉及存储数据变更。
