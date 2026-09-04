# WebView 元素标注跨进程状态实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把 WebView 元素标注收敛为 Guest 单一事实源、Main 文档会话信任边界和请求期导出，删除 Renderer/Main 的 annotations 镜像及其 Cache/旧 IPC 链路。

**架构：** Guest preload 拥有完整 annotations、DOM identity 和交互草稿；Renderer 只持有 `enabled/count/session/operation` 并按需请求一次 snapshot；Main 的 `AnnotationSession` 为每个 live WebContents 分配不可复用的 session ID，在 AX 前后验证宿主所有权和会话。完整导航轮换 session，same-document navigation 保留 session，复制只覆盖当前 WebView。

**技术栈：** TypeScript、Electron WebContents/WebviewTag、React 19、Zod、IpcApi、Vitest 3、Testing Library、Cherry lifecycle、CDP Accessibility。

---

## 设计依据与执行约束

- 规格：[WebView 元素标注跨进程状态设计](../specs/2026-09-04-webview-annotation-cross-process-state-design.md)
- 数据边界：[Data System Reference](../../references/data/README.md)
- IPC：[IpcApi Reference](../../references/ipc/README.md)
- lifecycle：[Lifecycle & Application Reference](../../references/lifecycle/README.md)
- 目录边界：[Main Process Architecture](../../references/architecture/main-process.md)、[Renderer Architecture](../../references/architecture/renderer.md)、[Shared Layer Architecture](../../references/architecture/shared-layer.md)
- 测试：[Frontend Testing Guidelines](../../references/testing/frontend-testing.md)

执行时遵守以下约束：

1. 不新增 DataApi、Preference、BootConfig、Cache key、全局 Renderer store 或兼容层。
2. 不改变打印、保存、拼写检查、弹窗策略和既有 i18n 文案。
3. `src/preload/WebviewAnnotationController.ts` 只做协议和已确认交互缺陷所需修改，不额外拆解 overlay/selector。
4. 新旧导出源不得同时可用。切换 `webview.export_annotations` 的同一任务必须删除 `replace_annotations`、`get_annotations_markdown` 和 Main Cache registry。
5. 每个 commit 使用 `git commit -S --signoff`；禁止 force-push。
6. 每个测试先说明它捕获的生产回归；不新增 snapshot、渲染冒烟或只固定 mock 调用次数的测试。
7. 执行任务 1 的第一条测试前运行 `pnpm install`，预期使用 `package.json` 固定的 Node/pnpm 版本并退出 0；若 lockfile 发生非预期变化，先查明原因，不把它夹带进实现 commit。

## 最终文件结构

### 创建

- `src/main/services/webview/index.ts`：WebView main topic 的唯一公开入口。
- `src/main/services/webview/AnnotationSession.ts`：一个 live WebContents 的 session、导航监听、销毁和 AX 串行队列。
- `src/main/services/webview/annotationExport.ts`：请求期 AX 获取和 Markdown 导出编排。
- `src/main/services/webview/annotationMarkdown.ts`：纯 Markdown/URL 格式化。
- `src/main/services/webview/annotationTypes.ts`：仅 Main 使用的 Page、AX、CDP 和 resolved annotation 类型。
- `src/main/services/webview/__tests__/AnnotationSession.test.ts`：导航、幂等、队列和 dispose 契约。
- `src/main/services/webview/__tests__/annotationExport.test.ts`：AX 降级、预算和异步会话失效。
- `src/main/services/webview/__tests__/annotationMarkdown.test.ts`：转义、清洗、顺序和上限。
- `src/renderer/components/WebviewAnnotationControls/index.ts`：Renderer 组件公开入口。
- `src/renderer/components/WebviewAnnotationControls/WebviewAnnotationControls.tsx`：纯 UI、toast 和确认框。
- `src/renderer/components/WebviewAnnotationControls/useWebviewAnnotationSession.ts`：WebView 绑定、握手、摘要、snapshot 和操作失效。
- `src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx`：用户可见控件结果。
- `src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx`：跨事件/session 竞态。

### 修改

- `src/shared/types/webviewAnnotation.ts`：缩减为跨进程 annotation payload、Guest 协议、limits、locale/theme。
- `src/shared/ipc/schemas/webview.ts`：以单一 `webview.export_annotations` 替换两个旧 annotation routes。
- `src/main/services/webview/WebviewService.ts`：保留 lifecycle/通用 WebView 行为和 live `AnnotationSession` map；委托请求期导出。
- `src/main/ipc/handlers/webview.ts`：只委托单一 export route。
- `src/main/ipc/handlers/__tests__/webview.test.ts`：验证 export input 与 `senderId` 透传，删除旧 revision/schema 行为钉死测试。
- `src/main/core/application/serviceRegistry.ts`：从 `@main/services/webview` barrel 导入。
- `src/preload/webview.ts`：装配最终 Guest event protocol。
- `src/preload/WebviewAnnotationController.ts`：session gate、摘要事件、snapshot response 和交互安全。
- `src/preload/__tests__/WebviewAnnotationController.test.ts`：session、失活、editable、多指针和坐标测试。
- `src/renderer/pages/miniApps/components/MiniAppPane.tsx`：把唯一 attach 路径得到的 concrete WebView 存入 state 并下传。
- `src/renderer/pages/miniApps/components/MinimalToolbar.tsx`：消费 concrete WebView，删除指数退避轮询。
- `src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx`：WebView 替换时 listener ownership。
- `src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx`：更新组件契约 mock。

### 删除或迁移后删除

- `src/main/services/WebviewService.ts`
- `src/main/services/__tests__/WebviewService.test.ts`
- `src/main/services/__tests__/WebviewService.security.test.ts`
- `src/main/utils/webviewAnnotations.ts`
- `src/main/utils/__tests__/webviewAnnotations.test.ts`
- `src/renderer/components/WebviewAnnotationControls.tsx`
- `src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx`
- `src/shared/ipc/errors/webview.ts`

---

### 任务 1：让 MiniAppPane 成为 concrete WebView 绑定的唯一所有者

**文件：**
- 修改：`src/renderer/pages/miniApps/components/MiniAppPane.tsx:49-112`
- 修改：`src/renderer/pages/miniApps/components/MinimalToolbar.tsx:19-278`
- 修改：`src/renderer/components/WebviewAnnotationControls.tsx:27-216`
- 测试：`src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx`
- 测试：`src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx`
- 测试：`src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx`

本任务捕获的回归：Toolbar 或 annotation controls 在 ref 尚为空时启动独立轮询、WebView 被 pool 替换后旧 listener 继续接收事件、同一 concrete WebView 重渲染时重复注册 listener。

- [ ] **步骤 1：把地址栏测试改成 concrete `webview` prop，并增加替换所有权测试**

在 `MinimalToolbar.address.test.tsx` 中把 helper 改成直接传值，并加入以下用例：

```tsx
function toolbar(webview: WebviewTag | null, currentUrl: string | null = app.url) {
  return (
    <MinimalToolbar
      app={app}
      webview={webview}
      currentUrl={currentUrl}
      isWebviewReady={webview !== null}
      isHostActive
      onReload={vi.fn()}
      onOpenDevTools={vi.fn()}
      splitMode="open"
      onSplit={vi.fn()}
    />
  )
}

it('moves navigation ownership when the concrete webview changes', () => {
  const first = createWebview('https://example.com/first')
  const second = createWebview('https://example.com/second')
  const { rerender } = render(toolbar(first.webview))
  const address = screen.getByRole('textbox', { name: 'URL' })

  act(() => first.navigate('did-navigate', 'https://example.com/first/next'))
  expect(address).toHaveValue('https://example.com/first/next')

  rerender(toolbar(second.webview))
  act(() => first.navigate('did-navigate', 'https://example.com/stale'))
  expect(address).not.toHaveValue('https://example.com/stale')

  act(() => second.navigate('did-navigate', 'https://example.com/second/next'))
  expect(address).toHaveValue('https://example.com/second/next')
})
```

- [ ] **步骤 2：运行测试并确认当前 props/旧 listener 行为使其失败**

运行：

```bash
pnpm test:renderer src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx
```

预期：FAIL，TypeScript/Vitest 报告 `webview` prop 尚不存在，或替换后 listener 未转移。

- [ ] **步骤 3：在 MiniAppPane 将 attach 结果提升为 state**

保持 `webviewRef` 给 `WebviewSearch` 使用，同时增加 concrete 值：

```tsx
const webviewRef = useRef<WebviewTag | null>(null)
const [webview, setWebview] = useState<WebviewTag | null>(null)

const detachWebview = useCallback(() => {
  webviewCleanupRef.current?.()
  webviewCleanupRef.current = null
  webviewRef.current = null
  setWebview(null)
}, [])

const attachWebview = useCallback(() => {
  const selector = `webview[data-mini-app-id="${CSS.escape(app.appId)}"]`
  const attachedWebview = document.querySelector<WebviewTag>(selector)
  if (!attachedWebview) return false
  if (webviewRef.current === attachedWebview) return true

  detachWebview()
  webviewRef.current = attachedWebview
  setWebview(attachedWebview)
  const handleInPageNav = (event: DidNavigateInPageEvent) => {
    if (event.isMainFrame) setCurrentUrl(event.url)
  }
  const handleFocus = () => onActivateRef.current?.()
  attachedWebview.addEventListener('did-navigate-in-page', handleInPageNav)
  attachedWebview.addEventListener('focus', handleFocus)
  webviewCleanupRef.current = () => {
    attachedWebview.removeEventListener('did-navigate-in-page', handleInPageNav)
    attachedWebview.removeEventListener('focus', handleFocus)
  }
  return true
}, [app.appId, detachWebview])
```

将 Toolbar 调用改为：

```tsx
<MinimalToolbar
  app={app}
  webview={webview}
  currentUrl={currentUrl}
  isWebviewReady={isReady && webview !== null}
  isHostActive={isHostActive}
  onReload={handleReload}
  onOpenDevTools={handleOpenDevTools}
  splitMode={splitMode}
  splitActive={splitActive}
  onSplit={onSplit}
/>
```

- [ ] **步骤 4：删除 MinimalToolbar 的轮询并绑定 prop identity**

删除 `WEBVIEW_CHECK_*` 常量、`webviewRef` prop 和指数退避 effect。所有读取改用捕获的 `webview`；listener effect 只依赖 concrete identity：

