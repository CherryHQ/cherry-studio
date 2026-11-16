# Agent Note: Cherry Cloud 额度显示一致性

Status: implemented

[English](2026-11-16-cherry-cloud-quota-display.md) | 中文

## Problem

订阅卡片的百分比原先由 `src/renderer/utils/cherryCloudQuota.ts` 中的 `(limit_units - used_units) / limit_units` 计算，数据来自 `plans` 事实。`src/main/services/cherryCloud/CherryCloudService.ts` 中的 `refreshAccount` 仅在刷新原因为 `initial` 和 `focus_refresh` 时刷新该事实，而卡片使用的 `src/renderer/hooks/useCherryCloudPlans.ts` 钩子禁用了焦点触发的重新验证。

输入框横幅和发送拦截使用的是另一个事实：`receipt.models`，由 `src/renderer/hooks/useCherryCloudModelAvailability.ts` 每 60 秒轮询一次。同一服务中的 `projectEntitledModels` 根据各额度池的 `windows[].remaining_units`，结合实际拒绝响应写入的拒绝下限，判断可用性。

可信的 `429 QUOTA_EXHAUSTED` 会清除模型同步缓存，却不会重新获取账号或套餐，因此卡片只能在应用重启后才能反映变化。Issue #24649 展示了这一矛盾：对于同一个月度窗口，卡片显示“100.00% remaining”，输入框却阻止发送，API 也返回 429。

## Decision

`remaining_units` 是可用额度的权威数值。卡片根据它计算百分比，限制数值范围并向下取整到小数点后两位，绝不使用 `limit_units - used_units`。

卡片按额度池关联新鲜的 `models` 决策，使用与输入框发送拦截相同的 `quotaExhaustedModelIds` 集合。如果服务端已拒绝某个池中的模型，该池显示为额度耗尽，其各窗口显示 0。如果留存的统计数据仍声称有剩余额度，卡片还会提示统计数据已过期，而不是显示正的百分比。

可信拒绝指模型推理请求收到的 HTTP 429，且带有 `Cherry-Error-Code: QUOTA_EXHAUSTED`；首次响应以及鉴权/重放重试后的响应均适用。它会将留存的 `plans` 事实标记为 stale，发布收据，并在每个 30 秒窗口内最多准许一次完整账号刷新。拒绝响应本身原样返回；用户请求绝不会因此重放，返回拒绝响应也不会等待刷新完成。

输入框发送拦截和每 60 秒一次的可用性轮询保持不变。额度耗尽时，输入框仍会阻止发送。

## Alternatives considered

- 由主进程发布收据级额度事实：否决，因为这会改动模式，并重复 `models.quotaExhaustedModelIds` 已携带的决策。
- 根据 `used_units === limit_units` 判断额度耗尽：否决，因为预留额度会使其在两个方向上都产生误判。
- 移除输入框发送拦截：否决，因为提出需求的用户希望在输入前得到提示；缺陷在于显示矛盾，而非拦截本身。
- 为卡片增加轮询定时器：否决，因为现有的 60 秒可用性轮询已经会重新推导决策，一次由拒绝触发的刷新即可补上缺失的状态转换。

## Consequences

可信拒绝现在会将留存的 `plans` 事实置为 stale，直到获准的刷新完成。因此，用量区域会显示留存快照、数据过期标记和重试入口，而不是加载失败文案。要求 `plans` 事实为新鲜状态的购买和分析路径保留原有的新鲜度条件。

卡片不会再显示与发送拦截相矛盾的百分比。存在矛盾的快照会被明确标注，而非被静默覆盖。

已将新增的翻译键 `settings.subscription.quota_out_of_date` 添加到全部 17 个语言区域，并提供了真实译文。

## Verification

- AC1 — `remaining_units` 为 0 的窗口显示 0.00 %，总额 20、剩余 5 的窗口显示 25.00 % (verification: unit)
- AC2 — 新鲜的 `quotaExhaustedModelIds` 集合指明的额度池显示为已耗尽，其窗口显示 0；统计数据存在矛盾时显示数据过期提示行 (verification: renderer)
- AC3 — 可信 429 原样返回拒绝响应，并恰好准许一次套餐刷新；30 秒内的第二次拒绝不准许刷新，冷却期后的拒绝则准许再次刷新 (verification: unit)
- AC4 — 未携带标记的 429、`RATE_LIMITED` 拒绝、纯文本额度消息，以及携带相同错误码的 403，均不准许刷新 (verification: unit)
- AC5 — 退出登录后到达的可信拒绝不准许刷新，并使收据保持已退出登录状态 (verification: unit)
- Regression — src/renderer/utils/__tests__/cherryCloudQuota.test.ts 覆盖百分比表、额度池关联、提供商过滤、非活跃权益、过期事实和汇总最小值 (verification: unit)
- Regression — src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts 覆盖拒绝触发的刷新、冷却期、不可信拒绝、重试后路径、退出登录竞态和不递归场景 (verification: unit)
