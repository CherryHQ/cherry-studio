# Agent Note: Agent 历史操作与显式 Plan／Goal 入口

Status: proposed

[English](2026-11-08-agent-history-operation-boundaries.md) | 中文

## 问题

当前草稿中出现规划相关词语时会显示 Plan Mode 提示，并临时改变 Shift+Tab 的处理。接受提示会持久化整个 Agent 的权限模式，尽管提示围绕单条草稿出现。用户要求在 Quick Panel 中提供独立的 Plan、Goal 入口，输入框不显示模式提示，也不根据草稿推断模式。Shift+Tab 只切换普通／计划，Goal 单独选择。

历史操作还存在另一层歧义。Claude Code 和 Pi 保存原生分叉边界并实现了桌面 fork/edit。Pi Durable 能分叉原生子会话，却没有暴露桌面 fork/edit 检查点。renderer 目前只凭助手消息成功就启用分叉，没有检查 driver 支持或检查点是否存在。对话编辑不会恢复工作区文件。

本方案负责具体后续修改范围与验收门槛。[runtime 契约](2026-10-17-agent-runtime-contract.md)继续负责产品消息树与原生绑定语义；[边界所有权方案](../simplification/2026-11-05-agent-runtime-boundary-ownership.md)负责输入、投影和关闭边界。本方案属于补充提案，不代表这些文档或本项工作已获批准或完成。合并后审计中的批准、终结结果、关闭和提供商校验问题仍是独立工作。

### 已核对基线

源码基线为提交 `3ace7c1389454fea8cb02aa3029fefa15dc7c3df`。下列事实已经过代码核对，不代表新增 Electron 或真实提供商验收。

| 范围 | 当前行为 | 处理要求 |
|---|---|---|
| Plan Mode 发现入口 | `PlanModeHint.tsx` 渲染提示；`usePlanModeHint.ts` 持有关键词和草稿状态 | 删除整条建议链路；保留显式模式选择 |
| Claude 桌面历史 | 检查点包含原生 session ID、assistant UUID 和配置目录；原生 `forkSession()` 重映射 UUID | 保留原生实现，验证边界与映射契约 |
| Pi 桌面历史 | 检查点包含原生 session ID 和 leaf ID；`createBranchedSession()` 提取所选路径 | 保留原生分支提取，拒绝缺失或损坏历史 |
| Durable 子线程上下文 | `tx.forkConversation()` 从原生 entry 创建有归属的子会话 | 与桌面对话分叉分开处理 |
| Durable 桌面历史 | driver 没有 `fork()`；没有发出桌面分叉检查点 | 如实展示不支持；启用前须有独立的原生存储设计 |
| 工作区回滚 | 没有接入桌面文件检查点／回滚 | 历史操作不回滚文件，并说明其范围 |

源码归属为[分叉操作](../../../../src/main/ai/agentSession/fork/AgentSessionForkOperations.ts)、[检查点持久化](../../../../src/main/ai/agentSession/persistence/AgentSessionMessageBackend.ts)、[Claude 分叉](../../../../src/main/ai/runtime/claudeCode/claudeFork.ts)、[Pi 分叉](../../../../src/main/ai/runtime/pi/piFork.ts)、[Durable driver](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeDriver.ts)和[消息操作可用性](../../../../src/renderer/pages/agents/messages/agentSessionFork.ts)。

## 方案

### 1. 范围与操作名称

本次交付提示移除、准确的历史操作可用性，以及既有 Claude/Pi 历史契约。不新增 history manager、额外对话副本、通用能力注册表，也不向公共 Runtime 增加 fork/rewind 方法。

