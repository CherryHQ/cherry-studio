# Agent Note: 通过统一网关接入 Agent

Status: implemented

[English](2026-11-20-gateway-agent-connections.md) | 中文

## Problem

外部客户端需要所用协议的地址和网关接受的模型 ID。目前本机模型客户端也需要网关密钥，局域网监听只接受加密的设备配对流量。

## Decision

共享网关面板提供四个可复制的地址，分别对应 Base URL、OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages。模型列表复制网关接受的完整模型 ID，包含供应商前缀。停止时仍可复制地址，运行时使用实际监听端口。

本机模型客户端可以免密钥调用。局域网模型共享默认关闭，扩大监听范围之前须准备好网关密钥。设备配对、内部监听和模型寻址沿用现有契约。公开模型 API 支持 OpenAI、Anthropic 和 Gemini。

## Alternatives considered

用户已需要在客户端填入模型 ID，模型别名会增加一套命名和配置步骤。统一鉴权开关会把本机调用和局域网共享绑定在一起。将设备配对开关用于模型共享会改变已有安装的网络暴露范围。

## Consequences

部分外部客户端仍要求在自己的配置里填写凭据字段。HTTP 明文传输无法阻止局域网中的观察者读取 API Key。

## Verification

- AC1 — Electron 设置和启动台验证：四个复制地址在停止时匹配配置端口，运行时匹配实际监听端口。
- AC2 — `routes.integration.test.ts`：真实本机套接字允许原生客户端免密钥调用模型，并拒绝不受信任的网页来源。
- AC3 — `routes.integration.test.ts` 和 `lanLifecycle.integration.test.ts`：局域网调用须提供有效密钥，关闭模型共享不影响设备配对。
- AC4 — Electron 局域网验证：复制的地址使用当前活跃网卡和实际端口，密钥默认遮盖。
- AC5 — `ApiGatewayPanel.test.tsx` 和 Electron 模型列表验证：剪贴板收到 `/v1/models` 返回的带供应商前缀的完整 ID。
