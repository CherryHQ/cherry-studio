# 模型设置定位箭头实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将全局模型设置的整行定位高亮替换为指向目标模型选择器的短暂箭头动画。

**架构：** 保留现有 `focus` 查询参数、目标行 ref、滚动行为和 `data-focused` 定位合同，只在 `ModelSettings` 私有行组件中改变反馈方式。复用全局 `animation-provider-model-pull-guide` 动画类，在目标选择器控制区左侧绝对定位 `ArrowRight`，1.2 秒后卸载，不新增共享组件或 CSS。

**技术栈：** React 19、TypeScript、Tailwind CSS、Lucide React、Vitest、Testing Library。

---

## 文件结构

- 修改 `src/renderer/pages/settings/ModelSettings/ModelSettings.tsx`：移除整行底色/描边状态，改为控制目标选择器左侧箭头的显示与计时。
- 修改 `src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx`：保护正确行显示箭头、1.2 秒计时和计时结束后卸载箭头的交互合同。

## 测试价值边界

本计划新增的断言会捕获以下回归：默认模型与翻译模型的跳转箭头指向错误行、箭头没有出现、箭头未按既有动画时长消失。测试不锁定完整 Tailwind 类名或动画关键帧；动画视觉节奏由已有 `animation-provider-model-pull-guide` 负责，真实 Electron 只验证它出现在选择器左侧且不会挤压布局。

### 任务 1：用箭头替换整行定位高亮

**文件：**

- 修改：`src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx`
- 修改：`src/renderer/pages/settings/ModelSettings/ModelSettings.tsx`

- [ ] **步骤 1：把现有聚焦测试扩展为箭头交互合同**

将 `focuses the %s model row requested by the route` 用例改为异步计时合同。保留现有行定位和滚动断言，并加入以下断言：

```tsx
it.each([
  ['default', 'settings.models.default_assistant_model'],
  ['translate', 'settings.models.translate_model']
] as const)('points to the %s model selector requested by the route', (focus, expectedTitle) => {
  routerSearch.current = { focus }

  const { container } = render(<ModelSettings showPaintingModel={false} showSettingsButton={false} />)

  const focusedRows = container.querySelectorAll('[data-focused]')
  expect(focusedRows).toHaveLength(1)
  expect(focusedRows[0]).toHaveTextContent(expectedTitle)
  expect(focusedRows[0].querySelector('[data-testid="model-settings-focus-guide"]')).toBeInTheDocument()
  expect(container.querySelectorAll('[data-testid="model-settings-focus-guide"]')).toHaveLength(1)
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  expect(setTimeoutTimerMock).toHaveBeenCalledWith(
    'model-settings-focus-guide',
    expect.any(Function),
    1200
  )

  act(() => setTimeoutTimerMock.mock.calls[0][1]())

  expect(container.querySelector('[data-testid="model-settings-focus-guide"]')).not.toBeInTheDocument()
})
```

- [ ] **步骤 2：运行定向测试并确认红灯原因是旧高亮实现**

运行：

```bash
pnpm exec vitest run --silent --project renderer \
  src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx
```

预期：FAIL。两个聚焦样例都找不到 `model-settings-focus-guide`，并且旧计时器仍使用 `model-settings-focus-fade` 和 `2000`。

- [ ] **步骤 3：在私有模型设置行中渲染定位箭头**

在 `ModelSettings.tsx` 的 Lucide import 中加入 `ArrowRight`。把 `ModelSettingRowProps.focusFaded` 改为 `focusGuideVisible`，删除外层行高亮类，并把右侧控制区改为相对定位容器：

```tsx
interface ModelSettingRowProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  compact?: boolean
  children: ReactNode
  rowRef?: Ref<HTMLDivElement>
  focused?: boolean
  focusGuideVisible?: boolean
}

const ModelSettingRow: FC<ModelSettingRowProps> = ({
  icon,
  title,
  description,
  compact,
  children,
  rowRef,
  focused,
  focusGuideVisible
}) => (
  <div ref={rowRef} data-focused={focused || undefined}>
    <SettingRow className={cn(compact ? 'flex-col items-stretch gap-3 py-1' : 'items-start gap-6 py-1.5')}>
      <div className="min-w-0 flex-1">
        <SettingRowTitle className="gap-2">
          {icon}
          {title}
        </SettingRowTitle>
        {description && <SettingDescription className="mt-1.5 leading-5">{description}</SettingDescription>}
      </div>
      <div
        className={cn(
          'relative',
          compact ? 'flex w-full items-center gap-2' : 'flex w-[340px] shrink-0 items-center gap-2'
        )}>
        {focused && focusGuideVisible ? (
          <span
            aria-hidden="true"
            data-testid="model-settings-focus-guide"
            className="animation-provider-model-pull-guide pointer-events-none absolute top-1/2 right-full z-10 mr-1 flex h-4 w-5 items-center justify-end text-muted-foreground motion-reduce:-translate-y-1/2 motion-reduce:animate-none">
            <ArrowRight className="size-4" strokeWidth={2.5} />
          </span>
        ) : null}
        {children}
      </div>
    </SettingRow>
  </div>
)
```