| 操作 | 产品效果 | 原生效果 | 文件效果 |
|---|---|---|---|
| 分叉对话 | 新建产品会话，使用新的产品消息 ID 复制保留前缀 | 在已验证边界创建独立原生上下文 | 复制当前系统工作区，或复用现有普通工作区 |
| 编辑并重发 | 保留会话 ID；创建兄弟输入并选择新分支 | 在被编辑输入之前分叉，使用新原生绑定 | 保留当前工作区内容 |
| 选择保留分支 | 选择已有产品路径 | 后续发送输入时解析其既有绑定 | 不回滚 |
| 分叉子线程上下文 | 保留原生子任务归属及独立归档 | 由具体 harness 继承所选原生上下文 | 遵循现有子线程工作区策略 |
| 回滚文件 | 本方案不交付 | 需要单独批准文件恢复契约 | 会修改文件，需要独立预览与冲突规则 |

当前产品操作使用“编辑并重发”和“分叉对话”。两者都不标为恢复文件或撤销执行。复制后的系统工作区反映复制时状态，不是所选历史消息时刻的文件状态。

### 2. 使用显式 Plan、Goal 入口

删除提示组件、关键词匹配器、每草稿状态及专属测试。从 `AgentComposer.tsx` 删除相应导入、接受／关闭／重置接线和 JSX，并删除全部 `agent.input.plan_hint.*` locale key。不增加模式建议或模式专属 placeholder。

将 Plan 从输入框的 Permission Mode 子菜单移至 Quick Panel 独立开关。保留既有支持模式过滤与已保存的原生 `permission_mode`：开启 Plan 设为 `plan`，退出 Plan 设为 `default`。不在挂载时重置已有 Agent，也不增加另一份持久化模式。Agent 配置对话框保留已有原生权限选项。

两个 composer surface 均保留 `onShiftTab`。受支持的 harness 中，单独按 Shift+Tab 始终切换普通／计划，与草稿措辞无关，不发送也不改写草稿。重复 keydown 不再次切换；已打开面板的导航和提示词变量导航保持优先，输入法组合输入及带其他修饰键的快捷键不改变模式。Goal 不加入此循环。

将已有原生 `/goal` 命令提升为 Quick Panel 独立的 Goal 模式入口。选择后在草稿开头插入一次 `/goal `，保留已有 token 并聚焦输入框；用户填写目标并显式发送，继续走已有原生命令链路。不新增 Goal 状态机，也不根据普通文本推断目标。Pi、Durable 的静态回退目录声明其已实现的命令；Claude 在实时 SDK 目录声明该命令时显示入口。显式自定义命令不提升为原生模式控制。

保留 Full Access 确认、原生 Plan 执行，以及仍被推理／service-tier 设置使用的共享 `useUpdateAgent` 消费者。不增加替代关键词检测器、模型分类器、通知或引导横幅。

### 3. 区分三类不同目的的检查点

| 值 | 所有者与消费者 | 保证 |
|---|---|---|
| `runtimeAnchor.checkpoint` | 具体桌面 driver 产生；Main 将其交给 fork/edit 消费 | 定位原生对话边界；不是对话内容，也不是文件快照 |
| `checkpointMapping` | 现有 context service 与产品投影／分叉映射 | 保留 source 到产品身份的关联，以及分支专属的检查点关联 |
| 原生 Durable task/document 检查点 | 原生 SDK scheduler 与存储 | 支持其声明的原生恢复语义；不代表桌面分叉或文件恢复 |

保留已持久化的 Claude、Pi 检查点格式。Main 按 runtime 路由并验证产品归属；具体原生 helper 验证自身字段与历史。只有带有效原生证据的成功回复才能获得 fork anchor。检查点捕获／持久化失败时，保留已完成回答并禁用该回复的分叉，不制造边界。

Claude `/clear` 等原生会话重置发生时，使用当前产品分支边界准备后继 context。准备成功后才一并切换 handle/context。不为每个新原生会话复用连接建立时的 `branchHead`，不放宽锚点唯一约束，也不允许旧观察回写后继检查点。

### 4. 保留原生分叉与编辑行为

