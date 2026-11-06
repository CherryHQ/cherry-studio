# Agent Note: Claude Code Copilot Opus 5.5 网关别名

Status: implemented

[English](2026-11-02-claude-code-copilot-opus-55-alias.md) | 中文

## Problem

Claude Code 将带小数点的 Copilot 模型 ID 识别为 Opus 5，并使用 200k 本地上下文预算，即使所选模型声明了 1M 窗口。

## Decision

对内部网关路由，仅当启用且可路由的同提供商模型不会占用该地址时，使用限定范围的 Claude 版本拼写别名。根据每个槽位声明的窗口和第一方主机判断添加 CLI 的 1M 标记。将别名解析回原始模型行和线路 ID；渲染进程仅在同样的资格检查通过时匹配用量。

## Alternatives considered

- 全局替换小数点会改变其他模型 ID，并可能路由到不同的模型。
- 保留带小数点的拼写可维持路由，但 CLI 显示仍不正确。

## Consequences

有歧义的别名保留原始拼写。目录变化可能改变派生的连接签名。公共网关准入和线路 ID 保持不变。

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts src/main/features/apiGateway/utils/__tests__/models.test.ts src/main/features/apiGateway/__tests__/proxyStream.parse.test.ts`：Copilot 带小数点的 1M 模型在所有槽位得到 `copilot:claude-opus-5-5[1m]`，内部别名解析回原始模型行，歧义别名被拒绝；这些用例在未改动的基线上失败（5 条），精确地址的对照用例仍然通过。
- Regression — 随包 Claude Code 2.1.284 对本地 mock 的探针：`copilot:claude-opus-5-5[1m]` 报告规范名 `claude-opus-5-5`、预算 1000000，而当前的 `copilot:claude-opus-5.5` 报告 `claude-opus-5` 与 200000；CLI 在出网前剥掉标记。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/hooks/agent/__tests__/useAgentSessionContextUsage.test.ts`：别名下的网关用量读数得以保留，并按声明窗口计量（1M 的 30%），而存在冲突的同级模型或兄弟列表不可用时该读数仍被过滤掉。
- Regression — 本机未验证：已鉴权的 Copilot 账号真正发出 1M 请求，以及第一方订阅路径。