```tsx
interface Props {
  app: MiniApp
  webview: WebviewTag | null
  currentUrl: string | null
  isWebviewReady: boolean
  isHostActive: boolean
  onReload: () => void
  onOpenDevTools: () => void
  splitMode: SplitMode
  splitActive?: boolean
  onSplit: () => void
}

const updateNavigationState = useCallback(
  (attachedWebview: WebviewTag | null) => {
    if (!attachedWebview) {
      setCanGoBack(false)
      setCanGoForward(false)
      return
    }
    try {
      setCanGoBack(attachedWebview.canGoBack())
      setCanGoForward(attachedWebview.canGoForward())
    } catch {
      logger.debug('WebView not ready for navigation state update', { appId: app.appId })
      setCanGoBack(false)
      setCanGoForward(false)
    }
  },
  [app.appId]
)

const cancelNavigationUpdate = useCallback(() => {
  if (!navigationUpdateTimeoutRef.current) return
  clearTimeout(navigationUpdateTimeoutRef.current)
  navigationUpdateTimeoutRef.current = null
}, [])

const scheduleNavigationUpdate = useCallback(
  (delay: number, attachedWebview: WebviewTag) => {
    cancelNavigationUpdate()
    navigationUpdateTimeoutRef.current = setTimeout(() => {
      updateNavigationState(attachedWebview)
      navigationUpdateTimeoutRef.current = null
    }, delay)
  },
  [cancelNavigationUpdate, updateNavigationState]
)

useEffect(() => {
  if (!webview || !isWebviewReady) {
    setCanGoBack(false)
    setCanGoForward(false)
    return
  }

  updateNavigationState(webview)
  try {
    updateCurrentPageUrl(webview.getURL())
  } catch {
    logger.debug('WebView not ready for URL state update', { appId: app.appId })
  }
  const handleNavigation = (event: DidNavigateEvent | DidNavigateInPageEvent) => {
    if ('isMainFrame' in event && !event.isMainFrame) return
    updateCurrentPageUrl(event.url)
    scheduleNavigationUpdate(NAVIGATION_UPDATE_DELAY_MS, webview)
  }

  webview.addEventListener('did-navigate', handleNavigation)
  webview.addEventListener('did-navigate-in-page', handleNavigation)
  return () => {
    cancelNavigationUpdate()
    webview.removeEventListener('did-navigate', handleNavigation)
    webview.removeEventListener('did-navigate-in-page', handleNavigation)
  }
}, [
  cancelNavigationUpdate,
  isWebviewReady,
  scheduleNavigationUpdate,
  updateCurrentPageUrl,
  updateNavigationState,
  webview
])
```

让 `restoreCurrentPageUrl`、back/forward、address submit 和 annotation child 都使用同一个 `webview` 值；back/forward 调用 `scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS, webview)`。`WebviewAnnotationControls` 本任务先把 prop 改为 `webview: WebviewTag | null`，其 listener effect 直接绑定该值并在 cleanup 中移除该值上的 listener；删除 `WEBVIEW_ATTACH_MAX_ATTEMPTS`、attempt counter 和 retry timer，协议行为暂不改变。

- [ ] **步骤 5：更新 Renderer 测试 props 并验证没有轮询**

在 Toolbar 与 annotation controls 测试中用 `webview={webview}`。增加 fake-timer 断言，确保空值不会安排 attachment timer：

```tsx
it('does not poll while no concrete webview is attached', () => {
  vi.useFakeTimers()
  render(toolbar(null, app.url))
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})
```

运行：

```bash
pnpm test:renderer src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx
```

预期：三个文件全部 PASS。

- [ ] **步骤 6：提交 concrete WebView ownership**

```bash
git add src/renderer/pages/miniApps/components/MiniAppPane.tsx src/renderer/pages/miniApps/components/MinimalToolbar.tsx src/renderer/components/WebviewAnnotationControls.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx
git commit -S --signoff -m "refactor(mini-app-pane): bind controls to concrete webview"
git cat-file commit HEAD | rg "gpgsig|Signed-off-by"
```

---

### 任务 2：建立 Main `services/webview` 模块边界

**文件：**
- 创建：`src/main/services/webview/index.ts`
- 迁移：`src/main/services/WebviewService.ts` → `src/main/services/webview/WebviewService.ts`
- 迁移：`src/main/utils/webviewAnnotations.ts` → `src/main/services/webview/annotationMarkdown.ts`
- 迁移：`src/main/services/__tests__/WebviewService.test.ts` → `src/main/services/webview/__tests__/WebviewService.test.ts`
- 迁移：`src/main/services/__tests__/WebviewService.security.test.ts` → `src/main/services/webview/__tests__/WebviewService.security.test.ts`
- 迁移：`src/main/utils/__tests__/webviewAnnotations.test.ts` → `src/main/services/webview/__tests__/annotationMarkdown.test.ts`
- 修改：`src/main/core/application/serviceRegistry.ts`
- 修改：`src/main/ipc/handlers/webview.ts`
- 修改：`src/main/ipc/handlers/__tests__/webview.test.ts`

本任务是行为保持型移动。它防止后续继续把 session、AX 和 formatter 堆入根级 900+ 行 service，同时不提前改变任何 IPC 或产品语义。

- [ ] **步骤 1：记录移动前的聚焦测试基线**

运行：

```bash
pnpm test:main src/main/services/__tests__/WebviewService.security.test.ts src/main/services/__tests__/WebviewService.test.ts src/main/utils/__tests__/webviewAnnotations.test.ts src/main/ipc/handlers/__tests__/webview.test.ts
```

预期：全部 PASS。若基线失败，先记录失败并停止，不把已有失败归因于移动。

- [ ] **步骤 2：用 apply_patch 创建目标文件并删除旧路径**

移动时只修正相对 import。公开 barrel 必须是显式 re-export：

```ts
// src/main/services/webview/index.ts
export { setOpenLinkExternal, WebviewService } from './WebviewService'
```

`WebviewService.ts` 中 formatter import 改为：

```ts
import { formatWebviewAnnotations, sanitizeWebviewAnnotationUrl } from './annotationMarkdown'
```

`annotationMarkdown.test.ts` 使用：

```ts
import { formatWebviewAnnotations, sanitizeWebviewAnnotationUrl } from '../annotationMarkdown'
```

- [ ] **步骤 3：让所有模块外消费者只走 barrel**

```ts
// src/main/core/application/serviceRegistry.ts
import { WebviewService } from '@main/services/webview'

// src/main/ipc/handlers/webview.ts
import { setOpenLinkExternal } from '@main/services/webview'
```

同步把 handler test 的 mock 改为 `vi.mock('@main/services/webview', ...)`。目录内测试可直接引用 `../WebviewService` 和 `../annotationMarkdown`。

- [ ] **步骤 4：运行移动后的相同测试与 Node typecheck**

运行：

```bash
pnpm test:main src/main/services/webview/__tests__/WebviewService.security.test.ts src/main/services/webview/__tests__/WebviewService.test.ts src/main/services/webview/__tests__/annotationMarkdown.test.ts src/main/ipc/handlers/__tests__/webview.test.ts
pnpm typecheck:node
```

预期：全部 PASS；`rg "@main/services/WebviewService|main/utils/webviewAnnotations" src` 无结果。

- [ ] **步骤 5：提交 Main 模块移动**

```bash
git add src/main/services/webview src/main/services/WebviewService.ts src/main/services/__tests__/WebviewService.test.ts src/main/services/__tests__/WebviewService.security.test.ts src/main/utils/webviewAnnotations.ts src/main/utils/__tests__/webviewAnnotations.test.ts src/main/core/application/serviceRegistry.ts src/main/ipc/handlers/webview.ts src/main/ipc/handlers/__tests__/webview.test.ts
git commit -S --signoff -m "refactor(webview-annotations): establish main module boundary"
git cat-file commit HEAD | rg "gpgsig|Signed-off-by"
```

---

### 任务 3：修复 Guest 页面交互边界

**文件：**
- 修改：`src/preload/WebviewAnnotationController.ts:640-760,1010-1060`
- 修改：`src/preload/__tests__/WebviewAnnotationController.test.ts`

本任务捕获的回归：选择模式破坏表单/contenteditable 输入；非主指针、右键或第二 pointer ID 提交区域；滚动后 page coordinates 被当成 viewport coordinates；取消或失活遗留 pointer capture。

- [ ] **步骤 1：先写 editable、主指针和 pointer ID 失败测试**

先扩展 `privateController()` 的测试类型，暴露现有 arrow handlers，并用完整的 PointerEvent-like 对象绕过 JSDOM 不能构造 `isTrusted: true` 事件的限制：

```ts
interface TrustedPointerOptions {
  pointerId?: number
  button?: number
  isPrimary?: boolean
}

const trustedPointerEvent = (
  target: Element,
  clientX: number,
  clientY: number,
  { pointerId = 1, button = 0, isPrimary = true }: TrustedPointerOptions = {}
) =>
  ({
    isTrusted: true,
    isPrimary,
    button,
    pointerId,
    clientX,
    clientY,
    composedPath: () => [target, document.body, document.documentElement, document, window],
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn()
  }) as unknown as PointerEvent
```

`privateController()` 的返回类型增加：

```ts
handlePointerDown: (event: PointerEvent) => void
handlePointerMove: (event: PointerEvent) => void
handlePointerUp: (event: PointerEvent) => void
handlePointerCancel: (event: PointerEvent) => void
marqueeOrigin: unknown
marqueePointerId: number | null
```

随后加入以下测试：

