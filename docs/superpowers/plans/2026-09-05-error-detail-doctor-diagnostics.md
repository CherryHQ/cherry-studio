# 错误详情 Doctor 诊断整合实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将现有 AI 诊断和 Doctor 检查纯前端整合进错误详情弹窗，提供基础信息、原样复制、同弹窗完整详情、基础/网络检查以及单一问题上报出口。

**架构：** `ErrorDetailContent` 保持为单个 `ContentPopup` 的状态宿主，以隐藏而非卸载的方式在诊断概览与完整详情间切换。`useDoctorController` 增加窄的嵌入式自动运行与问题上报回调，Doctor 分组结果和确认视图从现有面板提取为两个宿主共享的 renderer 内部组件；AI 诊断继续调用现有 `diagnoseError` 并维持既有缓存与持久化回调。

**技术栈：** React 19、TypeScript、`@cherrystudio/ui`、Tailwind CSS、i18next、Vitest、Testing Library、renderer IpcApi/shared cache。

---

## 文件结构

- 创建 `src/renderer/components/doctor/DoctorCheckResults.tsx`：唯一的 Doctor 分组、检查行、证据、行内动作和确认视图实现。
- 修改 `src/renderer/components/doctor/DoctorChecksPanel.tsx`：保留独立 Doctor 弹窗的摘要、过期提示、高级工具和页脚，改用共享结果组件。
- 修改 `src/renderer/components/doctor/useDoctorController.ts`：支持嵌入式宿主“非运行状态只自动发起一次基础检查”和外部问题上报交接。
- 修改 `src/renderer/components/doctor/__tests__/useDoctorController.test.tsx`：覆盖嵌入式自动运行、共享运行不抢占和问题上报回调。
- 修改 `src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx`：保证提取后证据、修复确认、焦点恢复和独立弹窗行为不回退。
- 创建 `src/renderer/components/ErrorDetailModal/ErrorBasicInformation.tsx`：渲染灰色基础信息框及框内 Copy/View Details 操作。
- 创建 `src/renderer/components/ErrorDetailModal/ErrorDiagnosticsPanel.tsx`：同时挂载 AI 诊断与 Doctor 控制器，渲染 AI 补充项、Doctor 分组结果和标题栏网络检查入口。
- 修改 `src/renderer/components/ErrorDetailModal/AiDiagnosisSection.tsx`：仅调整为诊断列表行视觉与可访问状态；保留现有请求、缓存和持久化逻辑。
- 修改 `src/renderer/components/ErrorDetailModal/ErrorDetailModal.tsx`：组织概览/完整详情内部页面、保留原复制格式、处理设置/更新/问题上报交接并精简页脚。
- 修改 `src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx`：覆盖基础信息、复制、内部页面、并发运行、共享运行、网络检查和安全上报。
- 修改 `src/renderer/components/ErrorDetailModal/__tests__/AiDiagnosisSection.test.tsx`：保持 AI 后端调用和卸载语义契约，补充重试结果的可见行为。
- 修改 `src/renderer/i18n/locales/{en-us,de-de,el-gr,es-es,fr-fr,ja-jp,pt-pt,ro-ro,ru-ru,tr-tr,vi-vn,zh-cn,zh-tw}.json`：增加两个错误诊断界面键并完成全部翻译。

## 执行前保护

当前 worktree 已有未提交的 Doctor 可访问性/shared-cache hydration 修改，以及不属于本设计的 Feedback/Help 修改。执行者必须保留它们：先用目标测试验证已有改动，再将它们按原职责分别签名提交；后续任务不得把 Feedback/Help 文件混入本功能提交。

### 任务 0：收拢现有未提交改动

**文件：**
- Doctor 组：`src/renderer/components/doctor/DoctorChecksPanel.tsx`、`DoctorDialog.tsx`、`__tests__/DoctorPopup.test.tsx`、`__tests__/useDoctorController.test.tsx`、`useDoctorController.ts`
- Feedback 组：`src/renderer/components/feedback/DiagnosticBundleDialog.tsx`、`DiagnosticUploadDialog.tsx`、`__tests__/DiagnosticUploadDialog.test.tsx`、`src/renderer/pages/settings/AboutSettings/__tests__/DiagnosticBundleDialog.test.tsx`
- Help 组：`src/renderer/components/layout/HelpMenu.tsx`