Claude 继续固定 JSONL 前缀，通过现有 worker 和 SessionStore 调用 SDK 的 `forkSession()`。新 UUID 由 SDK 分配。根据返回映射验证继承检查点、压缩引用和内容替换；不支持的证据使操作失败。

Pi 继续打开固定的源快照，调用 `SessionManager.createBranchedSession(leafId)`。发布前验证 session 和 leaf，重写继承检查点中的 session 身份。不根据展示用产品文本重建原生上下文。

保留的产品前缀可能因 `/clear` 跨越多个原生 context。通过现有 adapter 分别分叉每个 context 的保留边界，保持各自的检查点映射和独立原生身份。复制前缀中的全部产品消息，将每段副本绑定到各自准备的 context，后续只恢复选中边界所在的 context。较早 context 继续支撑历史编辑和再次分叉，不进入选中 context 的模型历史。发布前准备全部原生产物，连同产品前缀重新核对已捕获的 context 绑定，并在一次 SQLite 事务中发布会话、消息和绑定。准备或发布失败时补偿全部归本操作所有的产物。删除源会话不得使早期或后期的副本历史失效。原地编辑只分叉其前置边界所在的原生 context，较早 context 继续归同一个产品会话所有。

编辑前缀非空时，要求被编辑用户输入之前紧邻的成功助手边界。编辑第一条输入、前缀为空时，预留新原生身份，不制造输入前检查点。保留以下产品消息树结果：

```text
root
└── U1 → A1
    ├── U2  → A2       (retained)
    └── U2' → A2'      (selected)
```

Main 保留针对运行中／排队／后台工作、审批及未确认关闭的编辑门禁。选择新分支前重新校验捕获的历史版本。准备失败保持旧选择不变。发布后，拒绝或未知接纳的输入留在新分支并保留实际交付状态，不恢复旧尾部、不自动重发。

### 5. 让操作可用性与证据一致

Main 保持权威。复用现有 Agent 消息读模型，只提供 renderer 实际消费的操作可用性：driver 支持情况，以及相应持久化检查点／分支有效性。不为复制原生校验而把不透明检查点暴露给 renderer。读取消息列表不得打开原生存储或恢复 scheduler。

`AgentSessionMessageService` 的普通消息分页不接收运行时回调，也不承载操作策略。`AgentSessionForkService` 只批量读取指定消息的边界字段及其父节点，包括当前页之外的父节点。`agentSession/fork` 中的无状态模块持有公共资格规则，复用所选 driver 的检查点校验器。`AgentSessionRuntimeService` 为消息列表 API 组合这些判断；编辑准备和 fork/edit 执行使用同一套规则。父节点缺失的输入和投递输入均被拒绝；父节点为 root 时，也只有受支持的 driver 才允许编辑首条输入。执行仍保留分支专属检查点映射、忙碌／关闭守卫、版本检查、附件校验和原生历史核验。

在既有分叉操作和编辑入口中消费该结果。助手消息成功本身不足以证明可分叉。Durable 不支持的桌面操作应显示为不可用并给出原因；正常复制／导出／删除和显式权限选择保持独立。列表读取之后历史文件丢失，仍应返回有类型的执行时错误，不能据此重建历史。

### 6. 保留发布与恢复归属

继续使用 `AgentSessionForkOperations` 和现有资源意图记录。在活跃源之外准备原生产物，校验后以不覆盖现有文件的方式发布，再通过 SQLite 事务绑定产品消息树。文件系统发布与 SQLite 不是同一原子事务；资源记录负责补偿与启动恢复。

取消或写入失败，只删除已证明属于本操作且尚未绑定到已提交产品 context 的资源。恢复保留已提交 context，不删除路径复用后属于别人的文件。显式分叉对话不继承活跃批准卡、任务所有权或执行回执。产品消息 ID 和原生 ID 由各自所有者重映射；原生压缩不能删除保留的产品分支。

### 7. Durable 与文件回滚的启用门槛