```ts
it('leaves editable composed paths to the page', () => {
  const editor = document.createElement('div')
  editor.contentEditable = 'true'
  const child = document.createElement('span')
  editor.appendChild(child)
  document.body.appendChild(editor)
  const pageClick = vi.fn()
  child.addEventListener('click', pageClick)

  const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
  expect(child.dispatchEvent(click)).toBe(true)
  expect(pageClick).toHaveBeenCalledOnce()
  expect(privateController(controller).editorElement).toBeNull()
})

it.each(['input', 'textarea', 'select'] as const)('does not intercept a %s control', (tagName) => {
  const control = document.createElement(tagName)
  const pageClick = vi.fn()
  control.addEventListener('click', pageClick)
  document.body.appendChild(control)

  const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
  expect(control.dispatchEvent(click)).toBe(true)
  expect(pageClick).toHaveBeenCalledOnce()
  expect(privateController(controller).editorElement).toBeNull()
})

it('recognizes a contenteditable ancestor inside an open shadow root', () => {
  const host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })
  const editor = document.createElement('div')
  editor.contentEditable = 'true'
  const child = document.createElement('span')
  editor.appendChild(child)
  shadow.appendChild(editor)
  document.body.appendChild(host)

  const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
  expect(child.dispatchEvent(click)).toBe(true)
  expect(privateController(controller).editorElement).toBeNull()
})

it('ignores non-primary and non-left pointer starts', () => {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const internals = privateController(controller)
  internals.handlePointerDown(trustedPointerEvent(target, 10, 10, { pointerId: 1, button: 2 }))
  internals.handlePointerDown(trustedPointerEvent(target, 10, 10, { pointerId: 2, isPrimary: false }))
  expect(internals.marqueeOrigin).toBeNull()
  expect(internals.marqueePointerId).toBeNull()
})

it('accepts move and release only from the pointer that started the marquee', () => {
  const target = document.createElement('div')
  target.id = 'canvas'
  document.body.appendChild(target)
  mockRect(target, 0, 0, 400, 400)
  const internals = privateController(controller)

  internals.handlePointerDown(trustedPointerEvent(target, 10, 10, { pointerId: 7 }))
  internals.handlePointerMove(trustedPointerEvent(target, 180, 180, { pointerId: 8 }))
  internals.handlePointerUp(trustedPointerEvent(target, 180, 180, { pointerId: 8 }))
  expect(internals.pendingRegion).toBeNull()

  internals.handlePointerMove(trustedPointerEvent(target, 180, 180, { pointerId: 7 }))
  internals.handlePointerUp(trustedPointerEvent(target, 180, 180, { pointerId: 7 }))
  expect(internals.pendingRegion).not.toBeNull()
})
```

把文件内既有 marquee 测试的 `pointerEvent(...)` DOM dispatch 改成相同的 `trustedPointerEvent(...)` + handler 直接调用；点击和键盘事件仍使用真实 DOM dispatch。删除现有 “synthetic pointerup 被拦截” 断言，因为新契约明确不信任该事件；页面 click 被拦截的用户结果断言继续保留。另加一个 DOM `pointerdown` dispatch，用 `defaultPrevented === false` 证明 synthetic/untrusted pointer 不启动或拦截 marquee。

- [ ] **步骤 2：运行 Guest 测试并确认三个回归失败**

运行：

```bash
pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts
```

预期：FAIL；editable click 被拦截，右键/非主指针可建立 marquee，错误 pointer ID 可更新或结束 drag。

- [ ] **步骤 3：实现统一 eligible target 和 active pointer gate**

在 controller 中增加进程内私有 helper，并让 pointer/click/mouse blocking 共用它：

```ts
const EDITABLE_TAG_NAMES = new Set(['input', 'select', 'textarea'])

function isEditablePath(path: EventTarget[]): boolean {
  return path.some(
    (target) =>
      target instanceof Element &&
      (EDITABLE_TAG_NAMES.has(target.tagName.toLowerCase()) ||
        target.matches('[contenteditable]:not([contenteditable="false"])'))
  )
}

private pageEventElement(event: Event): Element | null {
  const path = event.composedPath()
  if (isEditablePath(path) || (this.overlayHost && path.includes(this.overlayHost))) return null
  return path.find((target): target is Element => target instanceof Element) ?? null
}
```

Pointer handlers遵守以下精确 gate：

```ts
private marqueePointerId: number | null = null

private handlePointerDown = (event: PointerEvent) => {
  const element = this.pageEventElement(event)
  if (!this.enabled || !event.isTrusted || !event.isPrimary || event.button !== 0 || !element) return
  if (this.marqueePointerId !== null) return
  this.marqueePointerId = event.pointerId
  this.marqueeOrigin = { x: event.clientX, y: event.clientY }
  event.preventDefault()
  event.stopImmediatePropagation()
  try {
    element.setPointerCapture(event.pointerId)
    this.marqueePointerCapture = { target: element, pointerId: event.pointerId }
  } catch {
    this.marqueePointerCapture = null
  }
}

private isActiveMarqueePointer(event: PointerEvent) {
  return event.isTrusted && this.marqueePointerId !== null && event.pointerId === this.marqueePointerId
}
```

`pointermove/up/cancel/lostpointercapture` 只有 `isActiveMarqueePointer(event)` 时才能更新、提交或取消 marquee；没有 active marquee 的普通 pointer move 仍可更新 hover highlight，但仅处理可信事件。`cancelMarquee()` 先保存 `marqueePointerCapture`，再同时清空 `marqueePointerId`、capture、origin 和 rect，最后尝试 release capture。

JSDOM 分发事件的 `isTrusted` 为 false。测试不要弱化生产 gate：把 pointer handler 从 `privateController(controller)` 取出，用包含 `isTrusted: true` 的完整 event object 调用；另保留一个真实 DOM dispatch 测试证明 synthetic/untrusted pointer 不被拦截。

- [ ] **步骤 4：增加 page-coordinate 投影测试并保持既定语义**

```ts
it('stores regions in page coordinates and projects pins through current scroll', () => {
  vi.stubGlobal('scrollX', 30)
  vi.stubGlobal('scrollY', 50)
  const target = document.createElement('div')
  target.id = 'scrolled-region'
  document.body.appendChild(target)
  mockRect(target, 0, 0, 400, 400)
  const internals = privateController(controller)

  internals.handlePointerDown(trustedPointerEvent(target, 10, 20, { pointerId: 5 }))
  internals.handlePointerMove(trustedPointerEvent(target, 110, 120, { pointerId: 5 }))
  internals.handlePointerUp(trustedPointerEvent(target, 110, 120, { pointerId: 5 }))
  internals.textarea.value = 'Keep the captured page rectangle'
  internals.saveEditor()
  internals.updatePositions()

  const annotation = controller.getState().annotations[0]
  expect(annotation.region?.rect).toEqual({ x: 40, y: 70, width: 100, height: 100 })
  const pin = internals.pinLayer?.querySelector<HTMLElement>('button')
  expect(pin?.style.left).toBe('10px')
  expect(pin?.style.top).toBe('20px')
})
```

不要在 reflow 后重写已保存 region rect；element annotation 仍按当前 DOM rect 追踪。

- [ ] **步骤 5：运行测试并提交 Guest 交互修复**

运行：

```bash
pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts
```

预期：PASS。

```bash
git add src/preload/WebviewAnnotationController.ts src/preload/__tests__/WebviewAnnotationController.test.ts
git commit -S --signoff -m "fix(webview-annotations): protect guest page interactions"
git cat-file commit HEAD | rg "gpgsig|Signed-off-by"
```

---

### 任务 4：原子切换到 document session + request-scoped snapshot

**文件：**
- 创建：`src/main/services/webview/AnnotationSession.ts`
- 创建：`src/main/services/webview/__tests__/AnnotationSession.test.ts`
- 修改：`src/shared/types/webviewAnnotation.ts`
- 修改：`src/shared/ipc/schemas/webview.ts`
- 删除：`src/shared/ipc/errors/webview.ts`
- 修改：`src/preload/webview.ts`
- 修改：`src/preload/WebviewAnnotationController.ts`
- 修改：`src/preload/__tests__/WebviewAnnotationController.test.ts`
- 修改：`src/renderer/components/WebviewAnnotationControls.tsx`
- 修改：`src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx`
- 修改：`src/main/services/webview/WebviewService.ts`
- 修改：`src/main/services/webview/__tests__/WebviewService.test.ts`
- 修改：`src/main/ipc/handlers/webview.ts`
- 修改：`src/main/ipc/handlers/__tests__/webview.test.ts`

本任务必须形成一个绿色 commit。提交前只能有一个可用导出源：Guest fresh snapshot。不得留下旧 Cache route 作为 fallback。

- [ ] **步骤 1：先把 Guest tests 切到最终 session/event 契约并确认失败**

在 `src/preload/__tests__/WebviewAnnotationController.test.ts` 把 callback 收集改为 `WebviewAnnotationGuestEvent[]`，并让通用 configure helper 先启动 session：

```ts
const SESSION_ONE = '123e4567-e89b-42d3-a456-426614174010'
const SESSION_TWO = '123e4567-e89b-42d3-a456-426614174011'
const REQUEST_ONE = '123e4567-e89b-42d3-a456-426614174012'

const configure = (controller: WebviewAnnotationController, sessionId = SESSION_ONE) => {
  controller.handleCommand({ type: 'start_session', sessionId })
  controller.handleCommand({ type: 'configure', sessionId, locale, theme: 'light' })
  controller.handleCommand({ type: 'set_enabled', sessionId, enabled: true })
}

let emissions: WebviewAnnotationGuestEvent[]

beforeEach(() => {
  emissions = []
  controller = new WebviewAnnotationController((event) => emissions.push(event))
  configure(controller)
})

let annotationSequence = 0
const addAnnotation = (controller: WebviewAnnotationController, comment: string) => {
  const element = document.createElement('button')
  element.id = `annotation-target-${annotationSequence++}`
  document.body.appendChild(element)
  const internals = privateController(controller)
  internals.openEditor({ mode: 'create-element', element })
  internals.textarea.value = comment
  internals.saveEditor()
}
```

新增以下回归用例：

