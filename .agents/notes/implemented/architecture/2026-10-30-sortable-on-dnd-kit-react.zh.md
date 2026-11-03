# Agent Note: 让 Sortable 基于 @dnd-kit/react

Status: implemented

[English](2026-10-30-sortable-on-dnd-kit-react.md) | 中文

## 问题

`@cherrystudio/ui` 的 `Sortable` 运行在 `@dnd-kit/core` 6.3.1 上，该版本最后发布于 2024 年 12 月。这套 API 没有把嵌套控件排除在拖拽激活之外的选项，所以 `Sortable` 要继承 sensor，每个调用方还要用 `data-no-dnd` 标记控件。它还同时注册了 `PointerSensor` 和 `TouchSensor`，而 dnd-kit 文档把这两者写成二选一：`PointerSensor` 配 `touch-action: none`，或者 `MouseSensor` 配 `TouchSensor`。

PR #23117 暴露了这个代价。移除 `@hello-pangea/dnd` 后，内置的交互元素拦截和长按处理都没有了，三轮 review 逐个发现缺口：鼠标按操作按钮会触发拖拽，触摸按住同一按钮也会；随后的 Chromium 探针又发现，手指按住行拖动永远排不了序，`main` 上的 `Sortable` 同样如此。`PointerSensor` 抢到触摸后，行仍是 `touch-action: manipulation`，浏览器平移时发出 `pointercancel`。其他 `Sortable` 列表都使用同一组 sensor。

同一个 Chromium 151 探针用相同手势测试了 `@dnd-kit/react` 0.5.1，没有自定义 sensor，也没有拖拽手柄：手指按住拖动能排序，手指快速滑动会滚动且不进入拖拽，按住按钮不拖动，轻点按钮能触发点击，鼠标和键盘排序都正常。探针用的是简化页面，不是 Electron 应用。

## 决策

`Sortable` 和 `ReorderableList` 运行在 `@dnd-kit/react` 上，`@dnd-kit/react`、`dom`、`abstract`、`collision`、`helpers` 都精确锁定 0.5.1。`ReorderableList` 保留原有 props，并新增 `isItemDragDisabled`：禁止拖动某一行，但该行仍可接收放置，并把该行移出 Tab 顺序。划词助手也一并迁入，它所属的单一拖拽库变更记录在 [保留 dnd-kit 作为唯一的拖拽库](../simplification/2026-10-30-single-drag-and-drop-library.md)。

| 原 `Sortable` 能力 | 上线后的能力 |
| --- | --- |
| `DndContext` + `SortableContext` + 排序策略 | `DragDropProvider`；`@dnd-kit/react/sortable` 的 `useSortable` |
| `PortalSafePointerSensor`、`TouchSensor`、`KeyboardSensor` | 库自带的 `PointerSensor` 和 `KeyboardSensor`；仅 `PointerSensor.configure` 的选项与默认值不同 |
| `restrictions.windowEdges` | `RestrictToWindow` |
| `restrictions.scrollableAncestor` | 绑定 `getFirstScrollableAncestor` 的 `RestrictToElement` |
| 轴向 modifier | `RestrictToVerticalAxis` / `RestrictToHorizontalAxis` |
| `accessibility` | 中性的 `SortableAccessibility`，映射到 `Accessibility` 插件 |
| `DragOverlay`、ghost、`adjustScale` | `DragOverlay`；`adjustScale` 已移除，因为浮层盒子不再缩放内容 |
| `collisionDetection` | `collisionDetection="closest-center"`，映射到每个列表项的 `collisionDetector` |
| 对外暴露的 `Active`、`Over`、`Modifier`、`CollisionDetection` 类型 | `onDragStart({ activeId })`、无参数的 `onDragEnd`，并移除 `modifiers` prop |
| `dragHandleProps` 的 `{ ref, attributes, listeners }` | 基于 `handleRef` 的 `{ ref }`；四个 `dragHandle` 调用方已去掉展开写法 |

以下决策超出了 Spec 的表格，每一条都是因为探针在没有它时失败才加入的：

