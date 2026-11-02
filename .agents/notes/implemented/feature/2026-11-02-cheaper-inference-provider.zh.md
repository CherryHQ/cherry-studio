# Agent Note: Cheaper Inference 供应商

Status: implemented

[English](2026-11-02-cheaper-inference-provider.md) | 中文

## Problem

Cheaper Inference 用户目前需要先输入自定义供应商地址，才能连接账户。

## Decision

在全球版中新增具名供应商，使用现有 OpenAI 兼容适配器和官方文档中的 `https://api.cheaperinference.com/v1` 基础地址，保持 API 密钥认证为必填。通过需要认证的 `/models?type=text&streaming=true` 端点在运行时发现模型 ID，而不是将网关不断变化的模型目录或价格固定到注册表中。同时提供官网、文档、模型目录和控制台链接，为所有语言添加供应商名称，并使用官方浅色和深色标志。

## Alternatives considered

- 自定义供应商目前即可使用，但用户必须手动填写端点地址。
- 单独实现适配器或硬编码模型目录，会重复现有的传输和模型发现逻辑。

## Consequences

通用 OpenAI 兼容模型获取逻辑现在遵循已有的 `modelsApiUrls.default` 覆盖地址，并保留查询参数和正常密钥轮换。图标生成器在添加新标志时保留现有的手动维护 Radeon Cloud 图标。现有适配器、模型发现和初始化逻辑保持不变，不涉及数据库结构迁移或凭据转移。初始支持 Chat Completions 传输；其他协议可在单独验证后另行加入。

## Verification

- AC1 — 官方[文档](https://www.cheaperinference.com/docs)和[公开模型目录](https://api.cheaperinference.com/public/models)确认网关端点和模型 ID。

- AC2 — `src/main/ai/provider/__tests__/listModels.test.ts` 中两个模型列表地址用例在隔离 Electron 和服务边界后通过：筛选地址、默认地址、轮换 Bearer 认证以及不变的模型 ID。
- AC3 — 目录约束、供应商端点矩阵、注册表查询以及供应商图标注册表测试通过。
- AC4 — 翻译校验、双语配对、Agent Note 格式以及内置知识生成检查通过。
