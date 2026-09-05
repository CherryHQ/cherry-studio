# 错误详情顶部返回导航实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将错误详情内部页面的返回入口移到 Dialog 顶部标题左侧，并删除详情正文中重复的返回入口和标题。

**架构：** 用专用 `createPopup` Dialog 替换错误详情对静态 `ContentPopup` 壳的依赖，但保留 `showErrorDetailPopup(...)` 外部函数和 single-flight 行为。`ErrorDetailContent` 继续持有 `activeView`，同时渲染动态 `DialogHeader`；概览中的 AI 诊断和 Doctor controller 保持挂载，切页只改变展示。

**技术栈：** React 19、TypeScript、`@cherrystudio/ui` Dialog、Tailwind CSS、renderer popup service、Vitest、Testing Library。

---

## 文件结构

- 修改 `src/renderer/components/ErrorDetailModal/ErrorDetailModal.tsx`：渲染动态 Dialog header，并用专用 popup 壳承载现有内容及交接行为。
- 修改 `src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx`：验证返回按钮属于顶部 header、只有一个错误详情标题，且切页不取消 Doctor。

### 任务 1：用测试定义顶部返回导航

**文件：**
- 测试：`src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx`

- [ ] **步骤 1：移除只服务于旧 ContentPopup 壳的测试 mock**

删除 `@renderer/components/popups/ContentPopup` mock，让 `PopupHost` 测试覆盖真实 Dialog 结构。保留 `@renderer/services/popup` 的真实实现。

- [ ] **步骤 2：编写失败的顶部导航测试**

在 `ErrorDetailContent diagnostics` 中加入：

```tsx
it('places the details back action beside the sole dialog title', async () => {
  const user = userEvent.setup()
  mocks.doctorState = runningDoctorState('quick')
  render(<PopupHost />)

  act(() => {
    showErrorDetailPopup({ error: providerError })
  })

  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'View Details' }))

  const header = dialog.querySelector<HTMLElement>('[data-slot="dialog-header"]')
  expect(header).not.toBeNull()
  expect(within(header as HTMLElement).getByRole('button', { name: 'Back to diagnostic overview' })).toBeVisible()
  expect(within(header as HTMLElement).getByRole('heading', { name: 'Error Details' })).toBeVisible()
  expect(within(dialog).getAllByRole('heading', { name: 'Error Details' })).toHaveLength(1)
  expect(screen.getByText('private stack')).toBeVisible()
  expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.cancel', expect.anything())
})
```

- [ ] **步骤 3：运行目标测试确认失败原因**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx
```

预期：新增测试失败，因为返回按钮仍在 Dialog body，且 body 中还有第二个 Error Details 标题。

### 任务 2：迁移为专用 ErrorDetail popup

**文件：**
- 修改：`src/renderer/components/ErrorDetailModal/ErrorDetailModal.tsx`
- 测试：`src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx`

- [ ] **步骤 1：让 ErrorDetailContent 渲染动态 DialogHeader**

从 `@cherrystudio/ui` 引入 `DialogHeader`、`DialogTitle`、`Tooltip`。在现有内容容器之前渲染唯一 header：

```tsx
<DialogHeader className="pr-8">
  <div className="flex min-w-0 items-center gap-2">
    {activeView === 'details' ? (
      <Tooltip content={t('error.diagnostics.back_to_overview')}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('error.diagnostics.back_to_overview')}
          onClick={showOverview}>
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
      </Tooltip>
    ) : null}
    <DialogTitle ref={detailsHeadingRef} tabIndex={activeView === 'details' ? -1 : undefined}>
      {t('error.detail')}
    </DialogTitle>
  </div>
</DialogHeader>
```

`showDetails` 继续在下一帧把滚动位置归零并聚焦 `detailsHeadingRef`；`showOverview` 继续把焦点还给基础信息卡中的 View Details 按钮。

- [ ] **步骤 2：删除详情正文的重复导航**

把详情页 body 从：

```tsx
<div className="space-y-4">
  <div className="flex items-center gap-3">
    <Button>Back to Diagnostic Overview</Button>
    <h2>Error Details</h2>
  </div>
  {renderErrorDetails(error)}
