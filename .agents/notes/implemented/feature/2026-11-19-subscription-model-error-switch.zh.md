# Agent Note: 服务商报错时提供订阅模型

Status: implemented

[English](2026-11-19-subscription-model-error-switch.md) | 中文

## Problem

已付费订阅 Cherry AI 的用户，用其他服务商的模型聊天时，可能遇到这个服务商的密钥、额度、限流、地区限制或服务故障报错。聊天报错卡片只提供去服务商设置或重试，但订阅里本来就有能回答同一请求的模型。

## Decision

以下条件全部满足时，`ErrorBlock` 会在「详情」链接旁加一个不显眼的「改用订阅模型」入口：

- 当前页面提供了 `renderRegenerateModelPicker`。目前只有首页聊天的适配层提供；智能体、历史记录等只读页面不显示入口。
- 失败消息的服务商不是 `cherryai-subscription`。
- 这条消息不在生成中。
- 错误类型是换服务商能解决的：`auth`、`permission`、`region`、`model`、`quota`、`rate_limit`、`server`、`deprecated`，或本地找不到模型。
- `useCherryCloudPlans` 的套餐数据是最新的（`isPlansReady`），并且有生效中的付费权益（`activePaid`）。

这个入口就是现有「换模型重新生成」选择器的触发按钮。`MessageModelPickerRenderOptions.providerId` 把选择器限制为 `cherryai-subscription` 的模型，选中后用这个订阅模型重新生成这条回复。卡片原来的主操作（去设置或重试）不变。

## Alternatives considered

- 用切换入口替换主操作：不采用。修好原服务商的密钥或额度仍然是可行的路，而且卡片只有一个主操作位。
- 一键切换到固定的默认订阅模型：不采用。产品没有定义默认的订阅聊天模型，用户在聊天的其他地方也是自己选模型。
- 所有非订阅服务商的报错都显示入口：不采用。请求本身导致的失败（上下文过长、请求体过大、内容审核）和本地工具失败（MCP、知识库、OCR）换成订阅模型还会再出现。
- 套餐数据过期或未知时也显示入口：不采用。订阅已失效的用户会看到入口，但选中的模型又会失败。

## Consequences

- 只有页面、服务商和错误类型都满足条件的卡片才会去查套餐。查询共用 SWR 缓存，主窗口的订阅提醒已经预热过这份缓存。
- 没有「换模型重新生成」选择器的页面保持不变，等它们的适配层提供后才会出现入口。

## Verification

- AC1 — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`：订阅用户的 OpenAI 回复被限流时，入口提供只含 `cherryai-subscription` 模型的选择器，点击入口不会打开错误详情；没有付费套餐、套餐数据未确认、失败的模型本身是订阅模型、413 请求体过大、页面没有选择器时，都不显示入口。
- AC2 — `src/renderer/pages/home/messages/__tests__/homeMessageListAdapter.test.tsx`：传入 `providerId` 后，选择器的过滤会排除其他服务商的模型。
- AC3 — `pnpm check --base SiinXu/global-errors-7-tools --group checks` 通过：格式、docs、lint、`typecheck:web`，以及 i18n 的 catalog、unused、hardcoded 三项检查。新文案已在渲染进程的全部 18 种语言中翻译。
- 未做 Electron 和打包版本的验证。
