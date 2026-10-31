# Agent Note: 可编辑的提供商标识

Status: implemented

[English](2026-10-27-provider-alias.md) | 中文

## 问题

自定义提供商使用自动生成的 ID。API Gateway 在 `providerId:apiModelId` 形式的模型地址中暴露这些 ID，其他客户端因此难以区分多个已配置的提供商。提供商名称是可编辑的显示文本，不要求唯一。现有 `user_provider.providerId` 是模型引用的内部主键，修改它会改变持久化身份。

## 决策

通过新生成的迁移，为 `user_provider` 增加一列可空的 `alias` 及唯一索引。已有行取值为 `NULL`；提供商 ID、模型 ID、预设关联和现有引用保持不变。在共享 `Provider` 类型中暴露该可选字段，并通过提供商创建和更新 API 接受它。提供商数据层负责校验和持久化；该字段不专属于 Gateway。

去除首尾空白。空值将标识清除为 `NULL`；非空标识只允许小写 ASCII 字母、数字、连字符和下划线。更新时省略该字段则保留原值。标识在启用和禁用的全部提供商中唯一。拒绝与其他提供商内部 ID 或属于其他提供商的保留预设 ID 相同的标识。创建提供商时，也必须拒绝已被其他提供商用作标识的内部 ID。在同一个同步写事务中完成冲突检查和写入，并保留标识的数据库唯一约束。

现有提供商编辑器增加可选字段，标签为“Provider identifier” / “服务商标识”。用户可在创建时及编辑已有可编辑提供商时设置、修改或清空该字段。显示校验和冲突错误时保留输入。复制提供商时不复制标识。修改显示名称不改变标识。受托管提供商的现有限制继续生效。

Gateway 在 `/v1/models` 中公布 `${provider.alias ?? provider.id}:${apiModelId}`。请求进入时，通过内部 ID 或标识将前缀解析为提供商，随后使用内部 ID 查找模型、检查权限并执行。两种形式定位同一模型，并保留全部现有可用性检查。OpenAI、Anthropic、Gemini 和 token 计数路由使用相同的解析逻辑。响应中的模型字段保留请求使用的提供商前缀，并使用解析后的 API 模型 ID，避免通过标识发起的请求意外返回内部 UUID。

面向用户生成的 Gateway 配置在存在标识时使用标识。内部消费者可继续使用稳定的内部 ID。Gateway 地址格式化与内部 `UniqueModelId` 构造保持分离，并保留 Gemini CLI 后缀及 Antigravity 路径处理。提供商导出可携带 `alias` 元数据，同时保留内部提供商和模型 ID；这不意味着每个 DataApi 端点都接受标识寻址。

修改或清空标识对后续请求和列表立即生效。之前使用内部 ID 配置的地址继续有效。旧标识不作为重定向历史保留；使用旧标识的外部客户端必须更新配置。不引入标识映射表、根据名称自动生成标识、主键重命名或其他标识消费者。

## 考虑过的替代方案

- 仅在创建提供商时允许自定义 `providerId`：改动更小，但用户无法在不重建已有提供商的情况下为其配置易辨认的标识。
- 重命名已有提供商主键：拒绝，因为模型和其他持久化引用使用这些身份。
- 将新列命名为 `gatewayId`：拒绝，因为标识属于提供商，未来可能被其他消费者使用。
- 使用 `name` 作为地址前缀：拒绝，因为显示名称既不唯一，也没有路由所需的字符约束。
- 增加标识映射表或重定向历史：每个提供商只需一个当前标识，无需增加额外的归属和复用规则。

## 结果与影响

数据层统一管理内部 ID、别名和预设保留 ID 的标识命名空间。冲突检查和修改在同一事务中进行，数据库唯一索引也约束别名。无需迁移主键或引入别名映射表。

修改或清空别名会使使用它的外部配置失效，编辑器已说明这一后果。内部 ID 地址仍然有效，释放的别名之后可属于其他服务商。已有记录迁移后别名为空，身份保持不变。

面向用户的兼容性约定见[服务商标识](../../../../docs/references/provider-model/provider-identifiers.md)。

## 验证

- AC1 — `src/main/data/db/__tests__/applyMigrations.populated.test.ts` 从含有数据的生产迁移基线向前迁移，验证服务商和模型身份、外键不变，并重新打开数据库确认别名持久化；`pnpm db:migrations:check` 通过。
- AC2 — `ProviderService.alias.test.ts`、`ProviderService.create.test.ts` 及共享 `schemas/__tests__/providers.test.ts` 覆盖去除空白、省略、清空、非法字符、禁用服务商冲突、保留 ID、双向碰撞、批量回滚和数据库唯一约束。
- AC3 — `ProviderEditorDrawer.test.tsx` 及已有 `useProviderEditor.test.ts` 通过。真实 Electron 独立数据目录验证了非法或冲突输入的保留、新增、编辑、清空和重载后的持久化；`pnpm i18n:check` 对全部语言校验通过。
- AC4 — Gateway 模型、代理、路由和 token 计数测试通过，包含别名解析及公开 Cloud 访问限制。通过独立 Electron Gateway 的真实 HTTP 请求验证 OpenAI Chat/Responses、Anthropic、Gemini、两种 token 计数接口，以及 Claude 上下文标记和 Gemini 后缀。
- AC5 — 别名数据库测试验证导出身份字段不变；Gateway 和 CLI 测试验证寻址、配置生成、Antigravity 路径和 Gemini CLI 哨兵后缀。真实 Gateway 响应保留请求的别名或内部 ID 前缀。
- AC6 — 真实 Electron 编辑和 HTTP 请求验证别名修改或清空后，列表和路由立即更新、旧别名失效、内部 ID 仍可访问。中英文参考文档及 `pnpm docs:check` 通过。
