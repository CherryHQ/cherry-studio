# OpenClaw 配置预检与 Cherry 管理区重建设计

## 状态

- 日期：2026-08-03
- 状态：已完成讨论，待书面规格复审
- 范围：Cherry Studio 启动 OpenClaw 前的配置同步、校验、错误呈现与安全日志

## 背景与问题

Cherry Studio 当前在启动 OpenClaw Gateway 前调用 `openclaw.sync_config`，随后调用
`openclaw.start_gateway`。`OpenClawService.syncProviderConfig` 会读取用户的
`~/.openclaw/openclaw.json`，合并一个 `cherry-<providerId>` Provider，再直接覆盖原文件。

故障截图中的实际错误为：

- `models.providers.cherry-minimax.maxTokens` 不被当前执行的 OpenClaw 接受；
- `models.providers.cherry-cherryin.maxTokens` 不被当前执行的 OpenClaw 接受；
- `tools.web.fetch.ssrfPolicy` 不被当前执行的 OpenClaw 接受。

仓库实现表明，Cherry 当前只在模型级生成 `maxTokens`，不会生成 Provider 级
`maxTokens`；但同步时会展开并保留旧的 `cherry-*` Provider 和模型字段。因此，历史版本、
手工编辑或其他 OpenClaw 版本留下的 Cherry Provider 字段可能持续存在，并阻塞整个
OpenClaw 配置。`ssrfPolicy` 不由 Cherry 生成，属于用户或 OpenClaw 管理的外部配置。

直接根因是“实际执行的 OpenClaw 二进制所接受的 Schema”与磁盘配置不一致。Cherry 的
问题在于它会保留自己命名空间中的陈旧字段，并且写入和启动前没有用实际二进制验证最终配置。

## 目标

1. Cherry 只重建自己拥有的 `models.providers["cherry-*"]` 配置，消除陈旧 Cherry 字段。
2. 写入前使用 BinaryManager 实际解析出的 OpenClaw 二进制验证候选配置。
3. Gateway 启动前再次验证正式配置，避免把 OpenClaw 的 Schema 错误推迟到启动阶段。
4. 保留非 Cherry 配置及其所有权；外部配置无效时给出可操作、脱敏的错误。
5. 保持现有两段 IPC 和 Toast 交互，不引入共享契约或基础设施改造。

## 非目标

- 不自动删除或改写 `tools.web.fetch.ssrfPolicy` 等非 Cherry 字段；
- 不自动运行 `openclaw doctor --fix`；
- 不根据 Schema 动态删除 Cherry 字段或生成降级配置；
- 不增加用户自定义 OpenClaw 配置路径；
- 不新增 JSON5 解析能力，现有 JSON-only 行为保持不变；
- 不增加外部并发编辑检测、重试或长期备份；
- 不重构 `openclaw.cherry.json` 的旧配置迁移；
- 不修改 OpenClaw IPC Schema、BinaryManager、通用进程执行器或其他 CLI 适配器；
- 不新增 Modal、页面或端到端测试。

## 与其他 CLI 的对齐方式

Codex、OpenCode 和 Kimi 的配置构建器会删除已有 `cherry-*` Provider，再从 Cherry 当前选择
重建管理区；非 Cherry 内容继续保留。本设计采用相同的所有权模型。

其他文件型 CLI 通过现有配置写入器执行 `0600` 原子写入。本设计复用同一个
`atomicWriteFile` 能力，但不把 OpenClaw 纳入通用批量写入器，因为 OpenClaw 还需要调用
自身二进制执行 Schema 校验。

OpenClaw 严格拒绝未知配置键，因此 `config schema` 能力探测、`config validate --json`
候选校验和启动前复检是 OpenClaw 特有步骤。它们不要求其他 CLI 复制相同命令，只遵循
“由实际消费者验证其配置”的共同原则。

## 配置所有权

### Cherry 独占管理

`models.providers` 下所有键名以 `cherry-` 开头的完整 Provider 子树由 Cherry 独占管理。
同步时：

1. 删除所有旧的 `cherry-*` Provider，包括当前已不再选择的 Provider；
2. 根据当前选中的 Provider、启用且兼容的模型及 Cherry 中的模型元数据，重建唯一的
   `cherry-<selectedProviderId>`；
