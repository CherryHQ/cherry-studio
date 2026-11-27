# Agent Note: 把分组拖拽列表迁到 @dnd-kit/react

Status: proposed

[English](2026-11-19-grouped-drag-lists-on-dnd-kit-react.md) | 中文

## 问题

[让 Sortable 基于 @dnd-kit/react](../../implemented/architecture/2026-10-30-sortable-on-dnd-kit-react.md) 把 `Sortable` 和 `ReorderableList` 迁到了 `@dnd-kit/react` 0.5.1，其余部分留在 `@dnd-kit/core` 6.3.1 上，等后续 Spec 处理。renderer 目前仍同时带着两代库：

- `GroupedSortableVirtualList` 支撑 `ResourceListVirtual`，后者渲染话题和会话侧栏，是应用里使用最频繁的拖拽列表。
- 知识库导航（`BaseNavigatorContent`、`BaseNavigatorGroupSection`、`SortableKnowledgeBaseRow`）自己维护一个 `DndContext`。
- `@cherrystudio/ui` 为这两个调用方导出 `BlurCancelPointerSensor`，还导出了 `useDndState`。应用代码没有导入后者，只有包的 README 提到它。
- `Sidebar` 和 `LaunchpadPage` 从 `@dnd-kit/sortable` 导入 `arrayMove`。

两个列表仍在用 `Sortable` 已经替换掉的那套 sensor。`GroupedSortableVirtualList` 注册了一个 `BlurCancelPointerSensor` 子类，它的激活器只拒绝非主键和 Control 点击，所以在行内的置顶或菜单按钮上按下并移动 6 px 就会开始拖拽。知识库导航直接使用 `BlurCancelPointerSensor`。两个列表都没有配置触摸激活，而 `Sortable` 的探针表明，只有 pointer sensor 时，浏览器一开始平移，触摸拖拽就会丢失。`Sortable` 在 Electron 应用里验证过的修复都是 `sortable.tsx` 的私有实现：鼠标和触摸的激活约束、带两个标记的 `preventActivation`、窗口失焦时取消拖拽，以及用来停止 Radix `ContextMenu` 长按计时器的合成 `pointermove`。两个列表的行都有上下文菜单，同样需要这些修复。

上一份 Spec 推迟处理这两个列表，是因为虚拟列表会卸载屏幕外的行，而 `@dnd-kit/react` 在挂载时注册条目。2026-11-19 的探针回答了这个问题。它通过 Playwright 在无头 Chromium 中运行一个精简页面，使用真实的鼠标和键盘输入：300 px 高的滚动容器里有 200 行，每行 30 px；`@tanstack/react-virtual` 3.13.24，overscan 为 2；每行在同一个元素上同时使用 `useDraggable` 和 `useDroppable`，并带一个 `DragOverlay`。

- 自动滚动把源行带出了渲染范围。拖拽保持进行，overlay 一直可见，`onDragEnd` 报告了源和目标。
- 源行被卸载时，滚到底部后放下，报告的目标是第 194 行，而指针在第 195 行上。通过 range extractor 让源行保持挂载后，两次运行报告的都是指针下的那一行。
- 键盘拖拽能自动滚动越过视口。
- 放下后立即可以开始新的拖拽，有没有放下动画都一样。

## 方案

把两个列表迁到 `@dnd-kit/react` 0.5.1，与 `Sortable` 共用一个拖拽根组件，然后移除 `@dnd-kit/core`、`@dnd-kit/sortable` 和 `@dnd-kit/utilities`。

### 共享拖拽根组件

`@cherrystudio/ui` 导出 `DragDropRoot`。它是一个固定了 sensor 的 `DragDropProvider`，并承载 `Sortable` 已经验证过的行为：

- 使用库自带的 `PointerSensor` 和 `KeyboardSensor`。鼠标移动 8 px 后激活；触摸保持 250 ms 延迟和 5 px 容差。
- `preventActivation` 保留 `data-no-dnd` 和 `data-dnd-row-control` 两个标记，并且拒绝 Control 点击，因为 macOS 会把它变成上下文菜单。这条规则从虚拟列表的 sensor 子类移出来后，也会作用于所有 `Sortable` 列表。
- 窗口 `blur` 时通过 manager 停止操作，并销毁 sensor。
- 第一次触摸移动和放下时，在激活元素上派发合成的 `pointermove`。

调用方传入自己的事件处理、modifier 和 plugin。`Sortable` 改为渲染 `DragDropRoot`，不再自己接线。该包还导出 `BUTTON_HANDLE_DRAG_SENSORS`：同样的 pointer sensor，加上一个只用 Space 开始的 keyboard sensor，供手柄是按钮的 draggable 使用；否则库默认的 Enter 会开始拖拽，而不是点击按钮。

