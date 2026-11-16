# Agent Note: 产品漏斗埋点

Status: implemented

[English](2026-11-16-product-funnel-analytics.md) | 中文

## Problem

运营需要看到新用户从首次启动到第一次成功完成 Agent 任务之间在哪一步流失，以及从客户端登录 CherryIN 的用户有多少会充值。客户端原先只向现有统计后端上报启动、活跃天数和 token 用量，另外向 PostHog 上报订阅埋点。onboarding、Agent 会话与任务、CherryIN 登录与充值都没有上报，两个漏斗都无法建立。

## Decision

`src/shared/ipc/schemas/analytics.ts` 是产品事件目录。渲染进程事件是严格的可辨识联合，由唯一的 IpcApi 路由 `analytics.track` 校验；主进程事件只做类型定义。字段只能是枚举、数字、布尔值或随机 flow id，不携带用户文本、名称、路径、URL 或金额。

`AnalyticsService.trackProductEvent` 把两个版本的目录内事件都发送到 Cherry Studio PostHog 项目；订阅埋点仍留在各自版本的项目。只有开启数据收集并同意当前隐私政策时才发送任何内容，包括账号合并。服务复用现有的隐私同意闸门、关闭的 GeoIP 和固定的 `$ip`，把字段映射为 snake_case，并附加 `schema_version`。同意之后、客户端启动之前产生的事件暂存在最多 200 条的缓冲区里，启动后发送一次；撤回同意会清空缓冲区。

未登录 Cherry AI 账号时，事件使用设备的 client id。登录后由 `CherryCloudService` 发布账号的 distinct id `cloud-api:<edition>:<environment>:account:<id>`，与订阅埋点的格式相同。之后的产品事件改用该 id 并带人物档案，每次激活通过一次 `$identify` 把该设备此前的事件合并到账号。退出登录后，后续事件回到 client id。

事件：

- 新用户：`app_opened`（onboarding 状态，每个进程一次，先于补发事件）、`onboarding_option_selected`、`onboarding_step_viewed`、`onboarding_completed`（状态、路径、耗时；状态保存成功后才上报）。
- Agent：`agent_session_created`（DataApi 创建、复用或创建且实际新建时，以及 support、assistant、skill 会话；不含种子、定时任务、频道和分叉会话）、`agent_turn_finished`（状态、用户或后台触发、Agent 类型、模型来源、耗时、工具调用数；由运行时的结束转换每轮上报一次）、`agent_created`（手动或 Cherry Assistant 工具创建；不含内置种子）。
- CherryIN：`cherryin_entry_view`（每个窗口一次）、`cherryin_sign_in_result`（onboarding 或服务商设置；取消来自 OAuth 运行时的取消错误码）、`cherryin_topup_clicked`（带 flow id，同时以 `entry`、`entry_source`、`flow_id` 传给充值页）、`cherryin_balance_increased`（同一 flow id，不含金额）、`cherryin_quota_error`（chat 或 agent，来自统一的执行失败分类）。

模型来源取值为 `cherry_free`、`cherry_cloud`、`cherryin`、`own_key`。启动、活跃天数和 token 用量继续走现有统计后端。

## Alternatives considered

- 自建接收服务、ClickHouse 和 Metabase：与客户端已上线的 PostHog 链路重复，而且没有后端负责人。
- 通用的渲染进程 `track(name, data)` 路由：任意或可识别身份的数据都能通过；白名单让合同可评审。
- 在渲染进程使用带自动采集的 `posthog-js`：会记录目录之外的点击和页面内容，并绕过主进程的同意闸门。
- 所有事件保持匿名：漏斗无法按人与订阅、免费模型权限关联，而这两者都绑定 Cherry AI 账号。
- 改为绑定 CherryIN 账号：CherryIN 是目前 onboarding 的登录方式，但产品身份是 Cherry AI 账号，且 PostHog 不能把两个已识别账号合并成一个人。充值点击通过 flow id 与 CherryIN 订单关联。

## Consequences

- 只统计已同意隐私政策的用户，绝对数偏低；看板以比例和趋势为主。
- 现行隐私政策（2026-08-20）描述的是高度聚合的匿名数据；登录后的事件关联到账号，发布前需法务确认。
- 首充与金额只以 CherryIN 订单为准；客户端观察到的余额增加不是收入。
- `tool_call_count` 读取本轮已交付的工具部分，不交付这些部分的运行时会报 0。
- 只有当服务商报错被分类为额度不足（HTTP 402 或含额度、余额字样）时，才能识别 CherryIN 余额不足。

## Verification

- AC1 — `pnpm exec vitest run --project main src/main/services/__tests__/AnalyticsService.test.ts`：国内版的目录内事件进入 Cherry Studio 项目，订阅埋点留在国内项目；未同意或关闭收集后产生的事件既不发送也不补发；同意与启动之间产生的事件只送达一次。
- AC2 — `pnpm exec vitest run src/shared/ipc/schemas/__tests__/analytics.test.ts`：路由拒绝目录外事件、多余字段和 id 字段中的 URL。
- AC3 — `pnpm test:renderer src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx`：自定义服务商、CherryIN 和跳过三条路径按顺序上报方式、步骤和完成；状态保存失败时不上报完成。
- AC4 — `pnpm exec vitest run --project main src/main/services/__tests__/AnalyticsService.test.ts src/main/ai/agentSession/__tests__ src/main/ai/agents/__tests__ src/main/ai/mcp/servers/__tests__/assistant.test.ts src/main/ipc/handlers/__tests__/ai.test.ts src/main/data/api/handlers/__tests__/agentSessions.test.ts`：`app_opened` 先于补发事件且只报一次；一轮关闭两次只报一次；后台轮次、CherryIN 模型和内置 Agent 分类正确；只有真实创建才上报会话与 Agent。
- AC5 — `pnpm test:renderer src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/CherryInOauth.test.tsx src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx` 与 `pnpm exec vitest run --project main src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`：曝光只报一次，充值链接带 flow id 和入口，只有余额确实增加时才以该 flow id 上报，过期的 onboarding 尝试不上报，只有 CherryIN 额度失败会上报。
- AC6 — `pnpm exec vitest run --project main src/main/services/__tests__/AnalyticsService.test.ts src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts`：已知账号在启动事件前完成识别，之后事件带账号 id 和人物档案，退出后回到 client id，Cherry Cloud 会发布并释放账号。
