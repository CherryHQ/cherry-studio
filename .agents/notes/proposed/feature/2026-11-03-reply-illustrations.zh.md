# Agent Note: 在助手回答中生成插图

Status: proposed

[English](2026-11-03-reply-illustrations.md) | 中文

## Problem

独立的图片 MCP 会等生图结束后，才向回答模型返回 Markdown 图片。它无法观察普通助手回答，也无法控制 Cherry Studio 正文中的占位。所需体验是让同一次文字模型回答包含插图意图，立即预留位置，继续显示文字，并在生图结束后替换占位。

用户已选择将功能集成进 Cherry Studio，不再协调单独启动的 MCP 服务。设置必须提供自动、强制开启、强制关闭三种模式。回答插图对应助手回答中的某一段内容，与单独生成的绘画作品不同。

## Proposal

### 已确定的方向

在当前源码中增加功能。通过提示词让回答模型在普通回答中输出带分隔标记的插图意图。处理这些意图，避免在渲染后的回答中展示其原始文本。生图不得阻塞后续文字输出。使用 `[[IMAGE]]...[[/IMAGE]]` 包裹每段纯文本生图提示词：起始标记预留占位，结束标记立即提交完整提示词，不等待回答结束。

适当复用现有[生图入口](../../../../src/main/ai/AiService.ts)和[图片 IPC 契约](../../../../src/shared/ipc/schemas/ai.ts)。生成图片应使用应用管理的文件系统，并由持久化消息持有。集成功能不需要外部 stdio 进程和本机回环图片服务。

在实时渲染与最终消息持久化分流之前处理文本流。重复流式更新和视图重新挂载时保持插图身份稳定，避免显示回答本身再次触发付费请求。保留文字和插图的顺序。

本方案等待针对当前 Spec PR head 的明确人类 Approval。本地探索不等于上游审批；记录该审批前，实现层必须保持草稿状态。

### 已确认的产品决策

| 决策 | 已接受行为 |
| --- | --- |
| 模式含义 | 自动由回答模型判断是否插图；强制开启要求每条新回复恰好包含目标张数的插图；强制关闭停止新生图并保留已有图片。 |
| 数量 | 自动模式显示每条回答的上限张数；强制开启显示目标张数，并将目标作为解析器的硬上限。两者默认均为一张，范围为 1–10，分别记忆。不再提供独立的强制张数开关。 |
| 提示词查看 | 生图提示词不会显示在回答正文中。每张插图旁都有展开按钮，可将完整提示词以纯文本查看，包括生成中或生成失败时。 |
| 范围和默认值 | 一个全局设置，初始强制关闭，适用于普通助手聊天。首版不覆盖 Agent 编程会话和群聊。 |
| 图片配置 | 选择已配置的生图模型，复用其服务商凭据。 |

三档通过系统提示词控制：自动档允许零张到上限张数，强制开启要求恰好输出目标张数，强制关闭不注入插图指令且不解析标记。提示词与流解析器使用同一份回答数量快照：自动模式的上限或强制模式的目标。超出的标记会被消费，不生成图片，也不暴露隐藏提示词。模型漏写或截断标记时，不会另调 LLM 创建或修复提示词，因此最终完成的图片可能少于要求。每个被接纳的意图都有独立标识。停止回答时取消未完成的生图，保留已完成图片；失败或取消的图片可以手动重试。模型设置复用已有默认绘画模型选择器。

加载偏好设置前，一次性转换已有配置。原先开启强制张数的自动或强制开启模式转为强制开启，保留按旧上限裁剪后的目标张数。未开启强制张数的强制开启模式，目标设为一张。强制关闭保持关闭，自动模式上限保留。转换后移除旧开关配置；后续切换模式不覆盖任一种数量。

主进程负责图片任务身份、取消、文件引用及带版本号的更新。最多并行两项图片请求，每项活动请求五分钟超时；在接纳回答时固定模式和数量设置。重启后放弃未完成请求，只有用户显式重试才会再次提交，并可能产生新的服务商费用。

### 用户原图引用

每个配图块可在首行使用保留字段，例如 `references: ["image_2", "image_1"]`，下一行开始写生图提示词。省略首行或使用空数组时仍按纯文字生图。回答模型逐块判断：修改原图、保留主体特征或参考风格布局时是否需要原图。只能使用应用提供的编号；正文提及图片不会触发上传。

候选图仅包含当前话题、当前分支中实际进入本次模型请求的用户图片，可来自历史轮次。应用在图片前标注编号。保留的附件索引、仅在摘要中提及的旧图、助手生成图和其他话题的图片均不纳入候选。最终模型中间件在上下文处理后再次收窄白名单，回退模型请求也遵守此规则。

重复编号保留首次出现的顺序并去重。无效引用或格式错误的列表使对应配图失败。模型不支持图片输入、原图超量、文件缺失或无法读取也明确失败，绝不静默丢掉已选原图。按模型声明的模式和图片上限提交；例如 Seedream 可在 generate 模式接收图片，无需声明 edit 模式。

