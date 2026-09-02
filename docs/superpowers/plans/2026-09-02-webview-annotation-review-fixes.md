# Webview 标注审查问题修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 PR #17842 引入的页面主世界选择器执行风险和元数据更新导致编辑器草稿丢失问题，并补齐 Markdown 转义契约测试。

**架构：** 主进程在目标 WebView 主 frame 的 CDP isolated world 中解析选择器，再沿用现有 DOM/AX 抓取流程。渲染进程把桥接生命周期依赖收窄到 WebView、host 和 target identity，使用 ref 在消息发生时读取最新 target 元数据。格式化器保持实现不变，仅增加能杀死转义逻辑突变的输出契约测试。

**技术栈：** TypeScript、Electron WebContents Debugger/CDP、React 19、Vitest、Testing Library、pnpm。

---

## 文件结构

- 修改 `src/main/services/__tests__/WebviewService.test.ts`：模拟 main-frame isolated world，并断言选择器执行使用返回的 context ID。
- 修改 `src/main/services/WebviewService.ts`：创建 isolated world，把 execution context 传给 `Runtime.evaluate`。
- 修改 `src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx`：复现同一 target 的 label 更新导致 annotation mode 被关闭，并验证同步使用最新 label。
- 修改 `src/renderer/components/WebviewAnnotationControls.tsx`：用 ref 解耦最新 target 元数据与桥接 attachment 生命周期。
- 修改 `src/main/utils/__tests__/webviewAnnotations.test.ts`：覆盖页面标题、target label、元素文本和无障碍文本中的 Markdown 控制字符。
- 删除 `docs/superpowers/specs/2026-09-02-webview-annotation-review-fixes-design.md` 和本计划：按用户要求在修复完成后移除临时方案材料。

### 任务 1：在 isolated world 中解析 AX 目标

**文件：**
- 修改：`src/main/services/__tests__/WebviewService.test.ts:93-143,333-455`
- 修改：`src/main/services/WebviewService.ts:31-67,458-665`

- [ ] **步骤 1：让测试 WebView 模拟 CDP isolated world**

把传入 mock 保留为 delegate，并在 debugger 边界统一提供 Page 域响应：

```ts
const delegateSendCommand = options.sendCommand ?? vi.fn().mockResolvedValue({})
// other debugger members stay unchanged
sendCommand: vi.fn((method: string, params?: Record<string, unknown>) => {
  if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'main-frame' } } })
  if (method === 'Page.createIsolatedWorld') return Promise.resolve({ executionContextId: 73 })
  return delegateSendCommand(method, params)
})
```

- [ ] **步骤 2：增加会失败的安全边界断言**

```ts
expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Page.getFrameTree', undefined)
expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Page.createIsolatedWorld', {
  frameId: 'main-frame',
  worldName: 'cherry-webview-annotation-accessibility',
  grantUniveralAccess: false
})
expect(guest.debugger.sendCommand).toHaveBeenCalledWith(
  'Runtime.evaluate',
  expect.objectContaining({ contextId: 73 })
)
```

- [ ] **步骤 3：运行红灯测试**

运行 `pnpm test:main src/main/services/__tests__/WebviewService.test.ts`。

预期：FAIL；`Page.getFrameTree` 尚未被调用。

- [ ] **步骤 4：添加最小 isolated-world 实现**

添加协议结果类型和 world 名称：

```ts
const ACCESSIBILITY_WORLD_NAME = 'cherry-webview-annotation-accessibility'

interface CdpPageGetFrameTreeResult {
  frameTree?: { frame?: { id?: string } }
}

interface CdpPageCreateIsolatedWorldResult {
  executionContextId?: number
}
```

为抓取方法加入 `executionContextId: number` 参数，并在 selector evaluation 中加入：

```ts
{
  expression: buildElementResolverExpression(annotation.element.selector),
  contextId: executionContextId,
  objectGroup,
  returnByValue: false,
  silent: true
}
```

在 Runtime/Accessibility enable 后创建 context：

