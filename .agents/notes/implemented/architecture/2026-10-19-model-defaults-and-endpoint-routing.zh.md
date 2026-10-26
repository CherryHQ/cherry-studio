# Agent Note: 模型默认值、显式覆盖与端点路由

Status: implemented

[English](2026-10-19-model-defaults-and-endpoint-routing.md) | 中文

## Problem

手动创建曾把初始的空能力数组当作用户的明确覆盖提交。已知 Gemini 生图模型因此从绘画功能中消失，而导入同一个模型仍保留目录描述。默认 Chat 端点也可能掩盖已知 Speech 端点。仅有地址继承无法修复这种意图丢失，也无法为同时声明 Chat 的模型选中独立 Images 地址。

10 月 19 日在 `d5122ff4e47f6b76c53988263ff60e7cb858b016` 的诊断通过 `gemini-2.5-flash-image` 复现了绘画模型缺失。开启图像生成能力后恢复可选，Electron 随后请求了本地 Google HTTP 模拟服务。这证明了元数据缺陷，不代表真实云端部署验收通过。

[Spec PR #21998](https://github.com/CherryHQ/cherry-studio/pull/21998) 堆叠在[前置 PR #21724](https://github.com/CherryHQ/cherry-studio/pull/21724) 上；后者的 `c60f7c7ef2a35e831395847740fcf5c7a65b9007` 包含连接继承、独立元数据控件和普通云端 TTS。本实现继承 Spec 提交 `5f99a0b3e762352057f1850063b181d7951c84f1`。用户于 2026 年 10 月 20 日明确授权跳过 Spec 当前提交的审批门禁，直接在本地实现。

## Decision

系统供应商和自定义供应商使用相同的模型解释规则，扩展现有的[供应商解析](../../../../docs/references/ai/provider-resolution.md)和[注册表](../../../../docs/references/provider-model/provider-registry.md)所有者。

| 数据 | 职责 |
| --- | --- |
| 模型能力与模态 | 支持的任务及输入、输出形式 |
| 模型 `endpointTypes` | 部署提供的接口，包括有序的多个 LLM 端点 |
| 供应商 `endpointConfigs` | 连接地址及目标适配器配置 |
| 注册表 | 默认描述、供应商模型差异和连接兼容规则 |
| 用户覆盖 | 所选部署的显式差异 |

### Default descriptions

`ProviderRegistryService` 使用供应商的有效连接解析已知描述。创建和协调同步对每个供应商只读取一次上下文，再分别解析每个模型。匹配规范模型时保留原始 API 模型 ID。未知模型可继续手动配置，不按名称模式猜测；查询失败会中止创建，不会静默变成未知模型。

手动表单通过已有 Main 解析路由在失焦和提交时解析。展示的默认值与显式草稿修改分离。身份校验丢弃过期结果，异步默认值不能替换已编辑字段。修改 ID 时重新计算默认值并保留显式草稿修改；打开另一模型时使用其独立草稿。批量提交分别解析每一项，只对明确编辑过的共享字段应用覆盖，并通过一次创建请求提交。

导入只叠加发现接口实际提供的元数据。发现的正向能力补充目录能力；获取器的空能力列表不表达否定。远端明确声明的端点保持优先。临时创建元数据区分远端字段与解析后的展示默认值，不持久化 touched 状态或增加模型 schema。已有同步模型的用户覆盖保持不变。

| 操作 | 存储含义 |
| --- | --- |
| 元数据保持未修改 | 省略覆盖 |
| 显式清空数组 | 存储空数组 |
| 修改字段 | 只提交该字段；保留现有的等于基线时消除差异的规则 |
| 恢复默认值 | 删除选中字段的存储覆盖 |

### Endpoint routing

显式用户端点及供应商模型／远端端点优先。兼容的已知任务端点提供建议；普通 LLM 保留供应商默认端点。模型厂商身份不决定部署协议。未知 Speech 模型可通过端点、能力及模态控件配置。

调用时，图片生成／编辑、嵌入、重排和语音入口先把请求要求交给 `resolveRequestEndpoint`，再构造 SDK 配置。专用任务端点和适用的 Google 端点保留声明顺序，优先于通用适配器回退。图片编辑优先使用已声明的 Edit 端点，否则可由兼容图片适配器处理附带图片。不支持的描述在传输前失败。聊天保留现有偏好、有序端点及端点专属服务端工具。

注册表拥有纯连接来源决策：目标地址、兼容的默认 LLM 地址、最后按固定注册表顺序选择兼容回退。Main 保留 URL／完整路径规范化及目标 SDK 构造。继承的完整 URL 只贡献根地址，显式目标完整 URL 保持原有含义。Google、Anthropic 与普通 OpenAI 连接保持分离，显式 New API 网关兼容例外仍受支持。继承不回写地址，也不转移来源端点的工具能力。

配置界面显示目标、来源端点及配置地址，并脱敏凭证参数。缺少兼容连接时，设置页给出解释，请求构造器拒绝调用。SDK 推导的 Vertex／Bedrock 主机、托管传输、Google Imagen／嵌入和现有兼容图片适配器保留既有构造契约。

网关后续收敛删除 AiHubMix／DMXAPI 工厂中的第二次协议决策。Main 和 Pi 共用纯端点选择器。注册的扩展返回可执行的语言模型适配器，将构造函数与参数 namespace 一起传递；模型名判断只能在已选 Chat 协议内选择序列化实现。部署默认值仍是元数据，独立于供应商默认值进入模型解析。集中维护网关／客户端／namespace 表的方案被否决，因为它重复了实际构造函数的选择决策。标准嵌入和 Google 生图按选定端点执行，专用图片传输保留现有生命周期。

端点建议和请求选择共用原生任务适配器能力。Voyage 嵌入／重排及 Bedrock 嵌入保留已配置的适配器，不会被通用任务协议替换。`nativeTaskRouting.test.ts` 验证真实 SDK 的响应解析。批量创建每次请求最多发送 500 个模型；如果后续批次失败，先前成功的批次仍已持久化，调用方会收到错误。

### Reset and save ordering

`resetFields` 是 PATCH 命令，仅限能力、输入模态、输出模态和端点。Main 在一次同步写事务中解析当前基线并清空选中列。重置输入模态时同时清除 `inputModalitiesExplicit`。同字段设置／重置冲突及无基线模型会在写入前失败；批量操作中任一失败会回滚全部修改。不修改数据库 schema。

已有空数组或 Chat 选择保留到用户明确重置。表单预览当前默认值、解释默认值可能演进，并只应用选中字段。价格、Token 限额、名称、启用状态和无关字段保持不变。保存队列让重置在较早编辑之后、后续编辑之前执行，不跨重置合并操作。失败保留草稿和重试控件。切换模型不能改变排队写入的目标，也不能把其结果应用到新草稿。

## Alternatives considered

- 将所有空数组视为省略：丢失明确清空的意图，掩盖产生问题的表单缺陷。
- 增加功能专属的图片／TTS URL 补丁：复制连接所有者，让其他创建路径仍然不一致。
- 增加 `protocolConfigs`、持久化 `operation` 或供应商级模型分类：重复连接状态，无法表达具体部署的模型支持情况。
- 复制规范模型端点或按厂商／名称推断协议：把原生传输强加给兼容中转。
- 重写旧行或拒绝所有多兼容地址：丢弃用户意图，在没有证据时改变既有确定性回退。

## Consequences

未修改的预设描述可随注册表更新演进，显式覆盖继续优先。目录匹配不代表云端授权或实际网关支持。配置仍可覆盖，不兼容请求会报告错误。

普通 OpenAI／Gemini／New API TTS 复用已有朗读和播放器。流式播放及 Realtime 不属于本决策。语音说明现在明确指出，选择云端模型会向其供应商发送文本。解释配置不需要凭证内容。

实现通过定向测试、类型检查、lint、文档检查以及使用本地 HTTP 模拟服务的独立持久 Electron profile 验证。模拟服务验证了请求路由、解析、持久化及播放状态转换。真实云端部署访问和音质需要另行验收。

## Verification

- AC1 — `ModelService.defaults.test.ts`、`modelSync.test.ts` 和 `modelMetadataForms.test.tsx`：手动／默认 DTO、混合批次及导入保留等价描述，不固定推导字段。
- AC2 — `ModelService.defaults.test.ts` 和 `modelMetadataForms.test.tsx`：明确清空会持久化，选择性重置恢复稀疏 null 和输入显式标志；冲突／未知模型重置不产生部分写入。
- AC3 — Electron profile `PragueEndpointRouting`：只输入 `models/gemini-2.5-flash-image` 即展示默认值、创建绘画选项，并向配置的本地服务发送 `/v1beta/models/gemini-2.5-flash-image:generateContent`；图片成功持久化并显示。
- AC4 — `speechModels.test.ts` 与 Electron：已知 `tts-1` 继承 `/v1/audio/speech`；通过表单配置的不透明模型出现在语音设置中并完成试听，朗读播放器经历 generating／ready／playing／idle 状态。
- AC5 — Electron：`text-embedding-3-small` 出现在知识库选择器中；公共 `ai.embedding.embed_many` 经真实 SDK 请求 `/v1/embeddings` 并返回模拟向量。
- AC6 — `modelMetadataForms.test.tsx`、`EditModelDrawer.test.tsx`、`endpoint.test.ts` 和 `provider.serverTools.test.ts`：无关编辑保留端点顺序及聊天端点／工具行为。
- AC7 — `endpoint.test.ts`、`endpointConnection.test.ts`、`config.test.ts`、`googleImageModel.test.ts` 与 Electron：图片使用独立的 `/generation/v1/images/generations` 和 `/edit/v1/images/edits` 地址；Google-only／OpenAI Images 不匹配在 HTTP 前失败。
- AC8 — Renderer 表单测试及模型 handler 测试：过期身份和延迟默认值不能替换显式编辑；查询失败不创建模型；未知模型保持可编辑。
- AC9 — 共享注册表连接测试、Main 端点测试及 Electron 设置页：连接来源／地址与缺少连接的解释一致；同族及显式 New API 继承继续受支持。
- AC10 — 真实数据库重置测试、Renderer 队列／失败／模型切换测试及 Electron：旧行仅在选择性恢复后改变；SQLite 显示覆盖被清除，其他字段保留，重置不能越过编辑或更新另一份草稿。

`gatewayModelDefaults.test.ts` 还覆盖数据库默认值／重置及实际 SDK 请求：Claude 模型显式选择 Chat、Responses 或 Google 端点时，必须使用所选地址和请求格式。边界测试覆盖 thinking、兼容 reasoning、认证及 Anthropic 工具限制。这些本地 fixture 不证明云端可用性。

详细本地运行记录及 HTTP／截图产物保存在 `.context/provider-diagnosis/` 和 `.context/cherry-electron-dev/`。这些是本地验证，不宣称远端 CI 或 GitHub 审批已完成。
