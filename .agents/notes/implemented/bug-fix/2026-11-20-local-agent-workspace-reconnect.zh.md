# Agent Note：空会话切换工作目录后重建本地 Agent 连接

Status: implemented

[English](2026-11-20-local-agent-workspace-reconnect.md) | 中文

## Problem

打开空会话会在首条消息之前预热 CLI。选择其他工作目录后，会话和界面更新了，但预热连接仍停留在原目录。ACP、Codex 和 Claude 本地连接都会复用过期的 cwd；在目录变更后才完成的连接也有同样的问题。

## Decision

将本地工作目录纳入宿主的连接目标，并保留当前原生连接所对应的目录。在复用前、等待协调检查返回后以及连接完成时校验目录。不匹配时关闭旧连接，按当前工作目录重试。丢弃旧目录预热产生的恢复 token，而不是恢复旧原生会话。不要跨目录继承正在关闭的运行条目的 token。

将该策略放在 AgentSessionRuntimeService 中，而不是增加三套协议专用的失效逻辑。工作目录 API 仍禁止在出现任何非 root 消息后换目录；目录不变时继续正常复用连接。其他运行时类型保持不变。

## Alternatives considered

- 重写提示词上下文：只是掩盖不一致，进程和工具仍使用旧目录。
- 仅在工作目录变更事件中失效：无法覆盖正在建立或协调检查中的连接。
- 用新 cwd 恢复旧原生会话：即使新进程启动目录正确，协议实现仍可能保留旧上下文。

## Consequences

空的本地会话切换目录后，下次使用时可能启动新的 CLI 进程和原生会话。未使用的旧原生会话可能仍留在 CLI 自己的历史中。不会改写认证、模型配置、工作目录内容或已有对话历史。

## Verification

- 回归 — `AgentSessionRuntimeService.workspace.test.ts` 使用真实迁移 SQLite 和本地协议进程 fixture：覆盖已预热 ACP/Codex 的 A 到 B 切换、连接中的切换、等待协调检查时的切换、不恢复原原生会话、相同目录复用，以及发送消息后拒绝换目录。
- 去掉实现时，五项回归用例因 fixture 实际进程 cwd 错误失败；加入实现后，全部六项通过。
- macOS 上真实 Qwen、Codex 和 Claude 的独立测试会话初始化：新进程 cwd 等于 B；Qwen/Codex 旧进程退出且原生 ID 改变；Codex thread/read 也报告 B。相同目录再次预热复用连接。无需模型回合，也未访问 Downloads。