- [ ] **步骤 1：运行现有改动的最低充分测试**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx \
  src/renderer/components/doctor/__tests__/useDoctorController.test.tsx \
  src/renderer/components/feedback/__tests__/DiagnosticUploadDialog.test.tsx \
  src/renderer/pages/settings/AboutSettings/__tests__/DiagnosticBundleDialog.test.tsx \
  src/renderer/components/layout/__tests__/HelpMenu.test.tsx
```

预期：5 个测试文件全部 PASS；失败时只修复对应现有改动，不进入任务 1。

- [ ] **步骤 2：分职责创建签名提交**

```bash
git add src/renderer/components/doctor/DoctorChecksPanel.tsx \
  src/renderer/components/doctor/DoctorDialog.tsx \
  src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx \
  src/renderer/components/doctor/__tests__/useDoctorController.test.tsx \
  src/renderer/components/doctor/useDoctorController.ts
git commit -S --signoff -m "fix(system-doctor): preserve diagnostic dialog focus"

git add src/renderer/components/feedback/DiagnosticBundleDialog.tsx \
  src/renderer/components/feedback/DiagnosticUploadDialog.tsx \
  src/renderer/components/feedback/__tests__/DiagnosticUploadDialog.test.tsx \
  src/renderer/pages/settings/AboutSettings/__tests__/DiagnosticBundleDialog.test.tsx
git commit -S --signoff -m "fix(diagnostics): guard embedded bundle cleanup"

git add src/renderer/components/layout/HelpMenu.tsx
git commit -S --signoff -m "fix(help-menu): defer popup actions until close"
```

预期：每个 `git cat-file commit HEAD` 均含 `gpgsig` 和 `Signed-off-by`；`git status --short` 仅可能剩下本计划文档。

### 任务 1：为 Doctor controller 增加嵌入式宿主策略

**文件：**
- 修改：`src/renderer/components/doctor/useDoctorController.ts`
- 修改测试：`src/renderer/components/doctor/__tests__/useDoctorController.test.tsx`

- [ ] **步骤 1：编写失败的 controller 契约测试**

在现有测试 fixture 基础上加入以下三种真实输入/输出断言：

```tsx
it('runs one basic check when an embedded host opens over a completed run', async () => {
  mocks.doctorState = completedDoctorState('quick')
  const options = {
    autoRunPolicy: 'when-not-running' as const,
    initialPanel: 'checks' as const,
    onInstallUpdate: vi.fn(),
    onNavigate: vi.fn()
  }
  const { rerender } = renderHook(() => useDoctorController(options))

  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'quick' })
  )
  rerender()
  expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(1)
})

it('observes an active shared run without replacing it', async () => {
  mocks.doctorState = { status: 'running', runId: 'shared-live', tier: 'live', startedAt: new Date().toISOString(), results: [] }
  renderHook(() =>
    useDoctorController({
      autoRunPolicy: 'when-not-running',
      initialPanel: 'checks',
      onInstallUpdate: vi.fn(),
      onNavigate: vi.fn()
    })
  )

  await act(async () => {})
  expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything())
})

it('hands a report action to an embedded host without changing panels', async () => {
  mocks.doctorState = completedDoctorState('quick')
  const onReportProblem = vi.fn()
  const { result } = renderHook(() =>
    useDoctorController({
      initialPanel: 'checks',
      onInstallUpdate: vi.fn(),
      onNavigate: vi.fn(),
      onReportProblem
    })
  )

  await act(async () =>
    result.current.executeAction('logs-recent-findings', { kind: 'report' }, 'completed-run')
  )
  expect(onReportProblem).toHaveBeenCalledWith(expect.stringContaining('logs-recent-findings'))
  expect(result.current.session.activePanel).toBe('checks')
})
```

`completedDoctorState(tier)` 返回有效未过期 `DoctorState`，`report.runId` 固定为 `completed-run`，`results` 可为空，report summary 的 pass/warn/fail/skip/error 五项为 0。

- [ ] **步骤 2：运行测试并确认新契约尚未实现**

```bash
pnpm exec vitest run --project renderer src/renderer/components/doctor/__tests__/useDoctorController.test.tsx
```

预期：FAIL，原因分别为 `autoRunPolicy`/`onReportProblem` 尚不存在或 completed 状态未发起 quick。

- [ ] **步骤 3：实现最小 controller 扩展**

在 `UseDoctorControllerOptions` 中加入窄接口，并保持独立 Doctor 弹窗默认行为：

```ts
type DoctorAutoRunPolicy = 'when-idle' | 'when-not-running'

