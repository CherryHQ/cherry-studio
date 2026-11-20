# Agent Note: 服务商报错时提供订阅模型

Status: implemented

[English](2026-11-19-subscription-model-error-switch.md) | 中文

## Problem

已付费订阅 Cherry AI 的用户，用其他服务商的模型聊天时，可能遇到这个服务商的密钥、额度、限流、地区限制或服务故障报错。聊天报错卡片只提供去服务商设置或重试，但订阅里本来就有能回答同一请求的模型。

## Decision

只有 `useHasCurrentPaidPlan` 为真时，首页聊天适配层才提供 `renderSubscriptionModelPicker`。这个 hook 要求套餐数据是最新的（`isPlansReady`），有生效中的付费权益（`activePaid`），并且权益如果记录了 `expires_at`，这个时间还没到。组件挂载期间，hook 会在这个到期时间重新检查一次：不自动续费的套餐到期后，即使没有收到新的账户数据，开着的卡片也会隐藏入口。适配层每个消息列表只读一次套餐，图片截图用的列表（`imageActionConsumer: 'capture'`）永远拿不到这个能力。

以下条件全部满足时，`ErrorBlock` 会在「详情」链接旁显示一个不显眼的「改用订阅模型」入口：

- 当前页面提供了 `renderSubscriptionModelPicker`。智能体、历史记录等只读页面不提供。
- 失败消息的服务商不是 `cherryai-subscription`。
- 这条消息不在生成中。
- 错误类型是换服务商能解决的：`auth`、`permission`、`region`、`model`、`quota`、`rate_limit`、`server`、`deprecated`，或本地找不到模型。

入口打开的是「换模型重新生成」选择器，只列 `cherryai-subscription` 的模型，并关闭推荐行（`showSubscriptionOffers={false}`）。所以选中任何一项都会重新生成这条回复；需要授权的 AMD 模型、需要登录的模型和订阅推荐这些会触发别的流程的行，都不会出现。卡片原来的主操作（去设置或重试）不变。入口带有 `data-image-capture-excluded` 属性，所有图片导出都会去掉它，所以复制或保存的消息、话题图片不会透露导出账户的付费状态。

## Alternatives considered

- 用切换入口替换主操作：不采用。修好原服务商的密钥或额度仍然是可行的路，而且卡片只有一个主操作位。
- 一键切换到固定的默认订阅模型：不采用。产品没有定义默认的订阅聊天模型，用户在聊天的其他地方也是自己选模型。
- 所有非订阅服务商的报错都显示入口：不采用。请求本身导致的失败（上下文过长、请求体过大、内容审核）和本地工具失败（MCP、知识库、OCR）换成订阅模型还会再出现。
- 套餐数据过期或未知时也显示入口：不采用。订阅已失效的用户会看到入口，但选中的模型又会失败。

## Consequences

- 报错卡片自己不注册任何 IPC 监听。每个消息列表只有一份套餐订阅，供所有卡片共用。
- 没有订阅模型选择器的页面保持不变，等它们的适配层提供后才会出现入口。

## Verification

- AC1 — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`：入口位于「去设置」旁，带有截图排除标记，点击不会打开错误详情。失败模型本身是订阅模型、413 请求体过大、没有订阅选择器时，都不显示入口。同时挂载符合和不符合条件的卡片，都不会注册 IPC 监听。
- AC2 — `src/renderer/hooks/cherryCloud/__tests__/useHasCurrentPaidPlan.test.ts` 覆盖套餐数据过期、未付费、已到期、禁用这几种情况，以及挂载期间到期、但没有收到新账户数据的情况。`src/renderer/pages/home/messages/__tests__/homeMessageListAdapter.test.tsx` 证明：有生效中的付费套餐时提供这个能力，只列 `cherryai-subscription` 模型，并关闭推荐行；没有付费套餐时，以及在截图列表里，都不提供。
- AC3 — `src/renderer/components/cherryCloud/__tests__/CherryCloudModelSelector.test.tsx`：已登录、关闭推荐行的选择器不显示需要授权的 AMD 聊天模型。`src/renderer/utils/__tests__/image.test.ts`：图片截图会过滤掉带 `data-image-capture-excluded` 的子树。
- AC4 — `pnpm check --base SiinXu/global-errors-7-tools --group checks` 通过：格式、docs、lint、`typecheck:web`，以及 i18n 的 catalog、unused、hardcoded 三项检查。新文案已在渲染进程的全部 18 种语言中翻译。
- Electron CN 版：未登录时，无效 OpenAI 密钥产生的 401 卡片不显示入口。开发版没有配置 `MAIN_VITE_CHERRY_CLOUD_CLIENT_SECRET`，登录失败，所以已订阅的情况没有在 Electron 里实测。未做打包版本的验证。