```ts
it('does not answer request_state before Main starts a session', () => {
  const unstartedEvents: WebviewAnnotationGuestEvent[] = []
  const unstarted = new WebviewAnnotationController((event) => unstartedEvents.push(event))

  unstarted.handleCommand({ type: 'request_state' })

  expect(unstartedEvents).toEqual([])
  unstarted.dispose()
})

it('keeps annotations for the same session and clears them for a new session', () => {
  addAnnotation(controller, 'Current note')
  emissions = []
  controller.handleCommand({ type: 'start_session', sessionId: SESSION_ONE })
  expect(emissions.at(-1)).toEqual({ type: 'state_changed', sessionId: SESSION_ONE, enabled: true, count: 1 })

  controller.handleCommand({ type: 'start_session', sessionId: SESSION_TWO })
  expect(emissions.at(-1)).toEqual({ type: 'state_changed', sessionId: SESSION_TWO, enabled: false, count: 0 })
})

it('ignores protected commands from a stale session', () => {
  addAnnotation(controller, 'Current note')
  configure(controller, SESSION_TWO)
  addAnnotation(controller, 'New document note')
  emissions = []

  controller.handleCommand({ type: 'clear', sessionId: SESSION_ONE })
  controller.handleCommand({ type: 'set_enabled', sessionId: SESSION_ONE, enabled: false })
  controller.handleCommand({ type: 'request_state' })

  expect(emissions).toEqual([{ type: 'state_changed', sessionId: SESSION_TWO, enabled: true, count: 1 }])
})

it('returns a full snapshot only for the matching session and request', () => {
  addAnnotation(controller, 'Copy this')
  emissions = []

  controller.handleCommand({ type: 'request_snapshot', sessionId: SESSION_TWO, requestId: REQUEST_ONE })
  expect(emissions).toEqual([])

  controller.handleCommand({ type: 'request_snapshot', sessionId: SESSION_ONE, requestId: REQUEST_ONE })
  expect(emissions).toHaveLength(1)
  expect(emissions[0]).toMatchObject({
    type: 'snapshot_ready',
    sessionId: SESSION_ONE,
    requestId: REQUEST_ONE,
    annotations: [{ comment: 'Copy this' }]
  })
})

it('deactivates selection and discards a draft without deleting committed annotations', () => {
  addAnnotation(controller, 'Committed note')
  const draftTarget = document.createElement('button')
  draftTarget.id = 'draft-target'
  document.body.appendChild(draftTarget)
  const internals = privateController(controller)
  internals.openEditor({ mode: 'create-element', element: draftTarget })
  internals.textarea.value = 'Unsaved draft'
  emissions = []

  controller.handleCommand({ type: 'deactivate', sessionId: SESSION_ONE })
  controller.handleCommand({ type: 'request_snapshot', sessionId: SESSION_ONE, requestId: REQUEST_ONE })

  expect(internals.editorElement).toBeNull()
  expect(emissions[0]).toEqual({ type: 'state_changed', sessionId: SESSION_ONE, enabled: false, count: 1 })
  expect(emissions[1]).toMatchObject({ type: 'snapshot_ready', annotations: [{ comment: 'Committed note' }] })
})
```

把其余测试对 `getState().annotations` 的读取改为显式 `request_snapshot` 后检查 `snapshot_ready.annotations`；`getState()` 最终只供摘要使用，不能继续暴露完整 annotations。

运行：

```bash
pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts
```

预期：FAIL，当前 controller 不识别 `start_session`/`request_snapshot`，callback 仍是旧 full-state 形状。

- [ ] **步骤 2：用最终 schema 替换旧 document/AX/revision wire 类型**

`src/shared/types/webviewAnnotation.ts` 保留 locator/region/target/locale/theme/limits，annotation 去掉 `createdAt`。新增并导出以下最终 schema：

```ts
export const WebviewAnnotationSessionIdSchema = z.uuid()
export const WebviewAnnotationRequestIdSchema = z.uuid()

export const WebviewAnnotationSchema = z
  .object({
    id: z.uuid(),
    comment: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.comment),
    element: WebviewElementLocatorSchema,
    region: WebviewAnnotationRegionSchema.optional()
  })
  .strict()

export const WebviewAnnotationSnapshotSchema = z
  .array(WebviewAnnotationSchema)
  .min(1)
  .max(WEBVIEW_ANNOTATION_LIMITS.annotations)

const sessionCommand = {
  sessionId: WebviewAnnotationSessionIdSchema
}

export const WebviewAnnotationHostCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_session'), ...sessionCommand }).strict(),
  z.object({ type: z.literal('request_state') }).strict(),
  z.object({ type: z.literal('configure'), ...sessionCommand, locale: WebviewAnnotationLocaleSchema, theme: WebviewAnnotationThemeSchema }).strict(),
  z.object({ type: z.literal('set_enabled'), ...sessionCommand, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('deactivate'), ...sessionCommand }).strict(),
  z.object({ type: z.literal('clear'), ...sessionCommand }).strict(),
  z.object({ type: z.literal('request_snapshot'), ...sessionCommand, requestId: WebviewAnnotationRequestIdSchema }).strict()
])

export const WebviewAnnotationGuestEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state_changed'),
    sessionId: WebviewAnnotationSessionIdSchema,
    enabled: z.boolean(),
    count: z.number().int().min(0).max(WEBVIEW_ANNOTATION_LIMITS.annotations)
  }).strict(),
  z.object({
    type: z.literal('snapshot_ready'),
    sessionId: WebviewAnnotationSessionIdSchema,
    requestId: WebviewAnnotationRequestIdSchema,
    annotations: z.array(WebviewAnnotationSchema).max(WEBVIEW_ANNOTATION_LIMITS.annotations)
  }).strict()
])
```

本任务立即删除 `WebviewAnnotationStateSchema`、`WebviewAnnotationNavigationRevisionSchema` 及对应类型，因为它们属于旧 wire contract。现有 formatter/AX 仍依赖的 page/document/accessibility/resolved 类型先留到任务 5 的行为保持型迁移；它们不再出现在任何 IPC/Guest route 中。结构约束由 IpcApi 的统一 schema gate 和 Node/Web typecheck 覆盖，不新增 per-domain schema 单测。

- [ ] **步骤 3：把 IpcApi 收敛为单一 export route**

`src/shared/ipc/schemas/webview.ts`：

```ts
'webview.export_annotations': defineRoute({
  input: z
    .object({
      webviewId: z.number().int().positive(),
      documentSessionId: WebviewAnnotationSessionIdSchema,
      target: WebviewAnnotationTargetSchema,
      annotations: WebviewAnnotationSnapshotSchema
    })
    .strict(),
  output: z.string().max(WEBVIEW_ANNOTATION_LIMITS.exportMarkdown)
})
```

删除 `webview.replace_annotations` 和 `webview.get_annotations_markdown`。删除 `src/shared/ipc/errors/webview.ts` 及 `WebviewService.ts` 中的 `IpcError`/`webviewErrorCodes` imports，把 ownership 拒绝改为 `throw new Error('The caller does not own this webview')`；Renderer 对该路由只有统一失败反馈，不保留 shared annotation error taxonomy。

- [ ] **步骤 4：为 AnnotationSession 写导航、幂等、销毁和异步失效测试**

`AnnotationSession` constructor 接受 `createSessionId`，使测试无需 mock 全局 randomness：

```ts
import { EventEmitter } from 'node:events'

const SESSION_ONE = '123e4567-e89b-42d3-a456-426614174010'
const SESSION_TWO = '123e4567-e89b-42d3-a456-426614174011'

function createContents() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false)
  }) as unknown as Electron.WebContents & EventEmitter & { send: ReturnType<typeof vi.fn> }
}

it('rotates only for a new main-frame document and starts it at dom-ready', () => {
  const ids = [SESSION_ONE, SESSION_TWO]
  const contents = createContents()
  const annotationSession = new AnnotationSession(contents, vi.fn(), () => ids.shift()!)

  contents.emit('dom-ready')
  expect(contents.send).toHaveBeenLastCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
    type: 'start_session',
    sessionId: SESSION_ONE
  })

  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  contents.emit('dom-ready')
  expect(annotationSession.currentId).toBe(SESSION_ONE)

  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  expect(annotationSession.isCurrent(SESSION_ONE)).toBe(false)
  contents.emit('did-fail-load')
  expect(annotationSession.currentId).toBe(SESSION_TWO)
  contents.emit('dom-ready')
  expect(annotationSession.currentId).toBe(SESSION_TWO)
})

it('rejects work whose session changes while the task is pending', async () => {
  const contents = createContents()
  const createSessionId = vi.fn().mockReturnValueOnce(SESSION_ONE).mockReturnValueOnce(SESSION_TWO)
  const annotationSession = new AnnotationSession(contents, vi.fn(), createSessionId)
  contents.emit('dom-ready')
  const current = annotationSession.currentId
  let finish!: (value: string) => void

  const pending = annotationSession.run(current, () => new Promise<string>((resolve) => (finish = resolve)))
  contents.emit('render-process-gone')
  finish('# stale')

  await expect(pending).rejects.toThrow('Annotation document session is stale')
})

it('serializes work for one webContents', async () => {
  const contents = createContents()
  const annotationSession = new AnnotationSession(contents, vi.fn(), () => SESSION_ONE)
  contents.emit('dom-ready')
  const order: string[] = []
  let releaseFirst!: () => void

  const first = annotationSession.run(SESSION_ONE, async () => {
    order.push('first:start')
    await new Promise<void>((resolve) => (releaseFirst = resolve))
    order.push('first:end')
  })
  const second = annotationSession.run(SESSION_ONE, async () => {
    order.push('second:start')
  })

  await vi.waitFor(() => expect(order).toEqual(['first:start']))
  releaseFirst()
  await Promise.all([first, second])
  expect(order).toEqual(['first:start', 'first:end', 'second:start'])
})

it('removes itself once and stops sending after destruction', () => {
  const contents = createContents()
  const onDestroyed = vi.fn()
  const annotationSession = new AnnotationSession(contents, onDestroyed, () => SESSION_ONE)
  contents.emit('dom-ready')
  const sendsBeforeDestroy = contents.send.mock.calls.length

  contents.emit('destroyed')
  annotationSession.dispose()
  contents.emit('dom-ready')

  expect(onDestroyed).toHaveBeenCalledOnce()
  expect(contents.send).toHaveBeenCalledTimes(sendsBeforeDestroy)
  expect(contents.listenerCount('did-start-navigation')).toBe(0)
  expect(contents.listenerCount('render-process-gone')).toBe(0)
  expect(contents.listenerCount('dom-ready')).toBe(0)
  expect(contents.listenerCount('destroyed')).toBe(0)
})
```

运行：

```bash
pnpm test:main src/main/services/webview/__tests__/AnnotationSession.test.ts
```

预期：FAIL，class 尚不存在。

- [ ] **步骤 5：实现 AnnotationSession，不在 BaseService disposables 中捕获每个 WebContents**

`src/main/services/webview/AnnotationSession.ts` 的公开面固定为：

