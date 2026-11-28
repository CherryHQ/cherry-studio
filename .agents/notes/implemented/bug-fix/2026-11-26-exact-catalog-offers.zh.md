# Agent Note: 目录刷新保留供应商的独立模型条目

Status: implemented

[English](2026-11-26-exact-catalog-offers.md) | 中文

## 问题

每日刷新按规范模型 ID 去重。付费路由和免费变体共用该 ID 时，生成的目录可能保留免费价格，而应用仍使用付费请求 ID。

## 决策

价格和限制归属具体的供应商条目。供应商使用命名空间或不同版本分隔符时，按规范 ID 查询优先匹配无变体后缀的条目。按完整 API ID 查询可独立找到带后缀的条目。

CherryIN 按完整 API ID 为带价格的条目建立索引，并将供应商价格作为整套费率使用。供应商声明保留公开的固定单价和上下文长度分档。桌面端在请求完成时估算八条分时计费的 DeepSeek 路由，并对 Claude Haiku 5.5 和两条 Kimi K3.1 Pro 路由采用按缓存时长区分的费率。这些路由的目录固定费率留空。模态计费规则暂不提供估算。

CherryIN 的 Chat Completions 适配器读取 `cherryin` SDK 选项命名空间。Qwen4 Max 在 Chat Completions 使用 `enable_thinking` 和 `reasoning_effort`，在 Messages 使用 `thinking.type` 或 `output_config.effort`。

关闭思考时，Chat Completions 适配器将 Qwen4 Max 请求的输出上限设为最多 131,072 token。CherryIN Messages 即使关闭思考也接受 `max_tokens: 262144`。这里确认的是请求参数校验，模型实际生成上限见原厂规格。[阿里云 Qwen4 Max 规格](https://www.alibabacloud.com/help/en/model-studio/qwen4-max)

每日工作流在更新 PR 前检查生成目录，并一起提交变更的模型数据和工具索引。完整刷新会保留生成线路仍在引用的已审核基础模型。供应商模板没有匹配到新目录条目时，沿用上一版线路的完整请求 ID 和价格。OpenCode Go 优先使用模板声明的协议，其次采用上游标注且受支持的 SDK 协议，最后使用 Chat Completions。只有推理规则已覆盖的模型才会发布上游提供的推理控件。

远程发布仅在 v5 通道保留 CherryIN Qwen4 Max 条目，该通道的桌面端最低版本是 2.2.4。更早的通道省略该条目，因为旧版 Chat Completions 适配器无法应用其推理控制。每日目录 PR 包含 provider-registry 的 changeset。完整生成保留 Gemini Flash-Lite Preview 的推理档位和 Silicon Qwen3-VL Thinking 的预算。未设置模型价格覆盖时，CherryIN 已保存的倍率使用公开基础费率。主进程 AI 层在写入记录前计算模态估算，GPT Image 编辑缺少输入分项时费用留空。

## 考虑过的替代方案

每个规范模型只保留一条记录，会丢失可独立调用的条目。选第一条会让价格受上游数组顺序影响。

## 影响

一个模型可对应多条供应商记录。候选目录违反现有契约时，需要修复源数据，自动化才能更新 PR。

## 验证

- Regression — `catalog-invariants.test.ts`：Nemotron 付费和免费路由各自使用对应价格，规范 ID 查询结果与记录顺序无关。
- Regression — `alibaba-catalog.test.ts`：Qwen4 Max 保留原厂输出上限，OpenRouter 路由使用自身上限及推理设置。
- Regression — `registry.test.ts` 和 `ProviderRegistryService.test.ts`：CherryIN 的价格和分档边界按完整路由生效。目录无法表达的规则不会继承基础模型的缓存费率。
- Regression — `reasoningMembership.test.ts` 和 `ProviderRegistryService.test.ts`：Gemini 2.5 Flash Image 保留图像生成能力和 32,768 token 输出上限，隐藏思考设置。[Google 模型规格](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-image)
- Regression — `providerBilling.integration.test.ts`：CherryIN 按完成时刻记录谷时费用。缓存时长明细完整时按对应费率计费，原始 token 数照常记录。明细不完整时费用留空。
- Regression — `providerBilling.integration.test.ts`：Haiku 5.5 按完整输入 token 数选择公开费率档位，两条 Kimi K3.1 Pro 路由各自采用对应的 1 小时缓存写入费率。
- Regression — `cherryin-provider.test.ts` 和 `providerBilling.integration.test.ts`：Gemini 聊天和生图请求发送完整的 CherryIN 路由 ID，Gemini 工具提示 token 计入输入用量及费用。
- Regression — `providerBilling.integration.test.ts`：CherryIN Gemini 音频与图像 token 按公开模态费率计算，缺少模态明细时费用留空。
- Regression — `providerBilling.integration.test.ts`：CherryIN GPT Image 生图及编辑保留图像输入及缓存 token 数，按公开公式逐次计算费用。
- 生产冒烟验证（2026-11-26）— CherryIN 原生 Gemini 接口接受带命名空间的 Flash、Flash-Lite 和 Flash Image ID。音频请求返回 13 个音频输入 token，生图请求返回 1,290 个图像输出 token，均有模态用量明细。
- Regression — `gatewayUsageNormalize.test.ts` 和 `providerBilling.integration.test.ts`：Chat Completions 和 Responses 的缓存写入别名只统计一次，并从未缓存输入中扣除。
- Regression — `providerBilling.integration.test.ts`：桌面端在两种协议的请求中保留 Qwen4 Max 推理设置。
- 生产冒烟验证（2026-11-26）— Chat Completions 接受关闭思考以及 `low`、`high`、`xhigh` 档位。Messages 接受同样的档位，并拒绝 `max_tokens: 262145`。开启思考后，要求完整句子的流式请求返回正文，要求只回数字的请求结束时缺少正文块。同一数字请求走非流式 Messages 时返回了正文。
- Regression — 用留存和重新获取的上游数据完整生成目录。目录校验覆盖请求 ID、模型引用、OpenCode Go 端点和推理模型识别。
- Regression — 发布回放验证旧版与当前通道。目录与计费测试覆盖推理控件、已保存倍率、缓存音频和图片编辑分项缺失。