本次交付保持 Durable 桌面 fork/edit 不可用，共享 behavior 的子线程分叉不变。启用桌面历史操作须另有后续方案，并为以下全部条件提供证据：

- 固定已提交的 conversation/entry 边界及匹配的历史配置。
- 源存储独占归属，以及进程重启后可打开的隔离目标 backend。
- 原生保留压缩与可回退 document，同时不继承活跃 task/submission 归属。
- 发布、取消和补偿接入现有 Main 资源生命周期。
- 使用公开 SDK／存储 API；缺少的导出或原生操作必须在实现前作为明确的上游决策提出。

仅调用同存储中的 `forkConversation()` 不能证明这些条件成立。不以复制活跃 SQLite 文件、截断原生表、重放展示文本，或在源存储上新建第二个 Harness 的方式补齐缺口。

文件回滚也不属于本次交付。未来方案须区分受跟踪文件恢复与任意 shell／网络副作用，明确捕获时机、跟踪路径、预览、用户编辑冲突、部分失败、重启行为和显式用户操作。Claude 的 `rewindFiles()` 要求启用文件检查点，目前没有被调用；它是候选原生能力，不是跨 harness 保证。不为 Pi/Durable 补建通用文件系统快照作为降级路径。

### 8. 修改清单与交付顺序

| 步骤 | 文件或所有者 | 修改 | 验证 |
|---|---|---|---|
| A | `variants/agent/PlanModeHint.tsx`、`usePlanModeHint.ts`、专属测试、`AgentComposer.tsx`、两个 composer surface 与 locale catalog | 删除草稿提示；保留普通／计划 Shift+Tab 与独立 Quick Panel Plan／Goal 入口 | Composer 消费者测试与未经适配的 Electron Work 启动 |
| B | `AgentSessionMessageBackend.ts`、现有 context／读模型 service 与 Agent 消息操作 adapter | 保持检查点证据一致；提供真实操作可用性 | 生产迁移后的真实 SQLite 与 renderer 操作行为 |
| C | `ClaudeCodeRuntimeDriver.ts`、`claudeContext.ts`、现有 fork helper 和 fork operations | 修正重置边界交接；保留 SDK 身份映射及发布／补偿 | 原生 SDK 契约与 Main fork/edit 失败场景 |
| D | Runtime package／桌面 README、Agent runtime reference 与操作文案 | 记录准确支持范围，区分对话历史与文件状态 | 文档门禁与代表性 Electron 交互 |

A 独立交付，然后完成带受影响消费者的 B/C，最后按实际实现完成 D。下列验收标准全部有证据之前，文档不转为 implemented。Durable 启用与文件回滚属于独立后续工作，不是本次交付中未经验证的最后阶段。

### 9. 本地实现验证（2026-11-09）

本地实现复用现有 driver schema 与消息读模型。`historyActions` 提供可为 null 的 fork/edit 失败原因，不向 renderer 发送原生检查点。草稿提示链路已删除；显式 Quick Panel 控制与普通／计划 Shift+Tab 复用已有原生模式／命令链路。Claude 重置先按当前 head 准备后继 context，再切换 handle，并忽略退休会话的结果。

