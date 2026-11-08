# Agent Note: Agent 历史操作与 Plan Mode 提示移除

Status: proposed

[English](2026-11-08-agent-history-operation-boundaries.md) | 中文

## 问题

当前草稿中出现规划相关词语时会显示 Plan Mode 提示，并临时改变 Shift+Tab 的处理。接受提示会持久化整个 Agent 的权限模式，尽管提示围绕单条草稿出现。现有权限模式菜单已经提供显式选择。用户已选择移除这条根据草稿触发的建议。

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

### 2. 移除草稿驱动的 Plan Mode 链路

删除提示组件、关键词匹配器、每草稿状态及专属测试。从 `AgentComposer.tsx` 删除相应导入、接受／关闭／重置接线和 JSX。删除两个 composer surface 专为提示增加的 `onShiftTab` 属性、ref 和转发，保留其既有提示词变量导航和编辑器键盘处理。

删除全部 `agent.input.plan_hint.*` locale key。保留权限模式菜单、支持模式过滤、原生 Plan Mode、已有保存配置，以及仍被推理／service-tier 设置使用的共享 `useUpdateAgent` 消费者。不将已有 Agent 重置为默认模式。不增加替代关键词检测器、模型分类器、通知或引导横幅。

基线已将 hook 重命名为 `usePlanModeHint.ts`，解决了大小写不敏感文件系统上的模块冲突。本次交付移除用户已否定的剩余产品行为。

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
| A | `variants/agent/PlanModeHint.tsx`、`usePlanModeHint.ts`、专属测试、`AgentComposer.tsx`、两个 composer surface 与 locale catalog | 删除完整提示链路及其单消费者键盘 API | Composer 消费者测试与未经适配的 Electron Work 启动 |
| B | `AgentSessionMessageBackend.ts`、现有 context／读模型 service 与 Agent 消息操作 adapter | 保持检查点证据一致；提供真实操作可用性 | 生产迁移后的真实 SQLite 与 renderer 操作行为 |
| C | `ClaudeCodeRuntimeDriver.ts`、`claudeContext.ts`、现有 fork helper 和 fork operations | 修正重置边界交接；保留 SDK 身份映射及发布／补偿 | 原生 SDK 契约与 Main fork/edit 失败场景 |
| D | Runtime package／桌面 README、Agent runtime reference 与操作文案 | 记录准确支持范围，区分对话历史与文件状态 | 文档门禁与代表性 Electron 交互 |

A 独立交付，然后完成带受影响消费者的 B/C，最后按实际实现完成 D。下列验收标准全部有证据之前，文档不转为 implemented。Durable 启用与文件回滚属于独立后续工作，不是本次交付中未经验证的最后阶段。

### 9. 本地实现验证（2026-11-09）

本地实现复用现有 driver schema 与消息读模型。`historyActions` 提供可为 null 的 fork/edit 失败原因，不向 renderer 发送原生检查点。草稿提示链路及专属键盘 API 已删除。Claude 重置先按当前 head 准备后继 context，再切换 handle，并忽略退休会话的结果。

| 验收标准 | 已记录证据 |
|---|---|
| AC1–AC2 | Composer 消费者测试；真实 Electron 草稿输入／Shift+Tab 不改变已保存模式，显式 Plan/default 选择保留草稿 |
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

## 考虑过的替代方案

- 重命名提示 hook 或将提示搬到其他位置。这样只修复导入解析或位置，仍保留关键词推断和草稿到 Agent 的作用范围错配。
- 增加基于模型的规划意图分类器。这样增加延迟、成本与第二个决策所有者，仍不能证明权限意图。
- 截断现有原生对话来模拟 rewind。这样会改写保留历史，并危及压缩、排队工作和旧分支绑定。
- 根据产品消息重建上下文，或新增统一历史／快照服务。产品展示历史不是原生执行状态的权威来源。
- 因为存在子线程 fork 就立即启用 Durable 桌面分叉。子线程归属与同存储继承不能证明产品会话可独立恢复。
- 编辑／重发或分叉时自动恢复文件。选择对话不代表授权覆盖当前工作区文件。

## 验收标准

- AC1 — 规划关键词、否定句和引用文本均不渲染 Plan Mode 建议，也不改变 Agent 配置；显式模式选择仍可用，已保存模式保持不变。 (verification: renderer and Electron — implementation author)
- AC2 — Shift+Tab 在延迟加载和已初始化的 composer surface 中均保留原有提示词变量／编辑器行为，不随草稿内容改变。 (verification: renderer and Electron — implementation author)
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

## 风险

检查点与 source 映射已存在于真实用户数据中。本次交付不新增 schema，也不改写已发布迁移；保留历史证据，对不支持的历史明确报错，不静默替换。

列表时可用不能保证执行时原生文件仍存在。操作须保留有类型的失败与 Main 复核，避免逐消息进行昂贵原生读取或增加平行能力缓存。

原生压缩／内容替换行为随固定 SDK 版本而不同。拒绝不支持的分叉，优于产生看似可恢复却含不同历史的上下文。依赖补丁须有独立维护者决策和更新后的契约证据。

重置交接涉及异步观察与持久化。需要验证旧 source 隔离，以及发布前后失败，不能依赖单次成功 clear。

文档和单元测试不能证明原生进程强杀恢复、打包行为、真实模型验收或文件恢复。这些证据类别须分别记录；未实施的后续方案不标为已交付。
