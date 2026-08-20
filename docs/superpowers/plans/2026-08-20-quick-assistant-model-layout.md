# 快捷助手模型布局优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将快捷助手的模式选择与当前助手/默认模型配置拆成两行，使控制层级清楚，并保留默认模型的精确设置跳转。

**架构：** 继续由 `feature.quick_assistant.assistant_id` 决定模式，由 `useDefaultModel()` 提供有效默认模型；只重组 renderer 设置行，不新增 Preference、IPC 或模型解析逻辑。第一行只负责模式选择，第二行按模式显示助手选择器或默认助手模型及跨页设置入口。

**技术栈：** React 19、TypeScript、TanStack Router、i18next、`@cherrystudio/ui`、Vitest、Testing Library、Tailwind CSS。

---

## 文件结构

- 修改 `src/renderer/pages/settings/QuickAssistantSettings.tsx`：把模式选择和条件配置拆成两个可访问的设置行。
- 修改 `src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx`：保护两行信息分组、两种模式内容和默认模型跳转。
- 修改 `src/renderer/i18n/locales/{de-de,el-gr,en-us,es-es,fr-fr,ja-jp,pt-pt,ro-ro,ru-ru,vi-vn,zh-cn,zh-tw}.json`：新增“快捷助手模式”标签。

## 测试价值边界

本计划保护的回归：

- 模式分段控件再次与模型、跳转按钮或助手选择器混在同一设置行。
- 默认模型模式不显示有效模型或跳往错误目标。
- 助手模式错误显示全局模型入口，或原有助手选择行为被破坏。

不锁定具体 Tailwind 类、行高、按钮像素宽度或头像 DOM；这些通过真实 Electron 目视检查覆盖。

### 任务 1：将模式和条件配置拆成两行

**文件：**

- 修改：`src/renderer/pages/settings/QuickAssistantSettings.tsx:41-238`
- 测试：`src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx:16-213`
- 修改：全部 12 个 `src/renderer/i18n/locales/*.json`

- [ ] **步骤 1：让测试中的分段控件暴露可访问标签**

扩展 `@cherrystudio/ui` 测试 mock，接收并转发 `aria-label`：

```tsx
SegmentedControl: ({
  'aria-label': ariaLabel,
  options,
  value,
  onValueChange
}: {
  'aria-label'?: string
  options: Array<{ disabled?: boolean; label: string; value: string }>
  value: string
  onValueChange?: (value: string) => void
}) =>
  React.createElement(
    'div',
    { 'aria-label': ariaLabel, role: 'radiogroup' },
    options.map((option) =>
      React.createElement(
        'button',
        {
          'aria-checked': value === option.value,
          disabled: option.disabled,
          key: option.value,
          onClick: () => option.value !== value && onValueChange?.(option.value),
          role: 'radio',
          type: 'button'
        },
        option.label
      )
    )
  )
```

- [ ] **步骤 2：先写两种模式的信息分组失败测试**

把现有默认模型和助手模式测试收紧为用户可见的两行合同：

```tsx
it('separates default-model mode from its model configuration', async () => {
  const user = userEvent.setup()
  MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', '')
  modelState.defaultModel = defaultModelFixture

  render(<QuickAssistantSettings />)

  const modeRow = screen.getByRole('group', { name: 'settings.models.quick_assistant_mode' })
  const modelRow = screen.getByRole('group', { name: 'settings.models.default_assistant_model' })

  expect(within(modeRow).getByRole('radiogroup')).toBeInTheDocument()
  expect(modeRow).not.toHaveTextContent('GPT-4o')
  expect(within(modelRow).getByText('GPT-4o')).toBeInTheDocument()

  await user.click(within(modelRow).getByRole('button', { name: 'navigate.model_settings' }))
  expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/model', search: { focus: 'default' } })
})

it('separates assistant mode from the mode selector without global model navigation', () => {
  MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', 'assistant-1')
  modelState.defaultModel = defaultModelFixture

  render(<QuickAssistantSettings />)

  const modeRow = screen.getByRole('group', { name: 'settings.models.quick_assistant_mode' })
  const assistantRow = screen.getByRole('group', { name: 'settings.models.quick_assistant_selection' })

  expect(within(modeRow).getByRole('radiogroup')).toBeInTheDocument()
  expect(within(assistantRow).getByRole('button', { expanded: false })).toHaveTextContent('Assistant 1')
  expect(screen.queryByRole('button', { name: 'navigate.model_settings' })).not.toBeInTheDocument()
})
```

