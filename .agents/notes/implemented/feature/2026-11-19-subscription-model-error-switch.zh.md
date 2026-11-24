# Agent Note: 服务商报错时提供订阅模型

Status: implemented

[English](2026-11-19-subscription-model-error-switch.md) | 中文

## Problem

已付费订阅 Cherry AI 的用户，用其他服务商的模型聊天时，可能遇到这个服务商的密钥、额度、限流、地区限制或服务故障报错。报错只提供去服务商设置或重试，但订阅里本来就有能回答同一请求的模型。首页聊天和智能体会话都会遇到这种情况。

## Decision

输入框上方显示一条推荐提示条，位置和视觉样式与 Cherry Cloud 额度提示相同，首页聊天（`ChatComposer`）和智能体会话（`AgentComposer`）都有。`src/renderer/components/composer/subscriptionModelSuggestion.ts` 中的 `shouldSuggestSubscriptionModel` 根据会话的最新一条消息判断，同时满足以下条件才显示：

- 最新消息是状态为 `error`、带 `data-error` 部分的助手回复。首页优先读取实时的消息部分。
- 这条回复的服务商不是 `cherryai-subscription`。服务商依次取自冻结的作者快照、消息行的模型 ID、错误本身。
- 错误类型是换服务商能解决的：`auth`、`permission`、`region`、`model`、`quota`、`rate_limit`、`server`、`deprecated`，或本地找不到模型。

首页在 `ChatContentInner` 里根据运行时消息计算，通过 `ChatComposerSlot` 和 `ChatPlacementComposer` 传入一个 `suggestSubscriptionModel` 属性；话题历史过期时不显示。`AgentComposer` 在会话允许换模型时，根据它的 `messages` 属性计算。

`SubscriptionModelNotice` 只在 `useHasCurrentPaidPlan` 为真时显示，并且只在存在符合条件的失败时才调用这个 hook。该 hook 要求套餐数据是最新的，且有生效中的付费权益；如果记录了到期时间，到期时间还没到。输入框当前模型已经是订阅模型时，提示条隐藏。按钮第一次点击时才挂载 `CherryCloudModelSelector`。选择器只列出 `cherryai-subscription` 的模型，而且这些模型还要满足输入框自己的模型限制（首页是聊天模型，智能体是运行时过滤条件加上仅限智能体的模型）。推荐行关闭（`showSubscriptionOffers={false}`），所以需要授权的 AMD 模型、需要登录的模型和订阅推荐行都不会出现。选中模型后，通过输入框自己的选择路径切换当前会话的模型：首页的模型选择处理最终调用 `setModel`，智能体调用 `updateSession({ id, model })`。不会重新生成失败的回复。

聊天报错卡片上没有订阅入口。

## Alternatives considered

- 在聊天报错卡片上放入口，用订阅模型重新生成回复：不采用。它只覆盖首页聊天，而且需要每张卡片读取套餐、拦截点击冒泡、在图片导出中排除，评审反复指出这些问题。
- 重新生成失败的回复，而不是切换模型：按产品选择不采用。用户希望会话继续使用订阅模型。
- 一键切换到固定的默认订阅模型：不采用。产品没有定义默认的订阅聊天模型，用户在聊天的其他地方也是自己选模型。
- 所有非订阅服务商的报错都提供切换：不采用。请求本身导致的失败（上下文过长、请求体过大、内容审核）和本地工具失败（MCP、知识库、OCR）换成订阅模型还会再出现。
- 套餐数据过期或未知时也显示提示条：不采用。订阅已失效的用户会看到提示条，但选中的模型又会失败。

## Consequences

- 提示条只跟随最新一条回复。用户再次发送，或者模型已切换为订阅模型后，提示条消失。
- 只有存在符合条件的失败时才读取套餐，模型数据在第一次点击后才加载。
- 这一层没有在 Electron 里实测已订阅的情况，也没有做打包版本的验证。

## Verification

- AC1 — `src/renderer/components/composer/__tests__/subscriptionModelSuggestion.test.ts`：其他服务商的 auth、permission、model、rate_limit、server 失败和本地找不到模型都符合条件，包括服务商来自快照或错误本身的情况。订阅服务商的失败、上下文过长和网络失败、非错误状态、之后已有新消息的早先失败、缺少错误部分都不符合。实时消息部分优先于已持久化的部分。
- AC2 — `src/renderer/components/composer/__tests__/SubscriptionModelNotice.test.tsx`：使用真实选择器时，付费用户的选择器只列出满足输入框过滤条件的订阅模型，没有需要授权的 AMD 行；选中一项会把它传给选择处理函数。没有付费套餐、套餐数据过期、没有符合条件的失败、当前模型已经是订阅模型时，提示条都不显示。
- AC3 — `src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx` 和 `AgentComposer.test.tsx`：从提示条选择模型，首页聊天会调用 `setModel`，智能体会用会话模型调用 `updateSession`。`src/renderer/pages/home/__tests__/ChatContent.test.tsx`：最新回复失败时，判断结果经 `ChatComposerSlot` 传到首页输入框，历史过期时不传。
- AC4 — `src/renderer/hooks/cherryCloud/__tests__/useHasCurrentPaidPlan.test.ts` 覆盖套餐数据过期、未付费、已到期、禁用、挂载期间到期，以及到期时间落在渲染和 effect 之间的情况。`src/renderer/components/cherryCloud/__tests__/CherryCloudModelSelector.test.tsx`：已登录、关闭推荐行的选择器不显示需要授权的 AMD 聊天模型。
- AC5 — 对改动文件运行的 `tsrs --noEmit -p tsconfig.web.json`、`oxlint --deny-warnings`、`eslint`、`oxfmt`，以及 `pnpm i18n:check` 和 `pnpm docs:check` 都通过。新文案已在渲染进程的全部 18 种语言中翻译。
