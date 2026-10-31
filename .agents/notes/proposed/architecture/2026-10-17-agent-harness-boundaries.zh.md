# Agent Note: Harness 所有权与 Runtime 包边界

Status: proposed

[English](2026-10-17-agent-harness-boundaries.md) | 中文

## Problem

Cherry 需要以统一方式访问不同智能体 harness，同时保留各自的执行所有权。把产品会话、原生上下文、当前运行和渲染流合并成一个对象，会让后台输出依附父消息，并为输入队列、历史、取消和结果交付制造相互竞争的所有者。

本文接替 Runtime 栈中的 harness 定义文档。三个包已有代码，但桌面接入、产品会话的存储关联和 Lane 投影仍待完成。本文保留 proposed，因为包实现并不等于这些接入及其验收已经完成。

本文的实现事实以累计 Runtime 栈 `bd6509eb5f71a9c6bbb57453f0a7ced25e92c766` 的检查结果为依据。由上层提供的行为在本层仍属于目标，不表示这些功能已存在于本层。源码链接指向该固定快照，尚未引入的文档链接到其所属 PR。

[SDK 内容协议方案](../simplification/2026-10-29-agent-runtime-content-protocol.md)调整了内容依赖边界：允许依赖标准 AI SDK 消息协议，同时不向公共包引入原生 SDK 或 Cherry 产品类型。这取代之前一律排除 AI SDK 的约束；执行和原生存储的所有权仍属于 harness。


## Proposal

### 按行为定义 harness

智能体 harness 是组织智能体执行的系统：接纳输入、管理上下文、协调模型、工具与外部交互、推进工作，并暴露可观察事实和支持的控制。它可以是嵌入式库、服务或 CLI 背后的执行系统。进程形态、传输协议和持久化都不是定义前提。

| 行为 | 所有权 | 必须区分的事实 |
| --- | --- | --- |
| 接纳与安排输入 | 对用户输入、干预、工具结果和通知应用原生规则。 | 接纳、排队、进入上下文、模型消费与完成。 |
| 管理上下文 | 为模型组织指令、历史、工具及压缩后的内容。 | 展示历史与模型实际上下文。 |
| 推进执行 | 协调模型调用、工具反馈、等待及后续调用。 | 工具失败、执行结束与用户目标完成。 |
| 管理相关工作 | 在支持时定义父子工作、等待、取消传播及结果交付。 | 可复用的子上下文、一次委派与一次运行。 |
| 接受控制 | 校验目标并报告原生效果。 | 请求已收到与效果已完成。 |
| 暴露与恢复事实 | 在原生支持时提供观察、查询与恢复路径。 | 重新连接、重新打开上下文与恢复执行。 |

子智能体、后台工作、审批、持久恢复和精确运行控制都是可选原生能力。适配器不能从输出文本中补造这些能力，也不能把不支持的操作静默改投其他目标。

### 每类事实只设一个所有者

| 概念 | 含义与所有者 |
| --- | --- |
| 智能体配置 | 角色、指令、模型、工具和策略；不是某次执行实例。 |
| Harness | 原生上下文，以及已接纳工作的安排与执行的所有者。 |
| `AgentRuntime` | 宿主访问一个已配置 harness 的公共入口，由适配器实现。不再设置同义的 `Backend` 接口；`backendId` 仍用于标识命名空间。 |
| 适配器 | 解析原生身份、映射可观察事实、管理接入资源，不运行竞争的调度器。 |
| 宿主 | 拥有 Cherry 入口、授权、投递记录、资源政策、投影和展示。 |
| 产品会话 | Cherry 的标题、归档和导航对象；与原生上下文显式关联，不强制一对一。 |
| `Thread` | Backend 内的原生上下文身份。是否保存、能否重新打开，取决于 harness 和存储配置。 |
| `ThreadHandle` / `Observation` | 本地访问和订阅，不拥有原生上下文的业务生命周期。 |
| Input / Item | 一次逻辑输入与可独立更新的内容；两者不要求一一对应。 |
| Execution / Interaction | 有证据的工作边界与外部请求；当前公共 API 不将它们暴露为公共对象。 |