```ts
import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, type WebviewAnnotationHostCommand } from '@shared/types/webviewAnnotation'
import { randomUUID } from 'node:crypto'

export class AnnotationSession {
  private documentSessionId: string
  private ready = false
  private disposed = false
  private captureTail: Promise<void> = Promise.resolve()

  constructor(
    readonly webContents: Electron.WebContents,
    private readonly onDestroyed: (session: AnnotationSession) => void,
    private readonly createSessionId: () => string = randomUUID
  ) {
    this.documentSessionId = createSessionId()
    webContents.on('did-start-navigation', this.handleNavigation)
    webContents.on('render-process-gone', this.handleRenderProcessGone)
    webContents.on('dom-ready', this.handleDomReady)
    webContents.once('destroyed', this.handleDestroyed)
  }

  get currentId() {
    return this.documentSessionId
  }

  isCurrent(sessionId: string) {
    return !this.disposed && this.ready && !this.webContents.isDestroyed() && sessionId === this.documentSessionId
  }

  async run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    this.assertCurrent(sessionId)
    const result = this.captureTail.catch(() => undefined).then(async () => {
      this.assertCurrent(sessionId)
      const value = await task()
      this.assertCurrent(sessionId)
      return value
    })
    this.captureTail = result.then(() => undefined, () => undefined)
    return result
  }

  private handleNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) this.rotate()
  }

  private handleRenderProcessGone = () => {
    this.rotate()
  }

  private handleDomReady = () => {
    if (this.disposed || this.webContents.isDestroyed()) return
    const command: WebviewAnnotationHostCommand = {
      type: 'start_session',
      sessionId: this.documentSessionId
    }
    try {
      this.webContents.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, command)
      this.ready = true
    } catch {
      this.ready = false
    }
  }

  private handleDestroyed = () => {
    if (this.disposed) return
    this.dispose()
    this.onDestroyed(this)
  }

  private rotate() {
    if (this.disposed) return
    this.ready = false
    this.documentSessionId = this.createSessionId()
  }

  private assertCurrent(sessionId: string) {
    if (!this.isCurrent(sessionId)) throw new Error('Annotation document session is stale')
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.webContents.removeListener('did-start-navigation', this.handleNavigation)
    this.webContents.removeListener('render-process-gone', this.handleRenderProcessGone)
    this.webContents.removeListener('dom-ready', this.handleDomReady)
    this.webContents.removeListener('destroyed', this.handleDestroyed)
  }
}
```

这里不暴露 shared error code；Main 内部统一用 `Error('Annotation document session is stale')` 终止过期工作。

- [ ] **步骤 6：把 WebviewService 的 per-WebContents 监听改为 live maps**

用以下 fields 替换 `preloadAttachedContents`、`initializedWebviews`、`annotationNavigationRevisions`、`accessibilityCaptureQueues`：

```ts
private readonly preloadBindings = new Map<Electron.WebContents, () => void>()
private readonly annotationSessions = new Map<number, AnnotationSession>()
```

`initializeWebview` 创建 session，并防止 numeric ID 复用：

```ts
const previous = this.annotationSessions.get(contents.id)
if (previous?.webContents === contents) return
previous?.dispose()

const annotationSession = new AnnotationSession(contents, (destroyed) => {
  if (this.annotationSessions.get(contents.id) === destroyed) {
    this.annotationSessions.delete(contents.id)
  }
})
this.annotationSessions.set(contents.id, annotationSession)
```

`attachWebviewPreload` 的 cleanup 使用 identity guard，防止已被替换的旧 cleanup 删除新 binding：

```ts
const cleanup = () => {
  contents.removeListener('will-attach-webview', handler)
  contents.removeListener('destroyed', cleanup)
  if (this.preloadBindings.get(contents) === cleanup) {
    this.preloadBindings.delete(contents)
  }
}
contents.once('destroyed', cleanup)
this.preloadBindings.set(contents, cleanup)
```

不要再对每个 contents 调用 `this.registerDisposable(cleanup)`。`onStop()` 精确释放 live maps：

```ts
protected async onStop() {
  for (const cleanup of this.preloadBindings.values()) cleanup()
  this.preloadBindings.clear()
  for (const annotationSession of this.annotationSessions.values()) annotationSession.dispose()
  this.annotationSessions.clear()
}
```

只有 app 级 `web-contents-created` listener 和 session `webRequest` listener 留在 BaseService disposables。

- [ ] **步骤 7：将 Guest controller 切换为 session gate 和两类事件**

constructor 改为接收 event listener：

```ts
type GuestEventListener = (event: WebviewAnnotationGuestEvent) => void

private sessionId: string | null = null

constructor(private readonly onEvent: GuestEventListener) {}

handleCommand(command: WebviewAnnotationHostCommand) {
  if (command.type === 'start_session') {
    if (this.sessionId !== command.sessionId) {
      this.sessionId = command.sessionId
      this.reset(false)
    }
    this.emitState()
    return
  }
  if (command.type === 'request_state') {
    this.emitState()
    return
  }
  if (!this.sessionId || command.sessionId !== this.sessionId) return

  switch (command.type) {
    case 'configure':
      this.locale = command.locale
      this.theme = command.theme
      this.configured = true
      this.applyTheme()
      this.updateEditorLabels()
      return
    case 'set_enabled':
      this.setEnabled(command.enabled)
      return
    case 'deactivate':
      this.setEnabled(false)
      return
    case 'clear':
      this.clearAnnotations()
      return
    case 'request_snapshot':
      this.onEvent({
        type: 'snapshot_ready',
        sessionId: this.sessionId,
        requestId: command.requestId,
        annotations: structuredClone(this.annotations)
      })
  }
}

private emitState() {
  if (!this.sessionId) return
  this.onEvent({
    type: 'state_changed',
    sessionId: this.sessionId,
    enabled: this.enabled,
    count: this.annotations.length
  })
}

private reset(emit = true) {
  this.clearAnnotations(false)
  this.enabled = false
  this.removeSelectionListeners()
  this.cancelMarquee()
  this.stopPositionTracking()
  this.removeOverlay()
  if (emit) this.emitState()
}
```

`reset(false)` 清空 annotations/editor/listeners/overlay 但不重复 emit；保存 annotation 时不再写 `createdAt`。`src/preload/webview.ts` 直接把 controller event 送到 host。

更新 Guest tests：先发 `start_session` 再 `configure/set_enabled`；增加相同 session 保留、新 session 清空、旧 session clear 无效、deactivate 保留已提交数据且关闭草稿、snapshot request 精确回传的断言。

- [ ] **步骤 8：先写 Renderer 迟到 snapshot 的失败测试**

测试 helper 不再发送 full state；先握手，再按 request 回 snapshot：

```tsx
dispatchGuestEvent(webview, { type: 'state_changed', sessionId: SESSION_ONE, enabled: false, count: 1 })
fireEvent.click(await screen.findByRole('button', { name: '复制标注 Markdown' }))

const snapshotRequest = sentCommands(webview).find((command) => command.type === 'request_snapshot')
dispatchGuestEvent(webview, {
  type: 'snapshot_ready',
  sessionId: SESSION_ONE,
  requestId: snapshotRequest.requestId,
  annotations: [annotation]
})
await waitFor(() => expect(request).toHaveBeenCalledWith('webview.export_annotations', expect.anything()))
```

导航竞态：让 export promise pending，dispatch `{ type: 'did-start-navigation', isMainFrame: true, isInPlace: false }`，再 resolve `'# stale'`，断言 `navigator.clipboard.writeText` 未调用且出现复制失败 toast。另测 same-document 的 `did-navigate-in-page` 不清 count；错误 channel/session/request 和 synthetic `ipc-message` 不更新状态。

运行：

```bash
pnpm test:renderer src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx
```

预期：FAIL，现组件仍同步 Main Cache 并从旧 route 复制。

- [ ] **步骤 9：在 Renderer 实现摘要状态、snapshot correlation 和 operation key**

本任务先在现有组件文件实现，任务 6 再行为保持地提取 hook。核心结构固定为：

```ts
interface AnnotationBinding {
  webview: WebviewTag
  webviewId: number
  sessionId: string | null
  retiredSessionId: string | null
  operationGeneration: number
}

interface PendingSnapshot {
  sessionId: string
  requestId: string
  resolve: (annotations: WebviewAnnotation[]) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface AnnotationOperation {
  webview: WebviewTag
  webviewId: number
  sessionId: string
  target: WebviewAnnotationTarget
  generation: number
}

const bindingRef = useRef<AnnotationBinding | null>(null)
const pendingSnapshotRef = useRef<PendingSnapshot | null>(null)
```

规则：

- concrete `webview` effect 绑定 `ipc-message`、`did-start-navigation`、`render-process-gone` 和 `dom-ready`；cleanup 对称移除。
- `ipc-message` 必须满足 `event.isTrusted`、`event.currentTarget === webview`、channel 和 schema；单元测试通过直接调用捕获的 native listener 构造 `isTrusted: true` 输入。
- 初次绑定及 `dom-ready` 发送 `{ type: 'request_state' }`。
- 首个非 retired `state_changed` 建立 session，并发送带 session 的 `configure`。
- 新文档事件以 `isMainFrame && !event.isInPlace` 为准：若旧 session 存在，先 best-effort 发送 `deactivate` 和 `clear`；随后 retire 当前 session、count=0、enabled=false、operationGeneration++、reject pending。即使导航之后 `did-fail-load`，也不得恢复旧 session 或旧摘要。
- `did-navigate-in-page` 不清空。
- target ID 改变时，先向旧 session 发送 `clear`，再清 UI 和递增 generation；label/theme/locale 只发 configure。
- host inactive 发送 `deactivate`，只把 enabled 置 false。
- copy 单飞，snapshot timeout 固定 2 秒。
- `snapshot_ready.annotations.length === 0` 时 reject 当前 pending snapshot，不调用 Main；无 annotations 时 copy 控件本身保持隐藏。
- `isCurrentOperation` 逐项比较 concrete WebView identity、`webview.getWebContentsId()`、session ID、target ID 和 generation；cleanup、new-document、render-process-gone、target ID 改变都会先递增 generation 再 reject pending。

把当前 target 同步进 `targetRef`，并按以下实现最终 operation guard：

```ts
const targetRef = useRef(target)
targetRef.current = target

const isCurrentOperation = useCallback((operation: AnnotationOperation) => {
  const binding = bindingRef.current
  if (
    !binding ||
    binding.webview !== operation.webview ||
    binding.webviewId !== operation.webviewId ||
    binding.sessionId !== operation.sessionId ||
    binding.operationGeneration !== operation.generation ||
    targetRef.current.id !== operation.target.id
  ) {
    return false
  }
  try {
    return operation.webview.getWebContentsId() === operation.webviewId
  } catch {
    return false
  }
}, [])
```

