# Agent Note: 通过统一网关接入 Agent

Status: proposed

[English](2026-11-20-gateway-agent-connections.md) | 中文

## Problem

外部客户端需要所用协议的地址和网关接受的模型 ID。目前本机模型客户端也需要网关密钥，局域网监听只接受加密的设备配对流量。

## Proposal

共享网关面板提供四个可复制的地址，分别对应 Base URL、OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages。模型列表复制网关接受的完整模型 ID，包含供应商前缀。停止时仍可复制地址，运行时使用实际监听端口。

本机模型客户端可以免密钥调用。局域网模型共享默认关闭，扩大监听范围之前须准备好网关密钥。设备配对、内部监听和模型寻址沿用现有契约。公开模型 API 支持 OpenAI、Anthropic 和 Gemini。

## Alternatives considered

用户已需要在客户端填入模型 ID，模型别名会增加一套命名和配置步骤。统一鉴权开关会把本机调用和局域网共享绑定在一起。将设备配对开关用于模型共享会改变已有安装的网络暴露范围。

## Acceptance criteria

- AC1 — 设置和启动台停止时都显示四个可复制的地址，运行时使用实际监听端口 (verification: Electron)
- AC2 — 本机真实连接可以免密钥调用模型 API，不受信任的网页来源无法使用该权限 (verification: HTTP integration)
- AC3 — 局域网模型调用须提供有效密钥，关闭模型共享后不影响设备配对 (verification: HTTP integration)
- AC4 — 开启局域网共享后显示可复制的实际地址和遮盖的密钥 (verification: Electron)
- AC5 — 模型列表复制的 ID 与网关模型目录返回的带供应商前缀的 ID 一致 (verification: renderer and Electron)

## Risks

部分外部客户端仍要求在自己的配置里填写凭据字段。HTTP 明文传输无法阻止局域网中的观察者读取 API Key。