宿主提供模型实现、工具、存储设施或审批 UI，不会转移执行所有权。每类重试策略、队列和结果交付路径都需要唯一决策者。宿主拥有期望配置；执行端确认实际采用的配置及生效时点。工具结果、提交回执和 UI 状态都只能证明自身范围内的事实。

公共包不负责 CLI 安装、登录或业务表，也不承诺跨 harness 无损迁移。在真实公共消费者证明语义一致之前，模型、工具、存储和扩展接入保留在各适配器的强类型配置中。

### 分开子输出观察与 Lane 投影

子智能体流式输出属于 harness 可观察性。Lane 是拟议的宿主投影，按来源组织内容、历史关联与订阅；它既不调度执行，也不是面板或连接的同义词。

```text
Native harness facts -> adapter normalization -> host Lane/history projection -> UI
```

子上下文、委派、已知的原生运行、触发工具、内容 Item 和展示位置具有不同身份。父工具卡片可以引用 child Lane，但不是 child 的永久身份。前台工作转为后台不改变子来源；父消息结束不能终止仍在运行的 child 观察。

流式累积跟随内容身份，不跟随组件挂载或父轮切换。保存展示 parts 不会保存流解析器状态；重连需要快照衔接和明确的缺口。仅把现有 background flow 改名为 Lane，不能消除它对父消息的依赖。宿主投影可以由主进程或独立服务保存并跨越窗口生命周期；新的公共包没有实现该服务。

