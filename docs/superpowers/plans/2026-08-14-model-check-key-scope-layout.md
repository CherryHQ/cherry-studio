# 模型检测密钥范围布局修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将模型检测的“单个/所有”密钥范围从 API 密钥下拉选项中分离，并让单模型、所有模型两种检测表单使用相同结构。

**架构：** 保留现有 `ModelCheckKeySelection` 数据契约，只调整 `ModelCheckDialog` 的表单状态和渲染。每种检测模式继续独立保存密钥范围和具体密钥 ID；范围为“单个”时才渲染只包含具体启用密钥的 Combobox。

**技术栈：** React、TypeScript、`@cherrystudio/ui` SegmentedControl/Combobox、Vitest、Testing Library。

---

## 文件结构

- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx` — 分离密钥范围切换与具体密钥选择。
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx` — 保护单模型与所有模型表单的相同交互契约。
- 修改：`src/renderer/i18n/locales/en-us.json` — 增加与 v1 一致的密钥范围英文文案。
- 修改：`src/renderer/i18n/locales/zh-cn.json` — 增加与 v1 一致的密钥范围中文文案。
- 同步：`src/renderer/i18n/translate/*.json` — 通过 `pnpm i18n:sync` 同步新增文案键并移除废弃键。

### 任务 1：用组件测试固定密钥范围交互

