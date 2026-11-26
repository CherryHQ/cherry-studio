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

桌面 ACP 的聊天和管理共用 stdio 进程契约。CodeBuddy 在自己的包中声明 npm 发行渠道。Antigravity 安装复查使用与聊天相同的适配器选择，在独立适配器缺失时使用原生 ACP。Claude 把探测到的组件绑定到 SDK 启动，由 SDK 管理启动和关闭。

Amp 声明两个安装组件，Kiro 和 Vibe 各自提供安装配方。原生账号探测同时声明命令、输出解析和退出策略。Main 执行命令并转发登录提示。每次本机启动只读取一次所需配置文件。Harness 包解释配置，Main 验证路由并签发会话范围的网关凭据。

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
- AC16 — CodeBuddy 和 Claude 的安装与启动使用各自包中的声明。Antigravity 的发现与启动都选中原生 ACP 时，仅安装其 CLI 即可。ACP 管理和聊天在退出时均等待所属进程回收。(verification: unit and Electron)
- AC17 — Amp、Kiro 和 Vibe 通过包声明保留原生组件和安装行为。CLI 账号探测按各 harness 声明的格式解释成功和未登录退出。(verification: unit)
- AC18 — 启动期间修改原生配置时，启动与网关归账对同一文件使用同一次读取结果。(verification: unit)

## Risks

ACP 会话 ID 可以与 Pi 会话文件不同，确认身份前保留旧恢复入口。本机接手请求不能证明原生已经放置输入。配置改变和断线可能使旧控件失效。