| 验收标准 | 已记录证据 |
|---|---|
| AC1–AC2 | 修正后的验收单独记录在下方；此前“Shift+Tab 不改变模式”的检查已被取代，不能证明修正后的契约 |
| AC3 | 迁移后 SQLite 读模型测试与 `AgentSessionMessageBackend.test.ts` 覆盖检查点缺失、格式错误、其他 runtime 及持久化失败，并保留完成的回答 |
| AC4 | Pi SDK leaf／压缩与 Claude SDK UUID／不安全元数据契约测试；真实原生 JSONL 核对排除源的后续轮次并保留独立身份 |
| AC5 | Pi、Claude Electron 分叉、非首条编辑、首条编辑及分支导航；落盘编辑文本与原生记录均匹配新输入 |
| AC6 | Runtime service 忙碌／关闭门禁、发布阶段历史变化／写入失败测试、读模型拒绝，以及 Durable 强制编辑 IPC 拒绝 |
| AC7 | 真实临时文件及迁移后 SQLite 发布／恢复测试、准备完成后的分叉取消，以及 worker 退出／取消／超时测试 |
| AC8 | Main 读模型及 renderer 测试；真实 Durable 分叉禁用且显示原因、编辑入口缺失，直接编辑 IPC 返回 `checkpoint_unsupported` |
| AC9 | 真实系统工作区标记按当前状态复制，编辑后保持不变；原生分支发布测试重新打开两份保留历史且不执行模型 |
| AC10 | 发布 fixture 保留源内容，从子副本移除活跃任务事件与批准权限；其 runtime connection 会拒绝任何意外执行 |
| AC11 | 捕获预热 head 的桌面集成，以及两次真实 Electron `/clear` 后继续请求模型；三份不同的 bound 原生 context 与产品锚点保持有效 |
| AC12 | 更新 runtime／fork／driver reference，核对配对 Spec 并执行文档门禁 |

供应商验收使用已有开发环境的 LongCat-2.5 配置，经过三种生产 harness 路径。凭据不进入验证产物。本地日志、截图、落盘结果及原生前缀断言记录在 `.context/cherry-electron-dev/history-operations/`；这些未跟踪证据不代表打包或跨平台验收。

另有一处现有 UI 缺口：Claude `/clear` 的空回执成功落盘，但 Agent 消息 adapter 会渲染通用“No response”错误卡片。本次验证不宣称已修复该卡片。Spec 在发布／审查生命周期完成前保持 proposed；Durable 桌面 fork 与文件回滚仍不属于本次交付。

### 10. 模式入口修正验证（2026-11-09）

修正后的 AC1–AC2 契约已在更新 main 基线后的当前工作区验证。显式选择的九个 renderer 测试文件共 475 项通过，覆盖两种 composer surface、Agent 消费者、Plan／Goal 入口、Quick Panel 行为，以及真实编辑器在命令前缀插入时保留选中文本和文件 chip。共享能力文件的六项测试通过；Pi、Durable connection 消费者的 59 项测试通过，包含已有原生 Goal 命令场景。Web 类型检查、变更文件 Oxfmt／Oxlint／ESLint、翻译与文档检查通过。

在受跟踪 Electron 实例中，Claude Shift+Tab 将保存的模式按 `default → plan → default` 切换，草稿不变。根级 Plan 入口切换同一个原生设置，输入框权限子菜单不含 Plan。Claude 实时 SDK 目录提供 Goal；根级入口在已有草稿开头只插入一次命令，不发送，也不改变权限。Pi、Durable 独立提供 Goal，保留目标，并在显式发送 `/goal` 后返回原生状态。这些状态检查不代表完整的自主 Goal 执行验收。

另一次真实 LongCat-2.5 请求在 Claude Plan 模式下准确返回 `MODE_BOUNDARY_PLAN_OK`，落盘用户输入匹配，助手回答状态为成功。随后通过快捷键将保存模式恢复为 `default`。修正后的截图、日志与结果位于 `.context/cherry-electron-dev/mode-correction/`；此前历史操作验收按上文单独记录范围。

### 11. 历史操作归属修正验证（2026-11-09）

普通消息分页不再接收运行时回调，也不计算操作策略。fork 领域模块在列表投影、编辑准备和执行之间共享静态资格规则。明确指定的六个 Main 测试文件通过 329 项测试；两个 renderer 操作／编辑消费者通过 22 项测试。覆盖页外前置节点、首条输入编辑、父节点缺失、投递输入、会话／ID 范围、Durable 不支持的执行入口、旧历史／损坏／其他运行时检查点的一致拒绝、旧运行时名称的有效类型，以及既有分支发布／版本／关闭／恢复守卫。Node 类型检查、改动文件格式／Oxlint／ESLint 和文档检查通过。

