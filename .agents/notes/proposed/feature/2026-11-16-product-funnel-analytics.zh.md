# Agent Note: 产品漏斗埋点

Status: proposed

[English](2026-11-16-product-funnel-analytics.md) | 中文

## Problem

运营需要看到新用户从首次启动到第一次成功完成 Agent 任务之间在哪一步流失，以及从客户端登录 CherryIN 的用户有多少会充值。客户端目前只向现有统计后端上报启动、活跃天数和 token 用量，另外向 PostHog 上报订阅埋点。onboarding、Agent 会话与任务、CherryIN 登录与充值都没有上报，两个漏斗都无法建立。

## Proposal

在 `src/shared/ipc/schemas/analytics.ts` 新增产品事件目录。渲染进程事件是严格的可辨识联合，由唯一的 IpcApi 路由 `analytics.track` 校验；主进程事件只做类型定义。字段只能是枚举、数字、布尔值或随机 flow id，不携带用户文本、名称、路径、URL 或金额。

`AnalyticsService.trackProductEvent` 把两个版本的目录内事件都发送到 Cherry Studio PostHog 项目；订阅埋点仍留在各自版本的项目。它复用现有的隐私同意闸门、关闭的 GeoIP 和固定的 `$ip`，把字段映射为 snake_case，并附加 `schema_version`。

未登录 Cherry AI 账号时，事件使用设备的 client id。登录后由 `CherryCloudService` 发布账号的 distinct id `cloud-api:<edition>:<environment>:account:<id>`，与订阅埋点的格式相同。之后的产品事件改用该 id 并带人物档案，并通过一次 `$identify` 把该设备此前的事件合并到账号。退出登录后，后续事件回到 client id。只有开启数据收集并同意当前隐私政策时才发送任何内容，包括账号合并。同意之后、客户端启动之前产生的事件暂存在有上限的缓冲区里，启动后发送一次。撤回同意会清空缓冲区。

事件：

- 新用户：`app_opened`（onboarding 状态，每个进程一次）、`onboarding_option_selected`、`onboarding_step_viewed`、`onboarding_completed`（状态、路径、耗时）。
- Agent：`agent_session_created`（面向用户的对话会话）、`agent_turn_finished`（状态、用户或后台触发、Agent 类型、模型来源、耗时、工具调用数；每轮一次）、`agent_created`（手动或 Cherry Assistant 工具创建；不含内置种子）。
- CherryIN：`cherryin_entry_view`、`cherryin_sign_in_result`（onboarding 或服务商设置）、`cherryin_topup_clicked`（带 flow id，同时以 `entry`、`entry_source`、`flow_id` 传给充值页）、`cherryin_balance_increased`（同一 flow id，不含金额）、`cherryin_quota_error`（chat 或 agent）。

模型来源取值为 `cherry_free`、`cherry_cloud`、`cherryin`、`own_key`。订阅埋点保持现有合同与身份。启动、活跃天数和 token 用量继续走现有统计后端。

## Alternatives considered

- 自建接收服务、ClickHouse 和 Metabase：与客户端已上线的 PostHog 链路重复，而且没有后端负责人。
- 通用的渲染进程 `track(name, data)` 路由：任意或可识别身份的数据都能通过；白名单让合同可评审。
- 在渲染进程使用带自动采集的 `posthog-js`：会记录目录之外的点击和页面内容，并绕过主进程的同意闸门。
- 所有事件保持匿名：漏斗无法按人与订阅、免费模型权限关联，而这两者都绑定 Cherry AI 账号。
- 改为绑定 CherryIN 账号：CherryIN 是目前 onboarding 的登录方式，但产品身份是 Cherry AI 账号，且 PostHog 不能把两个已识别账号合并成一个人。充值点击通过 flow id 与 CherryIN 订单关联。

## Acceptance criteria

- AC1 — 已同意时，两个版本的目录内事件以 snake_case 字段和 `schema_version` 到达 Cherry Studio PostHog 项目；未同意时不发送也不事后补发；在同意与客户端启动之间产生的事件只送达一次。(verification: unit; owner: analytics)
- AC2 — `analytics.track` 拒绝目录外事件、多余字段和自由文本值（例如 id 字段中的 URL）。(verification: unit; owner: analytics)
- AC3 — onboarding 上报所选方式、进入的服务商或模型步骤，以及带状态、路径和耗时的完成事件；完成事件只在状态保存成功后上报。(verification: renderer; owner: onboarding)
- AC4 — 每个进程上报一次带 onboarding 状态的 `app_opened`；面向用户的 Agent 会话上报创建；每个 Agent 轮次上报一次带状态、触发方式、Agent 类型和模型来源的结束事件；用户创建的 Agent 上报创建，内置种子不上报。(verification: unit; owner: agent runtime)
- AC5 — 从 onboarding 和服务商设置登录 CherryIN 都上报结果；设置卡片每个窗口上报一次曝光；点击充值上报 flow id，并以该 flow id 和入口打开充值页；之后的余额增加以同一 flow id 上报且不含金额；CherryIN 余额不足失败上报所在输入框类型。(verification: renderer and unit; owner: CherryIN)
- AC6 — 登录 Cherry AI 账号期间，产品事件带账号 distinct id，且该设备此前的事件只合并一次；退出登录后回到 client id。(verification: unit; owner: analytics and Cherry Cloud)

## Risks

- 现行隐私政策（2026-08-20）描述的是高度聚合的匿名数据。这些事件不含内容，但登录后的事件关联到账号，发布前需法务确认符合政策。
- 只统计已同意隐私政策的用户，绝对数偏低；看板以比例和趋势为主。
- 首充与金额只以 CherryIN 订单为准；客户端观察到的余额增加不是收入。
