# Agent Note: 按声明的聊天端点路由 Poe 机器人

Status: implemented

[English](2026-10-28-poe-chat-endpoint-routing.md) | 中文

## 问题

Poe 列表丢弃了 `supported_endpoints`。没有注册表端点覆盖值的模型会继承 Responses，包括据报告因 HTTP 400 和 `invalid_request_error: Model does not support responses method` 而失败的 `perplexity-adv-deep-research`。

提供的 2026-10-28 快照包含 301 条记录：244 条为空声明，26 条支持 Responses 加 Chat Completions，14 条仅支持 Chat Completions，7 条支持 Messages 加 Responses 加 Chat Completions，2 条仅支持 Responses，8 条仅支持视频。声明不能证明经过鉴权的请求会被接受。模型拉取只添加缺失记录，不刷新保留记录。

## 决策

Poe 获取器使用配置的主机与凭据，也适用于固定到 Poe 预设的克隆。它保留原始 API ID，映射三个可识别的聊天路径。它取注册表端点偏好与声明的交集，保留注册表顺序；没有可用偏好时按 Messages、Responses、Chat Completions 排序。缺失或空声明优先使用可用的注册表端点，否则使用有文档依据的 Chat Completions 兼容回退。格式错误的声明仅使所在条目被跳过。非空且仅包含视频或未知路径的声明不增加端点提示或新能力。

`PoeChatEndpointUpgradeSeeder` 在 `PresetProviderSeeder` 之后运行，仅修复冻结的 15 个 ID：快照中 14 个仅支持聊天的 ID，加上报告中的机器人。仅当标准 `poe` 记录的提供商默认端点存储值为 null，且模型端点为 null 或空数组时，才写入 Chat Completions。它精确比较存储的 `modelId`；该列对外暴露为 `apiModelId`。显式选择、克隆、ID、模型状态、置顶、顺序和名称均保留。查询与写入在一个同步事务内完成。`hashObject` 根据修正数据生成版本。正常启动在迁移后执行种子，而 v1 导入有意跳过种子，因此导入的记录在正常启动时得到修复。

[PR #14144](https://github.com/CherryHQ/cherry-studio/pull/14144) 确立了 Responses 默认值。本修复保留它以及 Claude 注册表端点列表，包括不允许 Responses 的约束。推理契约、序列化器、端点配置和网关路由均不变。

## 备选方案

- 修改提供商默认值：不采用，因为双端点模型会失去原有 Responses 路由，而仅支持 Responses 的模型会收到未声明的方法。
- 仅修改获取器：不采用，因为保留记录在移除并重新添加之前仍然无法使用。
- 修复全部 301 条记录或增加模型家族路由：不采用，因为这会固定无关的继承配置，并引入需要维护的能力目录。
- 重试 HTTP 400 或分类视频：推迟，因为重放和生成传输需要独立契约。

## 影响

15 个 ID 之外的保留记录不会被修复。拉取为获取后新增的记录提供路由，但不刷新保留记录；替换此类记录后才会使用新获取的元数据。该历史修复不是应持续扩展的能力刷新机制。空声明不代表模态、工具、推理支持或价格信息。

离线映射 301 条记录时，每个唯一模型调用一次 `resolveModel`。冷加载测得 58.14 ms；缓存预热后为 3.01–5.40 ms（中位数 3.56 ms），不含传输和响应解析。解析使用注册表缓存，按需加载本地文件，不访问 SQLite 或网络。

## 验证

- Regression — `listModels.test.ts`：修复前端点断言失败；修复后声明顺序、Claude 交集、缺失或空声明回退、错误条目隔离、去重、原始 ID 和克隆的配置传输均通过。
- Regression — `endpoint.test.ts`：修复前报告中的无端点机器人继承 Responses；映射后的研究模型选择 Chat Completions，GPT-5.2 保留 Responses，Claude 保留 Messages 并拒绝 Responses 偏好。
- Regression — `PoeChatEndpointUpgradeSeeder.test.ts`：修复前唯一的 RED 证据是模块缺失；使用生产迁移的 SQLite 验证全部 15 个 ID、保留条件、ModelService 读取、置顶、状态与顺序、幂等性以及注入写入故障后的回滚。
- Regression — `modelSync.test.ts` 和 `doctorContent.test.ts`：获取的 Poe 端点经元数据补充和 DTO 转换后保留；全部 20 个类别通过全部 15 个真实渲染进程语言目录解析。每个目录都包含独立的 `bad_request` 键的真实翻译。
- Regression — 直接运行 Vitest，161 个主进程测试和 22 个渲染进程测试通过；i18n 校验通过 96416 条翻译；默认堆内存耗尽后，使用 `NODE_OPTIONS=--max-old-space-size=16384` 的 node 类型检查通过。

报告中机器人的 Poe 鉴权请求接受情况及有效流式输出仍未验证，因为本机没有可用的 Poe API 密钥。不声称已验证 Electron 启动或真实提供商请求。
