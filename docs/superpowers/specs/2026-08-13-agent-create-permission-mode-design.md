# 新建智能体权限模式设计

## 目标

在新建智能体向导中恢复权限模式设置，并将新建智能体的默认权限模式设为
`bypassPermissions`。用户可以在创建前改选其他模式，最终选择随创建命令持久化。

本次只调整当前 `main` 分支的 renderer 创建流程。现有智能体、助手创建流程、IPC
协议、主进程创建服务和数据库结构不变。

## 现状与根因

v1 的新建智能体弹窗直接展示权限模式选择，并把选择写入
`configuration.permission_mode`。当前 `main` 的编辑智能体弹窗也保留了完整选择器，
包括模式图标、描述以及 `bypassPermissions` 的危险提示。

v2 创建流程迁移到共享 `ResourceCreateWizard` 后，创建表单只收集头像、名称、模型、
提示词、知识库和技能。权限模式没有进入表单值；`buildCreateAgentCommand()` 因而只能
固定写入 `default`。创建命令 schema、IPC handler、`AgentService` 和 SQLite JSON 配置列
已经能够接收并持久化任意合法权限模式，缺口仅位于 renderer 创建表单和 DTO 映射。

## 推荐方案

### 组件边界

从编辑弹窗现有实现中提取受控的 `PermissionModeSelect`。它只负责权限模式选项的共享
展示和选择交互，公共 API 保持为：

- `value: PermissionMode`
- `onValueChange: (value: PermissionMode) => void`
- `portalContainer: HTMLElement | null`

创建向导和编辑弹窗继续各自持有表单状态、标签、布局和保存副作用。公共组件复用现有
`permissionModeCards`、`PermissionModeIcon`、`PermissionModeOptionLabel` 及 i18n 文案，
不新增配置对象、全局状态或隐藏 UI 通道。

### 创建表单与数据流

`ResourceCreateWizardFormValues` 和提交值增加 `permissionMode`。向导打开时：

- `kind === 'agent'`：默认 `bypassPermissions`；
- `kind === 'assistant'`：该字段不展示，助手 DTO 仍忽略它。

智能体的“能力”步骤在技能选择器上方展示权限模式字段。选择变化通过
`react-hook-form` 写回 `permissionMode`。提交时，向导将该值传给
`buildCreateAgentCommand()`，后者不再固定写入 `default`，而是写入用户最终选择。

数据流如下：

`PermissionModeSelect` → 创建表单 `permissionMode` → `ResourceCreateWizardValues` →
`buildCreateAgentCommand()` → `configuration.permission_mode` → 既有 IPC/主进程持久化。

### 安全与交互

`bypassPermissions` 会跳过工具授权，因此默认选中时仍必须使用现有危险色、危险图标和
警告文案。下拉选项与编辑智能体弹窗保持一致；本次不增加额外确认弹窗，因为需求明确
要求它作为默认值，而创建按钮提交的就是当前可见选择。

关闭并重新打开创建向导时，表单重置为 `bypassPermissions`。切换步骤不会重置选择。
提交失败时沿用向导现有错误处理，表单和值保持可继续编辑。

## 备选方案与取舍

1. 在 `CapabilityStep` 复制编辑弹窗选择器：改动局部，但会形成第二份模式渲染与危险
   提示实现，后续容易漂移。
2. 新增独立“权限”步骤：风险提示更醒目，但为一个字段增加流程步骤，扩大了本次修复
   范围。
3. 只把固定默认从 `default` 改为 `bypassPermissions`：不能恢复用户在创建时设置权限
   模式的能力，只解决默认值而未解决功能回归。

推荐共享受控选择器并放入现有“能力”步骤，因为它同时满足两个现有消费者，状态归属
清晰，并保持创建流程长度不变。

## 测试与验收

最低充分验证范围：

- 公共选择器：默认危险模式的标题、警告和选择回调可被用户观察；
- 创建能力步骤：默认值为 `bypassPermissions`，用户可切换，技能选择行为不回归；
- 创建向导：智能体提交所选权限模式，关闭重开恢复默认；助手实际 DTO 不受影响；
- 创建命令映射：`configuration.permission_mode` 等于传入选择，而不是固定常量；
- 编辑弹窗：原有权限模式选择和保存行为保持通过。

按用户要求不运行全量 `pnpm test`，也不运行会间接执行全量测试的
`pnpm build:check`。实现时运行上述相关 Vitest 文件，以及 `pnpm typecheck`、
`pnpm i18n:check` 和针对改动文件的格式/静态检查。若全局 `pnpm lint` 会写入无关文件，
改用等价的只读或定向命令并明确记录未运行的全量检查。
