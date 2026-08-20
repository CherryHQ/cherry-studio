# 快捷助手响应设置层级实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把快捷助手的模型来源区域改为“响应设置”配置组，将模式控制标为“使用方式”，并把助手专属 tooltip 移到“选择助手”标签后。

**架构：** 保留 `feature.quick_assistant.assistant_id`、`useDefaultModel()` 和现有跳转逻辑，只调整 renderer 的设置层级与可访问标签。配置组标题固定为“响应设置”；第一行控制来源，第二行继续按来源渲染助手选择器或默认模型，但 tooltip 只属于助手模式。

**技术栈：** React 19、TypeScript、TanStack Router、i18next、`@cherrystudio/ui`、Vitest、Testing Library、Tailwind CSS。

---

## 文件结构

- 修改 `src/renderer/pages/settings/QuickAssistantSettings.tsx`：增加配置组标题、重命名模式行、移动条件 tooltip。
- 修改 `src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx`：保护标题、控制行标签和 tooltip 所属行。
- 修改 `src/renderer/i18n/locales/{de-de,el-gr,en-us,es-es,fr-fr,ja-jp,pt-pt,ro-ro,ru-ru,vi-vn,zh-cn,zh-tw}.json`：用“响应设置”和“使用方式”替换仅在当前分支使用的“快捷助手模式”文案。

## 测试价值边界

本计划保护以下用户可见回归：

- 响应来源区域重新失去配置组标题，或标题与页面标题重复。
- 模式控制和从属配置行不再具有独立、准确的可访问名称。
- 助手专属 tooltip 又回到来源控制行，或在默认模型模式出现。
- 默认模型跳转、助手选择、删除助手回退和加载中选择保持行为被布局调整破坏。

不锁定具体 Tailwind 类、行高或 tooltip 图标 DOM；这些由真实 Electron 目视检查覆盖。

### 任务 1：重构响应设置标题和 tooltip 所属关系

**文件：**

- 修改：`src/renderer/pages/settings/QuickAssistantSettings.tsx:57-249`
- 测试：`src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx:16-199`
- 修改：全部 12 个 `src/renderer/i18n/locales/*.json`

- [ ] **步骤 1：让测试中的 tooltip 暴露可访问控件**

把测试 mock 中的 `InfoTooltip` 改为按 tooltip 文案渲染按钮，使测试可以判断它属于哪一行：

```tsx
InfoTooltip: ({ content }: { content: string }) =>
  React.createElement('button', { 'aria-label': content, type: 'button' }),
```

- [ ] **步骤 2：先编写标题、行标签和 tooltip 位置的失败测试**

把默认模型模式测试收紧为：

```tsx
it('groups default-model configuration under response settings without the assistant tooltip', async () => {
  const user = userEvent.setup()
  MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', '')
  modelState.defaultModel = defaultModelFixture

  render(<QuickAssistantSettings />)

  expect(screen.getByText('settings.models.quick_assistant_response_settings')).toBeInTheDocument()
  const usageRow = screen.getByRole('group', { name: 'settings.models.quick_assistant_usage_method' })
  const modelRow = screen.getByRole('group', { name: 'settings.models.default_assistant_model' })

  expect(within(usageRow).getByRole('radiogroup')).toBeInTheDocument()
  expect(
    within(usageRow).queryByRole('button', { name: 'selection.settings.user_modal.model.tooltip' })
  ).not.toBeInTheDocument()
  expect(within(modelRow).getByText('GPT-4o')).toBeInTheDocument()
  expect(
    within(modelRow).queryByRole('button', { name: 'selection.settings.user_modal.model.tooltip' })
  ).not.toBeInTheDocument()

  await user.click(within(modelRow).getByRole('button', { name: 'navigate.model_settings' }))
  expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/model', search: { focus: 'default' } })
})
```

把助手模式测试收紧为：

```tsx
it('shows the assistant tooltip only beside the assistant selector label', () => {
  MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', 'assistant-1')
  modelState.defaultModel = defaultModelFixture

  render(<QuickAssistantSettings />)

  const usageRow = screen.getByRole('group', { name: 'settings.models.quick_assistant_usage_method' })
  const assistantRow = screen.getByRole('group', { name: 'settings.models.quick_assistant_selection' })

  expect(within(usageRow).getByRole('radiogroup')).toBeInTheDocument()
  expect(
    within(usageRow).queryByRole('button', { name: 'selection.settings.user_modal.model.tooltip' })
  ).not.toBeInTheDocument()
  expect(
    within(assistantRow).getByRole('button', { name: 'selection.settings.user_modal.model.tooltip' })
  ).toBeInTheDocument()
  expect(within(assistantRow).getByRole('button', { expanded: false })).toHaveTextContent('Assistant 1')
  expect(screen.queryByRole('button', { name: 'navigate.model_settings' })).not.toBeInTheDocument()
})
```

- [ ] **步骤 3：运行测试并确认新合同失败**

运行：

```bash
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
```

预期：FAIL，找不到 `settings.models.quick_assistant_response_settings` 或名称为 `settings.models.quick_assistant_usage_method` 的分组；当前 tooltip 仍位于旧模式行。

- [ ] **步骤 4：更新英文源文案并同步 locale**

在 `src/renderer/i18n/locales/en-us.json` 的 `settings.models` 中删除：

```json
"quick_assistant_mode": "Quick Assistant Mode",
```

在相同排序位置新增：

```json
"quick_assistant_response_settings": "Response Settings",
"quick_assistant_usage_method": "Usage Method",
```

