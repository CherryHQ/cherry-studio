# 新建智能体权限模式实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在新建智能体向导中恢复权限模式选择，默认使用 `bypassPermissions`，并持久化用户创建前的最终选择。

**架构：** renderer 创建表单新增受控的 `permissionMode` 字段，并在智能体“能力”步骤展示。创建和编辑入口共用一个只负责渲染与选择的 `PermissionModeSelect`；表单状态和保存副作用仍由各自父组件持有。创建命令继续走既有 IpcApi 和 `AgentService`，不修改共享协议、主进程或数据库。

**技术栈：** React 19、TypeScript、react-hook-form、`@cherrystudio/ui`、Vitest、Testing Library

---

## 文件结构

- 创建：`src/renderer/components/PermissionModeSelect.tsx`
  - 受控权限模式选择器；复用既有模式卡片、图标、描述与警告。
- 修改：`src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx`
  - 用共享选择器替换本地重复渲染，保留编辑表单和自动保存所有权。
- 修改：`src/renderer/components/resourceCatalog/dialogs/create/steps/CapabilityStep.tsx`
  - 在技能选择器上方增加权限模式字段。
- 修改：`src/renderer/components/resourceCatalog/dialogs/create/ResourceCreateWizard.tsx`
  - 设置创建默认值，并在智能体提交值中带出权限模式。
- 修改：`src/renderer/components/resourceCatalog/dialogs/create/types.ts`
  - 为内部创建表单增加强类型权限模式字段。
- 修改：`src/renderer/types/resourceCatalog.ts`
  - 为共享创建值增加智能体专用的可选权限模式字段，保持助手调用兼容。
- 修改：`src/renderer/utils/resourceCatalog/resourceCreate.ts`
  - 将表单选择映射到 `configuration.permission_mode`，缺省时按新建智能体契约回退到 `bypassPermissions`。
- 修改测试：
  - `src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx`
  - `src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx`
  - `src/renderer/utils/resourceCatalog/__tests__/resourceCreate.test.ts`
  - `src/renderer/pages/agents/components/__tests__/AgentCreateDialog.test.tsx`
  - `src/renderer/components/resourceCatalog/selectors/__tests__/AgentSelector.test.tsx`
  - `src/renderer/hooks/resourceCatalog/__tests__/useResourceCatalogController.test.tsx`
  - `src/renderer/components/resourceCatalog/dialogs/edit/__tests__/EditDialogs.test.tsx`
- 更新类型测试夹具：
  - `src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/BasicInfoStep.test.tsx`
  - `src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/SystemPromptStep.test.tsx`
  - `src/renderer/components/resourceCatalog/dialogs/components/__tests__/EditDialogShared.test.tsx`

### 任务 1：让权限模式进入创建表单和命令映射

**文件：**
- 修改：`src/renderer/types/resourceCatalog.ts`
- 修改：`src/renderer/components/resourceCatalog/dialogs/create/types.ts`
- 修改：`src/renderer/components/resourceCatalog/dialogs/create/ResourceCreateWizard.tsx`
- 修改：`src/renderer/utils/resourceCatalog/resourceCreate.ts`
- 测试：`src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx`
- 测试：`src/renderer/utils/resourceCatalog/__tests__/resourceCreate.test.ts`
- 测试：`src/renderer/pages/agents/components/__tests__/AgentCreateDialog.test.tsx`
- 测试：`src/renderer/hooks/resourceCatalog/__tests__/useResourceCatalogController.test.tsx`

- [ ] **步骤 1：先把映射测试改为传入一个非默认权限模式**

在 `resourceCreate.test.ts` 的 `values` 中加入：

```ts
permissionMode: 'plan'
```

并把智能体命令期望改为：

```ts
configuration: {
  avatar: '🤖',
  permission_mode: 'plan'
}
```

这个测试捕获的回归是：映射器忽略用户选择，继续写死任意默认值。

- [ ] **步骤 2：为创建向导提交契约添加失败测试**

让 `ResourceCreateWizard.test.tsx` 中的 `CapabilityStep` 测试替身接收 `form`，提供一个把模式改成 `plan` 的按钮：

```tsx
vi.mock('../steps/CapabilityStep', () => ({
  CapabilityStep: ({ form }: { form: { setValue: (name: string, value: unknown) => void } }) => (
    <button type="button" onClick={() => form.setValue('permissionMode', 'plan')}>
      choose plan permission
    </button>
  )
}))
```

新增智能体提交流程用例：填完基本信息，进入能力步骤选择 `plan`，完成知识库步骤并创建，断言：

