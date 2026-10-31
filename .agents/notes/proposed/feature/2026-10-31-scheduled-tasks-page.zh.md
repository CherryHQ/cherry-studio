# Agent Note: 定时任务页面

Status: proposed

[English](2026-10-31-scheduled-tasks-page.md) | 中文

## Problem

现有定时任务可从设置页访问，但缺少一个从全局侧边栏进入、可选择任务并继续关联对话的独立页面。
目标流程应与“对话”和“智能体”一致：左侧列任务，右侧显示现有对话。
右侧必须保留对话和输入框，不改成任务详情或执行日志页面。

当前实现已有共享创建表单、任务命令、派生任务状态，以及执行与会话的关联。
需要补齐的是页面集成、正确的分组分页，以及可靠的关联会话选择。
本 Spec 描述待实现方案。页面尚未实现，产品验收标准尚未验证。

## Proposal

### 范围与文案

- 全局侧边栏增加“定时任务”入口，独立页面沿用“对话”和“智能体”的布局。
- 页面左栏顶部显示“添加定时任务”；点击后在当前窗口居中打开“建立定时任务”弹窗。
- 按钮下方保留“活跃”和“已暂停”两组。选择任务后，在当前页显示其关联对话。
- 复用共享表单及 [PR #21849](https://github.com/CherryHQ/cherry-studio/pull/21849) 中的创建集成方式。
- 保留对话输入框、运行时事件、工具输出、审批和忙碌状态保护。

中文文案固定为 `定时任务`、`添加定时任务`、`建立定时任务`、`活跃` 和 `已暂停`。
所有用户可见文案使用 i18next。新控件使用 `@cherrystudio/ui`，遵循 [DESIGN.md](../../../../DESIGN.md)。
本期不增加任务详情页、独立日志面板、批量操作、数据库表、依赖或调度器。
任务执行、重试、恢复和并发规则继续由现有运行时负责。

### 布局

```text
+-----------------+--------------------------+------------------------------------+
| Global sidebar  | Page sidebar             | Conversation                       |
|                 |                          |                                    |
| Chat            | + Add scheduled task     | Task title / associated session    |
| Agents          |                          | Current or historical run selector |
| Scheduled tasks | Active (total)           |                                    |
| ...             |   Task A [selected]      | Existing Agent message list        |
|                 |   Task B                 | Tool output, approvals, run state  |
|                 |   Group pagination       |                                    |
|                 |                          |                                    |
|                 | Paused (total)           |                                    |
|                 |   Task C                 |                                    |
|                 |   Group pagination       | Existing conversation composer     |
+-----------------+--------------------------+------------------------------------+
```

图中的三列包括现有全局侧边栏。页面内部只有任务左栏和对话区域。
宽度、拖动调整、折叠和小窗口行为复用 `ChatAppShell`、`PageSidebar` 与现有对话布局。
任务行显示名称、所属智能体和简短计划摘要，选中态沿用现有列表样式。
执行状态只作辅助信息，不决定任务属于活跃组还是已暂停组。

### 入口与选择

1. 从全局入口进入建议路由 `/app/scheduled-tasks`，保持该入口高亮。
2. 独立加载活跃和已暂停任务。没有有效选中项时，右侧提示选择任务。
3. 用 `taskId` 表达所选任务；先读取任务，再解析其关联对话。
4. 用 `runId` 表达明确选择的历史执行；打开会话前，校验该执行与任务的关联。
5. 选择任务只替换右侧内容，保留任务路由、左栏及各组分页位置。

不调用会把任务选择送回 `/app/agents` 的 `openConversation` 或其他导航助手。
任意 URL 中的 `sessionId` 都不能证明会话属于该任务。
切换时清除上一任务的展示数据。迟到响应既不能覆盖新选择，也不能短暂显示旧消息。

### 创建

1. 点击“添加定时任务”时，按需加载共享 `TaskFormDialog`，在当前窗口居中打开。
2. 使用要求的“建立定时任务”标题，保留共享字段、校验、计划转换和会话复用行为。
3. 通过 `useCreateTask` 提交，防止重复提交，复用现有错误提示。
4. 失败时保留表单和输入值。成功后关闭表单、刷新两组，并选中返回的新任务。
5. 创建后不额外调用立即执行命令。任务继续按现有计划规则运行。

新任务尚未执行时，右侧显示 `等待首次执行`。
共享弹窗当前中文标题为 `新建定时任务`；将其 i18n 值改为要求的 `建立定时任务`，不复制表单。
独立入口按钮使用 `添加定时任务`。
焦点进入表单并保持在弹窗内。非提交期间可用 Esc 或取消关闭，关闭后焦点返回触发按钮。
提交期间保留共享表单的 `saving` 保护，不允许关闭。
没有可用智能体时，说明要求并提供现有智能体入口，不创建无归属任务。

### 暂停、恢复与分组变化

任务行通过 `useSetTaskEnabled` 提供暂停或恢复，不另设写入 `enabled` 的路径。
暂停影响后续调度，不终止已开始的执行，沿用 `JobManager.pauseJobScheduleById` 的语义。
操作处理中禁止重复命令。成功后刷新两组及总数；失败时保留原状态并显示错误。
任务跨组移动时保持选中及当前对话，不因分类变化而重建输入框。
任务移出后若当前页越界，退回该组最后一个有效页。

### 状态与分页契约

| 派生状态 | 去向 | 含义与约束 |
| --- | --- | --- |
| `active` | 活跃 | 采用现有派生状态，不等于此刻正在执行 |
| `paused` | 已暂停 | 采用现有派生状态，不包含所有未启用的任务 |
| `completed` | 暂不进入两组 | 一次性计划已触发；保留现有设置入口可查 |
| `missed` | 暂不进入两组 | 保留现有错过执行的含义；保留设置入口可查 |

`AgentTaskService.ts` 中的 `deriveStatus` 优先判断 `missed`，再判断已触发的一次性 `completed`，最后判断 `paused / active`。
不能只按 `enabled` 分类，也不能把计划的 `completed` 状态当作执行结果成功。
继续按现有列表规则排除心跳任务和归档智能体。

两组独立分页，每页最多 50 条，按 `createdAt` 倒序排列。
各组总数涵盖该状态的全部任务，不只是当前页。加载、错误和分页位置各自独立。
为 `/agent-tasks` 增加可选 `status` 枚举查询参数；省略参数时保持现有行为。
主进程先按现有派生规则筛选，再计算 `total` 和截取当页。
不得只过滤当前 50 条、把全部任务传给渲染进程，或拼接逐智能体查询。

待评审默认：`completed / missed` 保留在现有设置入口，不新增第三组。
这个去向需要 Spec 评审，不是额外确认过的产品要求。
已选任务进入结束状态时更新列表，但不强制关闭已经打开的对话。

### 解析关联对话

现有普通定时任务创建 `conversation` 会话；心跳使用 `background` 会话。
每次执行通常创建新会话，启用 `reuseSession` 时则使用绑定会话。
任务提供 `reuseSessionId`，执行记录提供 `TaskRunLogEntity.sessionId`，执行过程写入 `job.metadata.sessionId`。

按以下顺序解析右侧内容：

1. 明确选择的历史执行优先：先校验它属于当前任务，再读取对应会话。
2. 未明确选择历史执行且启用了会话复用时，优先使用有效的 `reuseSessionId`。
3. 其他情况查找最近一次具有有效 `sessionId` 的执行。
4. 没有可用对话时显示对应空态。查看页面绝不创建会话或启动任务。

绝不能仅凭 `agentId` 打开该智能体的最近会话；它可能属于无关工作。
使用现有会话读取接口和类型检查，不绕过已删除、无权访问或 `background` 会话的边界。
明确选择的历史会话不可用时，显示该选择的错误，不悄悄替换为其他执行。

`useTaskLogs` 当前只向调用方提供前 50 条记录，但其 DataApi 接口已经支持分页。
扩展所选任务的日志 hook，暴露该分页能力，每页最多 50 条。
待评审默认：自动查找最多两页，共 100 条，然后提供继续查找更早对话的操作。
每次主动继续最多加载 50 条。历史执行选择器也按需加载分页。
只有读到记录末尾，才能确认没有关联对话；达到自动查找预算不能得出这个结论。

最新执行仍在排队且没有 `sessionId` 时，显示其真实状态。
如果下方展示较早的对话，标明该次执行时间，不能把它说成最新执行的输出。
新执行不能替换用户正在阅读或输入的对话；提供主动切换到新对话的操作。
执行选择器放在对话标题区，只用于选择关联对话，不扩展为任务详情或日志面板。

### 继续对话

消息流、工具输出、审批和忙碌状态保护复用 `AgentChat`。
发送消息属于普通对话交互，不修改任务提示词或计划，也不等于立即执行命令。
切换或卸载页面只解绑视图订阅，不停止主进程调度或正在执行的任务。
同一会话同时出现在智能体页、定时任务页和其他窗口时，保留现有流所有权与去重规则。

### 空态、错误与可访问性

| 情况 | 反馈 |
| --- | --- |
| 两组都为空 | 保留添加按钮，说明任务创建后可在执行时产生对话 |
| 某组为空 | 保留组标题及零总数，显示该组的空态 |
| 任务从未执行 | 显示“等待首次执行”，不挂载旧对话的输入框 |
| 正在查找更早记录 | 区分加载中、还有更多记录和历史已查尽 |
| 最新执行排队或失败且没有会话 | 展示真实执行状态，不伪造消息 |
| 任务、智能体或会话不可用 | 说明不可用的资源，仍可选择其他任务 |
| 某组加载失败 | 在该组提供重试，另一组和可用对话继续工作 |
| 会话解析失败 | 右侧提供重试，不回退至其他任务或智能体的最近会话 |

任务选择、暂停、恢复、分页和历史选择都必须支持键盘操作。
可访问名称与可见操作一致；加载和空态不只依赖颜色。验证浅色、深色和小窗口布局。

### 职责与实现边界

| 现有职责入口或建议位置 | 改动 |
| --- | --- |
| `src/renderer/utils/sidebar.ts`、`src/renderer/components/app/sidebarIcons.tsx` | 注册建议 app ID `scheduled_tasks`、标题、图标和路由前缀 |
| `src/renderer/utils/routeTitle.ts`、`src/renderer/utils/tabIcons.ts` | 注册路由的标签页标题和图标 |
| `src/shared/data/preference/preferenceTypes.ts`、`scripts/data-classify/data/target-key-definitions.json` | 通过现有生成流程扩展 app ID 和 `ui.sidebar_shortcut` 默认值 |
| `src/main/data/db/seeding/seeders/sidebarShortcutMigrationSeeder.ts` | 参考现有升级机制，一次性幂等补齐入口 |
| `src/renderer/routes/app/agents.tsx`、建议新增 `src/renderer/routes/app/scheduled-tasks.tsx` | 使用独立的选择与导航适配，组合相同的智能体对话页面 |
| `src/renderer/pages/agents/AgentPage.tsx`、建议新增 `src/renderer/pages/agents/components/ScheduledTaskSidebar.tsx` | 隔离硬编码路由访问，增加任务导航模式或左栏 slot |
| `src/renderer/hooks/agent/useTasks.ts` | 增加按状态分页和日志分页，保留命令及失效刷新 |
| `src/shared/data/api/schemas/agents.ts`、`src/main/data/api/handlers/agents.ts`、`src/main/data/services/AgentTaskService.ts` | 定义、校验并传递可选状态筛选，在分页前执行 |

`AgentPage` 当前直接读取 `/app/agents` 的 route API，仅替换左栏还不够。
让两个路由复用其对话组合层，`AgentChat` 与运行时组件仍留在 agents 内。
不从兄弟页面 `pages/scheduledTasks` 导入 `pages/agents/AgentChat`，也不为此功能搬迁整个对话模块。
`useConversationNavigationOwner` 当前通过 `findConversationTab` 查找普通智能体标签页；现有跳转行为不能直接驱动任务页内选择。
扩展所有权识别时，只接受已校验的任务与会话关联，绝不接受任意 URL `sessionId`，并覆盖两个视图及多个窗口。

新安装通过 `core.app` 快捷方式提供方，把默认入口放在对话和智能体附近。
升级时只向 `ui.sidebar_shortcut` 补入一次，保留固定项及其相对顺序。
使用现有 Preference 和 seeding 版本记录，不替换整份配置，也不在每次启动时补回用户已移除的入口。
`ui.sidebar.favorites` 是旧迁移来源，不是当前快捷方式偏好。仅修改旧默认值不能完成入口接入。
`preferenceSchemas.ts` 是生成文件，修改其源定义并运行现有生成器。

### 共享表单与入口兼容

当前 main 分支的 `src/renderer/` 下已经有 `components/ScheduledTask/TaskFormDialog.tsx`、`scheduleForm.ts` 和 `TaskRunSummaryLine.tsx`。
`TasksSettings.tsx` 已经导入共享表单。直接复用，不再抽取另一份副本，也不替换其计划校验。
创建模式接收 `open`、`agents`、`onOpenChange`，以及返回布尔值的异步 `onCreate`；将 `useCreateTask` 适配到该契约。
以 [PR #21849](https://github.com/CherryHQ/cherry-studio/pull/21849) 作为原地打开表单的参考，不依赖其整个 PR 栈。
当前 main 分支没有 `AgentTaskDashboard`。保留现有设置和智能体入口；若该面板落地，也保持兼容。
既有外部链接继续有效。这个页面不移除其他任务入口。

### 数据流与性能预算

读取继续走 DataApi：`/agent-tasks`、`/agent-tasks/:taskId` 和 `/agents/:agentId/tasks/:taskId/logs`。
创建、暂停、恢复继续走 IpcApi `ai.agent.task.create / pause / resume`。
复用命令成功后的失效刷新及任务数据变化事件，更新两组、总数和所选任务。

- 各组每页最多返回 50 个任务，只读取所选任务的会话与日志。
- 执行记录每页最多返回 50 条，自动查找最多两页，之后由用户主动继续。
- 按需加载创建表单；打开页面时不预载所有智能体的对话消息。
- 使用现有变化事件，不新增轮询计时器；列表刷新不重新挂载当前对话。
- 复用批量展示数据及运行摘要，不增加逐行日志请求或逐智能体 N+1 查询。

`queryTasks` 当前先读取候选任务，在主进程筛选、排序后切片，不是 SQL 层分页。
`getTaskLogs` 也先调用 `jobService.list({ scheduleId })` 再切片。限制返回量不等于限制底层扫描。
使用大量任务及长执行历史，与现有列表比较主进程耗时、请求数和渲染项数量。
若重复分组扫描造成明显卡顿，在所属服务内处理，不改为向渲染进程传全部任务，也不重做调度器。

### 实施顺序

1. 核对实施基线与共享表单契约，再阅读设计、数据和前端测试规范。
2. 补齐分页前状态筛选并暴露日志分页，验证总数、状态优先级和旧调用兼容。
3. 增加入口、路由、标题、图标及偏好升级，适配现有对话组合层。
4. 接入共享表单、两组任务、暂停恢复、关联解析和空态。
5. 验证受影响契约、桌面行为、可访问性、并发与性能，更新受影响文档及生成的路由资料。

## Alternatives considered

| 备选方案 | 未采用的原因 |
| --- | --- |
| 只保留设置页中的任务 | 无法提供要求的独立侧栏页面及从任务继续对话的流程 |
| 右侧改为任务详情或日志 | 与要求的关联对话及输入框冲突 |
| 复制 #21849 整个栈或重复表单 | 共享表单已经可用，复制会引入无关改动或分叉的校验逻辑 |
| 仅对当前取回的 50 条任务分组 | 分组和总数不完整，后续页的任务会遗漏 |
| 仅按 `enabled` 分类 | 会把已完成或错过的计划误标为暂停，丢弃现有派生状态优先级 |

## Acceptance criteria

- AC1 — 新安装与升级用户都有可用侧栏入口；升级保留固定项及其顺序，用户移除入口后重启不会被补回。 (verification: unit + renderer + Electron; owner: sidebar implementer)
- AC2 — 添加按钮打开居中创建弹窗；非提交期间 Esc、取消和焦点返回正常；提交期间禁止关闭和重复提交，失败保留输入值。 (verification: renderer + Electron; owner: renderer implementer)
- AC3 — 创建成功关闭表单并选中新任务，不额外执行立即运行命令，也不跳转设置或智能体页；从未执行的任务显示等待状态。 (verification: renderer + Electron; owner: renderer implementer)
- AC4 — 两组各有超过 50 个任务时仍完整且总数正确，暂停恢复跨组移动时保持选中；完成和错过的任务不归入暂停，暂停不终止已开始的执行。 (verification: unit + renderer; owner: data implementer)
- AC5 — 无任务、无关联对话和任务切换时不闪现旧任务消息；迟到响应不能覆盖所选任务。 (verification: renderer; owner: conversation implementer)
- AC6 — 复用会话、最近有效执行和明确选择的历史按规则解析；前 50 条以后的记录仍可按查找预算访问，空 ID 不打开智能体无关的最近会话。 (verification: unit + renderer; owner: conversation implementer)
- AC7 — 排队且无会话、会话已删除和 background 会话均有准确反馈；新执行不抢走当前对话，用户可主动切换到最新对话。 (verification: renderer + Electron; owner: conversation implementer)
- AC8 — 继续对话不改变任务提示词或计划，并保留忙碌状态、审批及同会话多视图保护，包括跨窗口场景。 (verification: renderer + Electron; owner: conversation implementer)
- AC9 — 现有智能体页、设置页、外部链接及已落地的任务面板保持可用；离开任务页不停止调度或正在执行的任务。 (verification: renderer + Electron; owner: feature implementer)
- AC10 — 浅色、深色、键盘和小窗口操作正常；分组与日志请求遵守预算，不增加轮询或逐行 N+1 工作，并测量大数据量下的扫描成本。 (verification: renderer + Electron + performance measurement; owner: feature implementer)

实现验证覆盖 `AgentTaskService`、agents handler、入口 seeder、表单、路由适配、关联解析竞态及受影响的现有调用方。
数据库测试使用 `setupTestDatabase()`。按明确文件路径运行定向测试，并验证超过 50 条任务及历史、两个视图和多个窗口的桌面行为。
本次文档改动只运行文档检查，不声称上述任何产品验收项已经通过。

## Risks

- 路由耦合：`AgentPage` 和导航所有权假定使用智能体路由。不完整的适配可能造成选择跳转或重复消息流；保持抽取范围小，并验证两个视图和多个窗口。
- 扫描成本：两个筛选组可能重复现有任务扫描，每页日志也可能重读长历史。测量实际成本，不能把返回分页描述成底层数据库工作有界。
- 结束状态去向：`completed / missed` 暂留设置页是待评审默认。评审若修改该选择，同步更新本 Spec 与分页契约，不悄悄增加分组或关闭已打开的对话。
- 定时执行与用户输入可能复用同一会话。保留现有并发、忙碌状态和审批规则；新页面不能绕过这些规则，也不能让暂停看起来会取消正在执行的工作。