- 拖动期间由 React 持有顺序。`Sortable` 保存预览 id，并在 `dragover` 上调用 `preventDefault`，因为库的乐观排序插件直接移动 DOM 节点，业务方拒绝放置时无法回滚。放下之后才到达的 `dragover` 会被忽略，因为状态要到放下渲染完成才离开 `dragging`。
- 每次预览移动后，放置目标重置为拖动源，同时暂停碰撞检测，与库的插件做法一致。否则刚被挤开的行仍是目标，再次进入它的新位置不会触发 `dragover`。
- 放下时提交屏幕上显示的顺序，即使 `target` 为 null。自动滚动可能把行带离指针，此时若拒绝排序，用户已经看到就位的行会弹回去。
- 鼠标激活条件是移动 8 px。库默认还会在按住 200 ms 后激活，这会吞掉行上的慢点击。触摸沿用库的 250 ms 延迟和 5 px 容差。
- `preventActivation` 在库默认逻辑外包了两个标记。`data-dnd-row-control` 标记本身就是行的按钮（侧边栏条目、启动台图标、provider 分组标题），否则这些行永远拖不动。`data-no-dnd` 标记行内的非控件区域，并且只对包含它的行生效，所以标记区域内的嵌套列表仍可拖动。行内控件不需要标记。
- 第一次触摸移动和放下时，都在激活元素上派发一个合成的 `pointermove`。`<body>` 上的指针捕获让行看不到手势，Radix `ContextMenu` 的长按计时器因此不会被清除，会在手指移动或抬起后打开模态菜单，并让 `<body>` 停留在 `pointer-events: none`。手指按住不动超过 700 ms 时长按菜单仍可打开。
- 窗口失焦时通过拖拽管理器停止操作，再对每个 sensor 调用 `destroy()`。外部停止后 sensor 仍保持附着，而且只有 sensor 知道尚未激活的按压。

`BlurCancelPointerSensor` 继续导出，供 `@dnd-kit/core` 使用方使用。`GroupedSortableVirtualList`、知识库导航、共享的 `arrayMove` 调用方和 `useDndState` 继续使用 `@dnd-kit/core`。

## 考虑过的替代方案

- 在 `PortalSafePointerSensor` 中拒绝 `pointerType === 'touch'`：只加一个条件就通过了探针，但保留了不受支持的 sensor 组合，只是绕开它。
- `MouseSensor` + `TouchSensor` 配自定义子类：通过了探针，也符合旧版文档，但每种输入都要保留自定义激活器，要在 `MouseSensor` 上重写失焦取消，每个调用方仍要手动标记控件。
- 给划词助手列表加独立拖拽手柄：无需新依赖就能解决该列表的嵌套控件问题，但把整行拖拽改成了抓手，也修不好其他列表的 sensor 组合。作为不希望的产品变更而否决。
- 这个列表继续用 `@hello-pangea/dnd`：所有手势都通过，但放弃了 PR #23117 的单库目标，还留下它的无用依赖。
- 一次迁移所有 dnd-kit 调用方：要改 14 个源文件，并把未验证的虚拟列表和已验证的路径放在同一次改动里。虚拟列表一旦失败，全部都得等。
- 依赖库的乐观排序插件：代码更少，但放置被拒绝或失败时 DOM 会与 `items` 不一致。
- 用列表级 prop 处理“行本身是按钮”：`ProviderListContent` 同时有按钮形式的分组标题和带内部控件的行，所以必须按元素决定。
- 把划词助手的行设为 `dragHandle`：库不再拦截 handle 内部的控件，编辑按钮又会触发拖动。
- 在拖动开始时清除长按计时器：更简单，但拖动在 250 ms 激活，触摸用户将完全失去行的上下文菜单。

## 后果

