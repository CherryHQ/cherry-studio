# Agent Note: 分离快捷键触发条件与命令目标

Status: implemented

[English](2026-11-09-command-target-routing.md) | 中文

## 问题

组件获得焦点，不应隐式禁用所属活动 tab 或窗口的命令。反过来，可见列表也不应仅因注册了 handler 就收到删除操作。键盘触发条件与命令目标选择回答的是不同问题。

[焦点作用域前置改动 #23917](https://github.com/CherryHQ/cherry-studio/pull/23917) 引入焦点作用域、显式交互边界和捕获的菜单来源。其输入框导航修复通过消费者自行选择的 tab runtime 注册回调，恢复了导航，但目标选择仍分散在注册点。

获批的 [Spec #23934](https://github.com/CherryHQ/cherry-studio/pull/23934) 已在包含 #23917 的 main 基线上实现。本决策部分接替其注册和 handler 路由；[焦点作用域说明](2026-11-09-command-focus-scopes.md) 保留独有的边界、可编辑目标、展示与生命周期决策依据及验证历史。

## 决策

### 参考模型与归属

参考模型是 VS Code 的职责分离；Cherry 的组件 handler 链是本地适配。在 [VS Code 提交 864824b432e6fb153a3b4dfa1e0f96744ebcf6a4](https://github.com/microsoft/vscode/tree/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4) 中，[ContextKeyService](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/platform/contextkey/browser/contextKeyService.ts) 解析目标局部上下文并继承父值；[KeybindingResolver](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/platform/keybinding/common/keybindingResolver.ts) 匹配有序规则及其 `when` 条件；[CommandService](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/workbench/services/commands/common/commandService.ts) 执行已注册命令。[编辑器导航](https://github.com/microsoft/vscode/blob/864824b432e6fb153a3b4dfa1e0f96744ebcf6a4/src/vs/workbench/browser/parts/editor/editorActions.ts) 从所属服务取得活动编辑器组。局部上下文不要求所有 handler 都属于当前获得焦点的 DOM 组件。

Cherry 保留现有命令 ID、快捷键偏好和表达式求值器。Renderer 命令贡献集中声明目标语义；可变拥有者注册仍留在 renderer。现有共享 `CommandScope` 继续表示进程范围（`main`、`renderer`、`both`），不表示 UI 目标范围。Renderer 服务或可变注册表不进入 `src/shared` 或 `packages/ui`。

### 触发条件与目标选择

键盘分发读取事件所属的已注册 ContextKey 作用域，包括继承值及事件局部的可编辑/IME 状态。对于每条匹配的绑定，`when` 判断触发资格，renderer 独立检查声明目标上是否存在已启用的 handler。保留符合条件的绑定之间的既有优先顺序。拥有者缺失、禁用或有歧义时，该命令对此次事件不可用，不能借用其他拥有者的 handler。选定候选项后，若随后被拒绝，不再尝试其他绑定。仅增加一个组件作用域，不应压制 tab/窗口命令。

目标策略在 `RENDERER_COMMAND_TARGETS` 中声明，仅覆盖现有需要：焦点拥有者、活动 tab 拥有者和窗口拥有者。这是 Cherry 的适配，不代表 VS Code 提供这三种策略。拥有者通过共享 renderer 命令机制注册业务回调；分发器按声明策略选择，而非要求各消费者另取 runtime。分发器中没有命令名、路由名或 Chat/智能体分支。同一命令/目标有多个符合条件的拥有者属于冲突，不通过注册顺序选举。

| 命令类别 | 键盘触发条件 | 目标 |
| --- | --- | --- |
| 永久删除 | 焦点资源符合条件，且不处于可编辑/重命名状态 | 焦点列表/分组/History 拥有者及其焦点项 |
| 会话数字导航 | 活动 tab 有可见、空闲的会话来源，且对应排序位置存在 | 活动 tab 内的会话导航拥有者 |
| 窗口命令 | 现有功能、平台及命令特定条件 | 当前窗口拥有者 |

会话导航保留现有 section 折叠过滤与分组排序、缺失位置行为、加载保护和列表激活条件。输入框获得焦点不禁用导航。目标归属来自 tab 生命周期，而非当前焦点子组件；隐藏或过渡中的 tab、未激活的面板不能提供符合条件的拥有者。目标策略不授予穿过对话框/菜单边界的权限。保留 #23917 的显式跨界策略及逻辑交互层优先级，包括 Activity 重放。

### 调用与迁移

解析时捕获命令 ID、拥有者和 handler 身份；执行时保留传入的参数。键盘执行使用匹配后捕获的 handler；同步谓词不能重定向它。显式组件/程序调用和菜单操作保留其绑定或捕获来源，而非重定向到稍后变为活动状态的 tab。显式执行检查业务 enablement，但不应用仅限键盘的 `when`。延迟菜单结果重新检查拥有者生命周期、回调身份及业务资格，拒绝过期来源且不重新指向其他目标。

会话数字导航回调现在通过普通 runtime 在自身列表作用域内注册。`TabRouter` 为现有作用域标记 `kind="tab"`；注册表选择该 tab 内符合条件的拥有者，对 tab 外的键盘输入则选择唯一活动 tab。显式调用保留来源 tab。不存在任何 tab 作用域的独立窗口使用窗口根作用域。非活动或过渡中的 tab 不会借用这个回退目标。

资源列表/分组/History 删除保留焦点归属。窗口搜索、tab 导航/关闭和退出全屏声明窗口目标。其他命令保留焦点策略。所有目标都拒绝多个符合条件的注册，包括同一焦点作用域内的重复注册。作用域生命周期和注册通知传递到祖先，让兄弟组件的命令控件在更广范围的目标出现或消失时刷新。消费者侧的 tab-runtime hook 和 context 已移除；命令参考文档描述统一的目标机制。

设置、快捷键提示和菜单展示继续区分已配置绑定、功能可用性、命令 enablement 与仅限键盘的条件。不改变默认快捷键、偏好存储、IPC、主进程/全局快捷键归属、删除确认或数据库保护。替换 Radix 焦点陷阱，以及修复另行观察到的嵌套 Activity 遮罩/指针恢复问题，不在本次改动范围内。

## 考虑过的替代方案

- 保留消费者自行选择 runtime：维持当前修复，但在调用处重复目标选择，使较宽范围的快捷键易受组件嵌套变化影响。
- 将所有命令全局化，或为 Chat/智能体快捷键建立白名单：丢失破坏性操作的焦点目标归属，或将业务例外编码进分发器。
- 让最近组件或注册顺序决定所有命令：混淆上下文、触发条件与目标选择；兄弟输入框无法可靠访问 tab 导航。
- 复制整套 VS Code 命令基础设施：超出所需改动。复用 Cherry 的注册表、条件和偏好，采用职责分离。

## 影响

- 拥有者继续负责业务资格和面板可见性。重复的活动拥有者会被拒绝，不按挂载顺序选择。
- 键盘上下文、业务 enablement、目标策略和交互边界保持独立。声明更广的目标不允许穿过对话框/菜单边界。
- 显式调用和延迟菜单不能借用后来活动的 tab 或替换后的回调。Activity 清理会移除注册并使捕获的调用失效。
- Electron 验证使用隔离的开发配置。真实 Chat/智能体输入框及资源删除通过 CDP 键盘输入驱动。原生菜单选择通过主进程 inspector 调用真实 Electron MenuItem 回调，不证明实际操作系统鼠标选择。前置改动中另行记录的嵌套 Activity 遮罩/指针恢复限制仍不在本次范围内。

## 验证

- AC1 — `CommandTargetRouting.test.tsx`、`CommandProvider.test.tsx` 和共享 `keybindings.test.ts` 覆盖嵌套输入框作用域、目标冲突、符合条件的绑定优先级、目标不可用，以及谓词在选定后拒绝且不重试。
- AC2 — `useConversationListShortcuts.test.tsx` 覆盖排序、折叠分组/section、缺失位置、加载中、非活动列表和 Activity 恢复。真实 Chat 与智能体 Electron 输入框通过 Cmd+1/2 切换，保留各自草稿，并忽略缺失的 Cmd+9。
- AC3 — `ResourceListPermanentDelete.test.tsx`、`ResourceListGroupPermanentDelete.test.tsx`、`HistoryRecordList.permanentDelete.test.tsx` 和 `CommandFocusScope.test.tsx` 覆盖焦点/选中项身份、可编辑/重命名/受保护/缺失项及非活动作用域。Electron 输入框焦点未触发删除；获得焦点但未选中的行打开了该行的确认框，取消后保留原选中会话。
- AC4 — 真实 `CommandFocusLayers.test.tsx` 和 UI `keyboard-layer.test.tsx` 保持对话框/菜单隔离、允许的窗口命令及嵌套/兄弟 Activity 优先级。Electron 删除确认框阻断了背景数字导航；输入框中仍可打开全局搜索。
- AC5 — `CommandMenus.test.tsx`、`CommandTargetRouting.test.tsx` 和 `CommandProvider.test.tsx` 覆盖捕获的回调、替换/销毁、tab 变化及仅限键盘的谓词。使用生产 `CommandPopupMenu` 和真实原生 IPC 的 Electron fixture 在焦点变化后保留原拥有者，在其 tab 停用后拒绝结果，并在键盘谓词拒绝的情况下执行显式操作。
- AC6 — CommandControls、CommandContextKeyProvider、useCommandShortcuts、useNumberShortcutHints、command 工具、AppShell、SubWindowAppShell、TabRouter 和全屏测试结合 renderer 类型检查覆盖展示、重新绑定、窗口行为及 IME。共享定义、偏好 schema 和 IPC 未改变。
- AC7 — 显式基线改动范围、源码检查、受影响文档审阅、变更文件 lint/格式、文档/配对及 Agent Note 状态迁移检查验证集中目标声明、消费者 runtime 移除、参考文档更新及本次双语部分接替。