重启后的隔离 Electron 实例通过生产 DataApi 读取已有真实模型历史，核对单条分页与页外父节点对应的操作，准备 Pi/Claude 编辑草稿，并发布原生 Pi/Claude 分叉。强制调用 Durable fork/edit 返回约定的不支持原因；实际消息界面保持历史可读、不显示编辑并禁用 Fork。本轮修正没有发起新的模型请求。证据位于 `.context/cherry-electron-dev/history-policy/`。

另观察到一个独立限制：旧 Claude 历史跨过多次 `/clear` context，分叉其后期边界时，未修改的原生前缀校验器返回 `history_changed`；分叉早期单一 context 内的边界成功。该现象暴露了把整个产品前缀视为单一原生 context 的假设；上文按 context 发布的契约修正该问题，其后续验证单独记录。

### 12. 独立 context 分叉验证（2026-11-09）

AC13 复用既有分叉协调器与资源记录实现。Main 按已持久化的 context 绑定分组保留检查点，每个 adapter 只分叉自身原生历史。发布前准备全部原生产物，产品会话、复制消息和 context 绑定在一次 SQLite 事务中提交。重新校验包含已捕获的原生绑定与分支专属检查点映射。原地编辑只分叉其前置 context，保留较早 context。

明确指定的七个 Main 测试文件通过 329 项测试，`AgentChatContextProvider` 另有 20 项通过；两个 renderer 历史操作／编辑消费者通过 22 项测试。六个新增的真实 Pi SDK／生产迁移用例覆盖独立原生前缀、删除源会话及原生文件后的早期／后期分叉与编辑、再次分叉已编辑的共享前缀、第二个 context 准备失败、并发绑定变化，以及原生发布后绑定插入失败。失败用例不留下部分目标会话或归本操作所有的产物。禁用增量缓存后的 Node 类型检查、改动文件格式／lint 与文档检查通过。

重启后的隔离 Electron 实例成功分叉了此前拒绝的、跨两次 `/clear` 的真实 Claude 历史，得到三个独立原生 context。随后再次分叉副本，通过生产 IPC 永久删除中间源会话，并确认其三份原生 JSONL 文件全部移除。存活副本的早期、后期边界仍可成功分叉。真实 LongCat-2.5 继续请求只使用选中 context；编辑并重发该输入创建新的原生 context，排除被替换的输入，较早两份原生文件逐字节保持不变。随后再次分叉已编辑的多 context 历史成功。选中原生历史不含两个较早 context 的标记，产品历史仍可见。未观察到 renderer 页面异常。

证据保存在 `.context/cherry-electron-dev/context-fork/`，包括 `result.json`、`live-result.json`、`edited-live.png`、日志与脚本。这些检查不代表打包、跨平台或进程强杀验收；上文空 `/clear` 回执的显示缺口仍独立保留。

## 考虑过的替代方案

- 重命名提示 hook 或将提示搬到其他位置。这样只修复导入解析或位置，仍保留关键词推断和草稿到 Agent 的作用范围错配。
- 增加基于模型的规划意图分类器。这样增加延迟、成本与第二个决策所有者，仍不能证明权限意图。
- 截断现有原生对话来模拟 rewind。这样会改写保留历史，并危及压缩、排队工作和旧分支绑定。
- 根据产品消息重建上下文，或新增统一历史／快照服务。产品展示历史不是原生执行状态的权威来源。
- 因为存在子线程 fork 就立即启用 Durable 桌面分叉。子线程归属与同存储继承不能证明产品会话可独立恢复。
- 编辑／重发或分叉时自动恢复文件。选择对话不代表授权覆盖当前工作区文件。

## 验收标准