```ts
const frameTreeResult = await this.sendDebuggerCommand<CdpPageGetFrameTreeResult>(
  debuggerSession,
  'Page.getFrameTree',
  undefined,
  deadline
)
const frameId = frameTreeResult.frameTree?.frame?.id
if (!frameId) throw new Error('Webview main frame is unavailable')

const isolatedWorld = await this.sendDebuggerCommand<CdpPageCreateIsolatedWorldResult>(
  debuggerSession,
  'Page.createIsolatedWorld',
  { frameId, worldName: ACCESSIBILITY_WORLD_NAME, grantUniveralAccess: false },
  deadline
)
const executionContextId = isolatedWorld.executionContextId
if (typeof executionContextId !== 'number') throw new Error('Webview isolated world is unavailable')
```

把 `executionContextId` 传给 annotation 循环中的 `captureAnnotationAccessibility` 调用。

- [ ] **步骤 5：运行绿灯测试**

运行 `pnpm test:main src/main/services/__tests__/WebviewService.test.ts`。

预期：测试文件通过；selector evaluation 含 `contextId: 73`。

- [ ] **步骤 6：提交任务 1**

```bash
git add src/main/services/WebviewService.ts src/main/services/__tests__/WebviewService.test.ts
git commit -S --signoff -m "fix(webview): isolate annotation selector capture"
```

### 任务 2：元数据更新时保留标注编辑器状态

**文件：**
- 修改：`src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx:86-229`
- 修改：`src/renderer/components/WebviewAnnotationControls.tsx:32-177`

- [ ] **步骤 1：添加同 target label 更新回归测试**

```tsx
it('keeps annotation mode active when target presentation metadata changes', async () => {
  const webview = createWebview()
  const webviewRef = { current: webview }
  const { rerender } = render(
    <WebviewAnnotationControls webviewRef={webviewRef} isWebviewReady isHostActive target={target} />
  )

  fireEvent.click(screen.getByRole('button', { name: '标注页面' }))
  vi.mocked(webview.send).mockClear()
  request.mockClear()

  const localizedTarget = { ...target, label: '演示' }
  rerender(
    <WebviewAnnotationControls webviewRef={webviewRef} isWebviewReady isHostActive target={localizedTarget} />
  )

  expect(webview.send).not.toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
    type: 'set_enabled',
    enabled: false
  })

  act(() => dispatchGuestState(webview, { enabled: true, annotations: [annotation] }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('webview.replace_annotations', {
      webviewId: 42,
      target: localizedTarget,
      annotations: [annotation]
    })
  )
})
```

- [ ] **步骤 2：运行红灯测试**

运行 `pnpm test:renderer src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx`。

预期：FAIL；rerender 触发 cleanup，观测到 `set_enabled: false`。

- [ ] **步骤 3：用 latest ref 收窄 effect 依赖**

```ts
const targetRef = useRef(target)
targetRef.current = target

const replaceMainSnapshot = useCallback(
  async (annotations: WebviewAnnotation[], webview = webviewRef.current) => {
    if (!webview) return false
    const currentTarget = targetRef.current
    try {
      const webviewId = webview.getWebContentsId()
      if (!webviewId) return false
      await ipcApi.request('webview.replace_annotations', { webviewId, target: currentTarget, annotations })
      return true
    } catch (error) {
      logger.debug('Failed to synchronize webview annotations', { targetId: currentTarget.id, error })
      return false
    }
  },
  [webviewRef]
)
```

不改 attachment cleanup。target ID 改变时 `sendCommand` 仍重建并触发真实 ownership cleanup；label/locale/theme 更新不再 detach。

- [ ] **步骤 4：运行绿灯测试**

运行 `pnpm test:renderer src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx`。

预期：测试文件通过；label 更新不 disable，后续 snapshot 使用新 label。

- [ ] **步骤 5：提交任务 2**

```bash
git add src/renderer/components/WebviewAnnotationControls.tsx src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx
git commit -S --signoff -m "fix(webview): preserve annotation drafts on metadata changes"
```

