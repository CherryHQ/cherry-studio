# Agent Note: 桌面 Agent 的运行能力

Status: proposed

[English](2026-11-26-desktop-agent-runtime-capabilities.md) | 中文

## Problem

输入框按 Agent 类型决定是否交给持久队列，桌面连接又独立判断能否接手。公共提交接口允许传入当前原生访问无法执行的忙时策略。CLI 已安装、握手成功与当前线程可写表达不同的事实。

## Proposal

每个输入操作绑定到实际能执行它的访问，保留输入 ID 和原生接纳结果。只读访问省略提交入口。插话说明空闲时的行为，原生后续输入说明能否在重启后恢复。交付结果未知时保留原目标。Main 负责派发。Pi Durable 持久化已接纳的后续输入；缺少原生持久排队能力时，草稿留在输入框现有待发队列。跨 harness 契约由[公共 runtime 包](../../../../packages/agent-runtime/README.md)持有。

本机 Agent 的发现、安装与启动从桌面目录读取同一份 CLI 组件声明。Pi CLI 的安装标识与恢复已有会话所用的协议彼此独立。Main 负责选择二进制、执行跨平台进程操作、终端登录、宿主权限与产品归账。Codex 适配器拥有其启动的 App Server 与 RPC 连接的生命周期。本机 Pi 通过随应用分发的 ACP 桥运行，内建 Pi 走 SDK，Claude 走 Claude 包，普通 ACP 走[现有适配器](../../../../packages/agent-runtime-acp/README.md)。保留显式 ACP 命令和 Codex App Server 路由。实时 part 与能力变化只读取相关来源。切换旧会话恢复路径前必须确认原生历史身份。

有专有行为的 ACP harness 由独立的 `agent-runtime-<harness>-acp` 包负责。包向设置页暴露可在浏览器中加载的 CLI 声明，按需实现原生安装配方、启动策略、模型配置和协议扩展。Main 注册适配器，提供进程、文件系统、审批和网关服务。公共 ACP 包为已注册的 harness 和自定义命令协商协议，并按原生会话分发增量。随应用分发的 Cursor SDK 管理登录、模型目录和会话，在选定工作区运行标准工具，并执行原生工具权限策略。Cherry 请求启用 Cursor Auto-review，按需提供浏览器 MCP 租约，并使用 SDK 的 agent ID 恢复会话。

CLI 包声明可执行文件和发行渠道。公共 CLI 契约携带宿主解析出的组件标识与路径。发现、安装复查与启动使用同一套组件选择。Codex 负责构造 stdio 启动命令、绑定 RPC 传输，并在探测或会话结束后关闭所持有的进程。探测只初始化连接或读取模型目录。显式指定的 wrapper 仍可提供完整命令。

桌面 ACP 的聊天和管理共用 stdio 进程契约。CodeBuddy 在自己的包中声明 npm 发行渠道。Antigravity 发现并安装官方 CLI，聊天和管理都运行 `agy acp`。Claude 把探测到的组件绑定到 SDK 启动，由 SDK 管理启动和关闭。

Amp 声明两个安装组件，Kiro 和 Vibe 各自提供安装配方。原生账号探测同时声明命令、输出解析和退出策略。Main 执行命令并转发登录提示。每次本机启动只读取一次所需配置文件。Harness 包解释配置，Main 验证路由并签发会话范围的网关凭据。

