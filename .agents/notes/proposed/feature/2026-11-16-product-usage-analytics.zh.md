# Agent Note: 产品使用埋点

Status: proposed

[English](2026-11-16-product-usage-analytics.md) | 中文

## Problem

产品漏斗埋点（`2026-11-16-product-funnel-analytics.md`）能看出新用户是否完成第一个 Agent 任务、CherryIN 用户是否充值，但看不出用了哪些功能、每个页面停留多久、哪些控件从来没人点。开发版发出的产品事件也和正式流量完全一样，无法区分。

## Proposal

扩展 `src/shared/ipc/schemas/analytics.ts` 中的产品事件目录，并沿用其规则：受隐私同意控制，只用静态标识，不含内容。

- 功能结果：`chat_turn_finished`（状态、模型来源、耗时、是否联网和用知识库、MCP 工具数、附件数），以及覆盖 15 个功能的 `feature_used`（功能、动作，可选的状态、模型来源、触发方式、预置 `target`、数量、耗时）。
- 页面停留：`page_viewed` 在一段停留结束时上报，包含固定列表中的页面、可选的设置分区或内置小程序 id、墙钟时长、有效时长和结束原因。有效时长只计窗口有焦点、页面可见且 60 秒内有输入的时间。后台标签页不计时；空闲 30 分钟结束一段；单段上限 4 小时，不足 1 秒不上报。
- 点击：`ui_clicked` 覆盖所有可交互控件的点击，上报最近的静态 `data-ui` 标记（没有则为 `unlabeled`）、页面、元素类型以及鼠标或键盘触发；不读取文字、值、链接或坐标。
- 命令：`command_executed` 上报静态命令 id，以及由快捷键、菜单还是命令面板触发。
- 设置：`setting_changed` 上报用户写入的偏好 key，只有布尔值和数字才附带值。
- 所有产品事件带 `test` 字段：开发版，以及指向其他 PostHog 项目或 Cloud 后端的构建为 true。

页面停留、点击、命令和设置属于使用行为，超出了现行隐私政策的表述。除非构建设置 `MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS=true`，主进程会丢弃这些事件；打开前需等待隐私审核。

## Alternatives considered

- `posthog-js` 自动采集：会记录元素文字和页面 URL，并绕过主进程的同意闸门。
- 每个按钮手写事件：漏掉大多数控件，且每个新控件都要写代码；构建时生成的 `data-ui` 标记已经命名了每个组件。
- 进入和离开各报一次停留：事件量翻倍，没有额外信息。
- 上报文本类设置的值：其中可能包含主机、路径或密钥。

## Acceptance criteria

- AC1 — 每次完成的普通对话回复或功能动作上报一次带状态的事件，Agent 轮次不上报 `chat_turn_finished`；`target` 只能是预置 id。(verification: unit and renderer; owner: analytics call sites)
- AC2 — 每次页面访问上报一段停留，有效时长只计有焦点、可见且最近有操作的时间；后台标签页、不足 1 秒的访问、空闲时间和路由参数都不会进入事件。(verification: renderer; owner: renderer shell)
- AC3 — 每次点击可交互控件上报最近的静态标记、页面、元素类型和输入方式，500 毫秒内去重，不读取文字或内容。(verification: renderer; owner: renderer shell)
- AC4 — 命令只在处理函数实际运行时上报；设置变更只上报用户写入，只有布尔值和数字附带值，同一 key 在 2 秒内合并。(verification: unit and renderer; owner: commands and preferences)
- AC5 — 产品事件带 `test` 字段，使用行为事件在构建未开启时被丢弃。(verification: unit; owner: analytics)

## Risks

- 行为事件需要法务确认后才能打开开关。
- 停留和点击约为每人每天几十条事件；PostHog 超出免费额度后按量收费，可能需要抽样。
- 推断出的 `data-ui` 标记会随组件改名而变化；长期分析应依赖显式标记。