### 任务 3：补齐 Markdown 转义契约测试

**文件：**
- 修改：`src/main/utils/__tests__/webviewAnnotations.test.ts:54-220`

- [ ] **步骤 1：添加页面来源 Markdown 控制字符测试**

构造 resolved document，设置 target label 为 `# Demo [link]`、page title 为 `> *Private* <page>`、element text 为 `_Submit_ [now]`、ARIA label 为 `# Confirm`，并设置 accessibility name/description 为 `*Pay* [now]` 和 `<unsafe>`。

断言：

```ts
expect(result.text).toContain('## \\# Demo \\[link\\] (`mini-app:demo`)')
expect(result.text).toContain('- Page: \\> \\*Private\\* \\<page\\>')
expect(result.text).toContain('- Visible text: \\_Submit\\_ \\[now\\]')
expect(result.text).toContain('- ARIA label: \\# Confirm')
expect(result.text).toContain('name=\\*Pay\\* \\[now\\]')
expect(result.text).toContain('description=\\<unsafe\\>')
```

- [ ] **步骤 2：运行测试确认现有契约**

运行 `pnpm test:main src/main/utils/__tests__/webviewAnnotations.test.ts`。

预期：PASS；该任务覆盖已实现但此前未被锁定的契约，不修改生产格式化器。

- [ ] **步骤 3：执行 mutation 验证**

用 `apply_patch` 暂时把 `escapeInlineMarkdown` 改为只调用 `normalizeInlineText(value)`，再次运行同一命令。

预期：FAIL，新增 escaped-output 断言失败。随后用 `apply_patch` 恢复原实现并重跑，预期 PASS。临时突变不得提交。

- [ ] **步骤 4：提交任务 3**

```bash
git add src/main/utils/__tests__/webviewAnnotations.test.ts
git commit -S --signoff -m "test(webview): cover annotation markdown escaping"
```

### 任务 4：删除临时文档并完成验证

**文件：**
- 删除：`docs/superpowers/specs/2026-09-02-webview-annotation-review-fixes-design.md`
- 删除：`docs/superpowers/plans/2026-09-02-webview-annotation-review-fixes.md`

- [ ] **步骤 1：删除设计和执行计划文档**

使用 `apply_patch` 删除两个文件，最终 PR 文件树不保留临时方案材料。

- [ ] **步骤 2：运行聚焦验证**

```bash
pnpm test:main src/main/services/__tests__/WebviewService.test.ts
pnpm test:renderer src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx
pnpm test:main src/main/utils/__tests__/webviewAnnotations.test.ts
pnpm lint
pnpm test:lint
pnpm docs:check
git diff --check
```

预期：所有命令退出码为 0。若 `pnpm lint` 格式化了本次文件，重新运行三个聚焦测试。

- [ ] **步骤 3：自审安全和范围**

检查 `git diff`：selector evaluation 始终携带 isolated context ID；presentation-only target 更新不触发 disable；同步读取最新 target；Markdown 测试断言公共输出；没有无关重构。

- [ ] **步骤 4：提交文档删除或 lint 结果**

```bash
git add -A docs/superpowers src/main/services/WebviewService.ts src/main/services/__tests__/WebviewService.test.ts src/renderer/components/WebviewAnnotationControls.tsx src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx src/main/utils/__tests__/webviewAnnotations.test.ts
git commit -S --signoff -m "docs(webview): remove completed annotation fix plans"
```

- [ ] **步骤 5：验证提交签名与 DCO**

```bash
git log --format='%H%n%B%n---' origin/add-browser-element-annotation..HEAD
git log --format='%H' origin/add-browser-element-annotation..HEAD | while read commit; do git cat-file commit "$commit" | rg -q '^gpgsig ' && git show -s --format='%B' "$commit" | rg -q '^Signed-off-by:'; done
```

预期：循环退出码为 0；所有新增提交同时包含 `gpgsig` 和 `Signed-off-by`。
