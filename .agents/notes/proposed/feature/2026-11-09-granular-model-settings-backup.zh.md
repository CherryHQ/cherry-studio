# Agent Note: 模型设置的细粒度备份

Status: proposed

[English](2026-11-09-granular-model-settings-backup.md) | 中文

## Problem

备份目前是全有或全无。在多台机器上使用 Cherry Studio 的用户，希望只携带服务商与模型配置（API 密钥、端点 URL、模型列表、启用状态、上下文上限覆盖），而不覆盖聊天记录、智能体或界面偏好。v2 数据层将服务商存于 `user_provider`，模型存于 `user_model`，但目前没有只触及这两张表的导出或导入路径。

## Proposal

在数据设置中现有备份与恢复控件旁新增一行"模型设置"，包含两个操作。

**文件。** 导出写入一个 JSON 文档，建议文件名为 `cherry-studio-models-YYYYMMDD.json`：

```json
{ "format": "cherry-studio-model-settings", "version": 1, "exportedAt": 1762646400000,
  "providers": [ ... ], "models": [ ... ] }
```

服务商条目使用 `CreateProviderSchema` 的字段（不含 `logo`），并加上 `isEnabled`。模型条目使用 `CreateModelSchema` 的字段，并加上 `isEnabled` 与 `isHidden`。两者均复用现有 schema，使文件与 DataApi 契约保持一致。排除项：logo 绑定、排序键、时间戳、`notes`、`reasoning`、`isDeprecated`、Cherry 托管的服务商及其默认模型，以及所有非模型表。引用某模型的助手默认设置不导出。

**导出来源。** 主进程直接读取已存储的覆盖行，而非经注册表补全的 `Model` 或 `Provider` 对象，因此预置值不会被固化进文件。预置模型只导出其已存储的覆盖项。保存对话框与发起请求的窗口绑定，与 `ExportService` 一致。导出前渲染进程显示确认提示，说明文件包含 API 密钥。

**导入。** 导入分两步执行：

1. `preview`：主进程打开文件选择对话框，拒绝超过 10 MiB 的文件，解析 JSON，用严格的文档 schema 校验，与当前数据比对得出冲突，并返回校验后的文档与冲突列表。此步不写入任何数据。
2. `apply`：渲染进程将文档连同每个冲突的决定一并回传。主进程重新计算冲突后写入。

每个冲突对应一行：服务商（`providerId`）或模型（`(providerId, modelId)`）。对话框为每行提供"替换"或"跳过"，并提供"全部替换"与"全部跳过"。没有决定的冲突按跳过处理。取消对话框则不写入任何数据。

**写入语义。** 写入通过 `providerService` 与 `modelService` 的公共方法完成，即 DataApi 处理器所调用的同一批方法，因此托管服务商保护、注册表补全与版本检查仍然生效。服务商先于模型写入，以便模型的外键能够解析。

- 新服务商：`create`，若 `isEnabled` 为真则再 `update`，文件列出密钥时再调用 `replaceApiKeys`。
- 替换服务商：`update` 写入文件中存在的服务商字段（`name`、`endpointConfigs`、`defaultChatEndpoint`、`authConfig`、`providerSettings`、`isEnabled`），文件列出 `apiKeys` 时再调用 `replaceApiKeys`。文件中缺失的 `providerSettings` 顶层键被设为 `null` 以清除；其他缺失的服务商字段保持不变。
- 新模型：以创建字段调用 `create`，仅当 `isEnabled` 或 `isHidden` 与默认值不同时再 `update`。
- 替换模型：以文件中的全部字段调用 `update`。文件中缺失的可空上限（`contextWindow`、`maxInputTokens`、`maxOutputTokens`）设为 `null`；文件中缺失的其他字段保持不变。

每个条目独立尝试。结果列出已创建、已替换、已跳过与失败的数量，每个失败项附带其类别、标识与错误信息。服务商失败时，其模型以 `provider_not_imported` 原因计入失败。