```ts
expect(onSubmit).toHaveBeenCalledWith(
  expect.objectContaining({ permissionMode: 'plan' })
)
```

同时保留现有助手提交的精确对象断言，确保助手值中不增加 `permissionMode`。

- [ ] **步骤 3：运行测试，确认它们因权限模式尚未接入而失败**

运行：

```bash
pnpm vitest run \
  src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx \
  src/renderer/utils/resourceCatalog/__tests__/resourceCreate.test.ts
```

预期：FAIL。映射测试仍得到 `default`；向导提交值中没有 `permissionMode`。

- [ ] **步骤 4：扩展创建值和内部表单类型**

在 `src/renderer/types/resourceCatalog.ts` 引入共享 enum 类型并扩展创建值：

```ts
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

export type ResourceCreateValues = {
  avatar: string
  name: string
  modelId: UniqueModelId
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  skillIds: string[]
  /** Agent-only; Assistant creation ignores this field. */
  permissionMode?: AgentPermissionMode
}
```

在 `create/types.ts` 中把内部字段设为必填，避免创建表单内部出现未定义状态：

```ts
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

export type ResourceCreateWizardFormValues = {
  avatar: string
  name: string
  description: string
  modelId: UniqueModelId | null
  prompt: string
  knowledgeBaseIds: string[]
  skillIds: string[]
  permissionMode: AgentPermissionMode
}
```

- [ ] **步骤 5：设置智能体默认值并只在智能体提交值中带出模式**

用以下完整实现替换 `getDefaultValues()`：

```ts
function getDefaultValues(kind: ResourceCreateWizardKind, initialName = ''): ResourceCreateWizardFormValues {
  return {
    avatar: getResourceCreateDefaultAvatar(kind),
    name: initialName,
    description: '',
    modelId: null,
    prompt: '',
    knowledgeBaseIds: [],
    skillIds: [],
    permissionMode: kind === 'agent' ? 'bypassPermissions' : 'default'
  }
}
```

修改 `handleCreate` 交给调用方的完整对象：

```ts
await onSubmit({
  avatar: values.avatar,
  name: values.name.trim(),
  modelId: values.modelId,
  description: values.description.trim(),
  prompt: values.prompt.trim(),
  knowledgeBaseIds: values.knowledgeBaseIds,
  skillIds: values.skillIds,
  ...(kind === 'agent' ? { permissionMode: values.permissionMode } : {})
})
```

这样助手的公开提交值和 DataApi DTO 都不发生变化。

- [ ] **步骤 6：让创建命令使用用户选择**

在 `buildCreateAgentCommand()` 中替换固定值和旧默认理由注释：

```ts
configuration: {
  avatar: values.avatar,
  permission_mode: values.permissionMode ?? 'bypassPermissions'
}
```

该回退保护直接调用映射器的非向导入口；正常向导总会传入必填表单值。

- [ ] **步骤 7：更新调用级回归测试**

- `AgentCreateDialog.test.tsx`：在 `wizardValues` 中加入 `permissionMode: 'plan'`，断言命令保存 `plan`。
- `useResourceCatalogController.test.tsx`：让 agent 用例传入 `permissionMode: 'plan'` 并断言保存 `plan`；assistant 用例仍断言 DTO 不含该字段。
- `AgentSelector.test.tsx`：保留不操作权限字段的真实向导流程，把期望从 `default` 改为 `bypassPermissions`，作为默认提交回归测试。

- [ ] **步骤 8：补齐强类型表单测试夹具**

在以下 `ResourceCreateWizardFormValues` 默认对象中加入一个合法值：

```ts
permissionMode: 'bypassPermissions'
```

文件：

- `steps/__tests__/BasicInfoStep.test.tsx`
- `steps/__tests__/CapabilityStep.test.tsx`
- `steps/__tests__/SystemPromptStep.test.tsx`
- `dialogs/components/__tests__/EditDialogShared.test.tsx`

只更新显式构造完整表单值的夹具，不添加与权限模式无关的断言。

- [ ] **步骤 9：运行创建数据流的定向测试**

运行：

```bash
pnpm vitest run \
  src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx \
  src/renderer/utils/resourceCatalog/__tests__/resourceCreate.test.ts \
  src/renderer/pages/agents/components/__tests__/AgentCreateDialog.test.tsx \
  src/renderer/hooks/resourceCatalog/__tests__/useResourceCatalogController.test.tsx \
  src/renderer/components/resourceCatalog/selectors/__tests__/AgentSelector.test.tsx
```

