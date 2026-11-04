# Agent Note: 已配对设备的 Relay 传输

Status: proposed

[English](2026-11-04-remote-relay.md) | 中文

## Problem

没有可达的直连地址时，已配对手机无法连接桌面。现有配对界面和会话生命周期也依赖正在运行的 LAN 监听器。

## Proposal

用户在当前任务中批准实施已核对的 Relay 接入方案。本文记录该范围，不表示已经取得 GitHub Spec 审批或完成真机验收。

在现有远程访问生命周期内增加出站 Relay 连接。直连和 Relay 流使用同一套 Noise 身份、配对批准和 grants，LAN 开关独立。Main 为每个 Relay origin 保存一个 host key，邀请和手机均不持有它。邀请增加 QR v4 和可选 Relay 地址，保留 v2/v3 读取及连接地址能力版本 1。

Relay runtime 负责临时会合和密文字节转发。账号凭据、设备登记库、WebRTC、推送和计费不在本次范围内。移动端现有连接管理器继续独占直连/Relay 选择和重连职责。

## Alternatives considered

- 要求 Relay 同时开启 LAN，会使纯 Relay 配对不可用。
- 另建 RPC 或认证实现会拆散配对和撤销的职责。
- 把 Relay URL 放进直连地址会丢失目标身份，并破坏旧读取方。

## Acceptance criteria

- AC1 — QR v2/v3 仍可读取，v4 可表达纯 Relay 目标且不携带 host key (verification: shared protocol tests)
- AC2 — 直连和 Relay 流共用端点身份、配对和授权；关闭 LAN 只关闭直连会话 (verification: main service tests)
- AC3 — Relay 重连保留原目标，取消会释放等待连接且不重放业务指令 (verification: runtime and connector tests)
- AC4 — 真实 Electron 和 iOS/Android 完成跨网配对、二进制传输、重启恢复和撤销，慢读缓冲保持有界 (verification: device acceptance)

## Risks

Relay 包发布后，普通 registry 安装才能消费它们。本地 tarball 验证与发布是两项独立工作。移动端原生发送缓冲和系统挂起需要真机验收，Bun 测试通过不能证明这些行为。