### 插入线列表

两个列表都不预览新顺序，而是在目标行之前或之后画一条线来标记插入位置，所以它们不使用 `Sortable` 及其预览重排。可拖动的行通过 `useSortable` 注册，并且只启用 `SortableKeyboardPlugin`：方向键每按一次移动一行，和知识库导航现在的行为一致；不启用 `OptimisticSortingPlugin`，DOM 里的行就不会移动。在虚拟列表中，不能拖动的行只注册为 droppable，也不带拖拽相关的 `role`、`tabindex` 或 `aria-*`，延续 PR #24869 定下的约定。

插入线落在哪一侧沿用现在的规则：比较被拖动行与目标行的垂直中心。被拖动行的中心由起始形状加上拖拽位移得到，因为测量出来的形状每次移动都会晚一帧。键盘每走一步都会让两个中心对齐，所以相差 1 px 以内时按移动方向决定。每一行通过 `useComputed` 读取自己的插入方向，所以一次移动只会重新渲染目标行；放下时的处理函数对最终状态使用同一条规则。

`GroupedSortableVirtualList`：

- 保留 props、拖拽 payload、`canDrag*` 和 `canDrop*` 回调、拖拽能力配置、分组阻止状态、分组追加目标和 overlay 尺寸。id 类型改为组件自己定义的 `string | number`，不再使用 `@dnd-kit/core` 的 `UniqueIdentifier`。移除 `dragActivationDistance`：没有调用方传它，激活条件由 `DragDropRoot` 决定。
- 拖拽期间，把源行的索引传给 `DynamicVirtualList` 已有的 `keepMountedIndexes`，这样自动滚动移动列表时源行一直保持挂载。
- 给会触发拖拽的分组标题按钮加上 `data-dnd-row-control`。条目行是 `div`，不需要标记。

知识库导航：

- 和现在一样，用行的主按钮作为知识库和分组的拖拽手柄，并使用 `BUTTON_HANDLE_DRAG_SENSORS`，所以 Enter 仍然选中知识库，Space 拿起它，与现在的按键设置一致。
- 用 `type`、`accept` 和 `collisionPriority` 表达碰撞规则，不再使用自定义检测器。拖动分组时，分组只接受分组；知识库行的优先级高于包含它的分组区块。
- 拖拽期间行不再移位。现在已经在画的插入线成为唯一的预览，和虚拟列表一致。

### 测试

`GroupedSortableVirtualList` 和知识库导航的排序测试改为运行在真实库上，使用 `Sortable` 测试已有的 DOM stub，并把这些 stub 移到 `tests/__mocks__/dndDomStubs.ts`，让 renderer 和 `@cherrystudio/ui` 两个测试项目都能导入。jsdom 不会触发测量放置目标的 observer，所以这些测试会显式测量。`ResourceList`、`Topics` 和 `Sessions` 的测试目前各自复制了一份相同的 `@dnd-kit/core` mock。它们去掉这些 mock，改为通过共享驱动 `tests/__mocks__/dndDriver.tsx` 操作真实库：renderer setup 中的 `@cherrystudio/ui` mock 渲染真实的 `DragDropRoot`，并带一个记录 manager 的探针；驱动用 Space 拿起一行，把目标放在被拖动行的上方或下方，然后放下。只记录 mock 调用的断言直接删除，不做移植。

### 依赖

`arrayMove` 改从 `@dnd-kit/helpers` 导入。根 manifest 在 `devDependencies` 中加入 `@dnd-kit/abstract`、`@dnd-kit/dom`、`@dnd-kit/helpers` 和 `@dnd-kit/react`，锁定为 0.5.1，与 `@cherrystudio/ui` 锁定的版本一致，这样 renderer 和该包解析到同一个实例，共享同一个拖拽 context。最后一层同步更新 `Sortable` 那份 note 中关于剩余 `@dnd-kit/core` 调用方的描述。

### Stack

| 层 | 改动 | AC |
| --- | --- | --- |
| 1 | 删除 `useDndState` 及其 README 条目；`arrayMove` 改从 `@dnd-kit/helpers` 导入 | AC12 的一部分 |
| 2 | 新增 `DragDropRoot`；`Sortable` 改为渲染它 | AC11 |
| 3 | 迁移知识库导航 | 导航部分的 AC5–AC10 |
| 4 | 迁移 `GroupedSortableVirtualList` 及其测试 | 话题和会话部分的 AC1–AC4、AC6–AC10 |
| 5 | 删除 `BlurCancelPointerSensor` 和旧包；把本 note 移到 implemented | AC12 |

