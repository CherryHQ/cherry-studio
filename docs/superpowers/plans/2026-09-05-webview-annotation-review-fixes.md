# WebView Annotation Review Fixes 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 PR #17842 已确认的 annotation 输入、投递、隐私、坐标、位置跟踪、生命周期、焦点和可访问性缺陷，并完成已接受的所有权收窄。

**架构：** Preload 负责 guest 输入与页面几何；Renderer 负责 host UI、异步命令结果和用户状态；Main lifecycle service 负责 document session。共享层只保留真实跨进程 schema/type。每个行为先添加可观察回归测试，再做最小修复。

**技术栈：** Electron 41 `WebviewTag`, React 19, TypeScript, Zod, Vitest 3, Testing Library, pnpm。

---

## 文件职责

- `src/preload/WebviewAnnotationController.ts`：guest 页面的选择输入、locator、region、overlay 和位置跟踪。
- `src/preload/webview.ts`：唯一 WebView preload 入口与宿主快捷键 relay。
- `src/preload/__tests__/WebviewAnnotationController.test.ts`：preload controller 的 DOM/输入/几何契约。
- `src/preload/__tests__/webview.test.ts`：preload entry 的 annotation Escape 与 shortcut relay 集成契约。
- `src/renderer/components/WebviewAnnotationControls/useWebviewAnnotationSession.ts`：renderer session、command delivery、snapshot/export 操作。
- `src/renderer/components/WebviewAnnotationControls/WebviewAnnotationControls.tsx`：用户操作、反馈与 accessible name。
- `src/renderer/components/WebviewAnnotationControls/__tests__/*`：hook/component 用户可观察行为。
- `src/renderer/pages/miniApps/components/MiniAppPane.tsx`：pane focus ownership。
- `src/renderer/pages/miniApps/__tests__/MiniAppPage.test.tsx`：split-pane ownership 集成行为。
- `src/main/services/webview/AnnotationSession.ts`：单 guest document session identity 与任务串行化。
- `src/main/services/webview/WebviewService.ts`：lifecycle 中发现/绑定 guest。
- `src/main/services/webview/__tests__/{AnnotationSession,WebviewService}.test.ts`：session restart 与 stale rejection。
- `src/main/services/webview/annotationExport.ts`：Main-only export limits 和解析。
- `src/shared/types/webviewAnnotation.ts`：真实跨进程 annotation message schemas/types。

### 任务 1：等待 Renderer WebView command delivery

**文件：**
- 修改：`src/renderer/components/WebviewAnnotationControls/useWebviewAnnotationSession.ts`
- 修改：`src/renderer/components/WebviewAnnotationControls/WebviewAnnotationControls.tsx`
- 测试：`src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx`
- 测试：`src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx`

- [ ] **步骤 1：编写 send rejection 回归测试**

在 hook harness 中让 `webview.send` 对 `set_enabled`、`clear` 和 `request_snapshot` 返回 rejected Promise，分别断言 enabled/count/editor 不乐观改变，copy 立即 reject 且 copying 恢复。组件确认框测试断言 clear 失败后对话框仍打开。

```ts
webview.send.mockRejectedValueOnce(new Error('guest unavailable'))
await act(async () => expect(result.current.toggle()).resolves.toBe(false))
expect(result.current.enabled).toBe(false)
```

- [ ] **步骤 2：运行测试并确认因同步 `true` 失败**

运行：`pnpm test:renderer src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx`

预期：FAIL；失败显示 action 已乐观提交或 snapshot 仍等待 timeout。

- [ ] **步骤 3：实现异步 delivery**

```ts
const sendCommand = useCallback(async (webview: WebviewTag, command: WebviewAnnotationHostCommand) => {
  try {
    await webview.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, command)
    return true
  } catch (error) {
    logger.debug('Failed to send webview annotation command', { error })
    return false
  }
}, [])
```

将用户 action 改成 async，成功后再变更 store；effect/cleanup 使用 `void sendCommand(...)`。`requestSnapshot` await send，失败时仅清除仍匹配的 pending 和 timeout 后 reject。

- [ ] **步骤 4：运行同一测试确认通过**

运行上一步命令；预期 PASS。

- [ ] **步骤 5：提交**

`git commit -S --signoff -m "fix(webview-annotations): await guest command delivery"`

