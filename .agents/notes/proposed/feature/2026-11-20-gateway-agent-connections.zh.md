# Agent Note: 通过统一网关接入 Agent

Status: proposed

[English](2026-11-20-gateway-agent-connections.md) | 中文

## Problem

客户端需要可长期使用的模型地址。现有模型 ID 包含供应商 ID，替换模型后可能需要逐个更新客户端配置。目前本机模型客户端也需要网关密钥，现有的局域网监听只允许加密的设备配对流量。

## Proposal

共享网关面板先展示可自定义命名的模型别名，再展示网络设置。每个别名都有稳定的 Base URL 和可直接操作的模型选择器。默认的 `default` 行与自定义别名同时显示，选中模型后才保存绑定。别名和目标模型独立保存，更换已禁用或删除的模型时，客户端可继续使用原地址。别名请求按 URL 选择目标，OpenAI 和 Anthropic 请求体可省略 `model`。通过别名地址发现模型时，只列出该别名。原有通用路由仍接受显式模型 ID。停止时仍可复制地址，运行时使用实际监听地址。本机环回客户端可以免密钥调用模型 API。局域网模型 API 共享默认关闭，独立保存设置，主进程准备好网关密钥后才允许访问。设备配对和内部监听保留现有鉴权与路由边界。模型 API 包括 OpenAI、Anthropic 和 Gemini 的模型路由。

## Alternatives considered

统一鉴权开关会让用户每次开启局域网共享时都要重新配置本机客户端。复用设备配对开关会改变升级后已有安装暴露的接口。

## Acceptance criteria

- AC1 — 两个网关入口均提供可直接复制的别名 Base URL 和协议端点，停止时也可查看和复制 (verification: Electron)
- AC2 — 通过真实本机连接可以免密钥调用模型 API，不受信任的网页来源无法使用该权限 (verification: HTTP integration)
- AC3 — 本机可免密钥调用时，局域网调用仍须提供有效密钥；关闭共享后，局域网模型调用被拒绝，设备配对仍可用 (verification: HTTP integration)
- AC4 — 开启共享后，局域网控件显示实际监听地址和遮盖的密钥 (verification: Electron)
- AC5 — 改绑别名后，同一个 URL 无需重启网关即可路由到新目标，支持省略请求体模型 (verification: HTTP integration)
- AC6 — 别名路由仅公开网关提供，沿用现有的本机和局域网访问规则 (verification: HTTP integration)

- AC7 — 添加自定义别名后仍可用默认模型选择器，完成选择后可复制地址，重载后地址继续有效 (verification: Electron)

## Risks

部分客户端仍要求在配置里填写模型或凭据字段。局域网客户端必须支持所用的传输方式。通过 HTTP 发送的局域网 API Key 可能被该网络上的观察者读取。