所有 `Sortable` 列表现在都支持手指按住拖动。在后续 Spec 移除旧版本之前，`Sortable` 会同时带上两代 dnd-kit。替换 `@hello-pangea/dnd` 净增约 10 KB gzip：新增约 40 KB，减少约 29 KB，这是用独立的 esbuild 产物和发布的 UMD 文件测得的，不是应用构建的数字。`@dnd-kit/react` 尚未到 1.0，升级时要重跑这些探针；`sensor.destroy()` 依赖 0.5.1 中 sensor 可复用的行为，由单元测试守护。

指针离开所有行后放下，现在会提交最后显示的位置；`@dnd-kit/core` 则会弹回。行属性（`role`、`tabindex`、`aria-*`）现在在调度器 tick 上写到行的外层元素，所以测试要用 `findByRole`。在带上下文菜单的行上触摸按住超过 700 ms 时，菜单会在拖动进行中打开；抬手后拖动结束且不移动。在 popover 中，键盘拖动时按 Escape 也会关闭 popover，因为 Radix 先处理了它；不会提交排序。

使用真实 sensor 的测试需要 `installDndDomStubs`，因为 jsdom 缺少指针、动画和滚动 API。Windows、真实触摸屏和系统级失焦都没有测试。触摸证据来自 macOS 上通过 CDP 派发的事件。`QueuedFollowupsDock` 需要进行中的生成，没有在应用内测试；它是普通的 `ReorderableList` 使用方，由渲染进程测试覆盖。

## 验证

- AC1 — 使用 CDP 触摸事件的 Electron 探针（侧边栏、provider 列表、启动台、MiniApp 设置、Code 配置、提示词设置、两个提示词弹窗）：手指按住拖动可排序，在 provider 列表上快速滑动会滚动且顺序不变。
- AC2 — Electron 探针加 `packages/ui/src/components/composites/sortable/__tests__/sortable.test.tsx`：在 provider 菜单按钮、composer 开关和划词助手编辑按钮上用鼠标和触摸按下都不会开始拖动，MCP 开关和 Code 卡片按钮拒绝鼠标拖动，点击和 CDP tap 编辑按钮仍能打开弹窗。
- AC3 — `sortable.test.tsx`（`uses only the library sensors`）：管理器的 sensor 只有 `PointerSensor` 和 `KeyboardSensor`；`PortalSafePointerSensor` 已删除。
- AC4 — Electron 探针加 `sortable-keyboard.test.tsx`：Space 和方向键能重排 provider 列表、启动台、composer 列表、提示词设置和划词助手，嵌套输入框中的输入法组合键不会开始拖动。
- AC5 — `sortable.test.tsx`（`window blur` 分组）加派发 `blur` 的 Electron 探针：进行中的指针和键盘拖动都会取消并恢复顺序，尚未激活的按压不会开始拖动，下一次按键不会被吞掉，可以开始新的拖动，之后的点击能到达页面。
- AC6 — Electron 探针：provider 列表（平铺、分组、分组内的行、紧凑浮层、自动滚动）、启动台网格、composer 工具栏列表、提示词设置、`PromptBindingTab` 和 `PaintingPromptPresetsDialog` 都能在限制范围内排序并显示浮层，MCP 列表检查了残影透明度；两个弹窗都在真实的 Radix 模态框中运行。外观没有与 `main` 并排对比。
- AC7 — Electron 探针加 `sortable.test.tsx`（`announces through localized strings`）：composer 列表的中文本地化文案在拿起和放下时都到达了它自己的 live region。
- AC8 — 临时绕过 macOS 辅助功能开关的 Electron 探针：整行可拖，双向跨越分隔线的长距离拖动 7 次全部与计算出的预期顺序一致，分隔线和最后一个启用项拒绝拖动但能接收放置，结果写入 `feature.selection.action_items`。
- AC9 — 对 `GroupedSortableVirtualList.test.tsx` 和 `BaseNavigator.test.tsx` 运行 `pnpm test:renderer`：两者仍基于 `@dnd-kit/core` 并通过。
- Regression — `sortable.test.tsx`：在最终代码上移除每个修复都会让测试失败，已用变异确认；唯一例外是 `dragover` 的 `preventDefault`，库自身的索引检查也能容忍。
