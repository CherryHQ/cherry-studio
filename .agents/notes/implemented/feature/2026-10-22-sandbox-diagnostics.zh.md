# Agent Note: 沙盒功能诊断

Status: implemented

[English](2026-10-22-sandbox-diagnostics.md) | 中文

## 问题

可编辑 JavaScript 示例无法证明宿主观察到的文件权限、嵌套 RPC、独立实例归属或目标白名单约束。网络连接失败本身不能证明隔离生效。

## 决策

诊断 UI 通过公共沙盒 manager 运行四个固定分组。主进程负责临时根目录和窗口取消，包负责测试资源与 guest RPC，每个 MXC lease 负责自己的网络代理。固定回归请求只传分组名。独立交互请求接受有界 RPC 参数与回调授权，或 HTTP(S) 请求及白名单来源；可执行文件、owner、宿主方法和文件授权仍由主进程控制。请求结束后展示实际策略、回调值和响应，不将外部网络失败视为隔离结论。诊断 guest 在构建时打包现有 RPC 库，不授予开发依赖目录的读取权限。

macOS 代理模式使用 MXC 的仅代理出口和每实例独立的 `proxy-chain` 服务。每个 HTTP 请求或 CONNECT 隧道都校验精确 host/port 授权。域名解析到私网或特殊地址时拒绝；私网目标需要显式 IP 授权。停止时撤销代理连接。kill 错误与 guest 退出竞态发生时，只有 SDK 独立确认退出才能认定已停止，否则继续保留清理重试责任。

## 考虑过的替代方案

- 诊断直接调用原始 SDK 会测试与产品调用方不同的路径。
- 公共网站引入可用性和 DNS 噪声；宿主拥有的可达 HTTP 服务提供正向对照与目标请求计数。
- 通过开放所有网络演示白名单无法证明 OS 约束生效。

## 后果

Windows 代理模式仍不支持。CONNECT 授权的是 TCP 端点，不校验 TLS 身份或应用内容。原生检查不证明硬链接隔离、后代进程终止或打包应用验收。停止会取消当前分组并阻止启动后续分组。每组限制 30 秒，最多两个目标实例。

## 验证

- AC1 — `packages/sandbox/tests/acceptance/diagnostics.test.ts` 在原生 macOS 上通过公共 manager 执行四组检查，涵盖打包的 guest 与资源清理。
- AC2 — `packages/sandbox/tests/contracts/proxy.test.ts` 检查 HTTP/CONNECT 拒绝、独立代理授权、私网 DNS 别名及关闭后连接拒绝；`lease.test.ts` 检查 kill/退出竞态与清理责任保留。
- AC3 — renderer 和共享 IPC 测试检查失败/不支持结果的区分、重新运行恢复、停止全部运行，以及拒绝 renderer 自选权限。

- AC4 — macOS Electron UI 的 21 项检查、单组重跑与手动停止均通过。集成验证发现原始 Node header 数组会使网络监控抛错；`MainNetworkDevtoolsService.test.ts` 覆盖正确的 header 归一化与凭据脱敏。未执行 Windows 或打包构建验收。

- AC5 — 交互验收及 renderer 测试覆盖编辑 RPC 数值、禁用回调授权、编辑网络白名单、空白名单拒绝全部目标，以及响应大小上限。