## 备选方案

- 只删死代码，两个列表继续留在 `@dnd-kit/core` 上：改动最小，但会继续保留两代库、一个自定义 sensor，以及最常用的两个列表里的嵌套控件和触摸问题。
- 让两个列表基于 `Sortable` 或库自带的 sortable 插件：两个列表都不移动行、不预览顺序，而分组、分组拖拽和跨组追加也装不进单一的平铺列表。
- 让库自己保留已卸载的源行：拖拽能继续，但探针中长距离自动滚动后目标落后了一行。多保持一行挂载就能消除这个偏差。
- 把知识库导航并入 `GroupedSortableVirtualList`：只剩一套拖拽实现，但要替换导航的 accordion 和行布局，属于本 Spec 范围之外的产品变更。
- 用指针位置而不是被拖动形状来决定插入线落在哪一侧：规则更好描述，但会改变所有现有用户的翻转点，也会让 MP-54 回归测试失败；该测试覆盖从行的下半部移动到上半部的情况。
- 把每个测试文件的 mock 各自移植到新的事件形状：又会得到同一个 mock 的四份副本，每一份都可能各自与库的真实事件不一致。

## 验收标准

- AC1 — 在话题和会话中，鼠标拖拽能在分组内重排条目，在列表允许时把条目移到另一个分组，并能重排会话分组；插入线在行内跟随指针，保存后的顺序与插入线一致。 (verification: Electron)
- AC2 — 在话题或会话中，拖拽时自动滚动把源行带出视口后，overlay 仍然可见，并放到插入线指示的位置。 (verification: Electron)
- AC3 — 被 `canDropItem`、`canDropGroup` 或已禁用的拖拽能力拒绝的目标显示阻止状态，在那里放下不会产生任何改动。 (verification: renderer)
- AC4 — 不能拖动的行不带拖拽相关的 `role`、`tabindex` 或 `aria-disabled`，点击它仍会执行。 (verification: renderer)
- AC5 — 在知识库导航中，鼠标拖拽能在分组内重排知识库，把知识库移到另一个分组中某一行的前面或后面，或者放到分组标题上追加到末尾并展开已折叠的分组，还能重排分组。 (verification: Electron)
- AC6 — 在两个列表中，按下行内的控件不会因鼠标或触摸开始拖拽，控件仍能正常触发；本身就是按钮的分组标题仍然可以拖动。 (verification: Electron)
- AC7 — 在 macOS 上，对话题、会话或知识库导航中的行按 Control 点击，会打开它的上下文菜单，并且不开始拖拽。 (verification: Electron)
- AC8 — 在两个列表中，手指按住拖动能完成重排，手指快速滑动会滚动而不拖拽，手指移动之后行的上下文菜单保持关闭。 (verification: Electron)
- AC9 — 在两个列表中，按 Space 拿起一行，方向键每按一次让插入线移动一行，再按 Space 放下，按 Escape 取消且顺序不变。 (verification: renderer)
- AC10 — 在两个列表中，窗口失焦会取消正在进行或尚未激活的拖拽，之后的点击能到达页面。 (verification: renderer)
- AC11 — `Sortable` 运行在 `DragDropRoot` 上后行为不变：`sortable.test.tsx` 和 `sortable-keyboard.test.tsx` 只改了 DOM stub 的导入路径即可通过。 (verification: unit)
- AC12 — 没有任何源文件、测试或包 manifest 引用 `@dnd-kit/core`、`@dnd-kit/sortable` 或 `@dnd-kit/utilities`，`@cherrystudio/ui` 也不再导出 `BlurCancelPointerSensor` 和 `useDndState`。 (verification: repository check)

## 风险

- `@dnd-kit/react` 尚未到 1.0。探针用的是精简页面而不是 Electron 应用，也没有在虚拟列表里测试触摸；AC2 和 AC8 会在应用里补上这部分验证。
- 知识库导航的行在拖拽期间不再移位。插入线已经能标出目标，但这个变化用户看得到。
- 两个列表的鼠标激活距离从 6 px 改为 8 px，并且所有 `Sortable` 列表中 Control 点击都不再开始拖拽。话题和会话中的方向键改为每按一次移动一行，而不是 25 px。
- 共享的测试替身可能与库的真实事件不一致。`GroupedSortableVirtualList` 和 `BaseNavigator` 的测试运行在真实库上，用来发现这种偏差。
- 去掉三个包带来的 bundle 体积收益尚未测量。
- 回滚方式是 revert 受影响的那一层。存储数据、排序格式和持久化 API 都没有变化。
