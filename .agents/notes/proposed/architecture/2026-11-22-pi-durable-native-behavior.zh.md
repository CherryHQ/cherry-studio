# Agent Note: Pi Durable 原生执行产品行为

Status: proposed

[English](2026-11-22-pi-durable-native-behavior.md) | 中文

## Problem

[共享行为方案](2026-10-18-agent-behavior-package.md)让 Pi Durable 与 Pi 通过同一套执行端口接入。Pi Durable 已经负责调度、输入队列、任务事务和子会话归属。现有适配器又构建了一层调用作用域，连输入分流、查询子会话运行状态也要组装大范围的历史事实。

## Proposal

保留 `@cherrystudio/agent-runtime-pi-durable`、`createPiDurableRuntime` 和桌面后端。用包内原生钩子、任务和事务接入 Cherry 的工具、目标和子会话作业。桌面后端继续提供审批、问答、模型配置和其他桌面服务。两个引擎都使用的产品规则和记录编解码保留共享实现。现有共享编排继续服务 Pi。本方案取代原方案中 Pi Durable 必须接入共享执行端口的要求。

先从普通提交、子会话状态和关闭流程移除全量历史读取。以原生提交回执和终态为准，从原生视图或提交记录应用观测到的变更。首次挂载和恢复有独立的读取路径，实时纯追加只访问变化的记录以及相关运行状态。桌面消息和归档契约继续沿用。

沿用已落盘的会话 ID、任务名和版本、输入和阶段布局、去重键、memo 和 provider 绑定。恢复调度前先恢复模型选项和子会话归属。现有 SQLite 数据库可以原地打开。Timeline 归档有独立的存储 Spec。

移除内存 Harness。核心测试验证产品规则，执行端口契约继续在真实适配器上测试，恢复和结果去重由原生 SQLite 验证。脚本化 Host 作为测试 fixture 提供审批、问答和配置输入。

## Alternatives considered

- 保留执行端口，逐一优化读取。这样可以消除单个扫描，新接入的原生能力仍然需要经端口转换。
- 在桌面后端挂载整个扩展。这样会跨包暴露 Harness 及其恢复和调度时序。

## Acceptance criteria

- AC1 — 普通输入分流和子会话状态读取原生事实，工作量与旧消息和 part 数量无关。owner 关闭时跳过仅为空回调而做的会话扫描 (verification: 运行时负责人，长历史计数测试)
- AC2 — 原生工具钩子保留桌面审批、参数修改、取消和结果外置行为 (verification: 运行时负责人，真实原生工具和桌面连接测试)
- AC3 — 目标、子会话续跑、停止、报告和用量通过原生任务和事务保留结果及原归属 (verification: 运行时负责人，契约和桌面连接测试)
- AC4 — 上一构建写出的真实 SQLite 数据库重开后，保留原会话 ID、checkpoint 祖先链、排队输入及可恢复任务。沿用旧回执和 memo 避免重复执行 (verification: 运行时负责人，跨构建 SQLite 重放)
- AC5 — Durable 生产入口和包声明脱离共享执行端口，Pi 适配器继续加载并使用该端口 (verification: 包负责人，导入规则、构建和适配器回归测试)

## Risks

改动原生任务版本或 memo 键会让待处理工作无法在升级后继续。保留这些键，直到旧记录有明确的兼容读取路径。子会话的完成与结果交付需要同原生回执核对，避免仅凭空闲快照就释放其他 Run。