interface UseDoctorControllerOptions {
  readonly autoRunPolicy?: DoctorAutoRunPolicy
  readonly initialPanel: DoctorPanel
  readonly initialDescription?: string
  readonly onInstallUpdate: (releaseInfo: UpdateInfo) => void
  readonly onNavigate: (target: DoctorNavigateTarget) => void
  readonly onReportProblem?: (description: string) => void
}
```

默认 `autoRunPolicy = 'when-idle'`。shared cache ready 后，仅在 `autoRunRequestedRef.current === false` 且下式为真时调用一次 `run('quick')`：

```ts
const shouldAutoRun =
  doctorState.status === 'idle' ||
  (autoRunPolicy === 'when-not-running' && doctorState.status !== 'running')
```

`DoctorAction.report` 分支先构造现有安全检查描述；有 `onReportProblem` 时直接交给宿主并返回，否则维持设置 draft 后切换 `report` 面板的原行为。不得传递 `DoctorReport`、evidence 或 AI 内容。

- [ ] **步骤 4：运行 controller 测试验证通过**

```bash
pnpm exec vitest run --project renderer src/renderer/components/doctor/__tests__/useDoctorController.test.tsx
```

预期：PASS。

- [ ] **步骤 5：签名提交**

```bash
git add src/renderer/components/doctor/useDoctorController.ts \
  src/renderer/components/doctor/__tests__/useDoctorController.test.tsx
git commit -S --signoff -m "refactor(system-doctor): support embedded diagnostic hosts"
```

### 任务 2：提取唯一的 Doctor 结果与确认渲染器

**文件：**
- 创建：`src/renderer/components/doctor/DoctorCheckResults.tsx`
- 修改：`src/renderer/components/doctor/DoctorChecksPanel.tsx`
- 修改测试：`src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx`

- [ ] **步骤 1：固定共享渲染器必须保留的用户行为**

在 `DoctorPopup.test.tsx` 的现有结果 fixture 上增加一条断言：问题组默认展开、健康组默认折叠，展开健康组后能看到真实检查标题；继续保留现有敏感 evidence 遮罩/确认、不可逆修复内容和焦点恢复测试。断言可见输出，不断言内部函数调用次数。

- [ ] **步骤 2：运行测试建立提取前基线**

```bash
pnpm exec vitest run --project renderer src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx
```

预期：PASS。

- [ ] **步骤 3：移动共享实现，不复制状态机**

`DoctorCheckResults.tsx` 导出两个组件：

```tsx
export function DoctorCheckResults({ controller }: { readonly controller: DoctorController })

export function DoctorConfirmationView({
  controller,
  onResolve
}: {
  readonly controller: DoctorController
  readonly onResolve: (checkId: DoctorCheckId) => void
})
```

`DoctorCheckResults` 包含现有 Accordion、`DoctorCheckRow`、`CheckDescription`、evidence 分类/确认后原位揭示、穷尽 `actionLabel`、`StatusIcon` 和行内动作。它只渲染 `controller.viewModel.groups` 中已有行，不补齐缺失 check ID。

`DoctorConfirmationView` 只接受 `confirm-fix` 或 `confirm-evidence` interaction，复用现有影响范围、预计字节数、不可撤销、耗时、destructive 确认和焦点进入逻辑。取消或确认前调用 `onResolve(checkId)`，随后调用 controller 的原有方法。

`DoctorChecksPanel` 保留现有 `restoreActionCheckRef`、`DoctorSummary`、stale/relaunch alerts、empty alert、advanced tools、copy 和 footer；把 Accordion 与确认 JSX 换成上述两个组件。该提取不得改变 `DoctorPopup.show` 或 `DoctorDialog`。

- [ ] **步骤 4：运行测试验证提取无回退**

```bash
pnpm exec vitest run --project renderer src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx
```

预期：PASS；确认按钮仍为 destructive，敏感 evidence 仍先遮罩后揭示，焦点仍返回触发按钮。

- [ ] **步骤 5：签名提交**

```bash
git add src/renderer/components/doctor/DoctorCheckResults.tsx \
  src/renderer/components/doctor/DoctorChecksPanel.tsx \
  src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx
git commit -S --signoff -m "refactor(system-doctor): share diagnostic result rendering"
```

### 任务 3：先用测试定义错误详情整合行为

**文件：**
- 修改测试：`src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx`
- 修改测试：`src/renderer/components/ErrorDetailModal/__tests__/AiDiagnosisSection.test.tsx`

- [ ] **步骤 1：为 ErrorDetail 测试增加真实 Doctor 边界 mock**

mock `cacheService.isSharedCacheReady()` 为 true；`useSharedCacheValue('doctor.state')` 返回可变的 `mocks.doctorState`；`ipcApi.request` 使用 `mocks.request`；app update 和 MCP hooks 返回无更新、空服务器。保留真实 `useDoctorController`、`doctorViewModel` 和共享结果组件，不 mock 它们。

在测试文件定义并复用以下完整 fixture；从 Testing Library 增加导入 `cleanup` 和 `waitFor`，从 error utils 增加导入 `formatError`：

```tsx
const providerError = { name: 'ProviderError', message: 'failed', stack: 'private stack' }
const aiDiagnosis = {
  category: 'runtime',
  explanation: 'Check the provider configuration',
  steps: [],
  summary: 'Provider failed'
}
const passingVersionResult = { id: 'install-version-channel' as const, status: 'pass' as const, durationMs: 1 }

function runningDoctorState(tier: 'quick' | 'live'): DoctorState {
  return { status: 'running', runId: `running-${tier}`, tier, startedAt: new Date().toISOString(), results: [] }
}

function completedDoctorState(
  tier: 'quick' | 'live',
  results: DoctorCheckResult[] = []
): DoctorState {
  const now = Date.now()
  return {
    status: 'completed',
    report: {
      schemaVersion: 1,
      runId: `completed-${tier}`,
      tier,
      startedAt: new Date(now - 1_000).toISOString(),
      finishedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      basics: {
        version: '2.0.0',
        edition: 'global',
        channel: 'latest',
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '25.0.0',
        runtime: {},
        isPackaged: true,
        isPortable: false,
        userDataPath: '/Users/local/CherryStudio'
      },
      results,
      summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  }
}

function deferredDiagnosis() {
  let resolve!: (result: DiagnosisResult) => void
  return {
    promise: new Promise<DiagnosisResult>((next) => {
      resolve = next
    }),
    resolve
  }
}
```

- [ ] **步骤 2：编写失败的用户行为测试**

新增以下独立测试：

```tsx
it('shows compact basic information and copies the unchanged error text', async () => {
  const error = { name: 'ProviderError', message: 'failed', stack: 'private stack' }
  render(
    <ErrorDetailContent
      diagnosisContext={{ errorSource: 'chat', providerName: 'OpenAI', modelId: 'gpt-5' }}
      diagnosticReport={{ location: 'Home conversation' }}
      error={error}
    />
  )

  expect(screen.getByText('Basic information')).toBeInTheDocument()
  expect(screen.getByText('OpenAI')).toBeInTheDocument()
  expect(screen.queryByText('private stack')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(formatError(error))
})

it('keeps both diagnostics mounted while viewing complete error details', async () => {
  const pendingDiagnosis = deferredDiagnosis()
  mocks.diagnoseError.mockReturnValueOnce(pendingDiagnosis.promise)
  mocks.doctorState = runningDoctorState('quick')
  const { rerender } = render(<ErrorDetailContent error={providerError} />)

  await userEvent.click(screen.getByRole('button', { name: 'View Details' }))
  expect(screen.getByText('private stack')).toBeInTheDocument()
  mocks.doctorState = completedDoctorState('quick', [passingVersionResult])
  rerender(<ErrorDetailContent error={providerError} />)
  pendingDiagnosis.resolve(aiDiagnosis)
  await userEvent.click(screen.getByRole('button', { name: 'Back to diagnostic overview' }))

  expect(await screen.findByText(aiDiagnosis.explanation)).toBeInTheDocument()
  expect(screen.getByText('Version and release channel')).toBeInTheDocument()
  expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.cancel', expect.anything())
})

it('starts uncached AI and basic Doctor diagnostics together without replacing a shared run', async () => {
  mocks.doctorState = { status: 'idle' }
  render(<ErrorDetailContent error={providerError} />)
  await waitFor(() => expect(mocks.diagnoseError).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'quick' })

  cleanup()
  vi.clearAllMocks()
  mocks.doctorState = runningDoctorState('live')
  render(<ErrorDetailContent error={providerError} />)
  await waitFor(() => expect(mocks.diagnoseError).toHaveBeenCalledOnce())
  expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything())
})