复制最终调用：

```ts
const markdown = await ipcApi.request('webview.export_annotations', {
  webviewId: operation.webviewId,
  documentSessionId: operation.sessionId,
  target: operation.target,
  annotations
})
if (!isCurrentOperation(operation)) throw new Error('Annotation copy operation is stale')
await navigator.clipboard.writeText(markdown)
```

删除 `replaceMainSnapshot`、完整 annotations React state、所有 `replace_annotations/get_annotations_markdown` 调用和 `navigationRevision`。

- [ ] **步骤 10：将 Main 导出改为当前 session 的一次请求**

先保留 AX helper 在 `WebviewService.ts`，任务 5 再拆文件。公开 method：

```ts
function assertUniqueAnnotationIds(annotations: readonly WebviewAnnotation[]) {
  const ids = new Set<string>()
  for (const annotation of annotations) {
    if (ids.has(annotation.id)) throw new Error('Duplicate annotation id')
    ids.add(annotation.id)
  }
}

async exportAnnotations(
  input: InputFor<'webview.export_annotations'>,
  senderId: WindowId | null
): Promise<string> {
  const guest = this.requireOwnedWebview(input.webviewId, senderId)
  assertUniqueAnnotationIds(input.annotations)
  const annotationSession = this.annotationSessions.get(input.webviewId)
  if (!annotationSession || annotationSession.webContents !== guest) {
    throw new Error('Annotation document session is stale')
  }

  return annotationSession.run(input.documentSessionId, async () => {
    const document: WebviewAnnotationDocument = {
      webviewId: input.webviewId,
      target: input.target,
      page: {
        title: guest.getTitle().replace(/\s+/g, ' ').trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.pageTitle),
        url: sanitizeWebviewAnnotationUrl(guest.getURL()).slice(0, WEBVIEW_ANNOTATION_LIMITS.pageUrl)
      },
      annotations: input.annotations,
      updatedAt: 0
    }
    const markdown = await this.resolveAndFormatAnnotations(guest, document)
    if (this.requireOwnedWebview(input.webviewId, senderId) !== guest) {
      throw new Error('The caller does not own this webview')
    }
    return markdown
  })
}
```

`InputFor` 和 `WindowId` 从 `@shared/ipc/types` type-only import。`resolveAndFormatAnnotations` 是任务 5 提取前的单文档适配层，完整实现为：

```ts
private async resolveAndFormatAnnotations(
  guest: Electron.WebContents,
  document: WebviewAnnotationDocument
): Promise<string> {
  const budget: AccessibilityCaptureBudget = {
    remaining: WEBVIEW_ANNOTATION_LIMITS.accessibilityRequestNodes
  }
  const deadline = Date.now() + ACCESSIBILITY_CAPTURE_TIMEOUT_MS
  const annotations = await this.captureDocumentAccessibility(guest, document, budget, deadline)
  const resolvedDocument: WebviewResolvedAnnotationDocument = { ...document, annotations }
  let markdown = formatWebviewAnnotations([resolvedDocument], { includeSafetyNotice: true }).text

  for (
    let annotationIndex = resolvedDocument.annotations.length - 1;
    markdown.length > WEBVIEW_ANNOTATION_LIMITS.exportMarkdown && annotationIndex >= 0;
    annotationIndex--
  ) {
    const annotation = resolvedDocument.annotations[annotationIndex]
    if (annotation.accessibility.status !== 'available') continue
    annotation.accessibility = createAccessibilityContext('budget_exceeded')
    markdown = formatWebviewAnnotations([resolvedDocument], { includeSafetyNotice: true }).text
  }

  return formatWebviewAnnotations([resolvedDocument], {
    includeSafetyNotice: true,
    maxChars: WEBVIEW_ANNOTATION_LIMITS.exportMarkdown
  }).text
}
```

单 annotation AX 错误仍转 status；session 的 `run()` 在任务开始前和完成后双检，callback 内在 AX 完成后再次调用 `requireOwnedWebview`，所以 ownership 与 session 都跨异步边界复核。删除 CacheService 调用、registry/list/replace/clear、numeric revision 和旧 queue map。

handler 改为：

```ts
'webview.export_annotations': async (input, { senderId }) =>
  application.get('WebviewService').exportAnnotations(input, senderId),
```

handler test 只保留一个有价值的 annotation case：确认 IpcApi 交付的完整 input 和 `senderId` 到达 service，并返回 Markdown。schema 的结构校验由 IpcApi 通用 router tests 与 typecheck 负责；删除旧 revision 表格测试。

- [ ] **步骤 11：更新 Main 测试为公开 session/export 契约**

删除所有 `listAnnotations`、Cache registry 和 `replaceAnnotations` 私有探测。沿用文件现有 `createContents`、`guestById` 和 `getWindow` mock，增加以下 helpers：

```ts
function initializeAndReady(service: WebviewService, guest: MockContents) {
  const ownerHost = guest.hostWebContents
  guestById.set(guest.id, guest)
  getWindow.mockImplementation((id: string) => (id === 'owner' ? { webContents: ownerHost } : undefined))
  ;(service as unknown as { initializeWebview(contents: Electron.WebContents): void }).initializeWebview(guest)
  guest.emit('dom-ready')
}

function lastStartedSession(guest: MockContents): string {
  const calls = guest.send.mock.calls.filter(([, command]) => command.type === 'start_session')
  return calls.at(-1)![1].sessionId
}

function exportInput(documentSessionId: string, webviewId = 7): InputFor<'webview.export_annotations'> {
  return {
    webviewId,
    documentSessionId,
    target: { id: 'mini-app:demo', label: 'Demo' },
    annotations: [annotation]
  }
}

function createGuestWithPendingAx(hostWebContents: object = {}) {
  let finishCapture!: () => void
  const sendCommand = vi.fn((method: string) => {
    if (method !== 'Runtime.evaluate') return Promise.resolve({})
    return new Promise((resolve) => {
      finishCapture = () => resolve({ result: { subtype: 'null' } })
    })
  })
  const guest = createContents(7, hostWebContents, { sendCommand })
  return { guest, sendCommand, finishCapture: () => finishCapture() }
}
```

然后加入以下公开契约 cases：

```ts
it('rejects another window and a stale document session', async () => {
  const guest = createContents(7, {})
  initializeAndReady(service, guest)
  const documentSessionId = lastStartedSession(guest)

  await expect(service.exportAnnotations(exportInput(documentSessionId), 'other-window')).rejects.toThrow(
    'The caller does not own this webview'
  )

  guest.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  await expect(service.exportAnnotations(exportInput(documentSessionId), 'owner')).rejects.toThrow(
    'Annotation document session is stale'
  )
})

it('rejects duplicate annotation ids before starting accessibility capture', async () => {
  const guest = createContents(7, {})
  initializeAndReady(service, guest)
  const documentSessionId = lastStartedSession(guest)
  const input = exportInput(documentSessionId)

  await expect(
    service.exportAnnotations({ ...input, annotations: [input.annotations[0], input.annotations[0]] }, 'owner')
  ).rejects.toThrow('Duplicate annotation id')
  expect(guest.debugger.attach).not.toHaveBeenCalled()
})

it('drops AX output when navigation happens during capture', async () => {
  const { guest, sendCommand, finishCapture } = createGuestWithPendingAx()
  initializeAndReady(service, guest)
  const documentSessionId = lastStartedSession(guest)
  const pending = service.exportAnnotations(exportInput(documentSessionId), 'owner')

  await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith('Runtime.evaluate', expect.anything()))
  guest.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  finishCapture()

  await expect(pending).rejects.toThrow('Annotation document session is stale')
})

it('revalidates host ownership after accessibility capture', async () => {
  const ownerHost = {}
  const replacementHost = {}
  const { guest, sendCommand, finishCapture } = createGuestWithPendingAx(ownerHost)
  initializeAndReady(service, guest)
  const documentSessionId = lastStartedSession(guest)
  const pending = service.exportAnnotations(exportInput(documentSessionId), 'owner')

  await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith('Runtime.evaluate', expect.anything()))
  guest.hostWebContents = replacementHost
  finishCapture()

  await expect(pending).rejects.toThrow('The caller does not own this webview')
})
```

保留 AX secret-value、iframe、budget、timeout、detach 等真实安全契约，迁移为直接输入本次 snapshot；删除跨 WebView registry 排序和清空 Cache 的行为钉死用例。

- [ ] **步骤 12：运行跨进程聚焦测试和 typecheck，确认旧源完全消失**

运行：

```bash
pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts
pnpm test:renderer src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx
pnpm test:main src/main/services/webview/__tests__/AnnotationSession.test.ts src/main/services/webview/__tests__/WebviewService.test.ts src/main/services/webview/__tests__/WebviewService.security.test.ts src/main/services/webview/__tests__/annotationMarkdown.test.ts src/main/ipc/handlers/__tests__/webview.test.ts
pnpm typecheck:node
pnpm typecheck:web
rg -n "replace_annotations|get_annotations_markdown|AnnotationRegistry|webview\.annotations|navigationRevision" src
```

预期：所有测试与 typecheck PASS；最后一个 `rg` 退出码为 1 且无输出。

- [ ] **步骤 13：提交原子协议切换**

```bash
git add src/shared/types/webviewAnnotation.ts src/shared/ipc/schemas/webview.ts src/shared/ipc/errors/webview.ts src/preload/webview.ts src/preload/WebviewAnnotationController.ts src/preload/__tests__/WebviewAnnotationController.test.ts src/renderer/components/WebviewAnnotationControls.tsx src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx src/main/services/webview/AnnotationSession.ts src/main/services/webview/__tests__/AnnotationSession.test.ts src/main/services/webview/WebviewService.ts src/main/services/webview/__tests__/WebviewService.test.ts src/main/ipc/handlers/webview.ts src/main/ipc/handlers/__tests__/webview.test.ts
git commit -S --signoff -m "refactor(webview-annotations): establish document session ownership"
git cat-file commit HEAD | rg "gpgsig|Signed-off-by"
```

---

### 任务 5：从 WebviewService 提取请求期导出与 Main-only 类型