### 任务 2：建立 Preload 输入所有权并补全隐私边界

**文件：**
- 修改：`src/preload/WebviewAnnotationController.ts`
- 修改：`src/preload/webview.ts`
- 创建：`src/preload/__tests__/webview.test.ts`
- 测试：`src/preload/__tests__/WebviewAnnotationController.test.ts`

- [ ] **步骤 1：编写 hostile capture、iframe、Escape 和 privacy 回归测试**

最小场景：controller 构造后注册会 `stopImmediatePropagation()` 的 guest window handler；启用 annotation 后 shield click 仍选择 underlying button 且页面 action 不执行。全 viewport iframe 命中 locator `tagName: 'iframe'`。`designMode='on'`、`role='unknown textbox'`、继承 contenteditable 的 locator text 均为 null。preload entry 测试断言 controller 消费 Escape 时不 relay，inactive 时仍 relay。

```ts
const iframe = document.createElement('iframe')
iframe.id = 'full-frame'
document.body.appendChild(iframe)
vi.spyOn(document, 'elementFromPoint').mockReturnValue(iframe)
dispatchTrustedPointer(inputShield, 'click')
expect(openedEditorElement()).toBe(iframe)
```

- [ ] **步骤 2：运行 preload tests 确认失败**

运行：`pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts src/preload/__tests__/webview.test.ts`

预期：FAIL；现有 late document listeners 被截断、iframe 无父文档事件、Escape 已 relay、editable text 未隐藏。

- [ ] **步骤 3：实现 early arbiter、shield 和统一 privacy predicate**

Controller 构造时注册 window capture handlers，dispose 对称移除。selection enabled 时创建 viewport shield，命中时暂时关闭其 pointer events 调用 `document.elementFromPoint`。提供 `handleHostKey(event): boolean` 供 preload entry 在 relay 前询问。

```ts
const isSensitiveEditable = (element: Element) => {
  if (element.ownerDocument.designMode.toLowerCase() === 'on') return true
  if (element instanceof HTMLElement && element.isContentEditable) return true
  if (element.matches('input, textarea, select, option')) return true
  const roles = element.getAttribute('role')?.toLowerCase().split(/\s+/) ?? []
  return roles.some((role) => SENSITIVE_EDITABLE_ROLES.has(role))
}
```

locator summary、ancestor/descendant scan 和 composed editable path 共用该函数。不要启用 subframe preload。

- [ ] **步骤 4：运行同一 preload tests 确认通过**

运行上一步命令；预期 PASS 且禁用/可编辑场景保持透传。

- [ ] **步骤 5：提交**

`git commit -S --signoff -m "fix(webview-annotations): own guest selection input"`

### 任务 3：修正 Region 坐标契约并限制 locator 工作量

**文件：**
- 修改：`src/shared/types/webviewAnnotation.ts`
- 修改：`src/preload/WebviewAnnotationController.ts`
- 修改：`src/renderer/components/WebviewAnnotationControls/useWebviewAnnotationSession.ts`
- 测试：`src/preload/__tests__/WebviewAnnotationController.test.ts`
- 测试：`src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx`

- [ ] **步骤 1：编写 long-page、bounded work、malformed response tests**

设置 `scrollY > 10_000_000`，断言 snapshot schema 接受真实 page y。提供超过 12 个候选且第 13 个 locator 构造会抛错，断言输出仍为前 12 个。向 pending snapshot 发送匹配 request/session 但非法 payload，断言立即 reject。

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts && pnpm test:renderer src/renderer/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx`

预期：FAIL；schema 拒绝长页坐标、locator 访问第 13 个、malformed response 等待 timeout。

- [ ] **步骤 3：实现最小契约修复**

拆分 viewport anchor bound 与 page coordinate validation。page x/y 使用有限 safe integer；producer helper 返回 round 后的 schema-compatible rect。renderer 先解析事件 envelope，匹配 pending 的 snapshot 完整解析失败时清 timeout 并 reject。locator 使用顺序循环并在收满 limit 后 break。

```ts
const elements: WebviewElementLocator[] = []
for (const element of contained) {
  const locator = createWebviewElementLocator(element)
  if (locator) elements.push(locator)
  if (elements.length === WEBVIEW_ANNOTATION_LIMITS.regionElements) break
}
```

- [ ] **步骤 4：运行 preload + renderer tests 确认通过**

运行上一步命令；预期 PASS。

- [ ] **步骤 5：提交**

`git commit -S --signoff -m "fix(webview-annotations): preserve region geometry"`

### 任务 4：在 CSS motion 期间跟踪位置

**文件：**
- 修改：`src/preload/WebviewAnnotationController.ts`
- 测试：`src/preload/__tests__/WebviewAnnotationController.test.ts`

- [ ] **步骤 1：编写 motion regression tests**

使用可控 rAF 和 mutable `getBoundingClientRect`；不触发 mutation/resize。相关 element/ancestor 的 `getAnimations()` 返回 running 时下一 frame 必须更新 pin 和发送 `editor_anchor_changed`；变为 finished 后最终刷新并停止；dispose 后无 frame。

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts`