it('runs network and service checks from the diagnostics header', async () => {
  mocks.doctorState = runningDoctorState('quick')
  const { rerender } = render(<ErrorDetailContent error={providerError} />)
  mocks.doctorState = completedDoctorState('quick', [passingVersionResult])
  rerender(<ErrorDetailContent error={providerError} />)

  await userEvent.click(screen.getByRole('button', { name: 'Network and services check' }))
  expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'live' })
})
```

同时更新既有 report 测试，断言概览页脚按钮文本严格等于 `['Report a problem']`，且 description 不包含 AI explanation、Doctor evidence 或完整 stack。

- [ ] **步骤 3：运行测试并确认界面尚未实现**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx \
  src/renderer/components/ErrorDetailModal/__tests__/AiDiagnosisSection.test.tsx
```

预期：FAIL，缺少 Basic information/View Details/Back、AI 自动启动、Doctor quick/live 请求和单一页脚。

### 任务 4：实现基础信息、内部详情页和统一诊断列表

**文件：**
- 创建：`src/renderer/components/ErrorDetailModal/ErrorBasicInformation.tsx`
- 创建：`src/renderer/components/ErrorDetailModal/ErrorDiagnosticsPanel.tsx`
- 修改：`src/renderer/components/ErrorDetailModal/ErrorDetailModal.tsx`
- 修改：`src/renderer/components/ErrorDetailModal/AiDiagnosisSection.tsx`

- [ ] **步骤 1：实现基础信息闭集映射**

`ErrorBasicInformation` 使用 `dl` 渲染非空值，字段严格为：

```ts
const fields = [
  [t('error.diagnostic_report.location'), diagnosticReport?.location ?? diagnosisContext?.errorSource],
  [t('error.provider'), diagnosisContext?.providerName],
  [t('error.modelId'), diagnosisContext?.modelId],
  [t('error.name'), error?.name],
  [t('error.statusCode'), errorRecord?.status ?? errorRecord?.statusCode],
  [t('error.message'), error?.message]
].filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined && entry[1] !== '')
```

外框使用 `rounded-xl border border-border bg-secondary p-4`。右上角两个 `@cherrystudio/ui` 小按钮分别调用 `onCopy` 和 `onViewDetails`；Copy 在无 error 时 disabled。不得在该组件序列化 error，也不得接收 AI/Doctor result。

- [ ] **步骤 2：实现持续挂载的诊断宿主**

`ErrorDiagnosticsPanel` 初始化 AI 状态：有缓存为 `done`，有 error 且无缓存为 `loading`。始终挂载现有 `AiDiagnosisSectionWithStatus`，使其现有 mount effect 自动调用 `diagnoseError`。controller 配置为：

```ts
const controller = useDoctorController({
  autoRunPolicy: 'when-not-running',
  initialPanel: 'checks',
  onInstallUpdate,
  onNavigate,
  onReportProblem
})
```