**文件：**
- 创建：`src/main/services/webview/annotationTypes.ts`
- 创建：`src/main/services/webview/annotationExport.ts`
- 创建：`src/main/services/webview/__tests__/annotationExport.test.ts`
- 修改：`src/main/services/webview/WebviewService.ts`
- 修改：`src/main/services/webview/annotationMarkdown.ts`
- 修改：`src/main/services/webview/__tests__/WebviewService.test.ts`
- 修改：`src/main/services/webview/__tests__/annotationMarkdown.test.ts`
- 修改：`src/shared/types/webviewAnnotation.ts`

这是行为保持型提取：`WebviewService` 只保留 lifecycle、ownership 和通用 WebView 能力；AX/CDP 不再扩大 service 文件。

- [ ] **步骤 1：运行 Task 4 的 Main 测试作为提取基线**

```bash
pnpm test:main src/main/services/webview/__tests__/AnnotationSession.test.ts src/main/services/webview/__tests__/WebviewService.test.ts src/main/services/webview/__tests__/WebviewService.security.test.ts src/main/services/webview/__tests__/annotationMarkdown.test.ts
```

预期：PASS。

- [ ] **步骤 2：定义 Main-only document、AX 和 CDP 类型**

`annotationTypes.ts` 从 shared 接受最小 payload，但不向 shared 反向泄露：

```ts
import type { WebviewAnnotation, WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'

export type AnnotationAccessibilityStatus =
  | 'available'
  | 'selector_not_found'
  | 'debugger_unavailable'
  | 'timeout'
  | 'capture_failed'
  | 'budget_exceeded'

export type AnnotationAccessibilityStateName =
  | 'disabled'
  | 'expanded'
  | 'checked'
  | 'pressed'
  | 'selected'
  | 'required'
  | 'invalid'
  | 'readonly'

export interface AnnotationAccessibilityState {
  name: AnnotationAccessibilityStateName
  value: boolean | string
}

export interface AnnotationAccessibleNodeSummary {
  role: string
  name: string | null
  description: string | null
  states: AnnotationAccessibilityState[]
}

export interface AnnotationAccessibleNode extends AnnotationAccessibleNodeSummary {
  children: AnnotationAccessibleNode[]
}

export interface AnnotationAccessibilityContext {
  status: AnnotationAccessibilityStatus
  path: AnnotationAccessibleNodeSummary[]
  tree: AnnotationAccessibleNode | null
  truncated: boolean
}

export interface AnnotationDocument {
  target: WebviewAnnotationTarget
  page: { title: string; url: string }
  annotations: WebviewAnnotation[]
}

export interface ResolvedAnnotation extends WebviewAnnotation {
  accessibility: AnnotationAccessibilityContext
}

export interface ResolvedAnnotationDocument extends Omit<AnnotationDocument, 'annotations'> {
  annotations: ResolvedAnnotation[]
}

export interface AccessibilityCaptureBudget {
  remaining: number
}

export interface CdpValue {
  value?: unknown
}

export interface CdpAccessibilityProperty {
  name: string
  value?: CdpValue
}

export interface CdpAccessibilityNode {
  nodeId: string
  ignored: boolean
  role?: CdpValue
  name?: CdpValue
  description?: CdpValue
  properties?: CdpAccessibilityProperty[]
  parentId?: string
  childIds?: string[]
  backendDOMNodeId?: number
  frameId?: string
}

export interface CdpRuntimeEvaluateResult {
  result?: { objectId?: string; subtype?: string }
  exceptionDetails?: unknown
}

export interface CdpPageGetFrameTreeResult {
  frameTree?: { frame?: { id?: string } }
}

export interface CdpPageCreateIsolatedWorldResult {
  executionContextId?: number
}
```

随后从 `src/shared/types/webviewAnnotation.ts` 删除任务 4 暂留的 page/document/accessibility/resolved schemas 和 exports；把 `annotationMarkdown.ts` 与提取出的 AX 代码全部改为上述 Main-only imports。`src/main/services/webview/index.ts` 不 re-export 这些内部类型。

迁移时使用固定的一一映射：`WebviewAccessibilityStatus` → `AnnotationAccessibilityStatus`、`WebviewAccessibilityState` → `AnnotationAccessibilityState`、`WebviewAccessibleNodeSummary` → `AnnotationAccessibleNodeSummary`、`WebviewAccessibleNode` → `AnnotationAccessibleNode`、`WebviewAccessibilityContext` → `AnnotationAccessibilityContext`、`WebviewAnnotationDocument` → `AnnotationDocument`、`WebviewResolvedAnnotation` → `ResolvedAnnotation`、`WebviewResolvedAnnotationDocument` → `ResolvedAnnotationDocument`。CDP interface 名称不变，只改变所属文件。

- [ ] **步骤 3：提取单文档 export 函数并写聚焦测试**

`annotationExport.ts` 的唯一模块内 API：

```ts
export interface ExportAnnotationDocumentInput {
  guest: Electron.WebContents
  target: WebviewAnnotationTarget
  annotations: WebviewAnnotation[]
}

export async function exportAnnotationDocument({
  guest,
  target,
  annotations
}: ExportAnnotationDocumentInput): Promise<string> {
  const document: AnnotationDocument = {
    target,
    page: {
      title: guest.getTitle().replace(/\s+/g, ' ').trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.pageTitle),
      url: sanitizeWebviewAnnotationUrl(guest.getURL()).slice(0, WEBVIEW_ANNOTATION_LIMITS.pageUrl)
    },
    annotations
  }
  const budget: AccessibilityCaptureBudget = {
    remaining: WEBVIEW_ANNOTATION_LIMITS.accessibilityRequestNodes
  }
  const deadline = Date.now() + ACCESSIBILITY_CAPTURE_TIMEOUT_MS
  const annotationsWithAccessibility = await captureDocumentAccessibility(guest, document, budget, deadline)
  const resolvedDocument: ResolvedAnnotationDocument = {
    ...document,
    annotations: annotationsWithAccessibility
  }
  let markdown = formatWebviewAnnotations(resolvedDocument, { includeSafetyNotice: true }).text

  for (
    let annotationIndex = resolvedDocument.annotations.length - 1;
    markdown.length > WEBVIEW_ANNOTATION_LIMITS.exportMarkdown && annotationIndex >= 0;
    annotationIndex--
  ) {
    const annotation = resolvedDocument.annotations[annotationIndex]
    if (annotation.accessibility.status !== 'available') continue
    annotation.accessibility = createAccessibilityContext('budget_exceeded')
    markdown = formatWebviewAnnotations(resolvedDocument, { includeSafetyNotice: true }).text
  }

  return formatWebviewAnnotations(resolvedDocument, {
    includeSafetyNotice: true,
    maxChars: WEBVIEW_ANNOTATION_LIMITS.exportMarkdown
  }).text
}
```

把 `ACCESSIBILITY_CAPTURE_TIMEOUT_MS`、`ACCESSIBILITY_WORLD_NAME`、`AccessibilityCaptureTimeout`、`ACCESSIBILITY_STATE_NAMES`、`FORM_CONTROL_TAG_NAMES`、`VALUE_BEARING_ACCESSIBILITY_ROLES`、`createAccessibilityContext`、normalizers、selector resolver、debugger command/cleanup 和两个 capture 函数从 `WebviewService.ts` 原样迁入该文件，再把它们的 `this.` 调用改为模块内函数调用。`annotationExport.test.ts` 直接保护 timeout、isolated world、secret-value suppression、node/depth/request budgets、iframe frame boundary 和 debugger detach 契约；不要通过 private cast 探测 WebviewService。

- [ ] **步骤 4：让 WebviewService 只负责授权和 session 双检**

最终 method body：

```ts
async exportAnnotations(
  input: InputFor<'webview.export_annotations'>,
  senderId: WindowId | null
): Promise<string> {
  const guest = this.requireOwnedWebview(input.webviewId, senderId)
  const annotationSession = this.annotationSessions.get(input.webviewId)
  if (!annotationSession || annotationSession.webContents !== guest) {
    throw new Error('Annotation document session is stale')
  }
  return annotationSession.run(input.documentSessionId, async () => {
    const markdown = await exportAnnotationDocument({
      guest,
      target: input.target,
      annotations: input.annotations
    })
    if (this.requireOwnedWebview(input.webviewId, senderId) !== guest) {
      throw new Error('The caller does not own this webview')
    }
    return markdown
  })
}
```

`WebviewService.test.ts` 只保留 owner/session integration、preload binding cleanup 和通用 WebView 行为；AX 细节全部由 `annotationExport.test.ts` 负责。

- [ ] **步骤 5：把 formatter 改为单 document 并保持 Guest 顺序**

`formatWebviewAnnotations` 改为接收一个 `AnnotationDocument | ResolvedAnnotationDocument`，删除 documents sort、`updatedAt` 和跨文档循环。把 `totalAnnotations` 固定为 `document.annotations.length`，按传入数组顺序依次构造 block；候选文本超过 `maxChars` 时停止并用 `totalAnnotations - includedAnnotations` 生成现有截断提示。保留安全提示、Markdown escaping 和 `slice(0, maxChars)` 最终硬上限。

运行：

```bash
pnpm test:main src/main/services/webview/__tests__/AnnotationSession.test.ts src/main/services/webview/__tests__/annotationExport.test.ts src/main/services/webview/__tests__/annotationMarkdown.test.ts src/main/services/webview/__tests__/WebviewService.test.ts src/main/services/webview/__tests__/WebviewService.security.test.ts
pnpm typecheck:node
```

预期：全部 PASS；`wc -l src/main/services/webview/WebviewService.ts` 明显低于提取前，且文件内无 `Runtime.evaluate`、`Accessibility.getAXNodeAndAncestors` 或 formatter 实现。

- [ ] **步骤 6：提交 Main 请求期导出拆分**

```bash
git add src/main/services/webview src/shared/types/webviewAnnotation.ts
git commit -S --signoff -m "refactor(webview-annotations): isolate request scoped export"
git cat-file commit HEAD | rg "gpgsig|Signed-off-by"
```

---

### 任务 6：提取 Renderer 私有 session hook 和窄 UI 组件

**文件：**
- 创建：`src/renderer/components/WebviewAnnotationControls/index.ts`
- 创建：`src/renderer/components/WebviewAnnotationControls/WebviewAnnotationControls.tsx`
- 创建：`src/renderer/components/WebviewAnnotationControls/useWebviewAnnotationSession.ts`
- 创建：`src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx`
- 创建：`src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx`
- 删除：`src/renderer/components/WebviewAnnotationControls.tsx`
- 删除：`src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx`
- 修改：`src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx`
- 修改：`src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx`