预期：PASS；默认路径保存 `bypassPermissions`，显式选择路径保存 `plan`，助手 DTO 不变。

- [ ] **步骤 10：提交创建数据流变更**

```bash
git add \
  src/renderer/types/resourceCatalog.ts \
  src/renderer/components/resourceCatalog/dialogs/create \
  src/renderer/components/resourceCatalog/dialogs/components/__tests__/EditDialogShared.test.tsx \
  src/renderer/utils/resourceCatalog/resourceCreate.ts \
  src/renderer/utils/resourceCatalog/__tests__/resourceCreate.test.ts \
  src/renderer/pages/agents/components/__tests__/AgentCreateDialog.test.tsx \
  src/renderer/hooks/resourceCatalog/__tests__/useResourceCatalogController.test.tsx \
  src/renderer/components/resourceCatalog/selectors/__tests__/AgentSelector.test.tsx
git commit -S --signoff -m "fix(agent-permission-mode): restore creation value"
```

提交后用 `git cat-file commit HEAD` 确认存在 `gpgsig` 和 `Signed-off-by`。

### 任务 2：提取共享选择器并恢复创建界面

**文件：**
- 创建：`src/renderer/components/PermissionModeSelect.tsx`
- 修改：`src/renderer/components/resourceCatalog/dialogs/create/steps/CapabilityStep.tsx`
- 修改：`src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx`
- 测试：`src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx`
- 测试：`src/renderer/components/resourceCatalog/dialogs/edit/__tests__/EditDialogs.test.tsx`

- [ ] **步骤 1：为能力步骤添加失败的用户行为测试**

扩展 `CapabilityStepHarness`，输出当前表单模式：

```tsx
<output data-testid="permission-mode">{form.watch('permissionMode')}</output>
```

新增用例，断言权限模式控件存在、默认值为 `bypassPermissions`，然后点击 `Plan Only` 选项并断言表单变为 `plan`。由于测试翻译替身返回 key，使用稳定的可访问名称：

```ts
expect(
  screen.getByRole('button', { name: 'library.config.agent.field.permission_mode.label' })
).toBeInTheDocument()

await user.click(
  screen.getByRole('button', { name: /agent.settings.tooling.permissionMode.plan.title/ })
)
expect(screen.getByTestId('permission-mode')).toHaveTextContent('plan')
```

该测试捕获的回归是：创建能力步骤不再展示权限模式，或选择没有写回创建表单。

- [ ] **步骤 2：运行能力步骤测试并确认失败**

运行：

```bash
pnpm vitest run src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx
```

预期：FAIL，找不到权限模式控件。

- [ ] **步骤 3：创建窄 API 的共享受控选择器**

创建 `src/renderer/components/PermissionModeSelect.tsx`：

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import type { PermissionMode } from '@renderer/types/agent'
import { permissionModeCards } from '@renderer/utils/agent'
import { useTranslation } from 'react-i18next'

import { PermissionModeIcon, PermissionModeOptionLabel } from './PermissionModeOption'

type PermissionModeSelectProps = {
  value: PermissionMode
  onValueChange: (value: PermissionMode) => void
  portalContainer: HTMLElement | null
}