3. 不保留该子树中的手工字段、旧 Header、旧模型覆盖或未知键；
4. 将 `agents.defaults.model.primary` 指向新建 Provider 下的当前模型。

这改变了现有“OpenClaw 中的手工 Cherry 字段优先”行为。该变化是修复陈旧字段无法清除的
必要条件，也是与其他 CLI 管理区语义对齐的结果。

### Cherry 不拥有

除上述 `cherry-*` Provider 子树和当前已由同步逻辑维护的启动配置外，现有根配置、工具配置
及非 Cherry Provider 原样保留。若它们被实际 OpenClaw 判定无效，Cherry 阻止写入和启动，
但不擅自修复。

## 二进制与环境

所有预检和 Gateway 启动都使用 `BinaryManager.getToolSnapshots(['openclaw'])` 返回的实际
可执行文件，沿用现有优先级和环境策略：

- `source === 'system'`：使用用户原始 Shell 环境；
- Cherry 管理的来源：使用刷新后的 Cherry 管理环境。

不以版本号作为兼容性条件，因为系统二进制可能没有可用版本号。最低能力条件为：

- `openclaw config schema --json` 可成功执行并返回可解析的 JSON 对象；
- `openclaw config validate --json` 可执行并返回可解析的结构化结果。

Schema 只用于确认能力，不用于动态改写或降级 Cherry 配置。候选配置是否兼容，以实际
`validate` 结果为准。

Cherry 启动的 OpenClaw 进程显式设置 `OPENCLAW_CONFIG_PATH`。正式预检与 Gateway 指向
`application.getPath('external.openclaw.config')/openclaw.json`，不受用户 Shell 中同名环境
变量影响。候选校验是唯一例外：它临时指向同目录的候选文件，以实现先验证、后覆盖。
用户在终端中自行运行 OpenClaw 的行为不受影响。

## 同步流程

`openclaw.sync_config` 保持现有 IPC 输入输出，内部按以下顺序执行：

1. 应用调用方传入的 Gateway 端口，并解析当前 Provider、模型、Endpoint 和 API Key；
2. 通过 BinaryManager 解析实际 OpenClaw 二进制及其执行环境；
3. 执行 `config schema --json` 能力探测；
4. 保持现有 `openclaw.cherry.json` 迁移代码及顺序，不在本修复中改变其备份语义；
5. 读取正式 `openclaw.json`。解析失败时保持现有“报错且不覆盖”行为；
6. 保留非 Cherry 内容，删除全部 `cherry-*` Provider，构建规范候选配置；
7. 在配置目录内创建权限为 `0600` 的唯一候选文件；
8. 令 `OPENCLAW_CONFIG_PATH` 临时指向候选文件，执行 `config validate --json`；
9. 无论结果如何都清理候选文件；
10. 只有候选结果 `valid: true` 时，才以 `0600` 调用 `atomicWriteFile` 覆盖正式配置；
11. 返回现有 `OperationResult`。

候选验证返回非阻塞警告时允许提交，同时把脱敏后的警告写入日志。

“校验失败不修改正式文件”的保证适用于现有旧配置迁移完成后的候选构建和提交阶段。由于旧
迁移明确不在本次重构范围，检测到 `openclaw.cherry.json` 时仍沿用当前先重命名文件的行为，
不为该既有步骤新增回滚。

## 启动流程

`openclaw.start_gateway` 仍是独立 IPC，不合并为新的 `openclaw.launch`：

1. 拒绝并发启动；
2. 解析实际二进制和执行环境；
3. 对正式 `openclaw.json` 执行 Schema 能力探测和 `config validate --json`；
4. 只有预检通过后，才检查端口、停止 Cherry 检测到的旧 Gateway 并启动新 Gateway；
5. Gateway 进程同时设置正式 `OPENCLAW_CONFIG_PATH` 和现有
   `OPENCLAW_NO_AUTO_UPDATE=1`；
6. 沿用现有健康检查和状态机。

把正式预检放在停止旧 Gateway 之前，可避免配置无效时先中断当前仍健康的进程。

