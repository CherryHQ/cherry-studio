# Agent Note：Ollama 思考行为遵循模型声明的控制项

Status: implemented

[English](2026-11-01-ollama-thinking-controls.md) | 中文

## 问题

Ollama 会拒绝模型不支持的命名 `think` 等级。模型具有通用思考能力，并不代表它支持命名等级。

## 决策

- 仅当模型声明了 effort 控制项时，Ollama 才发送命名等级；推理序列化器会将其映射到该模型的等级范围内。
- 仅声明开关控制项的模型会收到布尔值 `think`。
- 模型未声明适用的控制项时，映射器会省略 `think`。
- Ollama 的通用能力回退只声明开关；推断出的非 effort 控制项会通过此布尔开关发送，而不会作为命名线路等级发送。

## 考虑过的替代方案

- 保留 `high` 回退值和通用推断等级：不采用，因为两者都可能发送 Ollama 拒绝的值。
- 对所有 Ollama 模型都省略思考参数：不采用，因为这会禁用受支持的布尔开关。

## 影响

- 仅支持布尔开关的 Ollama 模型仍可使用思考功能，且不会收到命名等级。
- 声明了 effort 控制项的模型仍会收到受支持的等级。
- 思考控制项未知时会降级为不发送 `think`。

## 验证

- 回归测试 — `pnpm test:main src/main/features/apiGateway/adapters/__tests__/providerOptionsMapper.test.ts`：验证仅布尔开关、声明等级和能力未知的 Ollama 请求。
- 回归测试 — `pnpm test:main src/main/data/services/__tests__/ModelService.test.ts`：验证 Ollama 思考能力不会推断 effort 等级。