**文件：**
- 测试：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx`

- [ ] **步骤 1：编写失败的单模型表单测试**

将测试 API 密钥扩展为两个启用密钥，并新增以下用户行为：默认范围为“所有”，此时不显示具体密钥下拉；切换“单个”后显示只包含具体密钥的下拉；选择第二个密钥后开始检测。

```tsx
it('separates single-model key scope from the concrete key selector', async () => {
  health.apiKeyEntries = [
    { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
    { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
  ]
  render(<ModelCheckDialog />)

  expect(screen.getAllByTestId('segmented-control')[1]).toHaveAttribute('data-value', 'all')
  expect(screen.queryByRole('option', { name: 'settings.models.check.all_enabled_keys' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.single' }))
  fireEvent.change(screen.getAllByTestId('combobox')[1], { target: { value: 'key-2' } })
  fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

  await waitFor(() =>
    expect(startSingleModelCheck).toHaveBeenCalledWith({
      model: chatModel,
      keySelection: { mode: 'single', keyId: 'key-2' }
    })
  )
})
```

- [ ] **步骤 2：编写失败的所有模型表单测试**

在所有模型模式中重复相同范围切换，证明“所有密钥”不是 Combobox 选项，且具体密钥选择会传给批量检测。

```tsx
it('uses the same separate key-scope controls for all-model checks', async () => {
  health.apiKeyEntries = [
    { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
    { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
  ]
  render(<ModelCheckDialog />)
  fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.all_models' }))

  expect(screen.getAllByTestId('segmented-control')[1]).toHaveAttribute('data-value', 'all')
  expect(screen.queryByRole('option', { name: 'settings.models.check.all_enabled_keys' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.single' }))
  fireEvent.change(screen.getByTestId('combobox'), { target: { value: 'key-2' } })
  fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

  await waitFor(() =>
    expect(startHealthCheck).toHaveBeenCalledWith({
      keySelection: { mode: 'single', keyId: 'key-2' },
      isConcurrent: true,
      timeout: 15000
    })
  )
})
```

- [ ] **步骤 3：运行测试并确认因当前混合式下拉而失败**

运行：

```bash
pnpm vitest run --project renderer src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx
```

预期：FAIL；找不到独立的 `settings.models.check.single` / `settings.models.check.all` 控件，且当前密钥下拉仍包含“所有已启用的 API 密钥”。

### 任务 2：实现独立密钥范围控件

**文件：**
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx`

- [ ] **步骤 1：让 API 密钥字段只负责具体密钥**

将 `ApiKeyField` 的选项改为具体启用密钥。保留原有 Label 和 Combobox 结构，但 Label 使用 v1 的“选择要使用的 API 密钥”文案。

```tsx
const options: ComboboxOption[] = enabledEntries.map((entry) => ({
  value: entry.id,
  label: `${entry.label?.trim() || t('settings.provider.api_key.unnamed')} · ${maskApiKey(entry.key)}`
}))

<Label>{t('settings.models.check.select_api_key')}</Label>
<Combobox options={options} value={value} />
```

- [ ] **步骤 2：增加复用的密钥范围字段**

新增 `ApiKeyScopeField`，使用 SegmentedControl 单独展示“单个/所有”，仅在单个范围且存在多个启用密钥时展示 `ApiKeyField`。

```tsx
type ApiKeyScopeFieldProps = {
  entries: readonly ApiKeyEntry[]
  selection: ModelCheckKeySelection
  onChange: (selection: ModelCheckKeySelection) => void
}

function ApiKeyScopeField({ entries, selection, onChange }: ApiKeyScopeFieldProps) {
  const enabledEntries = entries.filter((entry) => entry.isEnabled)
  if (enabledEntries.length === 0) {
    return (
      <div className="space-y-2">
        <Label>{t('settings.models.check.key_scope')}</Label>
        <p className="text-muted-foreground text-sm">{t('settings.models.check.no_api_keys')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Label>{t('settings.models.check.key_scope')}</Label>
        <SegmentedControl
          aria-label={t('settings.models.check.key_scope')}
          value={selection.mode}
          options={[
            { value: 'single', label: t('settings.models.check.single') },
            { value: 'all', label: t('settings.models.check.all') }
          ]}
          onValueChange={(mode) =>
            onChange(mode === 'all' ? { mode: 'all' } : { mode: 'single', keyId: enabledEntries[0].id })
          }
        />
      </div>
      {selection.mode === 'single' && enabledEntries.length > 1 ? (
        <ApiKeyField
          entries={enabledEntries}
          value={selection.keyId}
          onChange={(keyId) => onChange({ mode: 'single', keyId })}
        />
      ) : null}
    </div>
  )
}
```

当没有启用密钥时，继续显示 `settings.models.check.no_api_keys`，并由现有 Start 禁用逻辑阻止请求；不要让独立范围控件隐藏这个反馈。删除不再需要的 `getKeySelection` sentinel 转换函数。

- [ ] **步骤 3：为两种检测模式保留独立范围状态**

将 `singleKey` / `allKey` 字符串改为 `ModelCheckKeySelection`，凭据变化时把失效的单密钥选择回退到所有密钥；开始检测时直接传递对应 selection。

```tsx
const [singleKeySelection, setSingleKeySelection] = useState<ModelCheckKeySelection>({ mode: 'all' })
const [allKeySelection, setAllKeySelection] = useState<ModelCheckKeySelection>({ mode: 'all' })

await health.startSingleModelCheck({ model: selectedModel, keySelection: singleKeySelection })
await health.startHealthCheck({ keySelection: allKeySelection, isConcurrent, timeout: timeout * 1000 })
```

- [ ] **步骤 4：恢复 v1 密钥范围文案并同步 i18n**

在英文、中文源语言中新增 `single`、`all`、`select_api_key`，并将 `key_scope` 恢复成原界面的“使用密钥”含义；删除实现不再引用的 `all_enabled_keys` 后执行同步。

```json
{
  "all": "所有",
  "key_scope": "使用密钥",
  "select_api_key": "选择要使用的 API 密钥：",
  "single": "单个"
}
```

```json
{
  "all": "All",
  "key_scope": "Key(s)",
  "select_api_key": "Select the API key to use:",
  "single": "Single"
}
```

运行：

```bash
pnpm i18n:sync
```

- [ ] **步骤 5：运行组件测试确认通过**

运行：

```bash
pnpm vitest run --project renderer src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx
```

预期：PASS。

- [ ] **步骤 6：运行 Provider Settings 定向回归测试**

运行：

```bash
pnpm vitest run --project renderer src/renderer/pages/settings/ProviderSettings/ModelList/__tests__
```

预期：相关测试全部通过。

### 任务 3：验证真实界面并完成质量检查

**文件：**
- 不新增文件；截图保存到 `.context/cherry-electron-dev/evidence/`。

- [ ] **步骤 1：通过已跟踪 Electron 实例验证两种表单**

在单模型与所有模型模式分别验证：默认显示“所有”；API 密钥下拉不可见；切换“单个”后下拉出现；下拉中没有“所有启用密钥”选项。

- [ ] **步骤 2：保存视觉证据**

保存截图：

```text
.context/cherry-electron-dev/evidence/model-check-single-key-scope.png
.context/cherry-electron-dev/evidence/model-check-all-key-scope.png
```

- [ ] **步骤 3：运行仓库规定校验**

运行：

```bash
pnpm lint
pnpm test
pnpm format
pnpm build:check
```

预期：命令均成功；若出现与本次改动无关的既有警告，在交付中注明。

- [ ] **步骤 4：提交实现**

```bash
git add src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx \
  src/renderer/i18n/locales/en-us.json src/renderer/i18n/locales/zh-cn.json \
  src/renderer/i18n/translate/*.json
git commit -S --signoff -m "fix(model-check): separate API key scope"
```
