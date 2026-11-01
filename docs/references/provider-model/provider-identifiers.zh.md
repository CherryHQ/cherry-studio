---
description: 可编辑的服务商别名、稳定的内部身份及外部模型地址兼容规则
sources:
  - src/main/data/services/ProviderService.ts
  - src/main/data/db/schemas/userProvider.ts
  - src/shared/data/api/schemas/providers.ts
  - src/main/features/apiGateway/utils/models.ts
  - src/renderer/pages/settings/ProviderSettings/ProviderList
  - src/renderer/pages/code/cliConfig
---

# 服务商标识

[English](./provider-identifiers.md) | 中文

每个服务商都有稳定的内部 `providerId`，对外类型为 `Provider.id`。模型和其他持久化引用使用这个身份。可选的 `alias` 属于服务商配置，不会重命名内部 ID，也不依赖显示名称。

## 配置别名

新增或编辑服务商时，可以填写编辑器中的**服务商标识**。留空则使用内部 ID。复制服务商时，别名初始为空。托管服务商沿用已有的编辑限制。

别名只能包含小写 ASCII 字母、数字、连字符或下划线。首尾空白会被去除，空值会清除别名。API 更新中省略该字段则保留已有值。数据库使用带唯一索引的可空列存储别名。

别名不能属于其他服务商（包括已禁用的服务商），也不能与其他服务商的内部 ID 或预设服务商保留 ID 相同。创建服务商时同样会检查其内部 ID 是否已被其他服务商用作别名。数据层在同一事务中完成校验和写入；更新被拒绝时，原有配置保持不变。

## 外部模型地址

设置别名后，API Gateway 以 `alias:apiModelId` 列出模型，否则使用 `providerId:apiModelId`。两种地址解析到同一个内部模型，并执行相同的可用性及权限检查。OpenAI、Anthropic、Gemini 和 token 计数路由共用此解析逻辑。响应中的模型字段保留请求使用的服务商前缀，并使用解析后的 API 模型 ID。

新生成的用户侧 Gateway 配置使用当前别名。Gemini CLI 后缀和 Antigravity 模型路径保持原有格式。内部调用方可以继续使用稳定的内部 ID。服务商导出包含别名元数据，但服务商和模型身份字段保持不变。除非另有说明，其他 DataApi 端点仍要求内部 ID。

修改或清除别名后，后续列表和请求立即使用新值。使用旧别名的外部配置需要更新，内部 ID 地址继续有效。旧别名不会成为重定向，释放后可分配给其他服务商。

已有数据库通过追加迁移获得值为 `NULL` 的别名列；服务商 ID、模型 ID 及其引用保持不变。
