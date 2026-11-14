# Agent Note: 保留自定义提供商的完整路径

Status: proposed

[English](2026-11-07-custom-provider-complete-path.md) | 中文

## Problem

自定义提供商可以配置端点主机，但请求 URL 的格式化可能追加协议路径或规范化已配置的 URL。因此，使用完整自定义路由的网关可能收到与用户输入不同的路径，而且用户在发送请求前无法总是明确实际目标地址。

## Proposal

为每个自定义提供商端点配置添加明确的完整路径选项。启用后，已配置的端点 URL 提供请求路径；URL 格式化不得追加默认协议路径或推断其他端点。关闭时，现有主机格式化和按端点类型构造路径的行为保持不变。

在创建自定义提供商和请求配置流程中，于保存或测试前显示有效请求路径。请求失败诊断应显示有效路径，同时继续隐去凭据和敏感 URL 参数。协议回退和端点自动检测不在本方案范围内，需要单独审议。

该选项按端点设置，并与端点配置一起持久化；默认采用现有主机模式。本 Spec 等待当前 PR head 上明确的人类 `APPROVED` 审查；获批前不得开始实现。

## Alternatives considered

- 继续将所有已配置的 URL 视为主机并追加协议路径。这样可以保持当前行为，但无法表达任意网关路由。
- 根据路径后缀自动判断路径是否完整。自定义路由存在歧义，这会静默改变路由行为。
- 配置路由失败时自动进行协议回退。这可能会把请求发送到其他目标，明确不属于本决策范围。

## Acceptance criteria

- AC1 — 每个自定义提供商端点都可明确选择完整路径模式，且该选择在保存和重新加载后保留，同时不改变默认主机模式行为 (verification: implementation author; provider persistence tests)
- AC2 — 在完整路径模式下，请求使用已配置的端点路径，不追加默认协议路径或静默改写路径；标准主机模式仍按现有端点类型构造路径 (verification: implementation author; focused provider configuration tests)
- AC3 — 在任一模式下，创建提供商和请求配置流程都在保存或测试前显示有效请求路径 (verification: implementation author; renderer tests and Electron)
- AC4 — 请求失败诊断显示有效请求路径，且不泄露凭据或敏感 URL 参数 (verification: implementation author; diagnostics tests and a credential-redaction check)
- AC5 — 选择完整路径模式不会触发协议回退或端点自动检测 (verification: implementation author; focused provider routing tests)

## Risks

不同提供商适配器构造 URL 的方式可能不同。验证必须确认实际发出的路由，而不只是已配置的 base URL 或 fetch 层预览；诊断还必须描述同一路由且不泄露机密。