同时从 Testing Library 导入 `within`。

- [ ] **步骤 3：运行测试并确认因两行语义尚不存在而失败**

运行：

```bash
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
```

预期：FAIL，找不到名称为 `settings.models.quick_assistant_mode`、`settings.models.default_assistant_model` 或 `settings.models.quick_assistant_selection` 的分组。

- [ ] **步骤 4：新增模式标签并完成全部 locale 翻译**

在 `settings.models.quick_assistant_model` 相邻位置新增 `settings.models.quick_assistant_mode`。先修改 `en-us.json`：

```json
"quick_assistant_mode": "Quick Assistant Mode",
```

运行：

```bash
pnpm i18n:sync
```

把同步产生的值替换为以下真实翻译：

| Locale | `settings.models.quick_assistant_mode` |
| --- | --- |
| de-de | Schnellassistent-Modus |
| el-gr | Λειτουργία Γρήγορου Βοηθού |
| en-us | Quick Assistant Mode |
| es-es | Modo del asistente rápido |
| fr-fr | Mode de l'assistant rapide |
| ja-jp | クイックアシスタントモード |
| pt-pt | Modo do Assistente Rápido |
| ro-ro | Mod asistent rapid |
| ru-ru | Режим быстрого помощника |
| vi-vn | Chế độ Trợ lý Nhanh |
| zh-cn | 快捷助手模式 |
| zh-tw | 快速助理模式 |

- [ ] **步骤 5：实现两个设置行和条件内容**

在 `QuickAssistantSettings.tsx` 中把 React hooks import 改为：

```ts
import { useEffect, useId, useState } from 'react'
```

在组件中创建稳定标签 ID：

```ts
const modeTitleId = useId()
const configurationTitleId = useId()
```

把当前包含模型、跳转按钮、助手选择器和 `SegmentedControl` 的单个 `SettingRow` 改为以下结构：

```tsx
<SettingRow role="group" aria-labelledby={modeTitleId} className="min-h-8.5 gap-3">
  <SettingRowTitle id={modeTitleId} className="gap-2.5">
    {t('settings.models.quick_assistant_mode')}
    <InfoTooltip
      content={t('selection.settings.user_modal.model.tooltip')}
      showArrow
      iconProps={{ className: 'cursor-pointer' }}
    />
  </SettingRowTitle>
  <SegmentedControl<'assistant' | 'model'>
    aria-label={t('settings.models.quick_assistant_mode')}
    size="sm"
    value={isAssistantMode ? 'assistant' : 'model'}
    options={[
      {
        value: 'assistant',
        label: t('settings.models.use_assistant'),
        disabled: assistantOptions.length === 0
      },
      { value: 'model', label: t('settings.models.use_model') }
    ]}
    onValueChange={(value) => void setQuickAssistantId(value === 'assistant' ? (firstAssistantId ?? '') : '')}
  />
</SettingRow>
<SettingDivider />
<SettingRow
  role="group"
  aria-labelledby={configurationTitleId}
  className="min-h-8.5 flex-nowrap gap-3">
  <SettingRowTitle id={configurationTitleId}>
    {t(isAssistantMode ? 'settings.models.quick_assistant_selection' : 'settings.models.default_assistant_model')}
  </SettingRowTitle>
  {isAssistantMode ? (
    selectedAssistant ? (
      <RowFlex className="items-center">
        <Popover open={assistantSelectOpen} onOpenChange={setAssistantSelectOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="h-8.5 w-75 justify-between px-2 shadow-none"
              aria-expanded={assistantSelectOpen}>
              <AssistantOption
                assistant={selectedAssistant}
                firstAssistantId={firstAssistantId}
                defaultModel={defaultModel}
              />
              <ChevronDown size={16} className="shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-75 p-0"
            align="end"
            onFocusOutside={(event) => {
              // The embedded quick assistant preview auto-focuses its input on render.
              event.preventDefault()
            }}>
            <Command>
              <CommandInput placeholder={t('settings.models.quick_assistant_selection')} />
              <CommandList>
                <CommandEmpty>{t('common.no_results')}</CommandEmpty>
                <CommandGroup>
                  {assistantOptions.map((assistant) => (
                    <CommandItem
                      key={assistant.id}
                      value={`${assistant.name} ${assistant.id}`}
                      keywords={[assistant.name, assistant.id]}
                      onSelect={() => {
                        handleAssistantSelect(assistant.id)
                      }}>
                      <AssistantOption
                        assistant={assistant}
                        firstAssistantId={firstAssistantId}
                        defaultModel={defaultModel}
                      />
                      {assistant.id === quickAssistantId && (
                        <Check size={14} className="ml-auto text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </RowFlex>
    ) : null
  ) : (
    <RowFlex className="min-w-0 items-center gap-3">
      <RowFlex className="min-w-0 max-w-44 items-center gap-2">
        {defaultModel ? <ModelAvatar model={defaultModel} size={18} className="shrink-0" /> : null}
        <span className="truncate text-foreground text-sm">
          {defaultModel?.name ?? t('settings.models.empty')}
        </span>
      </RowFlex>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => void navigate({ to: '/settings/model', search: { focus: 'default' } })}>
        <ArrowRight size={13} />
        {t('navigate.model_settings')}
      </Button>
    </RowFlex>
  )}
</SettingRow>
```

