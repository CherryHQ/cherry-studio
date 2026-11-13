# Agent Note: Pi 原生遥测

Status: implemented

[English](2026-11-09-pi-native-telemetry.md) | 中文

## 问题

Cherry 根据宿主观察创建 `pi.generate_content` 和 `pi.execute_tool`，却没有接入 Pi 原生遥测。模型 span 重复了网关 AI SDK 的观测；宿主工具 span 缺少原生任务阶段、重放及恢复关系。

## 决策

将 Pi 的 `TelemetryContext` 桥接到现有 OpenTelemetry provider 和本地 trace 存储。Durable 通过 `HarnessOptions.telemetry` 接入。Pi 负责提交和任务阶段的埋点；Cherry 提供受开发者模式控制的会话父级、可序列化传播和界面投影。原生阶段保留属性、事件和链接，包括工具身份及重放结果。

AI SDK 负责模型 span 和 token 用量；HTTP tracing 负责报文。抑制 `pi.ai.request` 和 `pi.ai.poll`，同时保留供后代使用的父上下文。通过网关不透明的内部用量捕获传入原生阶段父级。计费仍由网关负责。移除宿主创建的 Pi 模型和工具 span，无需依赖埋点补丁。

用户在实现对话中批准了原生遥测，并明确要求避免与底层 AI SDK trace 重叠。此处不声称存在单独的 GitHub Spec 审批。

## 考虑过的替代方案

- 丰富宿主创建的 span：仍维护第二套生命周期实现，并重复模型观测。
- 给 ModelRuntime 打补丁以输出原生模型 span：重复 AI SDK 覆盖，增加不必要的依赖补丁。
- 透传公开 trace header：向不可信调用者暴露归属入口；现有内部捕获已经验证所有者。

## 影响

普通 Pi 1.5.0 没有原生工具 span API；保留网关模型观测及工具 transcript，不伪造替代 span。原生遥测不记录消息和工具正文。启用遥测之前持久化的任务没有载体，无法重建原始父级。原生载体冻结发起时的所有者，不跟随可变的当前轮次。指标导出不属于此次 trace 接入范围。

## 验证

- AC1 — `PiDurableRuntimeConnection.test.ts`：真实原生提交和工具阶段暴露工具身份、结果及已提交条目事件；生成调用收到阶段父级。
- AC2 — `piTelemetry.test.ts`：以不同会话所有者重建适配器后，序列化载体保留父级身份及链接。
- AC3 — `gatewayIntegration.test.ts`：原生模型绑定和生产网关只产生阶段下的一次 SDK 请求、一次上游请求及一条 SQLite 用量记录；`ApiGatewayService.test.ts` 覆盖冻结归属和释放后的捕获。
- AC4 — `piTelemetry.test.ts`：关闭追踪不改变结果；错误保持身份；最终显式状态生效，结束后的 span 不再接受更新。

显式选择的八个主进程测试套件通过（171 项）；补充最终状态优先的回归后，适配器套件的七项测试全部通过。生产 Durable 连接测试验证了原生工具阶段和生成父级。原生模型绑定 → 生产网关 → 本地测试上游的测试验证了阶段下只有一次 SDK 请求、一次上游请求及一条 SQLite 用量记录。载体测试以不同会话所有者重建适配器，验证原始父级、链接和事件得以保留。另有关闭追踪和错误身份的独立覆盖。

Node 类型检查及变更文件的 lint/格式检查通过。这些证据来自进程内集成测试；此次新遥测链路尚未在 Electron 或真实供应商上验证。