预期：FAIL；one-shot frame 后位置不再更新。

- [ ] **步骤 3：实现 scoped rAF tracking**

收集 annotation/editor/highlight element 及 composed ancestors，仅在其 animation playState 为 `running`/`pending` 时续订下一 frame。animation/transition start/run/end/cancel capture listeners负责唤醒与最终刷新。stop/reset/dispose 清理 frame 和 listeners。

- [ ] **步骤 4：运行 controller suite 确认通过**

运行上一步命令；预期 PASS。

- [ ] **步骤 5：提交**

`git commit -S --signoff -m "fix(webview-annotations): track animated targets"`

### 任务 5：WebviewService restart 后重新握手

**文件：**
- 修改：`src/main/services/webview/AnnotationSession.ts`
- 修改：`src/main/services/webview/WebviewService.ts`
- 测试：`src/main/services/webview/__tests__/AnnotationSession.test.ts`
- 测试：`src/main/services/webview/__tests__/WebviewService.test.ts`

- [ ] **步骤 1：编写 surviving guest restart test**

初始化 loaded guest 得到 session S1，执行 service stop/init 且不发新 dom-ready，断言立即发送不同 S2；S1 export reject，S2 export 可进入 capture。另测 loading/new guest 仍等 dom-ready。

- [ ] **步骤 2：运行 Main tests 确认失败**

运行：`pnpm test:main src/main/services/webview/__tests__/AnnotationSession.test.ts src/main/services/webview/__tests__/WebviewService.test.ts`

预期：FAIL；restart 后没有第二次 `start_session`。

- [ ] **步骤 3：实现显式 announcement**

AnnotationSession 提取 idempotent `announce()`，`dom-ready` 调用它。WebviewService 扫描 existing loaded WebContents 时构造 session 后立即 announce；new/loading guest 保留 dom-ready gate。send 失败保持 `ready=false`。

- [ ] **步骤 4：运行 Main tests 确认通过**

运行上一步命令；预期 PASS。

- [ ] **步骤 5：提交**

`git commit -S --signoff -m "fix(webview-annotations): reannounce surviving sessions"`

### 任务 6：修复 pane focus 与 annotation count 可访问性

**文件：**
- 修改：`src/renderer/pages/miniApps/components/MiniAppPane.tsx`
- 修改：`src/renderer/components/WebviewAnnotationControls/WebviewAnnotationControls.tsx`
- 测试：`src/renderer/pages/miniApps/__tests__/MiniAppPage.test.tsx`
- 测试：`src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx`

- [ ] **步骤 1：编写 focus 与 accessible-name tests**

双 pane 测试用 userEvent.tab 进入 secondary toolbar 后断言 host owner 切到 split。count 测试通过 `getByRole('button', { name: /enable.*2 annotations/i })` 查找 toggle，且 Badge 不形成第二个可访问节点；zero count 名称不变。

- [ ] **步骤 2：运行 tests 确认失败**

运行：`pnpm test:renderer src/renderer/pages/miniApps/__tests__/MiniAppPage.test.tsx src/renderer/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx`

预期：FAIL；focus 不激活 split，button name 只有 action。

- [ ] **步骤 3：实现 focus capture 和 label composition**

Pane root 增加 `onFocusCapture={onActivate}` 并保留 native WebView focus listener。toggle 有 count 时组合 action label 与现有 count 翻译；Badge 设置 `aria-hidden`。

- [ ] **步骤 4：运行 renderer tests 确认通过**

运行上一步命令；预期 PASS。

