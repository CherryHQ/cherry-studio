# Agent Note: 命令焦点作用域

Status: proposed

[English](2026-11-09-command-focus-scopes.md) | 中文

## 问题

Renderer 的命令上下文目前是整个窗口共用的快照。`CommandProvider` 会在全窗口为同一命令选择最后一个已启用的注册项。因此，键盘事件缺少共享机制来选择实际焦点所在界面的上下文和 handler。

[PR #21837](https://github.com/CherryHQ/cherry-studio/pull/21837) 在 `b3acfe59449d76c53a3c47a22c26e0d2a9022fde` 中通过 `src/renderer/utils/commandFocus.ts` 弥补这一缺口。永久删除通过 DOM 检查判断焦点、可编辑后代、祖先可见性和所有已打开的对话框/菜单。该功能分支不属于本 Spec 的 main 基线。将扫描移入分发器仍会保留相同的职责归属问题。

仅添加焦点键还不够：全局 handler 选择仍可能执行另一个已挂载列表。此外，`useCommandShortcuts` 目前使用实时 `when` 表达式过滤设置目录，快捷键提示也使用运行时绑定解析。依赖焦点的条件可能使已配置的快捷键从设置或菜单标签中消失。

## 提案

### 职责归属和作用域模型

参考 VS Code 的 [DOM 作用域列表上下文](https://github.com/microsoft/vscode/blob/main/src/vs/platform/list/browser/listService.ts)和[按事件目标解析快捷键](https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/abstractKeybindingService.ts)。采用其职责归属规则，同时保留 Cherry 现有命令框架。

新增由 renderer 持有的 `CommandFocusScope`，与现有 shared `CommandScope`（`main` / `renderer` / `both`）区分。焦点作用域持有已注册的 DOM 根节点、父级关系、局部上下文值、handler 注册项和激活状态。窗口根作用域提供应用级上下文和 handler。shared 上下文表达式解析器和快捷键解析器继续独立于 DOM、React 和可变的 renderer 状态。

提供附着在现有界面根节点上的作用域 provider，不添加布局包装节点。`useCommandHandler` 和 `useCommandContextKey` 绑定到最近作用域；不在局部作用域内的现有调用者绑定到窗口根作用域。同一作用域内保留现有注册优先级。供分发使用的注册值和资格判断同步更新；焦点变化后立即按键时，不能以 React effect 发布的状态为准。

键盘分发时，根据事件的 composed path 或目标祖先链解析归属。不通过 focus/blur 事件维护第二份权威 `activeScope`。焦点通知可以刷新展示，但不能替代事件发生时的解析。页面/Tab/列表的拥有者在保留挂载的内容隐藏时停用对应作用域；脱离 DOM 或未激活的作用域不能接收命令。本次迁移必须覆盖受影响消费者使用的保留挂载界面，不能用 MutationObserver 或计算样式扫描替代可见性归属。

### 分发契约

一次按键中，解析最近的活动作用域，将局部上下文与允许继承的父级/根值组合，求值现有快捷键规则，并选定包含命令、作用域和 handler 的单一分发候选。消费事件前检查资格和 `shouldHandleKeyEvent`，然后执行同一候选。匹配与执行之间不重新选择 handler。

绝不搜索兄弟作用域。较近作用域拥有某命令、但目标已禁用或缺失时，不得回退到该命令的父级/后台注册项。未被局部拥有的窗口级命令仍可在根作用域解析，但必须满足自身条件和活动边界策略。没有命令接受事件时保留原生输入行为。保留输入法组合输入屏蔽、重新绑定和现有非资源快捷键。

提供作用域内的资源焦点和输入焦点上下文。永久删除的键盘条件应要求存在获得焦点的资源目标，并排除可编辑焦点。在事件边界的相关路径内识别 input/textarea/select 和继承的 contenteditable。资源消费者仍负责焦点条目、`aria-activedescendant`、重命名状态、固定/忙碌资格、待处理确认和删除。焦点目标缺失时，绝不回退到选中会话状态。保留 `shouldHandleKeyEvent` 以表达确实需要实际键盘事件的条件，不在其中重复普通焦点条件。

### 对话框、菜单和 Portal 边界

打开的对话框和菜单通过生命周期显式注册键盘边界。最上层活动边界限制后台命令路由，覆盖焦点转移或恢复前的间隙。嵌套关闭/卸载只释放对应边界；重复清理无副作用。根命令只有在明确的边界策略允许时才可用，既保留现有允许的应用快捷键，也不允许后台资源删除。

Portal 内容注册实际 DOM 根节点及明确的作用域父级。对话框/菜单内容从窗口上下文和自身作用域开始，不通过 React context 继承来源列表的焦点资格。对话框内的列表可以声明自己的资源作用域。普通 Portal 不自动成为阻断边界。使用 Radix 已有的打开状态、焦点管理和 Portal API，不重新实现焦点陷阱。

`packages/ui` 持有通用的交互层生命周期接入点；renderer 将其适配到命令作用域。UI 包不得导入 renderer 命令服务或业务命令 ID。接入共享 Dialog、ContextMenu、DropdownMenu 界面（包括命令式对话框），以及 `CommandMenus` 中的原生弹出菜单生命周期。原生菜单没有 renderer DOM 作用域，因此需要显式边界。注册和清理必须覆盖受控/非受控打开状态、取消、失败和卸载，不使用全局选择器。

### 键盘、显式执行与展示

键盘分发使用事件作用域和快捷键 `when`。组件的程序调用使用其绑定作用域；根调用保持根作用域语义。显式菜单执行使用打开菜单时捕获的来源作用域和业务目标，包括异步原生菜单返回后的执行。来源脱离 DOM、未激活或目标不再符合资格时，拒绝执行，不重新选目标。重新检查当前业务保护；捕获来源不构成过期删除的授权。

菜单展示按所属作用域解析，显式菜单动作不要求满足仅限键盘的焦点条件。命令 enablement 和业务资格与快捷键 `when` 分离。列表失焦、输入框获得焦点或对话框/菜单打开时，快捷键设置和已配置绑定标签仍须可用。保留平台和功能可用性、用户启用开关、默认值及重新绑定。不能无差别移除所有上下文过滤：运行时焦点资格不应决定其他条件满足的快捷键是否出现在设置中。

### 迁移与交付

一起实现作用域/上下文/handler 解析，再接入边界和命令展示。在 #21837 的消费者进入实现基线后，迁移其中 ResourceList 条目、分组标题和 History 删除消费者。如果该 PR 仍未合并，明确声明实现的精确依赖，不复制其功能或将其悄悄引入本 Spec。在同一次消费者迁移中删除 `commandFocus.ts`、过时的纯焦点资格传递和旧测试；针对共享路由和真实 UI 原语保留等价行为测试。

更新命令参考文档及受影响的双语决策记录，描述最终契约。[永久删除保护说明](https://github.com/CherryHQ/cherry-studio/blob/b3acfe59449d76c53a3c47a22c26e0d2a9022fde/.agents/notes/implemented/bug-fix/2026-10-19-permanent-deletion-guards.md) 继续持有事务内固定保护的决策；本提案不取代数据库、忙碌、级联和确认语义。不新增数据库迁移、IPC 变更、持久化设置、默认快捷键变更或依赖。

这是仅含文档的 Spec。实现层需要当前 Spec PR head 上明确的人类 Approval，并声明所覆盖的 AC。累计实现证据覆盖全部 AC 前，本文保持 proposed；之后才将完整双语三件套移至 implemented。

## 考虑过的替代方案

- 通过 focus/blur 维护权威活动作用域注册表：复制浏览器状态，且需要处理焦点间隙、节点移除和恢复的一致性。改为解析实际事件归属。
- 添加 ContextKey，但保留全局最后 handler 选择：可能匹配一个列表的上下文，却执行另一个列表的 handler。将二者纳入同一次作用域分发决策。
- 将全局 DOM 扫描移至命令 provider，或改用 MutationObserver：继续推断覆盖层/可见性状态，并让路由依赖任意 DOM 标记。使用明确的拥有者和生命周期边界。
- 仅用 `shouldHandleKeyEvent` 保护永久删除：上下文、设置、菜单执行和其他界面命令仍缺少共享归属。该谓词只保留给事件特定条件。
- 重写整个命令框架或 Radix 焦点管理：无必要地扩大改动。复用现有表达式解析器、命令定义、Preference 和 UI 原语。

## 验收标准

- AC1 — 两个同时挂载的列表注册相同命令时，无论注册顺序如何，只执行焦点所在列表的目标；嵌套上下文和 handler 解析为每次按键选择相同拥有者。(verification: renderer routing tests; owner: command runtime)
- AC2 — Input、textarea、select、继承的 contenteditable、重命名、焦点目标缺失及目标禁用/受保护时，不消费删除快捷键，也不执行父级/兄弟/后台目标；焦点条目与选中条目保持区分。(verification: renderer resource/history consumer tests; owner: resource consumers)
- AC3 — 隐藏但保留挂载的 Tab/列表、脱离 DOM 的作用域和已释放的注册项不能执行；焦点即时切换和作用域释放无需等待 React effect 即影响下一次按键。(verification: renderer lifecycle tests and Electron retained-tab scenarios; owner: scope runtime/surface owners)
- AC4 — 对话框、菜单和嵌套 Portal 边界从打开到关闭/焦点恢复期间隔离后台资源命令，同时允许的根命令和边界内自有命令仍可使用；嵌套清理不会释放外层边界。(verification: real UI primitive integration tests and Electron; owner: UI/command integration)
- AC5 — 焦点变化后，Cherry 和原生菜单动作执行其捕获的拥有者和目标，或拒绝未激活/缺失/不合资格的来源；取消、弹出失败和卸载释放边界且不重新选目标。(verification: renderer menu boundary tests and native Electron scenarios; owner: command menus)
- AC6 — 焦点和覆盖层变化期间，快捷键设置及已配置绑定提示保持可用；平台/功能可用性、用户启用开关、重新绑定、命令 enablement 和仅限键盘的 when 条件保持各自语义。(verification: settings/presentation and shared resolver tests; owner: command presentation)
- AC7 — 现有根/组件程序调用、输入法行为和非资源快捷键保留其文档规定的路由，renderer 作用域状态不进入 shared 纯工具，UI 不依赖 renderer 命令服务。(verification: affected consumer tests, type/dependency checks and Electron; owner: command runtime)
- AC8 — 三类永久删除消费者全部使用共享作用域路由；移除 commandFocus.ts 及过时的扫描/资格路径，命令参考文档和双语决策记录与交付行为一致。(verification: explicit change scope, source scan, focused consumer tests and docs gate; owner: implementation coordinator)

## 风险

- Portal 的 React 祖先和 DOM 祖先不同。继承的来源列表作用域绝不能成为菜单/对话框的键盘拥有者。
- 仅在自动聚焦后注册边界，或在焦点恢复前清除边界，可能放行后台删除。必须针对真实原语和原生菜单生命周期验证打开/关闭顺序。
- 事件发生时的上下文需要独立的展示订阅路径。避免每次焦点事件引发全窗口重渲染，也不要将路由决策缓存在过期的 React 快照中。
- 从快捷键展示中移除运行时过滤时，如果没有单独保留功能/平台可用性，可能暴露不适用的命令。
- Spec 创建时，#21837 是尚未合并的消费者依赖。运行时改动和最终删除消费者迁移必须标明实际基线；文档检查通过不证明任何运行时 AC。