诊断标题栏右侧按钮使用 `settings.doctor.actions.run_network`。当 `viewModel.status === 'running'`、controller 正在 interaction 或尚无基础 report 时 disabled；共享 live run 或本地 live interaction 时显示 loading。点击只执行 `controller.run('live')`。

AI 行在 Doctor Accordion 前；Doctor 只渲染 `DoctorCheckResults`。若 interaction 是 `confirm-fix`/`confirm-evidence`，概览内容使用 `hidden` 保持挂载，同时显示 `DoctorConfirmationView`，完成后把焦点还给相应检查动作。

- [ ] **步骤 3：保持 AI 数据逻辑并改用仓库视觉语义**

删除 `color-mix` inline style、原生 retry button 和 `animation-rotate`。改用 `@cherrystudio/ui` 的 `Badge`/`Button`、Tailwind semantic tokens、`motion-safe:animate-spin`；保留 `runDiagnosis`、dynamic import、cached result、`cancelledRef`、`onDiagnosisComplete` 的代码路径不变。loading 使用 `role="status" aria-live="polite"`，失败使用 `role="alert"`，retry 仍调用同一 `runDiagnosis`。

- [ ] **步骤 4：重组 ErrorDetailContent 而不改变复制与安全上报**

保留现有 `copyErrorDetails` 函数体原样。加入 `activeView: 'overview' | 'details'`；在一个 `ErrorDetailContainer` 内始终渲染 `ErrorDiagnosticsPanel`，仅通过父 `hidden={activeView !== 'overview'}` 隐藏；完整 `renderErrorDetails(error)` 只在 details 视图渲染。详情页顶部提供 Back to Diagnostic Overview。

删除 footer 的 Copy 和 AI Diagnosis 按钮；仅在 `diagnosticReport && onOpenDiagnosticReport` 时渲染现有 Report Problem。`openDiagnosticReport` 继续只调用 `buildDiagnosticReportDescription`。

为 Doctor 行动作新增可选宿主 props，并由 `ErrorDiagnosticsPanel` 原样传入 controller：

```ts
onDoctorInstallUpdate?: (releaseInfo: UpdateInfo) => void
onDoctorNavigate?: (target: DoctorNavigateTarget) => void
```

`showErrorDetailPopup` 将这两个回调与现有上报回调统一通过 `ContentPopup.hide()` + `POPUP_EXIT_MS` 交接。navigate 调用 `openSettingsTab(target)`；install update lazy import `UpdateDialogPopup`。不得发送 cancel IPC。

- [ ] **步骤 5：运行 ErrorDetail 目标测试验证通过**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx \
  src/renderer/components/ErrorDetailModal/__tests__/AiDiagnosisSection.test.tsx
```

预期：PASS。

- [ ] **步骤 6：签名提交 UI 与测试**

```bash
git add src/renderer/components/ErrorDetailModal/ErrorBasicInformation.tsx \
  src/renderer/components/ErrorDetailModal/ErrorDiagnosticsPanel.tsx \
  src/renderer/components/ErrorDetailModal/ErrorDetailModal.tsx \
  src/renderer/components/ErrorDetailModal/AiDiagnosisSection.tsx \
  src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx \
  src/renderer/components/ErrorDetailModal/__tests__/AiDiagnosisSection.test.tsx