Renderer 保持现有调用顺序。`sync_config` 失败后立即 Toast 并返回，绝不调用
`start_gateway`；同步成功后，`start_gateway` 对已提交文件复检。重复校验是有意的，因为两个
IPC 可以被独立调用，磁盘配置也可能在两次调用之间改变。

## OpenClaw 命令执行边界

在 `OpenClawService` 内增加私有、OpenClaw 专用的结构化命令执行方法，使用现有
`crossPlatformSpawn`，不修改共享 `processRunner`。原因是通用 `executeCommand` 在退出码非零
时会丢弃 stdout，而 `config validate --json` 会用非零退出码返回有价值的结构化校验结果。

私有执行方法必须：

- 同时保留退出码、受限 stdout 和受限 stderr；
- 设置本地命令超时，并在超时后终止子进程；
- 持续排空输出，但只保留有上限的诊断内容；超过上限视为预检失败；
- 正确处理 Windows `.cmd`；
- 不把命令完整输出直接放入日志或 `OperationResult`。

具体常量在实施计划中按现有本地命令惯例固定；它们不构成产品配置项，也不暴露给用户。

## 错误分类与用户呈现

不改变共享 `OperationResult`。服务内部分类后，仍返回 `{ success: false, message }`，Renderer
继续使用 Toast 展示。新增用户可见文本通过主进程 `@main/i18n` 提供中英文文案。

### `binary_incompatible`

以下情况使用该分类：

- `config schema --json` 不可用或没有返回合法 JSON；
- 候选配置存在路径位于 `models.providers.cherry-*` 的校验问题。

提示用户升级或切换 Cherry 当前实际使用的 OpenClaw 二进制。若候选同时包含 Cherry 和外部
问题，`binary_incompatible` 优先，但摘要仍包含经脱敏的代表性问题。

### `external_config_invalid`

候选或正式配置仅在非 `cherry-*` 路径失败时使用。Toast 最多展示三个问题路径和简短消息，
剩余问题显示数量，例如“另有 2 个问题”。提示用户修正外部配置或升级 OpenClaw，但 Cherry
不自动删除字段。

### `preflight_failed`

子进程无法启动、超时、validate 输出无法解析、结构不完整、没有 issues 却报告无效，或发生
候选文件 I/O 错误时使用。该分类不猜测配置字段，也不覆盖正式文件。

已有的二进制不存在、Provider/模型配置错误、JSON 解析错误和 Gateway 运行错误继续使用现有
失败路径及文案。本次只为新增的预检错误增加主进程 i18n，不顺带迁移既有文案，也不改变
IPC 类型。

## 日志与脱敏

`loggerService` 不提供自动秘密脱敏，因此 OpenClaw 边界必须在记录和返回前处理诊断文本。

允许记录：

- 二进制来源、路径及可用时的版本；
- 正式配置路径和候选文件生命周期；
- 命令阶段、退出码、问题数量和问题路径；
- 脱敏、截断后的问题消息与非结构化错误摘要。

禁止记录或返回：

- 候选配置、Schema 正文或完整 `openclaw.json`；
- API Key、Token、Password、Secret、Authorization/Bearer 值；
- 未脱敏或无限长度的 stdout/stderr；
- 完整环境变量。

脱敏覆盖大小写及常见 `apiKey`、`api_key`、`token`、`auth`、`secret`、`password` 和 Bearer
形式。文件和二进制路径保留，因为它们是定位实际配置与实际可执行文件所必需的诊断信息。
Gateway 早退时已有的前五行输出也必须先经过同一脱敏和长度限制再进入日志或错误消息。

## 写入与恢复语义

- 候选验证失败：清理候选文件，正式文件不写入；
- 正式写入失败：`atomicWriteFile` 保证旧文件仍可用或写入整体完成；
- Gateway 启动失败：不回滚已经验证并提交的配置；
- 不创建新的长期备份；现有旧配置迁移产生的 `.bak` 行为不变；
- 不比较读取后与提交前的外部文件内容，也不自动重试并发修改；
- 用户修正外部配置后再次点击启动，会重新读取、重建、验证并提交，不复用缓存候选。

这与其他 CLI 的原子文件写入原则一致，同时避免引入与当前报错无关的并发控制和恢复机制。