**归属。** 导出与导入逻辑位于 `src/main/services/ModelSettingsBackupService.ts`，是与 `ExportService` 相同的非生命周期单例。路由声明于 `src/shared/ipc/schemas/modelSettings.ts`，处理器位于 `src/main/ipc/handlers/modelSettings.ts`。文档 schema 位于 `src/shared/types/modelSettingsBackup.ts`。渲染进程在 `BasicDataSettings.tsx` 中新增一行，并在 `DataSettings/` 下新增冲突弹窗。`LegacyBackupManager`、备份归档及其恢复路径均不修改。

## Alternatives considered

- **仅渲染进程，使用现有 DataApi 读取。** 读取结果经注册表补全，会把注册表数据固化为用户覆盖项（即 #17096 所述的问题），且无法区分已存储的覆盖与默认值。
- **新增 DataApi 端点。** 原生文件对话框与文件 I/O 属于主进程职责；预览/应用的组合操作是命令式的，而非资源式 CRUD。
- **为完整备份归档增加仅模型模式。** 归档是 v1 的逐字镜像并包含数据库快照；部分恢复需要改写归档，且无法解决合并到已有配置的问题。
- **单事务全有或全无导入。** `ProviderService` 与 `ModelService` 未提供可组合进事务的创建或更新方法。使其可组合属于上游重构，会影响众多调用方。本 Spec 不承担该重构；部分失败的代价见 Risks，逐项结果使其可见。是否推进上游重构由维护者决定。
- **在文件中加密 API 密钥。** 需求要求与完整备份相同的处理方式；引入第二套密钥管理超出范围。

## Acceptance criteria

- AC1 — 导出的文档通过严格 schema 校验，且仅包含 `providers` 与 `models` 数组；不出现话题、消息、智能体、助手、文件或偏好数据（verification: unit）
- AC2 — 预置模型仅导出已存储的覆盖列；Cherry 托管的服务商及其默认模型不出现在文件中（verification: unit）
- AC3 — 导入时拒绝错误的 `format`、不支持的 `version`、超过 10 MiB 的文件、非法 JSON 以及任何格式错误的条目，且在此之前不写入任何数据（verification: unit）
- AC4 — 在空数据库上导入时，每个服务商被创建并带有其 API 密钥、端点配置与启用状态，每个模型被创建并带有其启用与隐藏状态（verification: unit）
- AC5 — 冲突按服务商与 `(providerId, modelId)` 逐条检测；替换决定覆盖列出的字段，跳过或缺失决定则保持行不变，替换模型时清除文件中缺失的可空上限（verification: unit）
- AC6 — 单个条目失败不影响其他条目，结果逐条列出失败的类别与标识；未导入服务商的模型以 `provider_not_imported` 报告（verification: unit）
- AC7 — 冲突对话框提供逐行的替换与跳过，以及全部替换与全部跳过；取消时不写入任何数据；导出前显示 API 密钥警告（verification: renderer）
- AC8 — `LegacyBackupManager` 及现有备份与恢复测试无改动通过（verification: unit）
- AC9 — 新增字符串在每个渲染进程语言包中均有译文，并通过 `pnpm i18n:check`（verification: docs gate）
- AC10 — 在一个配置中通过原生对话框保存的文件，可在第二个配置中导入并得到预期的服务商与模型（verification: Electron）

## Risks

- 导出文件以明文存储 API 密钥，与完整备份相同。唯一的缓解措施是警告提示。
- 导入不是原子的。条目逐个写入，且单个条目可能需要多次服务调用（例如先 `create` 再 `update` 设置 `isEnabled`）。调用之间的失败或崩溃会使该条目部分生效；运行中途崩溃则使先前的条目已写入。重复导入同一文件是安全的：已存在的行成为冲突，默认跳过将保持其不变。
- 替换服务商时，文件中缺失的 `providerSettings` 顶层键会被清除；嵌套对象沿用现有的 merge-patch 语义合并，因此文件中被删除的嵌套键在替换后仍会保留。本版本接受此限制。
- `notes` 与 `reasoning` 不导出，模型的自由文本备注不会在机器之间迁移。
- 导出的预置覆盖项可能指向将在后续版本中变化的注册表值；导入的机器会在该覆盖项下看到较新的注册表值。