</div>
```

收敛为：

```tsx
<div className="space-y-4">{renderErrorDetails(error)}</div>
```

不得改变 `renderErrorDetails`、复制内容、安全问题上报描述、AI 诊断或 Doctor controller。

- [ ] **步骤 3：用 createPopup 提供专用 Dialog 壳**

删除 `ContentPopup` import，改为引入 `Dialog`、`DialogContent`、`createPopup` 和 `PopupInjectedProps`。新增私有 popup 组件：

```tsx
type ErrorDetailDialogProps = ErrorDetailContentProps & PopupInjectedProps<void>

const ErrorDetailDialog = ({ open, resolve, ...contentProps }: ErrorDetailDialogProps) => (
  <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && resolve()}>
    <DialogContent
      closeLabel={i18n.t('common.close')}
      className="sm:max-w-none"
      style={{
        width: 'min(60vw, calc(100vw - 2rem))',
        minWidth: 'min(600px, calc(100vw - 2rem))',
        maxWidth: 'min(1200px, calc(100vw - 2rem))'
      }}>
      <ErrorDetailContent {...contentProps} />
    </DialogContent>
  </Dialog>
)

const ErrorDetailPopup = createPopup<ErrorDetailContentProps, void>(ErrorDetailDialog)
```

`showErrorDetailPopup(params)` 调用 `ErrorDetailPopup.show(...)`。设置跳转、更新和问题上报的 `finishHandoff` 改为先调用 `ErrorDetailPopup.hide()`，等待现有 `POPUP_EXIT_MS` 后执行原动作。不得修改调用方接口或增加全局状态。

- [ ] **步骤 4：运行目标测试验证通过**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx
```

预期：全部 PASS；新增测试证明顶部返回和单一标题，既有测试继续证明诊断宿主不卸载且 Doctor 不被取消。

- [ ] **步骤 5：运行最低充分静态检查**

运行：

```bash
pnpm exec eslint \
  src/renderer/components/ErrorDetailModal/ErrorDetailModal.tsx \
  src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx --cache
pnpm typecheck
git diff --check
```

预期：全部 exit 0。不运行全量测试或 build；此前仓库级 `pnpm lint` 已确认会被无关嵌套 worktree 阻断，本次不重复该无关失败。

- [ ] **步骤 6：在跟踪的 Electron 实例验证**

使用 `.context/cherry-electron-dev/instance.json` 重新校验 PID、cwd、CDP listener 和 `/windows/main/index.html` target。打开错误详情后验证：

1. 概览只有一个顶部 Error Details 标题且无返回箭头。
2. View Details 后，返回箭头位于同一 header 的标题左侧。
3. 正文没有重复标题或返回按钮。
4. 返回概览后 AI/Doctor 当前状态仍在，未发送 cancel。

保存一张详情页截图到 `.context/cherry-electron-dev/error-details-header-back.png`，并保持健康的 persistent 实例运行。

- [ ] **步骤 7：签名提交、push 并同步 Draft PR**

```bash
git add src/renderer/components/ErrorDetailModal/ErrorDetailModal.tsx \
  src/renderer/components/ErrorDetailModal/__tests__/ErrorDetailModal.test.tsx
git commit -S --signoff -m "fix(error-diagnostics): move detail navigation to header"
git cat-file commit HEAD
git show --show-signature --no-patch HEAD
git push origin codex/doctor-frontend-v1
```

验证提交包含 `gpgsig` 和 `Signed-off-by`，GitHub commit 为 Verified。按 `gh-create-pr` skill 更新 Draft PR #20006 body，保留 base `review-pr-19982-and-doc`，注明专用 ErrorDetail popup、顶部返回导航、目标测试结果和未改变 AI/Doctor 后端逻辑。