观察输出与向父模型交付结果是不同路径。Harness 已负责交付时，宿主不能因观察到完成再注入一份结果。对于宿主创建的跨 harness 委派，明确的编排所有者管理关系和结果交接，各 harness 负责自身执行。产品会话间的消息投递本身不能建立这种所有权。[子智能体控制方案](https://github.com/CherryHQ/cherry-studio/pull/21578) 负责记录后续可选输入与委派控制。

### 分开原生存储与产品存储

| 内容 | 语义所有者与保存责任 |
| --- | --- |
| 原生上下文、队列和 checkpoint | Harness 定义内容与提交边界；宿主可以提供存储设施。 |
| 公共与原生身份映射 | 适配器负责解释。跨重启所需的映射必须有指定存储，不能仅存在内存。 |
| 产品会话、逻辑输入、传输尝试和回执 | 宿主记录交接证据，保留未知状态，不能把未知结果标成未执行。 |
| 可读历史、Lane 与多窗口投影 | 宿主维护。原生历史无法再次读取时，观察归档不是可随意丢弃的缓存。 |
| 附件和产物 | 明确所有者与保留期限；随进程结束失效的路径不构成持久保存。 |

原生历史与展示历史可以同时存储，前提是职责明确。问题在于两个权威写入者相互重建同一原生事实。删除展示历史不等于删除原生上下文；归一化的可读内容也不承诺无损恢复任意 harness 状态。

当前 Pi 使用原生 `SessionManager` 管理文件和分支，未提供 manager 时默认使用内存。Pi Durable 拥有原生存储与任务恢复。Cherry 选择存储位置并记录产品关联；未来的 `DbService` 关联表不替代任何一种原生格式。当前栈尚未迁移桌面产品会话表，也未实现 Lane 持久化。

### 保持三个包的依赖方向

| 位置 | 当前职责 |
| --- | --- |
| [agent-runtime](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/README.md) | 公共契约、不透明 ID 和 `ThreadFeed` 观察交付；不含执行循环、SDK、Electron、AI SDK 或产品实体。 |
| [agent-runtime-pi](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/README.md) | Pi coding-agent 接入及自有的 Pi goal、工具和子智能体扩展，使用原生会话与存储。 |
| [agent-runtime-pi-durable](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/README.md) | 独立接入 Pi Durable 的 `Harness`、conversation/task API、调度器与存储。 |
| [Cherry 模型桥](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/README.md) | 宿主选择模型，将原生 Pi provider 注册到内部网关。Pi 保留协议流、重放和工具循环；Cherry 保留凭证管理与 provider 调用计费。 |

Pi Durable 是独立执行系统，不是 coding-agent 的持久化开关。两个适配器依赖公共包，互不依赖。Pi session 决定请求重试；原生 HTTP 客户端和内部网关不叠加重试，网关不执行 Pi 的工具。原生压缩、验证器上下文和 child 续接使用原生消息与 manager，不从公共展示 Item 重建。

桌面服务仍使用既有 Runtime 路径。[Runtime 契约](2026-10-17-agent-runtime-contract.md) 记录已实现的访问协议及其限制；[Harness 证据文档](../testing/2026-10-17-agent-harness-evidence.md) 区分五类原生样本、历史探针、源码覆盖与剩余验收。[Goal 文档](https://github.com/CherryHQ/cherry-studio/pull/21607) 和[后台子智能体文档](https://github.com/CherryHQ/cherry-studio/pull/21693) 分别维护 Pi 专用决策。

### 通过内部网关使用原生 Pi provider

本次获准删除宿主 `ModelCallPort`、自定义 AI SDK 流协议、元数据编码及绑定强制的 session 设置。宿主向已有内部网关注册原生 Pi provider。网关执行层拥有 provider 凭证和计费，原生 session 事件提供展示用量；本次不重构网关内部管线。通过 HTTP 集成测试保留工具所有权、原生历史、压缩、停止及重试行为，并在桌面接入所属栈层验证实际接入。

## Alternatives considered

- 让公共 Runtime 成为第二套会话引擎：不采用，因为重建原生队列、重试、历史和恢复会制造竞争的执行所有者。
- 让每个产品会话或父工具消息成为原生上下文身份：不采用，因为多个原生上下文、保留的 child 与后台输出具有独立生命周期。
- 提前统一所有工具、存储格式和原生能力：不采用，因为方法同名不代表语义相同；强类型适配器保留这些差异。
- 让同一份 transcript 同时充当 UI 归档和原生恢复格式：不采用，因为展示数据缺少原生上下文与执行状态，而某些原生历史又无法重新读取。

## Acceptance criteria

已有包边界是源码证据，不代表剩余宿主接入完成。以下标准定义该接入必须保持的行为。

- AC1 — 公共包保持独立于原生 SDK、Electron 和产品实体；允许方案提出的标准 AI SDK 内容依赖，适配器之间互不依赖。 (verification: unit — 包类型检查与依赖边界检查)
- AC2 — 释放窗口访问不会停止其他观察者或保留的 child；父消息结束后仍可定位 child 输出。 (verification: Electron — 宿主投影与多窗口集成)
- AC3 — 重新打开原生上下文使用原生存储和显式产品关联，不从展示历史重建，也不把存储缺失当作新建上下文。 (verification: unit — 适配器存储与宿主关联测试)
- AC4 — 原生委派与宿主委派各有唯一的结果交付所有者，观察到完成不会引发重复交付。 (verification: unit — 适配器与宿主编排测试)
- AC5 — 接入文档区分包源码覆盖、原生恢复保证和真实桌面验收。 (verification: docs gate — Runtime 文档与模块 README)

## Risks

即使访问契约很薄，适配器遗漏作用范围时仍会隐藏原生副作用。Durable 调度器启动、Pi preflight 取消限制、内容身份重置和不可用的 child 输入，都需要明确的行为说明。原生格式和归一化归档可能同时占用存储，但未考虑恢复或展示所有者就删除其中一份，可能造成数据丢失。拟议的宿主投影与关联模型仍需实际接入验收，才能把这些文档转为 implemented。