- [ ] **步骤 5：提交**

`git commit -S --signoff -m "fix(mini-app): activate focused webview pane"`，count 若需独立审查则另提交 `fix(webview-annotations): expose toggle count`。

### 任务 7：收窄 shared contract 并移动 renderer owner

**文件：**
- 修改：`src/shared/types/webviewAnnotation.ts`
- 修改：`src/main/services/webview/annotationExport.ts`
- 移动：`src/renderer/components/WebviewAnnotationControls/**` → `src/renderer/pages/miniApps/components/WebviewAnnotationControls/**`
- 修改：`src/renderer/pages/miniApps/components/MinimalToolbar.tsx`
- 修改：`src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx`
- 修改：`src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx`

- [ ] **步骤 1：确认 consumers 并建立重构前绿灯**

运行 `rg` 确认 Main-only limits 仅由 annotation export 消费，snapshot alias 无消费者，controls 仅由 MinimalToolbar 消费。运行受影响 main/preload/renderer suites，预期 PASS。

- [ ] **步骤 2：移动 Main-only limits 与私有化 composition schemas**

在 `annotationExport.ts` 定义私有 export limits；shared 文件去掉仅组合 schema 的 export，删除无消费者 snapshot type，保留实际跨进程类型和边界 schemas。不要为了测试重新导出 Main 私有常量。

- [ ] **步骤 3：移动完整 component directory**

使用 `git mv` 移动实现与测试；MinimalToolbar 改为本地 barrel import；只更新两个 toolbar tests 的 mock module path，不改变 API/行为。

- [ ] **步骤 4：运行所有受影响 suites**

运行：`pnpm test:main src/main/services/webview/__tests__/annotationExport.test.ts src/main/services/webview/__tests__/AnnotationSession.test.ts src/main/services/webview/__tests__/WebviewService.test.ts`

运行：`pnpm test:preload src/preload/__tests__/WebviewAnnotationController.test.ts src/preload/__tests__/webview.test.ts`

运行：`pnpm test:renderer src/renderer/pages/miniApps/components/WebviewAnnotationControls/__tests__/useWebviewAnnotationSession.test.tsx src/renderer/pages/miniApps/components/WebviewAnnotationControls/__tests__/WebviewAnnotationControls.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.test.tsx src/renderer/pages/miniApps/components/__tests__/MinimalToolbar.address.test.tsx src/renderer/pages/miniApps/__tests__/MiniAppPage.test.tsx`

预期：全部 PASS。

- [ ] **步骤 5：提交**

`git commit -S --signoff -m "refactor(webview-annotations): align feature ownership"`

### 任务 8：验证、运行时检查和删除临时文档

**文件：**
- 删除：`docs/superpowers/specs/2026-09-05-webview-annotation-review-fixes-design.md`
- 删除：`docs/superpowers/plans/2026-09-05-webview-annotation-review-fixes.md`

- [ ] **步骤 1：运行静态和 targeted verification**

运行 `pnpm lint`；因为 shared cross-process contract 发生变化，完整 typecheck/i18n/format 由该命令覆盖。若 lint 写入文件，检查并仅保留本任务产生的格式变化。再次运行任务 7 的三个 targeted commands。

- [ ] **步骤 2：tracked Electron smoke test**

按 `cherry-electron-dev/references/electron-instance.md` persistent policy 复用或启动实例。验证普通元素/全屏 iframe 选择、fullscreen Escape、split-pane keyboard focus、animated target pin。记录 PID、CDP port 和 evidence；保持健康实例运行。

- [ ] **步骤 3：进行 change verification review**

使用 `cherry-change-verification` 检查 diff 所有权、验证证据、提交签名和工作树；不把既有 `CONTEXT.md` 或其他 untracked spec 纳入范围。

- [ ] **步骤 4：删除本轮规格与计划**

仅删除上述两个已跟踪文档，运行 `pnpm docs:check`，确认另一份用户未跟踪规格仍存在且未修改。

- [ ] **步骤 5：提交文档清理并验证签名**

`git commit -S --signoff -m "docs(webview-annotations): remove temporary implementation notes"`

对每个新 commit 运行 `git cat-file commit <sha>`，确认存在 `gpgsig` 与 `Signed-off-by`。最终 `git status --short` 只能显示用户原有未跟踪文件。