配图保存有序的原图文件 id 和名称，并登记为回答消息持有的文件引用。提示词详情显示名称和图片预览。删除原上传消息后，回答的引用仍保留；所有持有者移除后按现有规则清理。显式重试始终使用已保存的提示词和原图选择，重启后也相同；同时使用当前默认绘画模型，重新校验图片输入能力和数量限制。无效引用需要重新生成回答，不能通过重试擅自换图。

### 验证计划

使用延迟返回的图片服务验证实际流式和消息结果。覆盖分片之间拆开的标记、不完整标记、包含示例标记的普通代码、图片请求失败、重复更新，以及重新打开已完成回答。实现后在 Electron 中操作实际设置和正文占位。检查范围限定为改动模块及其消费者。

## Alternatives considered

- 保留独立 MCP 可以继续使用原有打包方式，但正文解析与渲染仍由另一应用负责。用户已明确选择集成。
- 本地对话代理可以把标记改写成图片链接，但无法可靠控制 Cherry Studio 内所需的占位、重试和消息生命周期。
- 仅在渲染时解析标记，可以先隐藏文字，却没有解决最终存储、会话上下文和重复提交的归属。
- 重新实现图片服务配置会重复已有能力。已确认复用配置好的生图模型和服务商凭据。
- 在强制开启之外保留强制张数开关，会让自动设置产生矛盾，并让提示词和解析器各用一套数量限制。按模式提供数量设置可消除重叠。

## Acceptance criteria

- AC1 — 设置提供自动、强制开启、强制关闭三种插图模式，应用重启后保留所选模式 (verification: Leezehuan / implementation author; renderer and main integration tests)
- AC2 — 在启用模式下，插图起始标记在原始回答位置预留占位，意图完整后启动生图，图片就绪前后续文字继续输出 (verification: Leezehuan / implementation author; stream integration tests and Electron)
- AC3 — 生图成功后在预留位置显示图片，不替换或重排周围文字，重新打开已保存回答仍可查看该图片 (verification: Leezehuan / implementation author; persistence integration tests and Electron)
- AC4 — 重复流式更新和视图重新挂载不能重复提交同一插图意图 (verification: Leezehuan / implementation author; stream integration tests)
- AC5 — 分片边界和不完整插图标记不会暴露隐藏提示词片段或丢弃普通回答文字，代码中的示例标记仍作为普通代码处理 (verification: Leezehuan / implementation author; parser and renderer tests)
- AC6 — 生图失败保留已输出回答，并为插图显示明确失败状态，不会无限转圈 (verification: Leezehuan / implementation author; stream integration tests and Electron)
- AC7 — 集成功能运行时无需单独启动 MCP 进程，也不依赖独立项目的本机回环图片服务 (verification: Leezehuan / implementation author; Electron)
- AC8 — 自动模式只显示上限，强制开启只显示目标（均默认 1，范围 1–10）；两种数量分别记忆，提示词与解析器使用当前模式的数量，绝不生成超过该数量的插图 (verification: Leezehuan / implementation author; settings, prompt, stream integration tests and Electron)
- AC9 — 每张插图的提示词不会显示在回答正文中，并提供按钮，可在图片或占位旁展开查看完整纯文本提示词 (verification: Leezehuan / implementation author; renderer test)
- AC10 — 已有强制张数配置一次性转为对应模式及有效目标，未启用强制张数的强制开启模式默认一张，强制关闭保持关闭，后续用户选择在重启后保留 (verification: Leezehuan / implementation author; populated database seeder tests)

- AC11 — 模型逐块独立选择零张或多张应用编号的用户原图，候选仅限当前话题、分支和本次实际请求；排除被压缩的旧图和助手图片 (verification: Leezehuan / implementation author; prepared-message and final-middleware tests, Electron)
- AC12 — 所选原图按保序去重的顺序与干净提示词一起提交，使用支持的模式，包括 Seedream 的 generate；省略或空引用保持纯文字生图 (verification: Leezehuan / implementation author; intent and service tests, Electron)
- AC13 — 无效引用、不支持图片输入、原图超量和文件无法读取仅让对应配图失败，不丢图、不丢失回答文字 (verification: Leezehuan / implementation author; service and renderer tests)
- AC14 — 提示词详情显示所选原图名称和预览；删除上传消息后，保存的回答继续持有文件引用，直到所有引用均被移除 (verification: Leezehuan / implementation author; renderer and real-database persistence tests, Electron)
- AC15 — 失败或重启后的显式重试保留提示词和选图，使用当前默认绘画模型，并重新校验能力、数量上限和文件可读性 (verification: Leezehuan / implementation author; service persistence tests)

## Risks

仅靠提示词无法保证每个回答模型都输出有效的插图意图。强制开启是系统提示词要求，不会额外请求 LLM 补写缺失的插图意图。

普通聊天与 Agent 会话使用不同的请求链路。覆盖范围必须符合用户选择，不能因为共用渲染组件就推定两者都已支持。

当前采用专用传输的图片任务在重启时放弃恢复。已完成图片可以持久保存，但不能据此声称中断的生图请求会在重启后继续。恢复或重试未完成任务需要明确的生命周期约定，也不能导致用户未要求的重复生图。