- AC1 — 规划关键词、否定句和引用文本均不渲染模式建议，也不改变配置。Plan 与原生 Goal 拥有独立 Quick Panel 入口；输入框权限子菜单不含 Plan，Goal 选择只插入原生命令、不发送；已有保存模式不在挂载时重置。 (verification: renderer and Electron — implementation author)
- AC2 — 单独按 Shift+Tab 在延迟加载和已初始化的 composer surface 中均只切换受支持 harness 的普通／计划模式，保留草稿，忽略重复按键、输入法组合输入及带其他修饰键的组合。Goal 保持独立，已打开面板及提示词变量导航优先。 (verification: renderer and Electron — implementation author)
- AC3 — Claude/Pi 成功回复将有证据的原生边界与产品回复一起保存；检查点缺失／无效时保留回答并禁用分叉，不制造边界。 (verification: unit with migrated SQLite — implementation author)
- AC4 — Claude、Pi 分叉只包含所选原生前缀，保留受支持的压缩／替换状态，重映射继承检查点，并保持源历史不变。 (verification: native SDK contract — implementation author)
- AC5 — 编辑非首条输入时保留旧分支，选择带新产品输入和原生身份的兄弟分支；编辑首条输入无需伪造检查点即可成功。 (verification: unit with migrated SQLite and Electron — implementation author)
- AC6 — 忙碌、关闭中、历史变化、检查点缺失／不支持等情况均不发布半完成分支，也不派发重建或重复输入。 (verification: Main fork/edit consumers — implementation author)
- AC7 — 取消、产物写入／发布失败和产品事务失败，只清理已证明属于本操作的资源；重开后保留已提交分支并恢复未完成意图。 (verification: publication and recovery tests with real temporary files and migrated SQLite — implementation author)
- AC8 — Durable 桌面 fork/edit 不可用且给出可行动原因，受支持的 Claude/Pi 边界可用；读取列表不启动原生工作，之后发生的历史缺失仍明确报错。 (verification: renderer and Main read-model consumers — implementation author)
- AC9 — 选择保留分支不发出模型请求，也不回滚文件；分叉复制当前系统工作区文件或复用普通工作区，编辑／重发保留当前文件。 (verification: filesystem integration and Electron — implementation author)
- AC10 — 分叉产品历史不含活跃批准或任务所有权；打开分叉不重放继承执行。 (verification: Main fork/SDK consumers — implementation author)
- AC11 — 真实 Main prewarm/connect 后连续执行 Claude /clear 并继续输入，分支与原生身份保持一致，不发生锚点唯一约束错误或旧观察回写检查点。 (verification: desktop runtime integration and Electron — implementation author)
- AC12 — 配对 reference 记录已交付支持矩阵、文件状态限制及未完成的 Durable／文件回滚门槛；只记录实际执行检查的验收结果。 (verification: docs gate and final evidence review — implementation author and maintainer)
- AC13 — 跨原生重置分叉产品前缀时，为每段保留历史创建独立 context，后续只恢复选中的 context。删除源会话及其原生文件后，早期和后期副本边界仍可正确分叉与编辑。准备失败、绑定变化或发布失败，不留下部分产品会话或归本操作所有的原生产物。 (verification: migrated SQLite/native SDK tests and Electron — implementation author)

## 风险

检查点与 source 映射已存在于真实用户数据中。本次交付不新增 schema，也不改写已发布迁移；保留历史证据，对不支持的历史明确报错，不静默替换。

列表时可用不能保证执行时原生文件仍存在。操作须保留有类型的失败与 Main 复核，避免逐消息进行昂贵原生读取或增加平行能力缓存。

原生压缩／内容替换行为随固定 SDK 版本而不同。拒绝不支持的分叉，优于产生看似可恢复却含不同历史的上下文。依赖补丁须有独立维护者决策和更新后的契约证据。

重置交接涉及异步观察与持久化。需要验证旧 source 隔离，以及发布前后失败，不能依赖单次成功 clear。

文档和单元测试不能证明原生进程强杀恢复、打包行为、真实模型验收或文件恢复。这些证据类别须分别记录；未实施的后续方案不标为已交付。
