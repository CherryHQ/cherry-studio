# Agent Note: 产品使用埋点

Status: proposed

[English](2026-11-16-product-usage-analytics.md) | 中文

## Problem

产品漏斗埋点（`2026-11-16-product-funnel-analytics.md`）能看出新用户是否完成第一个 Agent 任务、CherryIN 用户是否充值，但看不出用了哪些功能、每个页面停留多久、哪些控件从来没人点、每项设置大家停在什么值，以及对话分支和消息操作怎么用。开发版发出的产品事件也和正式流量完全一样，无法区分。

## Proposal

扩展 `src/shared/ipc/schemas/analytics.ts` 中的产品事件目录，并沿用其规则：受隐私同意控制，只用静态标识，不含内容。

- 功能结果：`chat_turn_finished`（状态、模型来源、耗时、是否联网和用知识库、MCP 工具数、附件数），以及覆盖 15 个功能的 `feature_used`（功能、动作，可选的状态、模型来源、触发方式、预置 `target`、数量、耗时）。
- 页面停留：`page_viewed` 在一段停留结束时上报，包含固定列表中的页面（划词窗口上报 `selection`）、可选的设置分区或内置小程序 id、墙钟时长、有效时长和结束原因。有效时长只计窗口有焦点、页面可见且 60 秒内有输入的时间。后台标签页不计时；空闲 30 分钟结束一段；单段上限 4 小时，不足 1 秒不上报。
- 点击：`ui_clicked` 覆盖所有可交互控件的点击，上报控件的统计名，没有则用最近的静态 `data-ui` 标记（再没有则为 `unlabeled`），以及页面、元素类型和鼠标或键盘触发；不读取文字、值、链接或坐标。
- 控件统计名：渲染进程构建时给每个可交互元素加上 `data-analytics` 属性，与 `data-ui` 约定分开。名字只从源码推导：所属组件，加上控件标签的 i18n key 或具名处理函数，从不使用显示文字或运行时的值。
- 命令：`command_executed` 上报静态命令 id，以及由快捷键、菜单还是命令面板触发。
- 设置：`setting_changed` 上报用户写入的偏好 key，只有布尔值、数字或该设置的固定选项才附带值。每个本地自然日，`settings_snapshot` 按同样规则上报每项已编目设置的当前值；文本类设置只上报是否不同于默认值，用户头像只上报类型（默认、Emoji 或图片）。编目由偏好 schema 类型生成，列出每个 key 的类型和固定选项。
- 对话分支：`chat_branch_used` 上报新建分支及其来源（重新生成、编辑后重发、手动、@ 其他模型）、切换、删除和打开分支面板。每个本地自然日，`chat_branch_snapshot` 上报话题数、有多个分支的话题数，以及这些话题里的分支数。
- 消息操作：`message_action_used` 上报实际执行了的消息工具栏或菜单操作的静态 id。
- 所有产品事件带 `test` 字段：开发版，以及指向其他 PostHog 项目或 Cloud 后端的构建为 true；同时带设备本地的小时和星期几，这样能按用户的本地时间看使用时段，又不上报时区名或位置。

页面停留、点击、命令、设置、快照、分支和消息操作属于使用行为，超出了现行隐私政策的表述。除非构建设置 `MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS=true`，主进程会丢弃这些事件；打开前需等待隐私审核。

## Alternatives considered

- `posthog-js` 自动采集：会记录元素文字和页面 URL，并绕过主进程的同意闸门。
- 每个按钮手写事件：漏掉大多数控件，且每个新控件都要写代码；构建时生成的 `data-ui` 标记已经命名了每个组件。
- 进入和离开各报一次停留：事件量翻倍，没有额外信息。
- 上报文本类设置的值：其中可能包含主机、路径或密钥。
- 扩展 `data-ui` 给每个控件命名：`data-ui` 是有稳定性分级的样式和 E2E 约定，逐个控件命名会扩大它，并让统计改名受这套约定约束。
- 从 `setting_changed` 推算设置现状：它看不到停在默认值的设置，也看不到同意统计之前的修改。
- 从点击推算分支使用：点击分不清重新生成和编辑后重发，也漏掉从分支面板新建的分支。

## Acceptance criteria

- AC1 — 每次完成的普通对话回复或功能动作上报一次带状态的事件，Agent 轮次不上报 `chat_turn_finished`；`target` 只能是预置 id。(verification: unit and renderer; owner: analytics call sites)
- AC2 — 每次页面访问上报一段停留，有效时长只计有焦点、可见且最近有操作的时间；后台标签页、不足 1 秒的访问、空闲时间和路由参数都不会进入事件。(verification: renderer; owner: renderer shell)
- AC3 — 每次点击可交互控件上报其统计名，没有则用最近的静态标记，并带页面、元素类型和输入方式，500 毫秒内去重，不读取文字或内容；构建只从源码给控件命名。(verification: unit and renderer; owner: renderer shell and UI contract build)
- AC4 — 命令只在处理函数实际运行时上报；设置变更只上报用户写入，只有布尔值、数字和已编目的固定选项附带值，同一 key 在 2 秒内合并。(verification: unit and renderer; owner: commands and preferences)
- AC5 — 产品事件带 `test` 字段和本地小时、星期几，使用行为事件在构建未开启时被丢弃。(verification: unit; owner: analytics)
- AC6 — 每个本地自然日最多一次设置快照，上报已编目设置的值，文本类设置只记是否已设置，头像只记类型；编目与偏好 schema 一致。(verification: unit; owner: analytics)
- AC7 — 新建分支上报来源，切换、删除和打开分支面板各上报一次；每日快照上报话题数、有分支的话题数和分支数。(verification: unit and renderer; owner: chat)
- AC8 — 消息操作只在实际执行时上报其静态 id，包括选择翻译语言和 @ 模型。(verification: renderer; owner: chat)

## Risks

- 行为事件需要法务确认后才能打开开关。
- 停留和点击约为每人每天几十条事件；PostHog 超出免费额度后按量收费，可能需要抽样。
- 推断出的 `data-ui` 标记和统计名会随组件、处理函数或标签 key 改名而变化；长期分析应依赖显式命名。
- 设置快照每人每天增加约 200 个属性；编目必须保持自动生成，新增的文本类设置才不会上报值。