`w-5 + mr-1` 与非 compact 行现有 `gap-6` 都是 24px，箭头占用两栏之间的既有空隙，不改变选择器宽度。`motion-reduce:animate-none` 保留静态指示但取消位移和渐变动画，`motion-reduce:-translate-y-1/2` 在动画 transform 被禁用后继续保持垂直居中。

- [ ] **步骤 4：把两秒整行高亮计时改为 1.2 秒箭头计时**

在 `ModelSettings` 中用 `showFocusGuide` 替换 `focusFaded`：

```tsx
const [showFocusGuide, setShowFocusGuide] = useState(false)

useEffect(() => {
  if (compact || !focus) return

  const target = focus === 'default' ? defaultRowRef.current : translateRowRef.current
  if (!target) return

  scrollIntoView(target)
  setShowFocusGuide(true)
  setTimeoutTimer('model-settings-focus-guide', () => setShowFocusGuide(false), 1200)
}, [compact, focus, setTimeoutTimer])
```

默认模型和翻译模型两处调用都传入同一显示状态；只有 `focused` 为真的行渲染箭头。默认模型行改为：

```tsx
<ModelSettingRow
  compact={compact}
  rowRef={defaultRowRef}
  focused={focus === 'default'}
  focusGuideVisible={showFocusGuide}
  icon={<MessageSquareMore size={16} className="lucide-custom shrink-0 text-foreground" />}
  title={t('settings.models.default_assistant_model')}
  description={showDescription ? t('settings.models.default_assistant_model_description') : undefined}>
  <DefaultModelSelector
    model={selectableDefaultModel}
    providers={providers}
    filter={chatModelFilter}
    compact={compact}
    onSelect={onSelectDefault}
    placeholder={t('settings.models.empty')}
  />
</ModelSettingRow>
```

翻译模型行改为：

```tsx
<ModelSettingRow
  compact={compact}
  rowRef={translateRowRef}
  focused={focus === 'translate'}
  focusGuideVisible={showFocusGuide}
  icon={<Languages size={16} className="lucide-custom shrink-0 text-foreground" />}
  title={t('settings.models.translate_model')}
  description={showDescription ? t('settings.models.translate_model_description') : undefined}>
  <DefaultModelSelector
    model={selectableTranslateModel}
    providers={providers}
    filter={chatModelFilter}
    compact={compact}
    onSelect={onSelectTranslate}
    placeholder={t('settings.models.empty')}
  />
  {showSettingsButton && (
    <>
      <Button
        aria-label={t('settings.translate.title')}
        className="shrink-0"
        onClick={() => setActivePanel('translate')}
        size="icon-sm"
        variant="outline">
        <Settings2 size={16} />
      </Button>
      {translateModelPrompt !== TRANSLATE_PROMPT && (
        <Tooltip content={t('common.reset')}>
          <Button className="shrink-0" onClick={onResetTranslatePrompt} size="icon-sm" variant="outline">
            <RotateCcw size={16} />
          </Button>
        </Tooltip>
      )}
    </>
  )}
</ModelSettingRow>
```

- [ ] **步骤 5：运行定向测试并确认转绿**

运行：

```bash
pnpm exec vitest run --silent --project renderer \
  src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx
```

预期：PASS，现有模型筛选、Preference 写入和两个定位箭头样例全部通过。

- [ ] **步骤 6：运行仓库 lint 门禁**

运行：

```bash
pnpm lint
```

预期：命令退出码为 0；类型检查、i18n 检查和格式化均通过。按照用户要求不运行全量 `pnpm test`。

- [ ] **步骤 7：在已跟踪 Electron 实例中验证真实交互**

使用 `cherry-electron-dev` 技能连接当前实例，依次验证：

1. 快捷助手切到“默认模型”，点击“前往模型设置”；默认助手模型行滚动到视口，箭头出现在选择器左侧并在约 1.2 秒后消失。
2. 划词助手点击翻译模型的“前往模型设置”；翻译模型行滚动到视口，只有该选择器左侧出现箭头。
3. 箭头播放和消失期间，模型选择器宽度及相邻文字位置不发生跳动。

预期：三项均通过；验证完成后恢复测试前的快捷助手模式，不修改用户其它设置。

- [ ] **步骤 8：创建并验证签名提交**

运行：

```bash
git add src/renderer/pages/settings/ModelSettings/ModelSettings.tsx \
  src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx
git commit -S --signoff -m "fix(model-settings): point to focused model selector"
git cat-file commit HEAD | sed -n '1,20p'
git status --short --branch
```

预期：提交对象包含 `gpgsig` 和 `Signed-off-by`，工作树干净，分支继续领先 `origin/main`。
