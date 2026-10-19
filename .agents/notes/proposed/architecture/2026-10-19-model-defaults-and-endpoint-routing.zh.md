# Agent Note: 模型默认值、显式覆盖与端点路由

Status: proposed

[English](2026-10-19-model-defaults-and-endpoint-routing.md) | 中文

## 问题

在本次诊断的工作树中，手动创建时模型事实、用户意图和表单初始值失去了区别。`AddModelFormPanel` 将能力初始化为空数组并始终提交。`ModelService` 正确地将该数组解释为对 registry 默认值的显式覆盖。因此，已知生图或嵌入模型可能丢失能力，而导入相同模型却能保留能力。默认 LLM 端点还可能掩盖已知模型的专用 Speech 端点。

10 月 19 日基于 `d5122ff4e47f6b76c53988263ff60e7cb858b016` 和工作区已有 TTS 改动的诊断，通过 `gemini-2.5-flash-image` 复现了问题：手动创建保存了空能力，绘画选择器没有可用模型。仅开启图像生成能力便恢复了可选状态。随后 Electron 请求通过配置的 Google 地址到达本地模拟服务器并返回图片。这证明了元数据问题，不代表真实云端部署已经通过验收。

该工作树中，兼容端点的连接继承已经可用。端点选择仍存在独立缺口：当图片请求需要另一个声明过且具有独立地址的端点时，通用解析器可能选择第一个端点。共享连接不能意味着共享请求语义或服务端工具。

## 提案

### 范围与职责

系统和自定义提供商采用统一解释规则。系统提供商提供预设，自定义提供商也可使用已知模型描述。扩展现有[提供商解析](../../../../docs/references/ai/provider-resolution.md)和[提供商注册表](../../../../docs/references/provider-model/provider-registry.md)的职责。本提案是新的决策记录，没有已有的活跃笔记负责这一提案。

| 数据 | 职责 |
| --- | --- |
| 模型能力与模态 | 支持的任务和输入输出形式 |
| 模型 `endpointTypes` | 当前部署可用的接口，包括多个 LLM 端点及其顺序 |
| 提供商 `endpointConfigs` | 连接地址和端点适配器配置 |
| Registry | 默认模型描述、提供商模型差异和连接兼容规则 |
| 用户覆盖 | 当前部署相对默认值的显式差异 |

复用 LLM 端点地址作为兼容连接根，保留逐端点覆盖。不新增 `protocolConfigs`、持久化 `operation` 或提供商级模型类别声明。普通 TTS 复用朗读功能；流式播放和 Realtime 不在本提案范围内。

### 基线与实施前置条件