## 故障截图的恢复路径

对截图中的配置，第一次同步会在内存候选中删除两个旧 `cherry-*` Provider 的 Provider 级
`maxTokens`，但会保留外部 `tools.web.fetch.ssrfPolicy`。如果实际二进制仍拒绝该外部字段，
候选验证将只报告外部配置问题，并且不会覆盖正式文件。

用户随后可选择修正该外部字段，或升级到接受它的 OpenClaw。再次启动时，候选验证通过后才
提交已重建的 Cherry 管理区，旧 `maxTokens` 随提交消失，然后正式配置复检并启动 Gateway。
本设计故意不以一次点击越权删除外部配置来换取启动成功。

## 测试与验收

### `OpenClawService` 单元测试

1. 现有配置包含多个旧 `cherry-*`、Provider 级 `maxTokens` 和非 Cherry Provider：候选删除
   所有旧 Cherry Provider，只写入当前选中 Provider，并保留非 Cherry/根配置。
2. `tools.web.fetch.ssrfPolicy` 被 validate 拒绝：同步失败、正式文件不变，错误包含脱敏后的
   准确路径。
3. 新生成的 `cherry-*` 路径被拒绝：分类为二进制不兼容，正式文件不变。
4. Schema 命令不可用、validate 输出非 JSON、命令超时或候选 I/O 失败：阻止同步/启动并返回
   对应的本地化错误。
5. 合法候选：先验证候选，再以 `0600` 原子写入；正式预检与 Gateway 使用相同正式路径，
   候选校验仅使用临时候选路径。
6. `valid: true` 附带警告：允许写入并记录脱敏警告。
7. `apiKey`、Token、Bearer 等秘密出现在 issue 或非 JSON 输出时，不得出现在日志和
   `OperationResult`。
8. 启动时正式配置无效：预检失败，Gateway 不生成；若端口上有健康旧 Gateway，也不先停止。
9. 现有非法 JSON 测试继续通过；原文件内容保持不变。
10. System 与 Cherry 管理二进制分别使用现有对应环境，且都覆盖
    `OPENCLAW_CONFIG_PATH`。

### Renderer Hook 单元测试

补充 `sync_config` 返回失败时不调用 `start_gateway` 的断言。现有端口传递和成功启动测试继续
通过，不改变 Renderer 业务逻辑。

### 不纳入本次测试

JSON5、用户自定义配置路径、并发外部编辑、`doctor --fix`、动态 Schema 降级、新 UI 和 E2E
均不在本次验收范围。

## 实施文件边界

预计只修改：

- `src/main/services/OpenClawService.ts`；
- `src/main/services/__tests__/OpenClawService.test.ts`；
- `src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts`；
- `src/main/i18n/locales/en-us.json`；
- `src/main/i18n/locales/zh-cn.json`。

不新增公共模块或共享类型。OpenClaw 专用解析、错误分类和脱敏保持为服务文件内的私有函数或
私有类型；只有出现第二个明确消费者时才考虑抽取。

## 已拒绝的替代方案

1. **只删除截图中的三个字段**：会越权修改外部配置，也无法处理下一个陈旧 Cherry 字段。
2. **运行 `doctor --fix`**：修复范围由 OpenClaw 决定，可能改动用户未授权的非 Cherry 配置。
3. **按 Schema 动态降级字段**：会让不同机器生成不可预测配置，并掩盖二进制版本不兼容。
4. **新增单一 launch IPC**：可减少重复校验，但需要改共享 IPC 和 Renderer 调用契约，对本次
   局部修复没有必要。
5. **增加并发内容比较、JSON5 或迁移重构**：均不是截图报错的直接原因，会扩大风险和测试面。

## 完成标准

- Cherry 管理区不再保留旧 `cherry-*` 字段；
- 实际 OpenClaw 在候选写入前和 Gateway 启动前拥有最终否决权；
- 外部无效字段不被 Cherry 自动删除，错误能准确指向路径；
- 校验失败不会在正常候选流程中覆盖正式配置，也不会启动或先停止 Gateway；
- 日志和 Toast 不泄露配置秘密；
- 变更保持在上述文件边界，相关定向测试、项目规定的 lint/test/format/build 检查通过。
