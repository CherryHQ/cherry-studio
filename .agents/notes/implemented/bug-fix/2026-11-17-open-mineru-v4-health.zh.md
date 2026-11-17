# Agent Note：保持可达的 MinerU 4.x 服务可供选择

Status: implemented

[English](2026-11-17-open-mineru-v4-health.md) | 中文

## 问题

MinerU 4.x 的 `/v1/health` 返回 HTTP 200，但与 Cherry Studio 识别的 v1 schema 相比，能力字段改了名称。探测器把这个在线服务归类为响应无效，连接状态筛选因此将 Open MinerU 从设置中隐藏。

## 决定

将包含 MinerU 4.x 能力字段名的 v1 健康信封识别为可达的 MinerU 服务。如果它的 v1 能力不满足解析器契约，则探测 `/health`；只有该端点返回有效的 legacy 健康响应时才使用 legacy 解析器。否则保留引擎选项并标记为不支持。无关的成功响应（包括代理 HTML 页面）仍视为无效。

## 备选方案

- 将所有 HTTP 200 响应都视为可达：配置端口上的无关服务也可能因此显示为 MinerU。
- 拒绝所有不满足解析器契约的健康响应：这会隐藏在线的 MinerU 4.x 服务，也无法在解析时显示有用错误。

## 后果

使用已识别健康信封的 MinerU 4.x 服务会继续显示。具有有效 legacy 健康端点的服务可以使用现有 legacy 解析器；没有受支持解析器的服务仍会显示，但尝试解析时会报告不支持的响应。

## 验证

- 回归 — `pnpm test:main src/main/features/fileProcessing/processors/openMineru/__tests__/protocol.test.ts`：识别 MinerU 4.x 健康字段，仅在 legacy 健康端点有效时回退，并继续拒绝无关响应。
- 回归 — `pnpm test:main src/main/features/fileProcessing/__tests__/checkProcessorConnectivity.test.ts`：保持在线 MinerU 4.x 服务可选，同时保留不可达主机行为。
