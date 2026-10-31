# Agent Note: 模型级 reasoning 能力覆盖

Status: proposed

[English](2026-10-27-per-model-reasoning-capability.md) | 中文

## 问题

Issue #22726 记录了一个端点拒绝 `max` 的情况。此前的修复尝试将全局 `gpt-5-6-luna` 声明限制到 `xhigh`，仅为 OpenAI 预设恢复 `max`。这会错误限制支持 `max` 的自定义端点，而绑定该预设的中转仍可能拒绝它。模型名称和预设绑定都不能证明实际端点的能力。

现有 `user_model.reasoning` JSON 保存系统推断的 metadata，包括自定义模型的推断控制项，并不记录用户显式意图。模型 CRUD 和编辑器未开放 reasoning shape 或支持等级覆盖。模型读取与请求构建分别解析 profile，因此仅增加编辑器无法保证展示的选项与最终请求一致。

这是新的功能决策；活跃 Agent Note 树中没有模型级 reasoning 覆盖的现有归属文档。根据[提案文档规则](../AGENTS.md)，其持久化与序列化契约需要人工批准后才能实施。

## 提案

### 恢复 catalog 事实

恢复 `gpt-5-6-luna` 的上游声明，包含 `max`。移除全局 `xhigh` 上限，以及仅用于恢复 `max` 的 OpenAI override。保留原有合理的端点 contract。注册表声明继续作为默认值；用户显式配置表达实际端点差异，绝不根据模型名称或 OpenAI 预设绑定推断。

独立保留本 PR 已有的最近档位修复，使用有效的具体等级列表，而不是全局削减后的 catalog 列表。

### 单独持久化显式意图

追加一条迁移，在 `user_model` 中新增 nullable JSON 列 `reasoningOverrides`；绝不重写已发布迁移。既有行初始值为 `null`。`reasoning` 继续保存系统推断的 metadata，绝不将其内容提升为用户意图。覆盖归属于既有行的提供商/模型身份，包括绑定预设的行；另一提供商下的相同模型 ID 属于不同作用域。

JSON 包含可选的模型级字段，以及以既有 endpoint-type 枚举为键的可选映射，其子项接受相同字段。只开放类型化输入：启用/禁用 reasoning 参数发送、format type、wire dialect、具体强度等级、独立的 Off/Auto 可用性，以及 budget profile 的 thinking-token limits。拒绝未知字段和枚举值。`selectableEfforts` 是只读派生输出，绝不是可写或单独持久化的真相源。

扩展现有模型创建/更新 DataApi schema、DTO 和 ModelService 读写路径。显式编辑即使等于当前注册表默认值，也持久化并在 reconcile 和 catalog 刷新后保留。metadata 推断绝不能覆盖它们。patch 省略字段表示保留原值；`null` 清空整列。覆盖内部的显式字段删除恢复该字段继承，端点子项删除恢复该端点的模型级/注册表继承。更新契约必须区分删除、省略和空列表。

### 解析单一有效配置

使用由 ProviderRegistryService 负责的单一 main 侧 resolver，输入为实际提供商行、模型行和解析后的出站端点。各字段按以下优先级生效：

1. 用户端点覆盖。
2. 用户模型级覆盖。
3. 注册表端点 contract。
4. 支持能力取注册表模型声明 / wire 编码取端点默认 profile。

缺省字段继承。显式具体等级整组替换继承列表，绝不做并集。一起解析 support 和 shape，验证兼容性，再派生 wire profile、模式可用性、`selectableEfforts` 和 summary 可用性。显式 format/dialect 选择采用匹配的既有 profile，不得保留低优先级 contract 中属于旧 shape 的操作。用户未选择 shape 时，保留既有端点 contract 和 Responses summary 设置。

模型读取提供所选实际端点的 resolver 投影。切换端点需要重新投影。UI 候选、存量选择收敛和最终编码消费同一份有效结果。请求根据当前持久化覆盖和实际出站端点再次解析，避免过期 UI 状态。任何消费者都不得用仅来自 catalog 的 support 覆盖结果，或独立推断另一份词表。Gateway 原生快速路径必须遵守生效覆盖，不能绕过它。

| 用户操作/状态           | 有效语义                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 具体等级 `[]`           | 没有可选的具体强度档位；不回退到继承等级。Default 和独立允许的 Off/Auto 保留各自 profile 语义。没有具体档位时，存量具体选择在展示/提交时使用 Default。 |
| 禁用 reasoning 参数发送 | 隐藏 reasoning 控件，不发送任何 reasoning 参数，包括 default 操作。这不保证服务端停止内部推理，也不同于发送 Off。保留其它覆盖字段供重新启用时使用。    |
| 清除覆盖 / 恢复默认     | 删除显式字段/子项，或将整列设为 `null`；继承当前注册表和剩余父级覆盖。绝不保存默认值快照，也不将已存强度选择改为 Default。                             |