- [ ] **步骤 6：运行组件测试和 i18n 检查，确认转绿**

运行：

```bash
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
pnpm i18n:check
pnpm i18n:hardcoded:strict
```

预期：快捷助手全部测试通过；12 个 locale 无占位符、空值、插值或硬编码 UI 文案问题。

- [ ] **步骤 7：提交两行布局变更**

```bash
git add \
  src/renderer/pages/settings/QuickAssistantSettings.tsx \
  src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx \
  src/renderer/i18n/locales
git commit -S --signoff -m "fix(quick-assistant): clarify model mode layout"
```

### 任务 2：定向验证与真实 Electron UX 检查

**文件：**

- 验证：任务 1 修改的组件、测试和 locale 文件

- [ ] **步骤 1：运行相关 renderer 测试**

```bash
pnpm exec vitest run --silent --project renderer \
  src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts \
  src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx \
  src/renderer/pages/settings/SelectionAssistantSettings/components/__tests__/SelectionActionModelSettings.test.tsx \
  src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
```

预期：4 个文件全部通过，无失败用例。

- [ ] **步骤 2：运行允许的仓库门禁**

```bash
pnpm lint
git diff --check origin/main...HEAD
```

预期：格式、类型、i18n 和 diff 检查通过。遵照用户约束，不运行全量 `pnpm test` 或包含全量测试的 `pnpm build:check`。

- [ ] **步骤 3：复用 persistent Electron 实例验证默认模型模式**

按 `.agents/skills/cherry-electron-dev/references/electron-instance.md` 重新校验跟踪实例，确认 PID、工作区、CDP listener 和主窗口 target 一致后：

- 打开“设置 → 快捷助手”。
- 确认第一行只有“快捷助手模式”和分段控件。
- 确认第二行是“默认助手模型”、有效模型名称及完整“前往模型设置”按钮。
- 在真实窗口宽度检查长标签不会与分段控件或按钮重叠。
- 点击按钮并确认默认助手模型行滚动进入视口、短暂高亮并在约 2 秒后淡出。

- [ ] **步骤 4：验证助手模式和保留行为**

- 切到“使用助手”，确认第二行标题变为“选择助手”并显示助手选择器。
- 确认全局模型设置按钮不存在。
- 更换助手并确认选择器关闭、Preference 更新；切回默认模型后当前默认模型重新出现。
- 确认快捷助手预览没有横向溢出或异常跳动。

- [ ] **步骤 5：执行最终分支自审**

读取并执行 `cherry-change-verification` 与 `verification-before-completion`。确认工作区干净、任务 1 提交包含 `gpgsig` 和 `Signed-off-by`，并记录定向测试、lint、i18n、Electron PID、CDP 端口和主窗口 target 作为交付证据。