在官方 [Amp TypeScript SDK](https://ampcode.com/docs/sdk/typescript) 能使用宿主选中的 CLI 并在取消后等待子进程退出时，将 Amp 默认聊天迁到该 SDK。新的 SDK 会话使用原生 Amp thread ID。已有 ACP 会话仍可恢复，显式 ACP 命令仍可执行。终端、登录和额度读取继续使用选中的原生 CLI。SDK 入口保留图片输入及默认路径已提供的插话能力。

产品策略使用 Agent 权限模式。Runtime 可以通过连接报告会话当前生效的模式。调度器依据该模式和 Agent 的配置决策。原生控件适配层负责把选项名称和预设映射成 Agent 语义。原生快捷键和设置菜单使用同一套完全访问判定。

Runtime 声明模式选项在当前会话、下一轮或重连后生效。Main 在 runtime 能确认时读取已应用的模式。Composer 使用同一份选项语义。未映射的 ACP 选项继续作为原生控件展示。选项名称可以触发确认，宿主授权仍须有对应的权限依据。

未连接的会话展示选定 runtime 声明的权限控件。连接后使用当前原生控件。Effort 档位来自当前模型或明确声明的原生会话选项。绑定到模型的修改携带模型身份，由接收方复验。

Main 的本机连接检查、模型查询与会话打开共用一张表，派发到 ACP、Cursor、Codex 或 Claude 适配器。适配器实现这三项操作。保存的预设配置通过预设 ID 标识 runtime，从预设声明取得协议。自定义命令使用 ACP。CLI 发现与安装使用桌面 Code CLI 服务。MCP 租约由桌面的 MCP bridge 持有。

CLI 启动准备从进程环境使用的同一份配置快照解析 Gateway 路由。能够注入会话凭据的 runtime 提供已解析路由和注入操作。Gateway 校验路由后签发限定范围的凭据。只使用公共密钥的请求保留 provider 用量，归属会话为空。

ACP 适配器可以声明在启动时应用 Cherry 模型。Agent Services 把选中的 Cherry 模型保存在 Agent 中。Main 解析端点和模型地址，并向所属 runtime 提供限定范围的凭据。清除选项后恢复原生选模。多个会话共用进程的托管服务可以使用共用的 provider 配置。只有原生请求携带对应会话凭据时，用量才归该会话。

ACP 会话未连接时，打开下拉会读取已安装运行时的目录，会话等到启动时再连接。此时选中的原生模型，以及已接入的网关模型，沿用现有的 Agent 启动配置。已连接的 ACP 会话使用自身目录和会话操作切换原生模型。

Harness 适配器解释原生审批请求和选项。公共 ACP 包转换标准选项类型。Main 管理待处理审批、取消以及 Cherry 发放的会话授权。选中回执使用原生请求提供的选项 ID。

Composer 权限菜单使用已验证的独立 ACP 审批控制或具有多个已验证审批选项的原生权限目录。Harness 单独公布工作模式时，仅规划命令和 Shift+Tab 可在已验证的原生 Plan 与默认工作模式之间切换。新增原生支持时，已保存的 Cherry 宿主审批选择保留 CLI 报告的原生档位。其余 ACP 会话为 Cherry 的交互审批提供操作前询问、自动接受编辑和完全访问。Cherry 完全访问会选择原生请求提供的单次允许选项，并直接批准由宿主代跑的文件写入和终端操作。原生限制、只读模式、结构化提问和无人值守执行各自沿用原有策略。Cherry 按会话记住选择，生效时无需修改 CLI 配置。

权限菜单包含独立的原生沙箱选项。Plan 继续使用规划快捷入口。其余本机会话选项和执行工作流归入现有会话菜单，模型默认参数归入 Agent 服务。输入框取消独立的配置按钮。原生目录用同一个 ACP 类别表示审批与工作流时，由运行时声明用途。

Runtime 分别报告原生接纳和实际放入的位置。只有明确未接纳才释放绑定，允许调度器重新排队。Composer 持有未提交草稿，由当前连接决定是否直接提交持久后续输入。主动压缩是空闲线程的独立操作，匹配的原生终态解除占用并刷新上下文读数。

Pi Durable、内建 Pi、Claude 和 Codex 的既有原生能力走同一组桌面输入和压缩入口。Codex Stop 可撤回尚未派发的输入。派发后缺少原生回声时，送达状态保持未知，保留原绑定。

本机安装通过发行与组件声明解析目标，无需打开运行时。各 runtime 包拥有登录方法和凭据选择。Main 把原生登录提示交给发起窗口并负责取消。可选的订阅查询绑定到已保存运行设置实际使用的账号，使用短命管理连接。配置和登录代次仍匹配时才发布额度窗口。

## Alternatives considered

统一布尔表无法表达只读子任务、重启即丢的队列或随模型变化的可写选项。为本机 Pi 再维护一个桌面客户端会重复实现流式传输、取消与会话恢复。以后引入原生路由时，需要指出值得单独维护的产品操作或实测收益。

## Acceptance criteria

- AC1 — 普通 ACP、Pi 托管子线程和 Durable 根线程只暴露实际支持的输入操作及保证。(verification: unit)
- AC2 — 回执丢失或连接失效不会导致再次把输入交给其他原生线程。(verification: unit)
- AC3 — 输入框按当前连接直接提交持久后续输入，无法直接提交时使用草稿队列。(verification: renderer)
- AC4 — Pi 与 Amp 的安装、版本、登录和聊天各自使用相应用途的真实组件。(verification: unit)
- AC5 — 真实桌面 ACP 连接按宿主权限完成首发、工具审批、取消和进程回收。(verification: Electron)
- AC6 — 探测和关闭一个观察者保留活跃 owner，重放不重复写消息或计费。(verification: Electron)
- AC7 — 两万条历史中追加一个原生 part 或改变一个输入能力，从生产端到 Renderer 均不访问旧历史。(verification: Electron)
- AC8 — 打开旧本机上下文会恢复原历史或报告失败，不新建替代线程。(verification: unit)
- AC9 — 本机 Pi 和 Claude 使用选定的安装、设置和历史，显式 ACP 覆盖保留原语义。(verification: Electron)
- AC10 — 选项、资源目录、指定边界的历史操作、用量与子任务控制分别依赖其 owner 的证据。(verification: unit)
- AC11 — 厂商扩展只执行协商并实现的操作，分别处理交付未知和明确未接纳。(verification: unit)
- AC12 — 清理冗余 reader 与组件声明后，打包产物的管理、启动与恢复入口正常工作。(verification: packaged artifact)
- AC13 — Cursor 无需 CLI 即可在选定工作区创建会话，并按 SDK 的 agent ID 恢复会话。两条路径均可使用所选模型的标准工具集。聊天按原始调用 ID 展示工具调用和原生权限错误。（验证：单元测试和 Electron）
- AC14 — OpenClaw 通过自己的适配器恢复会话并过滤桥接器标题。自定义 ACP 命令经过同一桌面连接入口，使用协商出的恢复方式并保留原生标题。设置页与聊天读取同一份 CLI 声明。(verification: unit)
- AC15 — Codex 安装与启动使用同一个 CLI 组件标识。连接检查和模型探测不打开原生线程，正常关闭、启动失败和取消均等待所属 App Server 进程回收。(verification: unit and Electron)
- AC16 — CodeBuddy 和 Claude 的安装与启动使用各自包中的声明。Antigravity 的发现和安装复查选中 `agy`，聊天和管理以 `acp` 参数启动该程序。ACP 管理和聊天在退出时均等待所属进程回收。(verification: unit and Electron)
- AC17 — Amp、Kiro 和 Vibe 通过包声明保留原生组件和安装行为。CLI 账号探测按各 harness 声明的格式解释成功和未登录退出。(verification: unit)
- AC18 — 启动期间修改原生配置时，启动与网关归账对同一文件使用同一次读取结果。(verification: unit)
- AC19 — 即使 Agent 保存的模式允许输入建议，连接当前生效的 Plan 模式仍阻止生成建议。映射到完全访问的原生选项需要确认，Plan 快捷键不能选中它。(verification: unit and renderer)
- AC20 — Antigravity 问题返回 agent 提供的选项 ID。答案有歧义时取消请求。审批界面展示 Antigravity 警告，并将原生始终允许选项标记为会话授权。(verification: unit and Electron)
- AC21 — Goose 的 `auto` 需要确认，Claude 的 `auto` 仍由审查机制处理。未经验证的 ACP `yolo` 选项无法授权宿主写文件或执行终端操作。修改 DeepSeek Harness 模式会关闭空闲连接，并在下次启动时生效。(verification: unit and renderer)
- AC22 — Codex、Cursor 和 Claude 分别通过自己的 Main 适配器启动、查询模型和恢复原生会话。它们的会话路径不导入桌面 ACP 注册表或 ACP 附件编码器。(verification: import boundaries and Electron)
- AC23 — 使用同一个网关模型的两个 CLI 会话分别取得自己的凭据，请求归到凭据对应的会话。只有公共密钥的请求不会归到任一会话。启动准备在绑定凭据时不重复读取配置文件。(verification: unit and Electron)
- AC24 — 同一预设的检查、模型查询与会话打开选择同一个 Main 适配器。保存的配置包含预设 ID。自定义可执行文件选择 ACP。新增协议时必须为 Main 派发表提供三项操作。(verification: schema and typecheck)
- AC25 — 读取冷会话控件不会打开原生会话。连接关闭时 Composer 撤下该连接的实时控件。切换模型后撤下旧模型档位，并拒绝写入旧模型。ACP 保留原生公布的档位，包括 Pi ACP 的旧版思考模式和 Grok 的旧版模型元数据。Cursor 从 SDK 模型目录读取档位，在下一次发送时应用所选值。(verification: unit and Electron)
- AC26 — 设置页从所选安装读取目录，普通 ACP 原生模型作为 Agent 的启动偏好保存。Composer 使用当前 ACP 会话公布的候选并调用该会话绑定的操作。标准配置回包或通知确认当前模型和 effort，旧版选模使用原生回执。未登录、空目录、只有当前模型与写入方法不可用分别展示。标准目录探测在读完选项后关闭。Grok 在可用时直接读取模型目录。桌面连接和 ThreadHandle 复用原生控件实现。同一会话只允许一笔控件写入在途，迟到回包不能覆盖已收到的新配置通知。(verification: unit and Electron)
- AC27 — 上下文读数使用原生端报告的占用量或最近一次模型请求。Cursor 把整轮累计 token 留在用量记录。窗口取自原生 runtime 或已绑定的 Cherry 目录模型。窗口未知时显示 token 数，省略百分比。(verification: unit and Electron)
- AC28 — 原生插话的回执、归属和拒绝沿用同一 input ID。缺失或不明确的结果不会触发回退。原生后续轮和上一条 prompt 回包同批到达时，正文和终态仍归原生后续轮。桌面和原生回放共用同一个 ACP 会话 owner。恢复前绑定原生 ID，桌面接收启动元数据与已归属的新 turn，时间线继续增量写入。会话 owner 负责原生关闭及等待进程退出。 (verification: unit and Electron)
- AC29 — 主动压缩占用线程直到原生操作结算或来源终止。只有匹配的完成证据才刷新上下文读数。(verification: unit and Electron)

- AC30 — 安装代码无法导入会话适配器。登录提示和取消归发起窗口。启动失败或截止后，先关闭所属进程再返回。(verification: lint, unit and Electron)
- AC31 — Codex 与 Claude 无需执行一轮或扫描历史即可读取订阅窗口。同一已保存目标的并发查询共用在途结果。账号或配置改变后丢弃旧结果。Cherry 网关路由不继承 harness 账号的额度。厂商 Key 可以读取其实际认证的订阅额度。(verification: unit and Electron)

- AC32 — 新增的订阅读取器使用原生额度来源及启动所选的账号。组件、协议版本、账号存储或路由不受支持时返回明确结果，且不发送模型输入。无上限的预付余额显示币种和金额。(verification: unit and Electron)

- AC33 — 新建的默认 Amp 聊天使用官方 SDK，与登录和额度读取使用同一个 CLI 和账号。文本、图片及已支持的插话到达对应线程，SDK 会话按 Amp thread ID 恢复，取消后等待子进程退出。已有 ACP 会话及显式 ACP 命令仍可用。(verification: unit, Electron and packaged artifact)
- AC34 — 目录项选择声明的发行版和地区。每个可用登录流程在同一 runtime 完成并刷新账号状态。仅需供应商凭据的配置不提供 harness 账号登录。需要认证的前置状态显示为登录操作。(verification: unit and Electron)

- AC35 — 缺少已验证原生审批控制或多个已验证审批选项的 ACP 会话，在首轮开始前或连接已建立后，都可以用与内置 Agent 相同的权限菜单调整 Cherry 的模式。独立的仅规划命令和 Shift+Tab 可在 OpenCode 的 Plan 与 Build 之间切换。已验证的独立审批控制可以单独切换原生审批。独立工作流不会隐藏已验证的审批选项。保留语义不同的原生审批选项。排除会持久化 CLI 配置的 ACP setter。切换模式时保留 CLI 配置。已验证的启动型跳过审批仅作用于选中的桌面会话，并经新的 ACP 进程生效。进入仅规划时先移除启动覆盖，再恢复会话。Cherry 完全访问只发送原生提供的单次允许选项。切回操作前询问后恢复交互式审批，无人值守时继续拒绝请求。输入框在权限菜单显示原生审批，在会话菜单显示其余会话选项。ACP 对审批和执行工作流使用同一类别时，仍能独立选择执行工作流。模型默认参数归入设置。(verification: unit, renderer and Electron)
- AC36 — Agent Services 可以为 DeepAgents、Antigravity 和 Command Code 保存和清除 Cherry 模型。已启用的适配器使用选中的模型和发起会话的限定凭据，向内部网关发送原生 ACP 对话轮次。(verification: unit, renderer and Electron)
- AC37 — OpenClaw 可以通过托管配置使用 Cherry 网关模型。并发会话使用一致的模型路由，只有通过凭据验证的用量才会归到具体会话。(verification: unit and Electron)
- AC38 — Junie、DimAgent、Muse Code、Auggie、TRAE CN、Qoder 和 Qoder CN 在验证原生 ACP 能用注入的凭据向选定本机端点发送对话轮次后，提供 Cherry 模型选项。(verification: native ACP and Electron)
- AC39 — ACP 会话连接前打开模型下拉会加载已安装运行时的原生目录，已接入的适配器同时提供网关模型。已连接时，原生模型仍通过会话操作切换。(verification: renderer and Electron)

## Risks

ACP 会话 ID 可以与 Pi 会话文件不同，确认身份前保留旧恢复入口。本机接手请求不能证明原生已经放置输入。配置改变和断线可能使旧控件失效。