### 闭合的 shape 范围与 adapter 兼容性

shape 指从 `packages/provider-registry/src/reasoningProfiles.ts` 中既有 `ReasoningFormatType` 和 `ReasoningWireDialect` profile 做有限选择。解释器操作和目标路径不作为用户输入。首期兼容矩阵如下：

| Format type        | 允许显式选择的 wire dialect                                     | 端点 / 支持的出站 adapter                                                  | 最终 HTTP 请求体契约                                                                                                                    |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `openai-chat`      | `effort`                                                        | `openai-chat-completions`；AI SDK OpenAI Chat 或 OpenAI-compatible adapter | `reasoning_effort`；不包含 Responses 的 `reasoning.effort` 结构                                                                         |
| `openai-responses` | `effort`                                                        | `openai-responses`；AI SDK OpenAI Responses 或 Open Responses adapter      | `reasoning.effort`；summary 遵循既有端点 summary 设置                                                                                   |
| `anthropic`        | `effort`、`budget`、`adaptive-always`、`adaptive-between-tools` | `anthropic-messages`；AI SDK Anthropic adapter                             | 既有 adaptive `thinking` 加 `output_config.effort`，或 enabled `thinking` 加 `budget_tokens`；保留既有 always-on/between-tools 模式契约 |
| `gemini`           | `effort`、`budget`                                              | `google-generate-content`；AI SDK Google adapter                           | `generationConfig.thinkingConfig` 分别使用 `thinkingLevel` 或 `thinkingBudget`，二者不能共存                                            |
| `ollama`           | `effort`                                                        | `ollama-chat`；既有 Ollama adapter                                         | `think` 使用既有布尔值/等级编码                                                                                                         |
| `none`             | 无 dialect                                                      | 上述任意端点，通过对应 adapter                                             | 不包含 reasoning 参数                                                                                                                   |

省略 dialect 时，保留兼容的继承 dialect，或使用该 format 的既有默认值。不支持的显式组合校验失败，绝不静默选择另一 shape。应用端点覆盖后，模型级选择必须与每个已启用端点兼容；可用端点子项解决协议差异。校验同时考虑端点类型和 adapter 身份。用户未选择 shape 时，厂商特有的注册表 contract 保持不变；不开放其原始 descriptor 编辑。

AI SDK 聊天和 API Gateway 出站支持该矩阵，并使用同一 resolver。Pi 和 Claude Code 可通过既有 Gateway 路由遵守覆盖，由实际目标提供商/模型和端点负责最终编码。其 SDK 直连路径不承诺承载任意 shape：不受支持的直连路由存在生效覆盖时，必须在 HTTP 发送前明确失败，并指明支持 Gateway 路由。不得静默忽略覆盖，也不得自动改路由。没有覆盖的路由保持既有行为。验证既要覆盖出站 adapter，也要覆盖路由边界。

不引入任意 JSON 模板、JSONPath、表达式、端点探测、自动检测或新 wire dialect。budget shape 复用既有 token-limit、fallback 和 output-token clamping 策略；根据所选 profile 校验显式 limits 和模式可用性。绝不宣称支持 adapter 无法编码的模式。若 adapter 无法传递表中 profile，必须先修复上游 adapter 再宣称支持；仅断言 SDK provider options 不能证明成功。

### 编辑与收敛

在现有模型编辑器中使用共享 UI 组件和本地化文案增加 reasoning 区。初始为继承模式，展示有效值及其来源。支持模型级或端点目标编辑、兼容 shape 与具体等级选择，以及独立 Off/Auto 设置。保存前校验。按上述删除语义提供逐字段继承、端点重置和整体恢复默认操作；保存/重置后刷新当前端点投影。

保留既有最近具体等级映射、排序和距离相同时的选择规则。只有有效列表中的具体强度（`minimal`、`low`、`medium`、`high`、`xhigh`、`max`、`ultra`）参与。Default（`default`）、Off（`none`）和 Auto（`auto`）是模式，绝不是距离映射候选。保留既有 profile 特定语义，包括请求模式不可用时省略发送；最近档位映射不得将模式转为具体强度。toggle-only 控件仍为 Off/Auto 控件，不产生虚构档位。

收敛对每个已存选择只读，包括本模型自己的值。展示有效收敛值，并通过同一 resolver 提交。配置或端点变化不得重写助手、话题、其它模型或其它端点。用户显式选择保留既有保存行为。因此，返回支持 `max` 的端点后，会再次呈现保留的 `max` 选择。

### 已接受的过渡状态

移除全局上限会在本功能可用前恢复 `max`。因此，在用户为该提供商/模型或端点显式配置支持等级之前，Issue #22726 中拒绝该值的端点可能再次返回 HTTP 400。人类评审明确接受这一过渡状态。不得通过恢复全局限档、仅为预设补回能力，或端点推断来掩盖它。

