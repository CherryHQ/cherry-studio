# Agent Note: 深度求索默认分时计费

Status: proposed

[English](2026-11-14-deepseek-default-billing.md) | 中文

## Problem

深度求索官方目录保存峰价。没有供应商分时配置时，谷时请求也按峰价估算。
每日时段不能区分周末。旧 Flash API 别名还可能继承旧价格。

## Proposal

读取时解析官方默认规则。必须同时匹配深度求索预设、实际 HTTPS 接口和已核实的模型 ID。
保留用户保存的供应商计费规则和模型单价。整张分时表共用一个周一至周五条件。
复用现有倍率机制。保留请求开始时的价格快照，继续优先采用供应商实际费用。

使用北京时间。09:00–12:00、14:00–18:00 的峰时倍率为 1，其余为 0.5。
按用户要求只判断星期，节假日也一样。所有年份使用相同规则，不维护假期表。
请求开始时间未知时，仍按峰价回退。重置后恢复默认继承。
未修改就保存时，不写入默认规则副本。日期预览共用价格解析逻辑。
自定义模型单价保持不变。

官方别名价格放在供应商覆盖层，不改全局模型基础价。
保留目录币种。不换汇，不重算历史费用。

## Alternatives considered

- 始终使用峰价：不能满足谷时估算需求。
- 向所有账号写入默认配置：固定了规则，也混淆了用户覆盖。
- 只匹配模型名：会错误地给第三方代理打折。
- 假期表和循环日历编辑器：超出了仅按星期判断的需求。
- 请求结束时定价：改变现有跨界请求和历史费用约定。

## Acceptance criteria

- AC1 — 默认请求按北京时间正确切换边界价格；周末全天谷价，平日的节假日按普通平日计费(verification: shared unit tests)
- AC2 — 当前 Flash、两个旧 Flash 别名和 Pro 使用各自官方峰时 token 单价(verification: registry tests)
- AC3 — 供应商覆盖、自定义模型单价和非官方接口保留现有行为(verification: shared and main integration tests)
- AC4 — 每次请求冻结价格；后续请求重新解析；历史费用和上报费用不变(verification: main integration tests)
- AC5 — 未来年份沿用相同星期规则；请求开始时间缺失时保留明确的峰价回退原因(verification: shared unit tests)
- AC6 — 新老未配置账号继承默认规则；未修改保存和重置保留继承关系(verification: renderer and main integration tests)
- AC7 — 日历条件可以持久化，也可以通过合并补丁删除(verification: renderer and database tests)
- AC8 — 日期预览与运行时价格一致；异步加载的模型也能取得默认规则(verification: renderer and shared tests)

## Risks

按需求简化后的星期规则不处理供应商的节假日例外。
深度求索未说明跨峰谷请求的定价时刻，实际费用以供应商账单为准。
直接运行的外部运行时缺少可靠请求时间时，继续按峰价回退。
桌面外观和打包应用行为需要单独的运行时证据，不能用单元测试或服务测试代替。

来源：[深度求索定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。