export function PermissionModeSelect({ value, onValueChange, portalContainer }: PermissionModeSelectProps) {
  const { t } = useTranslation()
  const selected = permissionModeCards.find((card) => card.mode === value)
  const label = t('library.config.agent.field.permission_mode.label')

  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as PermissionMode)}>
      <SelectTrigger className="h-9 w-full rounded-md" aria-label={label}>
        <SelectValue>
          {selected ? (
            <span className={selected.dangerous ? 'text-destructive' : undefined}>
              {t(selected.titleKey, selected.titleFallback)}
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent portalContainer={portalContainer}>
        {permissionModeCards.map((card) => (
          <SelectItem key={card.mode} value={card.mode}>
            <div className="flex items-center gap-2">
              <PermissionModeIcon mode={card.mode} size={16} />
              <PermissionModeOptionLabel card={card} t={t} />
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

不要加入 `className`、模式列表、标签文案或表单对象等未被两个现有消费者需要的公共 props。

- [ ] **步骤 4：在创建能力步骤接入选择器**

用以下完整组件结构在 `SkillCatalogPicker` 上方接入权限模式：

```tsx
export function CapabilityStep({ form, portalContainer }: CapabilityStepProps) {
  const { t } = useTranslation()
  const permissionMode = form.watch('permissionMode')
  const skillIds = form.watch('skillIds')
  useReconcileSkillsOnOpen(true)
  const { skills, loading } = useInstalledSkills()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 border-border-subtle border-b pb-4">
        <span className="font-normal text-muted-foreground text-sm">
          {t('library.config.agent.field.permission_mode.label')}
        </span>
        <PermissionModeSelect
          value={permissionMode}
          onValueChange={(value) => form.setValue('permissionMode', value, { shouldDirty: true })}
          portalContainer={portalContainer}
        />
      </div>
      <SkillCatalogPicker
        mode="create"
        skills={skills}
        loading={loading}
        selectedIds={skillIds}
        onSelectedIdsChange={(ids) => form.setValue('skillIds', ids, { shouldDirty: true })}
        emptyLabel={t('library.config.dialogs.create.capability.no_skills')}
        portalContainer={portalContainer}
      />
    </div>
  )
}
```

保持技能加载、选择、导入和安装逻辑不变。

- [ ] **步骤 5：让编辑弹窗复用共享选择器**

删除 `AgentEditDialog.tsx` 内权限模式选项的重复渲染及不再使用的 Select、图标、卡片、`useWatch` imports。保留本地 `PermissionModeField` 对表单布局和 patch 的所有权：

```tsx
<PermissionModeSelect
  value={normalizePermissionMode(field.value)}
  onValueChange={(value) => patchAgentForm({ permissionMode: value })}
  portalContainer={portalContainer}
/>
```

`normalizePermissionMode()` 只用于把可能存在的旧存储值收敛到共享 enum；不要改变保存或自动保存语义。

- [ ] **步骤 6：运行两个消费者的定向测试**

运行：

```bash
pnpm vitest run \
  src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/edit/__tests__/EditDialogs.test.tsx
```

预期：PASS。创建步骤可见且可切换；编辑弹窗原有 `plan` PATCH 用例继续通过。

- [ ] **步骤 7：提交共享 UI 变更**

```bash
git add \
  src/renderer/components/PermissionModeSelect.tsx \
  src/renderer/components/resourceCatalog/dialogs/create/steps/CapabilityStep.tsx \
  src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx
git commit -S --signoff -m "fix(agent-permission-mode): restore creation selector"
```

提交后用 `git cat-file commit HEAD` 确认存在 `gpgsig` 和 `Signed-off-by`。

### 任务 3：定向验证与交付检查

**文件：**
- 验证任务 1、2 涉及的全部 renderer 文件
- 不新增产品代码

- [ ] **步骤 1：运行所有相关 renderer 测试文件**

```bash
pnpm vitest run \
  src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/BasicInfoStep.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/SystemPromptStep.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/components/__tests__/EditDialogShared.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/edit/__tests__/EditDialogs.test.tsx \
  src/renderer/utils/resourceCatalog/__tests__/resourceCreate.test.ts \
  src/renderer/pages/agents/components/__tests__/AgentCreateDialog.test.tsx \
  src/renderer/components/resourceCatalog/selectors/__tests__/AgentSelector.test.tsx \
  src/renderer/hooks/resourceCatalog/__tests__/useResourceCatalogController.test.tsx
```

预期：上述定向测试全部 PASS。

- [ ] **步骤 2：运行仓库静态检查，但不运行全量测试**

```bash
pnpm lint
pnpm format
git diff --check
```

预期：命令退出码均为 0；`pnpm lint` 内含 typecheck 和 i18n check，但不执行 `pnpm test`。

如果格式命令产生任务外的 tracked 变更，停止并逐项确认来源；不把无关格式变化带入提交。

- [ ] **步骤 3：格式化后复跑最关键回归测试**

```bash
pnpm vitest run \
  src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx \
  src/renderer/components/resourceCatalog/dialogs/edit/__tests__/EditDialogs.test.tsx \
  src/renderer/utils/resourceCatalog/__tests__/resourceCreate.test.ts
```

预期：PASS。

- [ ] **步骤 4：明确记录未运行的全量检查**

按用户要求：

- 不运行 `pnpm test`；
- 不运行 `pnpm build:check`，因为该脚本末尾会执行全量 `pnpm test`；
- 交付说明列出已运行的定向测试文件和静态检查结果，不声称全量测试通过。

- [ ] **步骤 5：检查最终差异和提交签名**

```bash
git status --short
git diff origin/main...HEAD --stat
git log --show-signature --format=fuller origin/main..HEAD
```

预期：除用户原有未跟踪文件外，工作区干净；提交只包含规格、计划和本功能相关文件；每个提交均有签名与 DCO sign-off。