本任务不改变 wire protocol。它把 request correlation、listener cleanup 和 stale operation 从 JSX 中移出，同时保持唯一 consumer 私有，不提升为全局 hook。

- [ ] **步骤 1：记录提取前 Renderer 测试基线**

```bash
pnpm test:renderer src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx
```

预期：PASS。

- [ ] **步骤 2：固定 hook 的最小返回契约**

`useWebviewAnnotationSession.ts` 只导出给同目录组件：

```ts
interface UseWebviewAnnotationSessionOptions {
  webview: WebviewTag | null
  isHostActive: boolean
  target: WebviewAnnotationTarget
  locale: WebviewAnnotationLocale
  theme: WebviewAnnotationTheme
}

export interface WebviewAnnotationSessionControls {
  enabled: boolean
  count: number
  ready: boolean
  copying: boolean
  toggle(): void
  clear(): void
  copy(): Promise<void>
}

export function useWebviewAnnotationSession(
  options: UseWebviewAnnotationSessionOptions
): WebviewAnnotationSessionControls
```

hook 内部保留 Task 4 已验证的 binding、pending snapshot、timeout 和 operation generation；不导出这些内部类型。

- [ ] **步骤 3：把竞态用例迁入 hook harness test**

`useWebviewAnnotationSession.test.tsx` 用 `renderHook` 保护：

- concrete WebView 替换时旧 listener 不再生效；
- new-document navigation retire session，same-document 不 retire；
- target ID 变化发 clear 并作废 copy，label/theme 只 configure；
- host inactive 发 deactivate 且保留 count；
- wrong native source/channel/schema/session/request 被忽略；
- snapshot timeout、unmount 和 AX 期间导航不写 clipboard；
- 单飞复制只产生一个 request。

核心 stale 断言：

```ts
let resolveExport!: (markdown: string) => void
request.mockReturnValueOnce(new Promise<string>((resolve) => (resolveExport = resolve)))
let copyPromise!: Promise<void>

act(() => {
  copyPromise = result.current.copy()
})
await waitFor(() =>
  expect(sentCommands(webview).find((command) => command.type === 'request_snapshot')).toBeDefined()
)
const snapshotRequest = sentCommands(webview).find((command) => command.type === 'request_snapshot')!

act(() => {
  dispatchGuestEvent(webview, {
    type: 'snapshot_ready',
    sessionId: SESSION_ONE,
    requestId: snapshotRequest.requestId,
    annotations: [annotation]
  })
})
await waitFor(() => expect(request).toHaveBeenCalledWith('webview.export_annotations', expect.anything()))
act(() => dispatchNewDocumentNavigation(webview))
resolveExport('# stale')

await act(async () => {
  await expect(copyPromise).rejects.toThrow('Annotation copy operation is stale')
})
expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
```

成功 case 的完整时序断言为：

```ts
request.mockResolvedValueOnce('# current')
act(() => {
  dispatchGuestEvent(webview, { type: 'state_changed', sessionId: SESSION_ONE, enabled: false, count: 1 })
})
let successfulCopy!: Promise<void>
act(() => {
  successfulCopy = result.current.copy()
})
await waitFor(() =>
  expect(sentCommands(webview).find((command) => command.type === 'request_snapshot')).toBeDefined()
)
const successfulRequest = sentCommands(webview).find((command) => command.type === 'request_snapshot')!
act(() => {
  dispatchGuestEvent(webview, {
    type: 'snapshot_ready',
    sessionId: SESSION_ONE,
    requestId: successfulRequest.requestId,
    annotations: [annotation]
  })
})
await act(async () => {
  await expect(successfulCopy).resolves.toBeUndefined()
})
expect(navigator.clipboard.writeText).toHaveBeenCalledOnce()
expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# current')
```

测试直接观察 WebView commands、IpcApi、clipboard 和 hook state；不断言内部 ref 或 rerender 次数。

- [ ] **步骤 4：把组件测试缩减为用户可见 UI 契约**

`WebviewAnnotationControls.test.tsx` 只保留：

1. 握手后 toggle 的 accessible name/pressed state；
2. count 出现后 copy/clear 按钮可见；
3. copy pending 按钮 disabled，成功/失败 toast 与 clipboard 结果；
4. clear confirmation 后 count 消失；
5. inactive 时 controls disabled。

不重复 hook 已覆盖的每一种 session race，不扩展全局 `@cherrystudio/ui` mock。

- [ ] **步骤 5：创建窄组件和 barrel**

组件消费 hook：

```tsx
const session = useWebviewAnnotationSession({ webview, isHostActive, target, locale, theme })

const handleCopy = async () => {
  try {
    await session.copy()
    toast.success(t('webview.annotation.copied'))
  } catch (error) {
    logger.error('Failed to copy webview annotations', error as Error, { targetId: target.id })
    toast.error(t('webview.annotation.copy_failed'))
  }
}
```

barrel：

```ts
export { WebviewAnnotationControls } from './WebviewAnnotationControls'
```

外部 `MinimalToolbar` import 保持 `@renderer/components/WebviewAnnotationControls`，由路径解析进入 barrel。删除旧单文件和旧测试位置。

- [ ] **步骤 6：运行 Renderer 测试与 Web typecheck**

```bash
pnpm test:renderer src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx
pnpm typecheck:web
```

预期：全部 PASS；`rg -n "annotations: \[|navigationRevision|replaceMainSnapshot|WEBVIEW_ATTACH_MAX_ATTEMPTS" src/renderer/components/WebviewAnnotationControls` 无旧镜像实现。

- [ ] **步骤 7：提交 Renderer 分层**

```bash
git add src/renderer/components/WebviewAnnotationControls src/renderer/components/WebviewAnnotationControls.tsx src/renderer/components/__tests__/WebviewAnnotationControls.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx
git commit -S --signoff -m "refactor(webview-annotations): isolate renderer session hook"
git cat-file commit HEAD | rg "gpgsig|Signed-off-by"
```

---

### 任务 7：完整验证、tracked Electron 验收和提交审计

**文件：**
- 检查：本计划列出的全部生产代码与测试文件
- 不创建新的 Playwright fixture 或 E2E framework

- [ ] **步骤 1：运行所有标注相关聚焦测试**

```bash
pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts
pnpm test:renderer src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx src/renderer/pages/miniApps/components/__tests__/MiniAppPane.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx
pnpm test:main src/main/services/webview/__tests__/AnnotationSession.test.ts src/main/services/webview/__tests__/annotationExport.test.ts src/main/services/webview/__tests__/annotationMarkdown.test.ts src/main/services/webview/__tests__/WebviewService.test.ts src/main/services/webview/__tests__/WebviewService.security.test.ts src/main/ipc/handlers/__tests__/webview.test.ts
```

预期：全部 PASS。

- [ ] **步骤 2：运行静态审计确认旧状态链路和跨层类型已删除**

```bash
rg -n "replace_annotations|get_annotations_markdown|AnnotationRegistry|webview\.annotations|navigationRevision|WebviewAnnotationDocument|WebviewResolvedAnnotation|WebviewAccessibilityContext" src/shared src/preload src/renderer src/main
```

预期：退出码 1，无输出。Main-only 类型只能以新的无 `Webview` shared 前缀存在于 `src/main/services/webview/annotationTypes.ts`。

再运行：

```bash
rg -n "CacheService|useCache|DataApi|usePreference" src/main/services/webview src/renderer/components/WebviewAnnotationControls src/preload/WebviewAnnotationController.ts
```

预期：annotation state/export 文件没有 Cache/DataApi/Preference 使用；`WebviewService.ts` 允许保留既有 user-agent language 获取，但不能出现 annotation Cache key。

- [ ] **步骤 3：运行仓库完成门禁**

```bash
pnpm lint
pnpm build:check
pnpm test:lint
```

预期：三条命令退出码 0。`pnpm lint` 会写格式；运行后执行 `git diff --check` 和 `git status --short`。若产生格式变更，把它们归入对应 owner 的上一任务，重新运行该任务测试并创建一个签名、sign-off 的 `chore(webview-annotations): apply validation formatting` commit；不得夹带其他工作树文件。

- [ ] **步骤 4：使用 tracked Electron 完成用户结果验收**

先完整阅读并使用 `/Users/gujiaming/Desktop/next/cherry-studio/.agents/skills/cherry-electron-dev/SKILL.md`。在受控实例中逐项记录结果：

1. 当前站点 WebView 创建元素和区域 annotations，复制 Markdown 只包含当前 target/title/sanitized URL。
2. 分屏两侧分别标注，复制不串数据。
3. 切换 active pane 后选择模式关闭、未保存草稿消失、已提交 pins/count 保留。
4. `#hash`/same-document history 变化保留；reload 和新 URL 清空。
5. 在 Main AX capture pending 时导航，确认原剪贴板内容不变并出现失败反馈。
6. input、textarea、select、contenteditable 可正常点击输入；annotation mode 不吞掉这些事件。
7. 区域拖拽后滚动，pin 按 page→viewport 规则移动；第二指针不能结束第一指针 drag。
8. 关闭/重建 WebView 后，旧 snapshot/request 不影响新实例。

不把人工操作描述为自动 E2E；PR 验证记录明确仓库当前没有 WebView Playwright fixture。

- [ ] **步骤 5：审计 commits、签名和工作树范围**

```bash
git log --format='%h %s%n%b' origin/add-browser-element-annotation..HEAD
git log --format='%H' origin/add-browser-element-annotation..HEAD | while read commit; do git cat-file commit "$commit" | rg -q '^gpgsig ' || exit 1; git show -s --format='%B' "$commit" | rg -q '^Signed-off-by:' || exit 1; done
git status --short
```

预期：所有新增 commits 都有 `gpgsig` 和 `Signed-off-by`；工作树只显示用户原有未跟踪文件，没有未提交的实现改动。

- [ ] **步骤 6：交付验证记录**

最终回复列出：

- Guest/Renderer/Main 最终所有权；
- 删除的旧 Cache/IPC/revision 路径；
- 每条聚焦测试、`pnpm lint`、`pnpm build:check`、`pnpm test:lint` 的退出状态；
- tracked Electron 八个场景的结果；
- 未新增自动 WebView E2E 的明确限制；
- commits 及签名/DCO 状态；
- 用户原有 `CONTEXT.md` 和其他未跟踪文档未被改动。