运行：

```bash
pnpm i18n:sync
```

把同步产生的值替换为以下真实翻译，并删除每个 locale 中旧的 `quick_assistant_mode`：

| Locale | `quick_assistant_response_settings` | `quick_assistant_usage_method` |
| --- | --- | --- |
| de-de | Antworteinstellungen | Verwendungsart |
| el-gr | Ρυθμίσεις απάντησης | Τρόπος χρήσης |
| en-us | Response Settings | Usage Method |
| es-es | Configuración de respuesta | Método de uso |
| fr-fr | Paramètres de réponse | Mode d’utilisation |
| ja-jp | 応答設定 | 使用方法 |
| pt-pt | Definições de resposta | Método de utilização |
| ro-ro | Setări de răspuns | Metodă de utilizare |
| ru-ru | Настройки ответа | Способ использования |
| vi-vn | Cài đặt phản hồi | Phương thức sử dụng |
| zh-cn | 响应设置 | 使用方式 |
| zh-tw | 回應設定 | 使用方式 |

- [ ] **步骤 5：实现标题、使用方式行和条件 tooltip**

把 `modeTitleId` 重命名为 `usageMethodTitleId`：

```tsx
const usageMethodTitleId = useId()
const configurationTitleId = useId()
```

把第二个 `SettingGroup` 的开头改为：

```tsx
<SettingGroup theme={theme}>
  <SettingTitle>{t('settings.models.quick_assistant_response_settings')}</SettingTitle>
  <SettingDivider />
  <SettingRow role="group" aria-labelledby={usageMethodTitleId} className="min-h-8.5 gap-3">
    <SettingRowTitle id={usageMethodTitleId}>
      {t('settings.models.quick_assistant_usage_method')}
    </SettingRowTitle>
    <SegmentedControl<'assistant' | 'model'>
      aria-label={t('settings.models.quick_assistant_usage_method')}
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
```

从使用方式行删除原有 `InfoTooltip`。把条件配置行标题改为：

```tsx
<SettingRowTitle id={configurationTitleId} className={isAssistantMode ? 'gap-2.5' : undefined}>
  {t(
    isAssistantMode ? 'settings.models.quick_assistant_selection' : 'settings.models.default_assistant_model'
  )}
  {isAssistantMode && (
    <InfoTooltip
      content={t('selection.settings.user_modal.model.tooltip')}
      showArrow
      iconProps={{ className: 'cursor-pointer' }}
    />
  )}
</SettingRowTitle>
```

助手选择器、默认模型展示、导航按钮和偏好更新逻辑保持不变。

- [ ] **步骤 6：运行定向测试和 i18n 检查**

运行：

```bash
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
pnpm i18n:check
pnpm i18n:hardcoded:strict
```

预期：快捷助手 5 条测试全部 PASS；i18n 检查无占位翻译、空值、插值或硬编码错误。

- [ ] **步骤 7：提交实现**

```bash
git add src/renderer/pages/settings/QuickAssistantSettings.tsx \
  src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx \
  src/renderer/i18n/locales
git commit -S --signoff -m "fix(quick-assistant): refine response settings hierarchy"
git cat-file commit HEAD
```

预期：提交包含 `gpgsig` 和 `Signed-off-by`。

### 任务 2：分支级定向验证与真实 UX 检查

**文件：**

- 验证：`src/renderer/pages/settings/QuickAssistantSettings.tsx`
- 验证：本分支 4 个相关 renderer 测试文件
- 验证：`.context/cherry-electron-dev/instance.json` 中跟踪的开发实例

- [ ] **步骤 1：运行本分支相关 renderer 回归测试**

运行：

```bash
pnpm exec vitest run --silent --project renderer \
  src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts \
  src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx \
  src/renderer/pages/settings/SelectionAssistantSettings/components/__tests__/SelectionActionModelSettings.test.tsx \
  src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
```

预期：4 个文件共 20 条测试全部 PASS。

- [ ] **步骤 2：运行仓库规定的静态检查**

运行：

```bash
pnpm lint
```

预期：命令退出码为 0；记录仓库既有 warning，但本次修改不得新增 error。

- [ ] **步骤 3：在跟踪的 Electron 实例中验证两种模式**

按 `.agents/skills/cherry-electron-dev/references/electron-instance.md` 重新校验 Electron PID、工作目录、CDP 端口和主窗口 target，再通过精确 target 验证：

1. 快捷助手页的第二个设置组标题为“响应设置”。
2. 第一行标签为“使用方式”，右侧为“使用助手 / 默认模型”分段控件。
3. 助手模式第二行显示“选择助手 ⓘ”和助手选择器，且没有“前往模型设置”。
4. 默认模型模式第二行显示“默认助手模型”、有效模型和“前往模型设置”，且没有助手 tooltip。
5. 点击“前往模型设置”后滚动并高亮“默认助手模型”。
6. 验证结束后恢复进入验证前的模式，并按实例策略保留健康的 persistent 实例。

预期：两种模式的标题、从属行和 tooltip 位置与设计一致，跳转高亮仍有效。

- [ ] **步骤 4：检查最终差异和签名状态**

运行：

```bash
git diff --check origin/main...HEAD
git status --short --branch
git cat-file commit HEAD
```

预期：无空白错误、工作树干净、最新提交包含签名和 DCO sign-off。按用户要求不运行全量 `pnpm test` 或 `pnpm build:check`，并在交付中明确该限制。