这份纯文档 Spec 直接堆叠在 [PR #21724](https://github.com/CherryHQ/cherry-studio/pull/21724) 上，目标分支为 `DeJeune/openai-gemini-endpoints-implement`，核对版本为 `d5122ff4e47f6b76c53988263ff60e7cb858b016`。该父层也是诊断基线，提供连接继承和独立元数据控件。父 PR 面向 `main`；本 Spec 相对父层仅新增双语文档三件套。

依赖顺序为 `main` → 前置 #21724 → 本 Spec → 下述实现层。Spec 当前 head 获得 Approval 后即可开始实现，无需等待前置 PR 合并，其改动通过堆叠关系继承。如果父层变化，需要向上变基并重新核对受影响的 API、测试和 Spec 审批要求。本地普通 TTS 原型仍未合入，其语音适配器和测试必须在下述传输层中交付并验证。本 Spec 不新增产品实现。工作拆解会标明来自前置改动或原型的计划文件位置。

### 默认描述与显式覆盖

逐字段依次应用 registry 默认值、明确的提供商模型元数据、用户覆盖。远端元数据仅贡献它实际描述的字段；缺失不代表否定，同步必须保留已有用户覆盖。模型所属厂商本身不能证明部署采用的协议。

手动创建、批量创建和同步导入使用主进程同一处解析逻辑。预览复用已有模型解析路径，创建时使用相同规则。批量模型逐项解析。渲染进程不得维护另一套独立模型默认值。

区分展示默认值和草稿中的显式覆盖，能力、模态和端点均采用该语义：

| 操作 | 含义 |
| --- | --- |
| 未修改字段 | 省略该字段的覆盖 |
| 显式清空能力 | 提交 `capabilities: []` |
| 修改字段 | 提交该字段的覆盖 |
| 恢复默认 | 移除该字段的覆盖，而不是复制当前默认值 |

保留现有稀疏存储语义。不能把所有空数组当成省略值，也不持久化表单 touched 状态。编辑或重置路径必须明确表达移除已有覆盖；普通更新中省略字段不等于重置。不计划修改数据库结构。

在失焦或提交时解析，不在每次按键时解析。结果绑定当前提供商和模型 ID；忽略过期响应，异步默认值不能覆盖草稿中的显式编辑。身份变化时重新计算默认值。当前草稿中的显式编辑保持可见，并针对新身份重新校验；打开另一个模型时建立独立草稿。未知模型仍可手动配置，不按名称模式猜测。

解析失败是错误，不能当成成功查得未知模型。提交等待当前身份解析完成或报告失败；重试不得创建重复记录。区分来自 registry 的预填值与用户显式选择或远端提供商明确声明的端点，只有后者构成显式端点选择。批量表单逐项解析默认值，仅在用户确实编辑后才应用共用覆盖。

### 端点建议与请求选择

端点建议采用以下优先级：

1. 用户显式选择。
2. 明确的提供商模型或远端端点元数据。
3. 与已配置连接兼容的已知模型端点建议。
4. 适用于当前模型时，提供商的默认 LLM 端点。

不能把 registry 的标准模型端点盲目复制到任意部署。例如，通过 OpenAI 兼容服务托管的 Gemini 模型不能被强制改成 Google 传输。保留显式但不兼容的选择并解释缺少的连接，不静默切换协议。补齐 Speech 端点和相关语音元数据控件，使未知 TTS 模型也可配置；仅有音频输出不能证明模型适合普通朗读。

调用时先校验有效模型描述，从模型支持的端点中选择适用端点，再解析连接并为目标端点构建 SDK 请求。图像生成与编辑、嵌入和语音入口本来就知道请求要求，直接传给选择逻辑，无需持久化 operation 字段。适用端点之间优先采用适用的显式偏好，否则保留声明顺序。没有适用端点时，在发送前报告配置问题。

聊天保留多个 LLM 端点、端点顺序和端点专属的服务端工具。非聊天请求不得无条件使用 `endpointTypes[0]`。模型描述允许时，Google `generateContent` 可承担多种任务。最终选中的目标端点负责 SDK 方法、请求路径、协议方言和工具语义。

保留 `resolveEndpointBaseUrl` 及现有优先级：目标端点独立地址、兼容的默认 LLM 地址、按确定顺序寻找兼容连接。保留同族继承，包括图片编辑继承图片生成地址，以及明确的 New API 网关兼容例外。不把继承地址回写为显式配置，也不继承来源端点无关的工具能力。

| 配置 | 预期结果 |
| --- | --- |
| Google 地址和已知 Gemini 生图模型 | 具备绘画可选资格，通过该地址调用 Google `generateContent` |
| OpenAI Chat 地址和 `tts-1` | Speech 端点使用继承地址 |
| OpenAI 地址和已知嵌入模型 | 具备嵌入可选资格并采用适用端点 |
| Chat 与 Images 端点分别配置地址 | 图片请求使用 Images 地址 |
| 只有 Google 连接，显式选择 OpenAI Images 端点 | 解释缺少兼容连接，不通过 Google 发送 |

### 可解释性与已有数据

在配置详情显示有效端点、地址和继承来源。配置阶段和调用阶段一致地报告已知矛盾，不能让用户只看到无法解释的模型缺失。Registry 建议是配置默认值，不证明网关的模型部署、授权或账户访问权限。

不自动修复旧的空能力数组或 Chat 选择：已有数据不能证明它们是否出于用户意图。提供恢复默认描述的预览，仅应用选定字段，保留未知模型元数据。复用当前存储模型；如果后续确需修改数据库结构，必须重新评估提案并追加迁移。

### 重置契约与保存顺序

在现有模型 PATCH DTO 中增加可选的 `resetFields` 列表，仅允许 `capabilities`、`inputModalities`、`outputModalities` 和 `endpointTypes`。命令移除选定字段的存储覆盖，不持久化该列表，也不把预览值复制到数据行。省略列表不改变任何字段。如果同一请求同时重置和设置同一字段，或尝试恢复没有可解析预设基线的模型，则在任何写入之前拒绝请求。已有未知模型描述保持完整。

在同一个同步数据库事务中解析当前基线并更新选定列。重置输入模态时清除 `inputModalitiesExplicit`。普通显式数组，包括空数组，保留当前语义。重置跟随当前基线，不固定预览快照；预览说明默认值可能演进。不将重置扩展到价格、token 限制、身份、启用状态或无关设置。

编辑抽屉按模型串行保存的队列负责排列重置与待保存编辑：先完成早先写入，再执行重置，后续编辑最后应用。不得以改变顺序的方式合并设置与重置操作。重置失败时保留可操作的错误提示和当前草稿；切换模型不能把待执行操作发送到新身份。只有成功响应才更新界面显示的持久化结果。

### 实施顺序

1. Spec 当前 head 获得 Approval 后，在本 Spec 上堆叠模型默认值解析与稀疏创建语义，继承前置路由与表单改动，覆盖 AC1、AC2 的创建部分和 AC8。
2. 在该层上堆叠请求目标选择和普通云端 TTS，覆盖 AC3–AC7 及 AC9 的路由部分。前两层一起验收，避免修复能力后掩盖错误路由。
3. 在传输层上堆叠配置解释与选择性重置，完成 AC2、AC9、AC10 和累计 Electron 场景。同步维护参考文档；只有具备全部 AC 证据的最终层才将笔记迁移到 implemented。

### 逐文件工作拆解

| 负责位置 | 修改内容 | 保护的契约 |
| --- | --- | --- |
| `src/main/data/services/ProviderRegistryService.ts` | 预览、创建和基线读取共享默认描述解释；匹配标准模型时保留原始 API 模型 ID | 别名不能折叠成另一个请求模型；预览与保存后重新读取一致 |
| `src/main/data/api/handlers/models.ts` 和 `src/main/data/services/ModelService.ts` | create/reconcile 逐项应用同一基线；保留显式覆盖并增加选定字段重置 | 批量条目不继承另一条目的元数据；省略与空字段保持区别 |
| `src/shared/data/api/schemas/models.ts` | 增加限定范围的重置命令，拒绝相互矛盾的设置与重置字段 | 先校验后写入；不新增数据库列 |
| `src/renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/` 和 `src/renderer/pages/settings/ProviderSettings/utils/modelSync.ts` | 分离默认值与覆盖，保护异步身份，补齐语音控件，排列重置与自动保存顺序 | 所有创建路径一致；编辑保留无关和未展示的元数据 |
| `packages/provider-registry/src/registry-utils.ts` | 负责纯端点兼容与建议规则；运行时和配置调用方共享连接来源选择 | 数据服务和渲染进程不导入 `main/ai`；不重复实现 URL 选择策略 |
| `src/main/ai/provider/endpoint.ts` 和 `src/main/ai/AiService.ts` | 在 SDK 配置前，依据实际生图、编辑或嵌入请求约束端点选择 | SDK 请求采用选中的目标端点及其显式地址 |
| 来自 #21724 的 `src/main/ai/provider/endpointConnection.ts` | 保留 URL 与完整路径归一化，同时使用共享连接来源决策 | 现有继承根地址和完整 URL 覆盖保留原有语义 |
| 来自本地原型的 `src/main/ai/provider/speech.ts` 与自定义 Gemini 语音适配器 | 普通 TTS 接入共同路由规则和现有朗读流程 | 列表可选资格与实际传输一致，包括明确的 New API 路径 |

仅将连接来源的纯决策共享到 registry，传输专用的 SDK 与路径构造留在主进程。配置解释展示来源端点和配置的基础地址，绝不包含凭证材料。用于建议的提供商上下文必须包含有效端点配置，不能只有厂商身份或默认 LLM 类型。同一批次按提供商解析一次上下文，避免增加逐模型数据库读取。

修改目标选择前核对已安装 SDK 的适配器。Google `generateContent`、Imagen、Google 嵌入和 OpenAI 兼容图片实现并非具有相同的实际请求方法。保留既有适配器契约，复用现有 SDK 模型构造器；通用任务过滤不能拒绝已经支持的路由。图片编辑依据实际请求形态和声明的模型支持判断，不能仅凭存在自定义图片 URL 判断。

### 验证计划

以下是计划检查，不是已完成的实现证据。下列已有测试名称来自诊断工作树；`endpointConnection.test.ts` 和 `modelMetadataForms.test.tsx` 来自 #21724，`speechModels.test.ts` 来自本地 TTS 原型。

| 验证负责方 | 显式测试位置 | 可观察证据 |
| --- | --- | --- |
| 模型数据 | `src/main/data/services/__tests__/ProviderRegistryService.test.ts`、`ProviderRegistryService.context.test.ts`、`ModelService.test.ts`；`src/main/data/api/handlers/__tests__/models.test.ts` | 真实保存并重新读取的元数据、原始 API ID、主动清空数组、混合批量、原子拒绝重置及无关字段不变 |
| 模型表单与导入 | `src/renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/__tests__/modelMetadataForms.test.tsx`、`EditModelDrawer.test.tsx`；`src/renderer/pages/settings/ProviderSettings/utils/__tests__/modelSync.test.ts` | 正确默认值展示、拒绝过期响应、显式覆盖、选定字段预览及自动保存与重置顺序 |
| 端点传输 | `src/main/ai/provider/__tests__/endpoint.test.ts`、`endpointConnection.test.ts`、`config.test.ts`、`googleImageModel.test.ts`；`src/main/ai/voice/__tests__/speechModels.test.ts` | 实际 SDK URL、请求体、请求模型 ID、解析后的图像/音频/嵌入结果，以及不兼容配置不发送请求 |
| 功能调用方与聊天 | `src/renderer/pages/paintings/hooks/__tests__/usePaintingProviderOptions.test.ts`；`src/renderer/pages/settings/VoiceSettings/__tests__/VoiceSettings.test.tsx`；`src/shared/utils/__tests__/provider.serverTools.test.ts` | 功能选择器接受新模型，同时保留 LLM 顺序与端点专属服务端工具 |

持久化测试使用 `setupTestDatabase()` 和生产迁移。传输集成测试仅替换远端网络；只断言调用过 mock 不能证明契约。按实际嵌入选择路径补充受影响的知识库调用方覆盖。执行带显式文件的逐项目命令、改动文件 lint/format 检查、相关类型检查、文档影响检查和 `docs:check`，不运行全仓本地测试。

在已验证的工作区 Electron profile 中，用本地 HTTP fixture 执行 Google 生图模型创建、OpenAI TTS 朗读、嵌入地址继承、独立生图与编辑地址、未知模型配置、不兼容连接及选定字段重置。记录 UI 状态、发出请求、持久化结果和截图。真实云端授权与音质验收和模拟 HTTP 证据分开报告。实现 PR 按 AC 记录实际检查；Spec PR 只验证文档。

## 考虑过的替代方案

- 服务端忽略所有空数组：拒绝了用户主动清空的意图，并掩盖表单写入缺陷。
- 增加生图或 TTS 专用 URL 补丁：在调用方重复连接规则，其他创建路径仍然存在问题。
- 增加协议配置或提供商类别标记：重复已有端点连接，无法描述逐模型的部署差异。
- 复制全部标准模型端点或按名称推断协议：把模型来源误当成托管服务的接口契约。
- 自动重写已有数据或拒绝所有存在多种兼容地址的配置：丢失未记录的用户意图，或在没有必要性证据时改变既有回退行为。

## 验收条件

- AC1 — 同一个已知模型通过手动、批量或导入添加，未显式覆盖时具有等价的有效元数据。（verification: 渲染进程与真实数据库测试；owner: 模型创建）
- AC2 — 未修改默认值不形成覆盖；显式清空仍为空；恢复某字段会移除其覆盖并跟随默认值，包括输入模态的显式标记。矛盾的设置与重置请求不产生写入。（verification: 渲染进程与真实数据库测试；owner: 模型持久化）
- AC3 — 已知 Gemini 生图模型仅填写 ID 和 Google 连接即可出现在绘画中，并向该连接发送 `generateContent`。（verification: Electron 与本地模拟 HTTP；owner: 绘画）
- AC4 — 已知 OpenAI TTS 继承 OpenAI LLM 地址并请求 `audio/speech`；未知 TTS 模型可通过表单配置并选用于朗读。（verification: 渲染进程与模拟 HTTP 集成测试；owner: 语音）
- AC5 — 已知嵌入模型可在知识库中选择，并使用正确的继承或显式覆盖端点地址。（verification: 渲染进程与模拟 HTTP 集成测试；owner: 嵌入）
- AC6 — 无关编辑保留多个 LLM 端点及其顺序；切换端点采用对应的服务端工具行为。（verification: 渲染进程与 shared/main 测试；owner: 聊天路由）
- AC7 — 图像生成与编辑尊重适用目标端点及显式地址；只有 Google 的连接不能通过普通回退供 OpenAI 图片请求使用。（verification: 主进程与模拟 HTTP 集成测试；owner: 端点路由）
- AC8 — 过期默认值解析结果不能替换当前身份或显式编辑；失败查询不能当作未知模型；未知模型保持可编辑，不强制猜测协议。（verification: 渲染进程测试；owner: 模型表单）
- AC9 — 配置显示有效连接来源并解释缺少的兼容连接；同族和明确的 New API 继承仍然可用。（verification: 渲染进程与主进程集成测试；owner: 提供商设置）
- AC10 — 用户应用预览后的默认值恢复之前，已有数据保持不变；恢复只更新选定字段；排队保存不能重排重置或将其发送给其他模型，失败不能表现为成功。（verification: 渲染进程与真实数据库测试；owner: 模型持久化）

## 风险

Registry 描述可能不完整，也可能与网关部署不同。仍然需要显式覆盖和有意义的请求错误；不能根据地址推断普遍支持。`generateContent` 等通用端点需要模型级任务信息来区分生图和语音用途。

稀疏覆盖有意允许未修改的默认值随 registry 更新而变化。已有误覆盖将保留，直到用户选择重置。端点建议的改动必须保留明确的远端元数据、多端点顺序和服务端工具差异。

本地模拟 HTTP 证明路由与响应处理，不证明真实云端访问或音质。先前诊断结果是基线证据，不是这些验收条件已经实现的证明。本笔记记录提议目标，不标记实现完成。
