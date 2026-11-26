# Agent Note: 桌面 Agent 的运行能力

Status: proposed

[English](2026-11-26-desktop-agent-runtime-capabilities.md) | 中文

## Problem

输入框按 Agent 类型决定是否交给持久队列，桌面连接又独立判断能否接手。公共提交接口允许传入当前原生访问无法执行的忙时策略。CLI 已安装、握手成功与当前线程可写表达不同的事实。

## Proposal

每个输入操作绑定到实际能执行它的访问，保留输入 ID 和原生接纳结果。只读访问省略提交入口。插话说明空闲时的行为，原生后续输入说明能否在重启后恢复。交付结果未知时保留原目标。Main 负责派发。Pi Durable 持久化已接纳的后续输入；缺少原生持久排队能力时，草稿留在输入框现有待发队列。跨 harness 契约由[公共 runtime 包](../../../../packages/agent-runtime/README.md)持有。

本机 Agent 的发现、安装和启动共用现有 shared 预设中的组件声明。Pi CLI 的安装标识与恢复已有会话所用的协议彼此独立。Main 拥有进程、终端登录、宿主权限与产品归账。本机 Pi 通过随应用分发的 ACP 桥运行，内建 Pi 走 SDK，Claude 走 Claude 包，普通 ACP 走[现有适配器](../../../../packages/agent-runtime-acp/README.md)。保留显式 ACP 命令和 Codex App Server 路由。实时 part 与能力变化只读取相关来源。切换旧会话恢复路径前必须确认原生历史身份。

Pi 和 Grok 的私有 ACP 操作由各自的包实现。随应用分发的 Cursor SDK 管理登录、模型目录和会话，在选定工作区运行标准工具，并执行原生工具权限策略。Cherry 请求启用 Cursor Auto-review，按需提供浏览器 MCP 租约，并使用 SDK 的 agent ID 恢复会话。

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

## Risks

ACP 会话 ID 可以与 Pi 会话文件不同，确认身份前保留旧恢复入口。本机接手请求不能证明原生已经放置输入。配置改变和断线可能使旧控件失效。