## 考虑过的替代方案

- 在 `user_model.reasoning` 内复用显式覆盖子对象：可避免列迁移，但会混合推断 metadata 和用户意图，要求每次 metadata 重写都保留两者。选择独立 nullable 列和追加迁移。
- 全局将 Luna 限到 `xhigh`，可选地为 OpenAI 补回能力：不采用，因为单个中转的拒绝不能重定义模型能力，预设身份也不能证明端点支持。
- 编辑独立的 `selectableEfforts` 列表，或合并用户/catalog 等级：不采用，因为会形成冲突真相或重新加入已排除等级。
- 重置时保存默认值快照，或收敛时重写已存选择：不采用，因为默认值将无法继承更新，端点局部限制也会抹去其它场景使用的选择。
- 任意 wire 模板或自动检测能力：排除在外，因为既有有限 profile 提供类型化、可验证的边界，无需新增模板语言或探测契约。

## 验收标准

- AC1 — 支持 `max` 的自定义 Luna 端点在没有覆盖时及显式配置 `max` 后均发送 `max`；显式等级决定的行为在绑定和未绑定 OpenAI 预设时一致，catalog Luna 包含 `max` 且无需 OpenAI 补偿 override。 (verification: registry unit + main resolver + captured HTTP; owner: registry and AI SDK integration)
- AC2 — 显式将端点限制到 `xhigh` 后，已存 `max` 展示为 `xhigh`，最终 HTTP 请求也发送 `xhigh`；覆盖两种预设绑定状态及 OpenAI Chat/Responses 端点。 (verification: renderer + captured HTTP; owner: model controls and AI SDK integration)
- AC3 — 覆盖遵循字段级优先级，列表整组替换而非并集，修改某个提供商/模型/端点不影响其它作用域；收敛绝不重写任何已存强度，包括本模型自己的值，返回后恢复保留的选择。 (verification: resolver unit + real database + renderer; owner: ModelService and model controls)
- AC4 — 矩阵中每个支持的 shape/dialect 都在 AI SDK 聊天和 Gateway 出站的真实 HTTP 请求体中生效，不残留不兼容的旧 shape 字段；无效端点/adapter 组合明确失败，Pi/Claude Gateway 路由遵守覆盖，不支持的直连路由在 HTTP 发送前失败，不能忽略覆盖。 (verification: adapter HTTP capture + route integration; owner: AI SDK, Gateway, Pi, and Claude Code integrations)
- AC5 — 显式配置经模型重新读取、catalog 刷新、reconcile 和应用重启后仍保留；重置删除覆盖并重新继承当前注册表；已有数据的数据库迁移后保留旧 metadata/业务行，并将覆盖初始化为 `null`。 (verification: file-backed database migrate-forward + Electron restart; owner: model persistence)
- AC6 — Default/Off/Auto、toggle-only 控件、`minimal`/`ultra` 和最近档位距离相同时的选择行为保留各自契约；空等级、禁用参数发送和清除覆盖具有不同的可观察结果，模式绝不参与最近档位映射。 (verification: resolver/serializer unit + renderer + HTTP capture; owner: reasoning controls and serialization)
- AC7 — 官方 OpenAI 和其它没有覆盖的模型保留注册表定义的候选和出站请求，包括 Chat/Responses 行为及 Responses summary 设置；历史推断 `reasoning` 绝不变成用户覆盖。 (verification: focused model-read and HTTP regressions; owner: registry and model/runtime integrations)
- AC8 — 编辑器展示继承来源、端点目标、独立 Off/Auto 控件、校验和重置操作；保存、重置、切换端点后，候选、展示收敛和最终编码均与同一 main resolver 结果一致，不存在可写的 `selectableEfforts` 副本。 (verification: DataApi schema + renderer + Electron and HTTP integration; owner: model editor and effective-config resolver)

## 风险

- 恢复 catalog 事实会有意让 Issue #22726 的 HTTP 400 再现，直到端点得到显式配置。说明继承与重置，不得声称已经探测出端点支持能力。
- SDK adapter 可能重命名/丢弃 provider options，Gateway 快速路径或智能体直连路由可能绕过投影。最终 HTTP 捕获和路由边界检查是必需证据；provider-options 断言不足以验收。
- catalog 刷新、过期 renderer 数据和端点选择差异可能覆盖用户意图，或导致展示词表与请求不同。必须一致解析实际端点，并保持收敛只读。
- 追加迁移和 CRUD 契约必须保留已有数据库数据，并区分删除与省略。历史 metadata 缺乏可靠的用户意图来源，必须继续作为 metadata。
- profile 特定的 budget 和模式可能使单独合法的字段在组合后不兼容。校验完整有效配置；未来扩展 profile 需要单独评审兼容性和 HTTP 证据更新。