git commit -S --signoff -m "feat(error-diagnostics): combine AI and system checks"
```

### 任务 5：完成 i18n 闭集

**文件：**
- 修改：全部 13 个 `src/renderer/i18n/locales/*.json`

- [ ] **步骤 1：在 en-US 增加并同步两个键**

```json
"error.diagnostics.back_to_overview": "Back to diagnostic overview",
"error.diagnostics.basic_information": "Basic information"
```

运行：

```bash
pnpm i18n:sync
```

预期：其他 locale 出现相同两个键；随后立即替换所有 `[to be translated]`。

- [ ] **步骤 2：写入全部自然翻译**

| Locale | `basic_information` | `back_to_overview` |
| --- | --- | --- |
| de-DE | Grundinformationen | Zurück zur Diagnoseübersicht |
| el-GR | Βασικές πληροφορίες | Επιστροφή στην επισκόπηση διαγνωστικών |
| es-ES | Información básica | Volver al resumen de diagnóstico |
| fr-FR | Informations de base | Retour à la vue d’ensemble du diagnostic |
| ja-JP | 基本情報 | 診断概要に戻る |
| pt-PT | Informações básicas | Voltar à visão geral do diagnóstico |
| ro-RO | Informații de bază | Înapoi la prezentarea diagnosticului |
| ru-RU | Основная информация | Назад к обзору диагностики |
| tr-TR | Temel bilgiler | Tanılama özetine dön |
| vi-VN | Thông tin cơ bản | Quay lại tổng quan chẩn đoán |
| zh-CN | 基础信息 | 返回诊断概览 |
| zh-TW | 基本資訊 | 返回診斷概覽 |

- [ ] **步骤 3：签名提交翻译**

```bash
git add src/renderer/i18n/locales/*.json
git commit -S --signoff -m "feat(i18n): translate error diagnostic overview"
```

### 任务 6：集中自检、最终验证和 Draft PR 更新

**文件：**
- 审查：本计划列出的全部实现与测试文件
- 更新：GitHub Draft PR #20006 body

- [ ] **步骤 1：进行一次集中自检**

检查：只有实际 Doctor catalog 行；AI 不进入 Doctor ViewModel/计数；复制函数体未变；report prefill 未拼入 AI、DoctorReport、evidence 或 stack；详情切换不卸载诊断宿主；无 nested Dialog；无 main/shared/backend/IPC schema 变更；所有 action switch 仍穷尽。

- [ ] **步骤 2：运行一次最终目标测试**

仅当任务 4 后代码继续变化时运行：

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx \
  src/renderer/components/ErrorDetailModal/__tests__/AiDiagnosisSection.test.tsx \
  src/renderer/components/doctor/__tests__/DoctorPopup.test.tsx \
  src/renderer/components/doctor/__tests__/useDoctorController.test.tsx
```

预期：4 个文件全部 PASS。不运行全量 renderer 测试、`pnpm test` 或 `pnpm build`。

- [ ] **步骤 3：只运行一次 lint**

```bash
pnpm lint
```

预期：exit 0。若 lint 写入无关文件，用逐文件 diff 还原仅由该命令产生且与本功能无关的部分；不得丢弃执行前已有改动。

- [ ] **步骤 4：提交 lint 必需修正并验证所有签名**

```bash
git add src/renderer/components/ErrorDetailModal \
  src/renderer/components/doctor/DoctorCheckResults.tsx \
  src/renderer/components/doctor/DoctorChecksPanel.tsx \
  src/renderer/components/doctor/useDoctorController.ts \
  src/renderer/i18n/locales/*.json
git commit -S --signoff -m "chore(error-diagnostics): apply repository checks"
git log --format='%H' review-pr-19982-and-doc..HEAD | while read commit; do git cat-file commit "$commit" | rg -q '^gpgsig '; done
```

若 lint 未产生改动则不创建空提交。每个提交都必须有 `gpgsig` 和 `Signed-off-by`。

- [ ] **步骤 5：push 并更新 stacked Draft PR**

```bash
git push origin codex/doctor-frontend-v1
gh pr edit 20006 --base review-pr-19982-and-doc --body-file /tmp/doctor-frontend-v1-pr-body.md
gh pr view 20006 --json url,isDraft,baseRefName,headRefName,statusCheckRollup
```

执行该命令前必须读取并遵循 `gh-create-pr` skill，基于当前 PR 模板用 `apply_patch` 创建 `/tmp/doctor-frontend-v1-pr-body.md`。body 必须明确写出：纯前端合并；AI 后端逻辑未改；Doctor 仍依赖 #19992；复制沿用原格式；网络检查移到诊断标题栏；本轮只运行目标 Vitest 与一次 lint；PR 仍为 Draft。预期 base 为 `review-pr-19982-and-doc`、head 为 `codex/doctor-frontend-v1`、`isDraft: true`，GitHub 上新提交显示 Verified。
