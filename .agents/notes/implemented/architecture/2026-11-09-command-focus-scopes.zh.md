# Agent Note: 命令焦点作用域

Status: implemented

[English](2026-11-09-command-focus-scopes.md) | 中文

## 问题

Renderer 命令上下文曾是窗口级快照，互不相关界面的 handler 按注册顺序竞争。[#21837](https://github.com/CherryHQ/cherry-studio/pull/21837) 中的永久删除通过 `commandFocus.ts` 扫描全局对话框/菜单标记和祖先样式来弥补这一缺口。仅增加焦点键仍可能匹配一个列表的上下文，却执行另一个列表的 handler。运行时 `when` 过滤还让键盘资格决定了设置项和绑定提示是否可见。

## 决策

### 作用域与分发归属

Renderer 持有附着于 DOM 的 `CommandFocusScope` 实例及其上下文/handler 注册项。现有 shared `CommandScope` 仍表示 `main` / `renderer` / `both`；shared 表达式和快捷键解析保持纯函数。这沿用 VS Code 的[列表作用域上下文](https://github.com/microsoft/vscode/blob/main/src/vs/platform/list/browser/listService.ts)和[按事件目标解析](https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/abstractKeybindingService.ts)的方式。

作用域 provider 附着于现有 `rootRef`，不添加布局包装节点。`useCommandHandler`、`useCommandContextKey` 和组件的程序调用绑定到最近作用域。键盘分发从事件路径解析该作用域，将其上下文与允许继承的父级/根值组合，在消费事件前选定单一合格 handler。兄弟作用域不参与竞争。较近作用域拥有的命令已禁用时，阻止该命令回退；未被局部拥有的命令可以沿父级解析。同一作用域内保留最后一个已启用注册项的优先级。

上下文和 handler 值同步读取；局部订阅更新展示，不另设权威焦点注册表。在事件路径上识别 input/textarea/select 及继承的 contenteditable，包括明确声明的不可编辑区域。`resource.focused && !input.focused` 控制列表作用域内删除按键的资格，包括永久删除（`resource.delete_permanently`）和归档到回收站（`topic.delete`）；目标就绪、重命名、固定/忙碌保护、待处理确认和实际删除仍由资源消费者负责。选中会话绝不替代缺失的焦点目标。

Provider 仅在激活状态或上下文值变化时发布选项更新。若每次 React 提交都发布新版本，订阅者向祖先回传上下文时就会形成反馈循环：即使作用域选项等价，祖先也会再次渲染 provider。因此，新分配但值相同的上下文对象不会再次触发发布。Handler 和上下文注册项保留各自的通知。DOM 元素和注册表不变时保留原有绑定；每次提交都解绑，会使子组件执行布局 effect 时路由短暂失效。提交后处理元素替换，在卸载或 Activity 隐藏时释放绑定。

`TabRouter` 在 React Activity 外提供明确的 Tab/切换激活状态。保留挂载的列表面板将现有 `dataEnabled` 可见性状态传给列表作用域。布局清理、DOM 附着和激活状态阻止隐藏/已释放拥有者执行。三类删除消费者共用该路由；移除 `commandFocus.ts` 及仅针对扫描的旧测试。

会话数字导航注册到所属 Tab 的运行时，由 `TabIdProvider` 捕获并通过 `useTabCommandRuntime` 读取。列表顺序、加载状态、活动 Tab 和列表激活状态仍决定可用位置。这允许在 composer 中使用 Cmd/Ctrl+1–9，而不会把永久删除提升到列表之外。不在 Tab provider 内时，导航使用窗口拥有者。

### 交互边界与来源

`packages/ui` 暴露 `KeyboardLayerProvider` 和通用 adapter 契约。Dialog、ContextMenu、DropdownMenu 持有打开状态和实际 Portal DOM 根节点。Renderer 将交互层适配为以窗口上下文为根的命令作用域，保留来源作用域的激活生命周期，但不继承其列表资格。焦点陷阱和恢复仍由 Radix 负责。边界清理可通过 `releaseAfterFocusRestore` 延迟到实际恢复回调；嵌套清理只释放自身 lease。逻辑拥有者和稳定的打开优先级独立于 effect 注册顺序，在 Activity 恢复后保留内层及较晚打开的兄弟边界优先级。受控和非受控 Root 使用同一个解析后的打开状态控制内容及边界。普通 Portal 不成为阻断层。

Renderer 根 handler 只有显式声明 `allowInKeyboardLayer` 才能跨键盘层执行。窗口级搜索/Tab 命令和全屏处理保留现有应用策略；全屏仍尊重已被处理的 Escape。边界内自有命令保持可用，不放行后台列表删除。主进程和操作系统全局快捷键的归属不变。

原生菜单在异步准备条目或弹出 IPC 前注册边界。捕获来源作用域和 handler 源，拒绝未激活/已释放/已替换的来源，并在完成、取消、被新请求替代、失败或卸载时释放。显式菜单执行使用捕获的来源，不按后来获得焦点的界面执行。业务保护会重新检查；捕获来源不构成删除不合资格目标的授权。仅限键盘的 `when` 不是显式菜单执行条件。

### 展示与保留的契约

快捷键设置、标签和 accelerator 独立于临时键盘 `when` 解析已配置绑定，同时保留命令 enablement、平台/功能可用性、用户启用开关、默认值及重新绑定。菜单状态按所属作用域解析。`shouldHandleKeyEvent` 继续用于确实需要实际事件的谓词。

[永久删除保护说明](../bug-fix/2026-10-19-permanent-deletion-guards.md) 继续持有事务内固定保护的决策。本次改动不改变数据库、忙碌、级联、确认和默认绑定语义。不新增数据库迁移、IPC 路由、持久化设置或依赖。实现在 #23917，基于尚未合并的前置 #21837，而非在 PR 差异中重复其功能。

## 考虑过的替代方案

- 权威 focus/blur 活动作用域缓存：复制浏览器状态，且需要处理节点移除、失焦间隙和恢复的一致性。直接解析事件归属。
- 局部 ContextKey 配合全局 handler 选择：允许上下文和 handler 分属不同列表。在同一次决策中解析两者。
- 将 DOM 扫描移至分发器或改用 MutationObserver：继续推断覆盖层/可见性状态。由明确的拥有者发布激活状态和交互层生命周期。
- 仅针对永久删除的事件谓词：展示、菜单来源和其他界面仍缺少共享归属。谓词保留给事件特定规则。
- 重写命令框架或 Radix 焦点管理：扩大迁移范围。复用现有定义、表达式解析、Preference 和原语。

## 影响

- Portal DOM 根节点和作用域生命周期拥有者必须明确，因为仅凭 React 祖先不能确定键盘归属。
- 新增保留挂载界面必须发布激活状态，新增 renderer 根命令必须明确选择能否跨键盘层执行。
- 异步菜单结果不能重新指向较新的注册项。Handler 被替换或拥有者脱离 DOM 时，需要重新打开菜单。
- Electron 证据使用隔离的真实模块夹具、生产 ResourceList 和真实原生弹出 IPC。原生选择通过主进程 inspector 调用 Electron MenuItem 回调；不证明操作系统鼠标交互或完整 Chat/智能体/History 流程。
- 真实 Chat/智能体输入框通过 Cmd+1/2 切换会话并保留草稿，不存在的 Cmd+9 保持当前会话。嵌套 Activity 的命令路由也通过验证，但夹具暴露了独立的 Radix 遮罩/指针和 aria-hidden 恢复限制；不证明完整的指针与无障碍恢复。
- 前置 PR 保持可独立审查。源码/CI 范围按 #21837 实际 head 检查；本说明记录行为，不声称已有 GitHub review Approval。

## 验证

- Regression — `CommandFocusScope.test.tsx` 验证重渲染时子组件布局 effect 内的局部路由、DOM 根节点替换后的重新绑定，以及未激活/已释放作用域；`CommandFocusLayers.test.tsx` 继续覆盖 Activity 恢复。
- Regression — `CommandFocusScope.test.tsx` 验证等价的内联上下文快照保持稳定，并观察值变化和覆盖项移除后的结果。

- AC1 — `CommandFocusScope.test.tsx` 验证兄弟注册顺序、事件即时焦点、嵌套上下文/handler 归属和禁用作用域回退屏障；Electron 夹具计数验证独立拥有者。
- AC2 — `ResourceListPermanentDelete.test.tsx`、`ResourceListGroupPermanentDelete.test.tsx`、`HistoryRecordList.permanentDelete.test.tsx` 和作用域测试覆盖可编辑/重命名/受保护/缺失目标以及焦点与选中条目的身份区分；生产 ResourceList Electron 夹具保留输入/受保护目标。
- AC3 — `CommandFocusLayers.test.tsx` 隐藏/恢复带打开 Dialog 的真实 React Activity，验证兄弟路由及保留的对话框状态；作用域生命周期和 TabRouter 测试覆盖未激活/已释放拥有者，Electron 保留 Tab 夹具重复隐藏/显示场景。
- AC4 — 真实 `CommandFocusLayers.test.tsx` 和 UI `keyboard-layer.test.tsx` 覆盖嵌套 Dialog/菜单隔离、显式允许的根命令和恢复顺序、嵌套/兄弟 Activity 重放及受控 ContextMenu 状态变化；Electron 夹具验证对话框内路由及后台隔离。
- AC5 — `CommandMenus.test.tsx` 验证捕获来源、已变化/脱离 DOM 的注册项及取消/失败/卸载清理；真实原生弹出 IPC 和 MenuItem 回调夹具验证取消、焦点变化及来源脱离 DOM 后拒绝执行，受上述原生交互限制约束。
- AC6 — `useCommandShortcuts.test.tsx`、`command.test.ts`、CommandControls 和 CommandMenus 测试验证设置/提示独立于键盘焦点、功能门控、禁用绑定和重新绑定；shared 快捷键测试覆盖触发器解析。
- AC7 — `useConversationListShortcuts.test.tsx` 使用真实列表 Frame 和 Chat/智能体 composer 验证导航、顺序及列表停用保护；CommandProvider、局部上下文、全屏及受影响消费者测试与 renderer 类型检查覆盖即时执行和输入法/根命令行为；依赖检查确保 renderer 状态不进入 shared 纯工具，UI 不依赖 renderer 服务。
- AC8 — 消费者测试、明确改动范围和源码检查确认三类迁移及旧扫描移除；命令参考更新和文档/配对/Agent Note 状态迁移检查验证文档改动。
