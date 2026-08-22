# macOS Conversation Island 动效与刘海信息实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让多活动展开态与窗口内容等高、在实体刘海两侧显示有用状态，并以 Cindy 风格的顶部中心弹簧动效自然出现、扩缩和退场。

**架构：** main 继续拥有活动快照、窗口 bounds、退场计时器和生命周期安全；renderer 只消费权威快照并负责视觉插值。现有专用 `conversation_island.set_expanded` IPC 不扩张，通用 `WindowManager` 不修改。实体刘海展开态使用固定 38px 肩部行，renderer 从 `target.conversationType` 选择图标；main 提供本地化总数、退出态和 reduced-motion 状态。

**技术栈：** TypeScript、Electron 41、React 19、Motion (`motion/react`)、Tailwind CSS、Lucide、Vitest 3、Testing Library。

**设计依据：** `docs/superpowers/specs/2026-08-22-macos-conversation-island-motion-polish-design.md`

---

## 实施前状态与保护规则

计划定稿时，平台隔离主体已由 `25936f8a84` 和 `4ad4744994` 落地；工作区仍有以下用户拥有的残余 hunk：

- `scripts/__tests__/before-pack.test.ts`
- `src/main/services/conversationIsland/ConversationIslandService.ts`
- `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`

这些改动继续保护非 macOS 打包过滤、测试输入适配和 `awaitingApprovalAnchors` 投影。它们不是本计划的提交内容。开始实现前先运行并记录最后一行输出为 `MOTION_BASE_SHA`：

```bash
git status --short
git diff --cached --stat
git diff --stat
git rev-parse HEAD
```

优先等待平台隔离工作由其所有者提交或明确交接。若必须在当前脏工作区继续，只能对重叠文件执行 `git add -p`，每次提交前检查 `git diff --cached`；任何 motion hunk 与平台隔离 hunk 无法安全拆分时，停止并请求用户决定归属。不得 unstage、覆盖或提交现有用户 hunk。

按用户要求，不做逐任务重复审查。每个任务保留 RED/GREEN 和小提交，全部完成后只做一次集中自审与运行时验收。

## 不变量

- compact 刘海布局、capsule fallback、500ms hover 展开、250ms leave 收起、点击后的 fresh re-entry、最多 5 行和 6+ 滚动保持不变。
- main 是 `exiting`、`reducedMotion`、本地化数量文本和关闭时机的唯一权威来源。
- renderer 不自行关闭窗口，不读取新的 Preference，也不单独查询系统 reduced-motion。
- 正常活动耗尽/终态过期可播放 180ms 退场；禁用、服务停止、窗口无效和展示失败仍立即关闭。
- 退场期间到达新活动必须取消旧计时器并复用当前窗口。
- 不新增持久化偏好、通用 WindowManager API、宽泛 IPC、原生 helper 或透明大 carrier 窗口。

## 文件结构

### 修改

- `src/main/services/conversationIsland/macScreenGeometry.ts`：删除展开刘海底部 8px 留白。
- `src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts`：锁定 2 行和 5+ 行的无底隙尺寸。
- `src/shared/types/conversationIsland.ts`：为快照增加本地化数量、退出态和 reduced-motion 展示字段。
- `src/main/i18n/locales/*.json`：增加活动总数文案并完成 12 个 locale。
- `src/main/services/conversationIsland/ConversationIslandService.ts`：投影展示字段，拥有可取消退场计时器和即时关闭兜底。
- `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`：覆盖本地化、reduced-motion、延迟关闭和取消退场。
- `src/renderer/windows/conversationIsland/ConversationIsland.tsx`：渲染肩部信息、Motion 容器、退出态交互屏蔽。
- `src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`：覆盖肩部布局和退出态交互。

### 新增

- `src/renderer/windows/conversationIsland/conversationIslandMotion.ts`：封装已经批准的弹簧、退场和 reduced-motion 视觉合同。
- `src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts`：以纯输入/输出保护动效参数。

### 明确不修改

- `src/main/core/window/**`、`src/main/ipc/**`、`src/shared/ipc/**`
- Preference、DataApi、数据库和迁移
- NotificationService 的平台隔离职责
- `electron.vite.config.ts`、`package.json`

## 任务 1：删除展开刘海的底部留白

**文件：**

- 修改：`src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts`
- 修改：`src/main/services/conversationIsland/macScreenGeometry.ts`

- [ ] **步骤 1：先把尺寸合同改成无底隙期望值**

保留 capsule 断言不变，只修改 notch expanded 的期望：

```ts
it.each([
  { activityCount: 2, expected: { width: 420, height: 126 } },
  { activityCount: 5, expected: { width: 420, height: 258 } },
  { activityCount: 8, expected: { width: 420, height: 258 } }
])('fits the notch header and visible rows without bottom padding', ({ activityCount, expected }) => {
  expect(resolveConversationIslandSize({ presentation: 'notch', expanded: true, activityCount })).toEqual(expected)
})
```

该测试能捕获 8px 底部常量被保留或重新引入。

- [ ] **步骤 2：运行 RED 测试**

```bash
pnpm test src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
```

预期：notch 的 2/5/8 活动断言失败，实际高度仍为 `134/266/266`；capsule 与 compact 用例通过。

- [ ] **步骤 3：最小化修改尺寸公式**

删除 `NOTCH_BOTTOM_PADDING`，让展开高度严格等于肩部与可见行之和：

```ts
const EXPANDED_WIDTH = 420
const EXPANDED_ROW_HEIGHT = 44
const CAPSULE_VERTICAL_PADDING = 16
const NOTCH_TOP_INSET = 38

const chromeHeight = presentation === 'notch' ? NOTCH_TOP_INSET : CAPSULE_VERTICAL_PADDING
return {
  width: EXPANDED_WIDTH,
  height: chromeHeight + Math.min(activityCount, MAX_VISIBLE_ACTIVITIES) * EXPANDED_ROW_HEIGHT
}
```

- [ ] **步骤 4：运行 GREEN 测试和静态检查**

```bash
pnpm test src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
pnpm exec biome check src/main/services/conversationIsland/macScreenGeometry.ts src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
git diff --check
```

预期：全部通过且无格式修改。

- [ ] **步骤 5：创建聚焦提交**

```bash
git add src/main/services/conversationIsland/macScreenGeometry.ts \
  src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
git diff --cached
git commit -S --signoff -m "fix(conversation-island): remove expanded notch bottom gap"
```

## 任务 2：把展示状态投影进权威快照

**文件：**

- 修改：`src/shared/types/conversationIsland.ts`
- 修改：`src/main/i18n/locales/de-de.json`
- 修改：`src/main/i18n/locales/el-gr.json`
- 修改：`src/main/i18n/locales/en-us.json`
- 修改：`src/main/i18n/locales/es-es.json`
- 修改：`src/main/i18n/locales/fr-fr.json`
- 修改：`src/main/i18n/locales/ja-jp.json`
- 修改：`src/main/i18n/locales/pt-pt.json`
- 修改：`src/main/i18n/locales/ro-ro.json`
- 修改：`src/main/i18n/locales/ru-ru.json`
- 修改：`src/main/i18n/locales/vi-vn.json`
- 修改：`src/main/i18n/locales/zh-cn.json`
- 修改：`src/main/i18n/locales/zh-tw.json`
- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`
- 修改：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`

- [ ] **步骤 1：新增失败的快照合同测试**

让主进程测试的 `t` mock 接受 count options，并对新 key 产生可断言文本：

```ts
t: (key: string, options?: { count?: number }) => {
  const fallback: Record<string, string> = {
    'agent.session.new': 'New task',
    'chat.conversation.new': 'New Chat'
  }
  if (key === 'conversation_island.activity_count') return `Total: ${options?.count}${mocks.i18nSuffix}`
  return `${fallback[key] ?? key}${mocks.i18nSuffix}`
}
```

给 hoisted mocks 增加 `animationSettingsError`，并让现有 Electron mock 在它存在时抛错；`beforeEach()` 重置为 `undefined`：

```ts
animationSettingsError: undefined as Error | undefined,

getAnimationSettings: () => {
  if (mocks.animationSettingsError) throw mocks.animationSettingsError
  return {
    shouldRenderRichAnimation: true,
    scrollAnimationsEnabledBySystem: true,
    prefersReducedMotion: mocks.prefersReducedMotion
  }
}
```

在两条活动的快照测试中增加：

```ts
expect(latestSnapshot()).toMatchObject({
  activityCountText: 'Total: 2',
  exiting: false,
  reducedMotion: false
})
```

另加 reduced-motion 与异常兜底测试：

```ts
it.each([
  { setting: true, expected: true },
  { setting: false, expected: false }
])('projects reduced motion $setting into the renderer snapshot', ({ setting, expected }) => {
  mocks.prefersReducedMotion = setting
  emitActivity('pending', 100)
  expect(latestSnapshot()).toMatchObject({ reducedMotion: expected })
})

it('falls back to no animation when Electron animation settings cannot be read', () => {
  mocks.animationSettingsError = new Error('settings unavailable')
  emitActivity('pending', 100)
  expect(latestSnapshot()).toMatchObject({ reducedMotion: true })
})
```

这些测试能捕获 renderer 自行推断系统状态、count 未本地化以及异常时误启动动画。

- [ ] **步骤 2：运行 RED 测试**

```bash
pnpm test src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：新字段断言失败，现有展示、排序、hover 展开和 awaiting-confirmation 合同保持通过。

- [ ] **步骤 3：扩展共享快照类型**

在 `ConversationIslandSnapshot` 增加三个必填展示字段：

```ts
export interface ConversationIslandSnapshot extends ConversationIslandActivityItem {
  activityCountText: string
  secondaryCount: number
  presentation: 'notch' | 'capsule'
  notchWidth?: number
  expanded: boolean
  exiting: boolean
  reducedMotion: boolean
  activities?: ConversationIslandActivityItem[]
}
```

保持 icon 类型不进入 shared；renderer 可直接从现有 `target.conversationType` 推导。

- [ ] **步骤 4：添加并翻译 main locale 文案**

先在 `en-us.json` 的 `conversation_island` 下添加：

```json
"activity_count": "Total: {{count}}"
```

随后同步并填写全部 locale，不留下占位符：

| Locale | 文案 |
| --- | --- |
| de-de | `Gesamt: {{count}}` |
| el-gr | `Σύνολο: {{count}}` |
| en-us | `Total: {{count}}` |
| es-es | `Total: {{count}}` |
| fr-fr | `Total : {{count}}` |
| ja-jp | `合計 {{count}} 件` |
| pt-pt | `Total: {{count}}` |
| ro-ro | `Total: {{count}}` |
| ru-ru | `Всего: {{count}}` |
| vi-vn | `Tổng: {{count}}` |
| zh-cn | `共 {{count}} 项` |
| zh-tw | `共 {{count}} 項` |

```bash
pnpm i18n:sync
```

- [ ] **步骤 5：由 service 构造权威展示字段**

把系统设置读取收敛成安全 helper：

```ts
private prefersReducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion
  } catch {
    return true
  }
}
```

在 `buildSnapshot()` 中一次性计算总数并投影：

```ts
const activityCount = secondaryCount + 1

return {
  ...primary,
  activityCountText: t('conversation_island.activity_count', { count: activityCount }),
  secondaryCount,
  presentation,
  notchWidth,
  expanded,
  exiting: false,
  reducedMotion: this.prefersReducedMotion(),
  activities
}
```

窗口 bounds 动画必须复用同一快照状态，避免 main 与 renderer 对 reduced-motion 判断分叉：

```ts
window.setBounds(bounds, isInitial ? false : !snapshot.reducedMotion)
```

- [ ] **步骤 6：修复 renderer 测试 fixture 的必填字段**

```ts
const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  ...activity,
  activityCountText: 'Total: 1',
  secondaryCount: 0,
  presentation: 'capsule',
  expanded: false,
  exiting: false,
  reducedMotion: false,
  ...overrides
})
```

- [ ] **步骤 7：运行 GREEN、类型和 i18n 检查**

```bash
pnpm test src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
pnpm typecheck:node
pnpm typecheck:web
pnpm i18n:check
git diff --check
```

预期：focused tests、两端 typecheck 和 i18n 全部通过。

- [ ] **步骤 8：只提交本任务 hunk**

先暂存 clean files；对两个受保护 service 文件只用交互式 staging：

```bash
git add src/shared/types/conversationIsland.ts src/main/i18n/locales/*.json \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git add -p src/main/services/conversationIsland/ConversationIslandService.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git diff --cached
git commit -S --signoff -m "feat(conversation-island): describe motion presentation"
```

预期 cached diff 不包含 NotificationService、Cache 迁移或 `awaitingApprovalAnchors` 的所有权变化。

## 任务 3：实现可取消的正常退场

**文件：**

- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`

- [ ] **步骤 1：新增退场时序合同测试**

使用现有 fake timers 和 window push mock 覆盖四个行为：

```ts
it('publishes an exit snapshot and closes after 180 ms when normal activity exhausts', async () => {
  emitActivity('pending', 100)
  emitActivity(null, 200)

  expect(latestSnapshot()).toMatchObject({ exiting: true })
  expect(services.windowManager.close).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(179)
  expect(services.windowManager.close).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(services.windowManager.close).toHaveBeenCalledWith(expect.any(String))
})

it('cancels exit and reuses the window when a new activity arrives', async () => {
  emitActivity('pending', 100, 'topic-1')
  emitActivity(null, 200, 'topic-1')
  emitActivity('pending', 250, 'topic-2')

  expect(latestSnapshot()).toMatchObject({ activityId: 'topic-2', exiting: false })
  expect(services.windowManager.open).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(180)
  expect(services.windowManager.close).not.toHaveBeenCalled()
})

it('closes normal exhaustion immediately when reduced motion is enabled', () => {
  mocks.prefersReducedMotion = true
  emitActivity('pending', 100)
  emitActivity(null, 200)
  expect(services.windowManager.close).toHaveBeenCalledWith(expect.any(String))
})

it.each(['disabled', 'stopped', 'invalid-window'] as const)(
  'uses immediate close for the %s safety path',
  async (path) => {
    // Drive the existing preference, lifecycle, or destroyed-window fixture.
    // Assert no exiting snapshot/timer survives the forced close.
  }
)
```

同时把“失败 compact TTL 后关闭”的旧测试更新为：TTL 到期后先发 `exiting: true`，再等待 180ms 关闭。测试抓的是用户可见合同，而不是 timer 被调用次数。

- [ ] **步骤 2：运行 RED 测试**

```bash
pnpm test src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：延迟关闭、取消退场和 exit snapshot 断言失败；即时生命周期安全用例仍通过或仅需适配新断言。

- [ ] **步骤 3：增加最小退场状态**

在 service 内维护：

```ts
const EXIT_ANIMATION_MS = 180

private exitTimer: ReturnType<typeof setTimeout> | null = null
private lastSnapshot: ConversationIslandSnapshot | null = null
```

实现三个窄 helper：

```ts
private clearExitTimer(): void {
  if (this.exitTimer !== null) clearTimeout(this.exitTimer)
  this.exitTimer = null
}

private beginExit(): void {
  const snapshot = this.lastSnapshot
  const windowId = this.windowId
  if (!windowId || !snapshot || snapshot.reducedMotion) {
    this.closeIslandWindow()
    return
  }

  const windowManager = application.get('WindowManager')
  const window = windowManager.getWindow(windowId)
  if (!window || window.isDestroyed() || !windowManager.pushInitData(windowId, { ...snapshot, exiting: true })) {
    this.closeIslandWindow()
    return
  }

  this.clearExitTimer()
  this.exitTimer = setTimeout(() => {
    this.exitTimer = null
    if (this.windowId === windowId) this.closeIslandWindow()
  }, EXIT_ANIMATION_MS)
  this.exitTimer.unref()
}

private cancelExit(): void {
  this.clearExitTimer()
}
```

继续使用现有 `WindowManager.pushInitData()`，不复制 channel 字符串或访问 `webContents`。`beginExit()` 发送失败时立即关闭。

- [ ] **步骤 4：接入正常与强制路径**

- `showOrUpdateWindow(snapshot)` 开头调用 `cancelExit()`；成功展示后保存 `lastSnapshot = snapshot`。
- 活动耗尽和失败活动 TTL 清除后，通过 `beginExit()`，不直接 close。
- 新活动复用同一 `windowId`，推送 `exiting: false` 快照并清掉旧 timer。
- preference 禁用、`onDeactivate()`、`onStop()`、窗口 destroyed/invalid、`open()` 或 init-data 发送失败：调用即时 `closeIslandWindow()`。
- `closeIslandWindow()` 必须先 `clearExitTimer()`，再清 `lastSnapshot`、expanded state 和 window id。
- destroyed callback 只清理与当前 window id 相符的状态，旧 timer 永远不能关闭替代窗口。

- [ ] **步骤 5：运行 GREEN 与 main 类型检查**

```bash
pnpm test src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
pnpm typecheck:node
pnpm exec biome check src/main/services/conversationIsland/ConversationIslandService.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git diff --check
```

预期：所有正常、取消、reduced-motion 与强制关闭路径通过。

- [ ] **步骤 6：只提交退场 hunk**

```bash
git add -p src/main/services/conversationIsland/ConversationIslandService.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git diff --cached
git commit -S --signoff -m "feat(conversation-island): animate normal dismissal"
```

## 任务 4：在展开刘海两侧展示活动信息

**文件：**

- 修改：`src/renderer/windows/conversationIsland/ConversationIsland.tsx`
- 修改：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`

- [ ] **步骤 1：先写肩部可见合同**

新增 expanded notch 测试：

```tsx
it.each([
  { conversationType: 'assistant' as const, icon: 'assistant' },
  { conversationType: 'agent' as const, icon: 'agent' }
])('shows $conversationType identity and status in the left notch shoulder', ({ conversationType, icon }) => {
  renderIsland(
    snapshot({
      presentation: 'notch',
      notchWidth: 180,
      expanded: true,
      target: { conversationType, conversationId: 'conversation-1' },
      activities: [activity]
    })
  )

  expect(screen.getByTestId('notch-expanded-leading')).toHaveTextContent(activity.statusText)
  expect(screen.getByTestId('notch-activity-icon')).toHaveAttribute('data-conversation-type', icon)
})

it('shows the localized total in the right shoulder and keeps capsule unchanged', () => {
  const { rerender } = renderIsland(
    snapshot({
      presentation: 'notch',
      notchWidth: 180,
      expanded: true,
      activityCountText: 'Total: 2',
      secondaryCount: 1,
      activities: [activity, secondaryActivity]
    })
  )
  expect(screen.getByTestId('notch-expanded-trailing')).toHaveTextContent('Total: 2')

  rerenderIsland(rerender, snapshot({ presentation: 'capsule', expanded: true, activities: [activity] }))
  expect(screen.queryByTestId('notch-expanded-header')).not.toBeInTheDocument()
})
```

这些测试能捕获 compact/capsule 被误改、图标类型混淆和总数在 renderer 硬编码。

- [ ] **步骤 2：运行 RED 测试**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

预期：三个新 header/test-id 查询失败；现有 23 个 hover、点击和列表合同通过。

- [ ] **步骤 3：实现固定 38px 展开肩部**

从 `lucide-react` 引入 `Bot` 与 `MessageCircle`，只在 `usesNotchLayout && snapshot.expanded` 时渲染：

```tsx
const ActivityIcon = snapshot.target.conversationType === 'agent' ? Bot : MessageCircle

<div
  data-testid="notch-expanded-header"
  className="grid h-[38px] w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] text-xs">
  <span
    data-testid="notch-expanded-leading"
    className="flex min-w-0 items-center gap-1.5 overflow-hidden pl-3">
    <ActivityIcon
      data-testid="notch-activity-icon"
      data-conversation-type={snapshot.target.conversationType}
      className="size-3.5 shrink-0 text-white/70"
      aria-hidden="true"
    />
    {stateIndicator(snapshot.state)}
    <span className="min-w-0 truncate font-medium">{snapshot.statusText}</span>
  </span>
  <span aria-hidden="true" style={{ width: snapshot.notchWidth }} />
  <span
    data-testid="notch-expanded-trailing"
    className="flex min-w-0 items-center justify-end overflow-hidden pr-3 text-white/60">
    <span className="truncate">{snapshot.activityCountText}</span>
  </span>
</div>
```

从 expanded notch root 删除 `pt-[38px]`；header 占有真实 38px，紧随其后的 list 保持 `max-h-[220px] overflow-y-auto`。capsule root 继续使用现有 `p-2`，compact notch 分支不变。

- [ ] **步骤 4：运行 GREEN 与 renderer 类型检查**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
pnpm typecheck:web
pnpm exec biome check src/renderer/windows/conversationIsland/ConversationIsland.tsx \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git diff --check
```

预期：肩部合同和全部原 hover/click 测试通过。

- [ ] **步骤 5：提交肩部布局**

```bash
git add src/renderer/windows/conversationIsland/ConversationIsland.tsx \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git diff --cached
git commit -S --signoff -m "feat(conversation-island): populate expanded notch shoulders"
```

## 任务 5：实现顶部中心弹簧与快速退场

**文件：**

- 新增：`src/renderer/windows/conversationIsland/conversationIslandMotion.ts`
- 新增：`src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts`
- 修改：`src/renderer/windows/conversationIsland/ConversationIsland.tsx`
- 修改：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`

- [ ] **步骤 1：为已批准的动效参数写纯合同测试**

```ts
import { resolveConversationIslandMotion } from '../conversationIslandMotion'

describe('resolveConversationIslandMotion', () => {
  it('enters from the top center with the approved spring', () => {
    expect(resolveConversationIslandMotion({ exiting: false, reducedMotion: false })).toEqual({
      initial: { opacity: 0, scaleX: 0.9, scaleY: 0.72 },
      animate: { opacity: 1, scaleX: 1, scaleY: 1 },
      transition: { type: 'spring', stiffness: 224, damping: 25, mass: 1 }
    })
  })

  it('uses a faster 180 ms ease-in exit', () => {
    expect(resolveConversationIslandMotion({ exiting: true, reducedMotion: false })).toEqual({
      initial: false,
      animate: { opacity: 0, scaleX: 0.96, scaleY: 0.82 },
      transition: { duration: 0.18, ease: [0.4, 0, 1, 1] }
    })
  })

  it('removes interpolation when reduced motion is authoritative', () => {
    expect(resolveConversationIslandMotion({ exiting: true, reducedMotion: true })).toEqual({
      initial: false,
      animate: { opacity: 1, scaleX: 1, scaleY: 1 },
      transition: { duration: 0 }
    })
  })
})
```

这些断言直接保护已确认的视觉规格，不从实现重新推导 expected value。

- [ ] **步骤 2：运行 motion RED 测试**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts
```

预期：模块不存在，suite 失败。

- [ ] **步骤 3：实现窄动效解析器**

```ts
import type { TargetAndTransition, Transition } from 'motion/react'

interface ConversationIslandMotionInput {
  exiting: boolean
  reducedMotion: boolean
}

interface ConversationIslandMotionPlan {
  initial: false | TargetAndTransition
  animate: TargetAndTransition
  transition: Transition
}

const VISIBLE = { opacity: 1, scaleX: 1, scaleY: 1 }

export function resolveConversationIslandMotion({
  exiting,
  reducedMotion
}: ConversationIslandMotionInput): ConversationIslandMotionPlan {
  if (reducedMotion) return { initial: false, animate: VISIBLE, transition: { duration: 0 } }
  if (exiting) {
    return {
      initial: false,
      animate: { opacity: 0, scaleX: 0.96, scaleY: 0.82 },
      transition: { duration: 0.18, ease: [0.4, 0, 1, 1] }
    }
  }
  return {
    initial: { opacity: 0, scaleX: 0.9, scaleY: 0.72 },
    animate: VISIBLE,
    transition: { type: 'spring', stiffness: 224, damping: 25, mass: 1 }
  }
}
```

如 Motion 的 tuple 类型要求，把 ease 显式声明为四元组；不得通过 `as any` 绕过类型。

- [ ] **步骤 4：运行 motion GREEN 测试**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts
```

预期：3/3 通过。

- [ ] **步骤 5：先添加退出态交互失败测试**

沿用仓库 `RightPaneHost.test.tsx` 的第三方动效测试模式，在组件测试中让 `AnimatePresence` 同步透传，并把 motion props 暴露为 data attributes；这避免 jsdom 留下正在退场的重复 DOM，同时纯 helper 测试仍保护真实参数：

```tsx
type MotionDivProps = {
  animate?: unknown
  children?: ReactNode
  exit?: unknown
  initial?: unknown
  layout?: unknown
  transition?: unknown
  [key: string]: unknown
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ animate, children, exit, initial, layout, transition, ...props }: MotionDivProps) => (
      <div
        {...props}
        data-animate={JSON.stringify(animate)}
        data-initial={JSON.stringify(initial)}
        data-transition={JSON.stringify(transition)}>
        {children}
      </div>
    )
  }
}))
```

在组件测试加入：

```tsx
it('clears hover work and disables activity actions while exiting', async () => {
  vi.useFakeTimers()
  renderIsland(
    snapshot({
      expanded: true,
      exiting: true,
      secondaryCount: 1,
      activities: [activity, secondaryActivity]
    })
  )

  const surface = screen.getByTestId('conversation-island-surface')
  expect(surface).toHaveAttribute('aria-hidden', 'true')
  for (const button of screen.getAllByRole('button', { hidden: true })) expect(button).toBeDisabled()
  expect(screen.getByTestId('conversation-island-motion')).toHaveAttribute(
    'data-animate',
    JSON.stringify({ opacity: 0, scaleX: 0.96, scaleY: 0.82 })
  )

  fireEvent.pointerEnter(surface)
  await vi.advanceTimersByTimeAsync(500)
  expect(mocks.request).not.toHaveBeenCalledWith('conversation_island.set_expanded', expect.anything())
})
```

另加 compact exit 的 disabled click 断言，确保程序化点击也不会触发 navigation IPC。

- [ ] **步骤 6：运行组件 RED 测试**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

预期：`aria-hidden`、disabled 和 hover timer 合同失败。

- [ ] **步骤 7：把 Motion 接到唯一 surface wrapper**

```tsx
import { AnimatePresence, motion } from 'motion/react'
import { resolveConversationIslandMotion } from './conversationIslandMotion'

const motionPlan = resolveConversationIslandMotion({
  exiting: snapshot.exiting,
  reducedMotion: snapshot.reducedMotion
})

return (
  <motion.div
    data-testid="conversation-island-motion"
    initial={motionPlan.initial}
    animate={motionPlan.animate}
    transition={motionPlan.transition}
    style={{ transformOrigin: '50% 0%' }}
    className="h-full w-full">
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={snapshot.expanded ? 'expanded' : 'compact'}
        layout={!snapshot.reducedMotion}
        initial={snapshot.reducedMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={snapshot.reducedMotion ? undefined : { opacity: 0, scale: 0.98 }}
        transition={snapshot.reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 224, damping: 25, mass: 1 }}
        className="h-full w-full">
        {surface}
      </motion.div>
    </AnimatePresence>
  </motion.div>
)
```

把当前 expanded/compact 两个顶层 return 收敛为一个局部 `surface`，不抽成公共组件。必须保留原 DOM role、test id、class 和事件语义。

当 `snapshot.exiting` 为 true：

- effect 立即清空 expand/collapse timer；
- pointer enter/leave handler 直接返回；
- compact Button 与 expanded activity Button 使用 `disabled`；
- surface 设置 `aria-hidden="true"` 和 `pointer-events-none`；
- 不发送 collapse、expand 或 navigation IPC。

当 reduced motion 为 true，outer 与 keyed content 均不插值；main 会同步立即关闭，所以 renderer 只需提供无动画安全状态。

- [ ] **步骤 8：运行 renderer GREEN 与静态检查**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
pnpm typecheck:web
pnpm exec biome check src/renderer/windows/conversationIsland/conversationIslandMotion.ts \
  src/renderer/windows/conversationIsland/ConversationIsland.tsx \
  src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git diff --check
```

预期：motion 3 个合同、组件全部交互合同、typecheck 和 Biome 通过。

- [ ] **步骤 9：提交 renderer 动效**

```bash
git add src/renderer/windows/conversationIsland/conversationIslandMotion.ts \
  src/renderer/windows/conversationIsland/ConversationIsland.tsx \
  src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git diff --cached
git commit -S --signoff -m "feat(conversation-island): animate island presentation"
```

## 任务 6：集中验证、运行时验收和提交完整性

**文件：** 无预期生产修改；若验证发现缺陷，回到对应任务补 RED 测试后修复。

- [ ] **步骤 1：运行全部相关测试**

```bash
pnpm test \
  src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts \
  src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts \
  src/main/ipc/handlers/__tests__/conversationIslandHandler.test.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts \
  src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx \
  src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
```

预期：全部通过，无 timeout、unhandled rejection 或悬空 timer。

- [ ] **步骤 2：运行仓库级验证**

本功能修改 shared contract、main 生命周期和 renderer，因此按高风险范围运行完整 gate：

```bash
pnpm test:lint
pnpm build:check
```

预期：两个命令 exit 0。`pnpm build:check` 内含 lint、docs gate 和 full test；lint 会写入格式，若产生与本功能无关的修改，停止并恢复其所有权，而不是顺手提交。

- [ ] **步骤 3：在 tracked Electron 实例验收 UI**

按 `cherry-electron-dev` skill 读取实例参考，复用或重启 tracked app（main 代码已修改，必须重启）。只通过开发工具调用现有 service 的活动输入边界构造临时 Assistant/Agent 活动，不写数据库或持久 Cache。

验证矩阵：

| 场景 | 期望 |
| --- | --- |
| 单活动 compact notch | 仍为 `320×38`，肩部布局与点击行为不变 |
| 两活动 hover 500ms | 原中心向左右、向下扩到 `420×126` |
| 五活动 | `420×258`，最后一行贴底，无 8px 黑色空带 |
| 六活动 | 高度仍 `258`，列表可滚动 |
| Assistant primary | 左肩 MessageCircle + 状态点 + 本地化状态 |
| Agent primary | 左肩 Bot + 状态点 + 本地化状态 |
| 展开刘海右肩 | 显示本地化总数，不出现按钮 |
| pointer leave 250ms | bounds 与内容弹簧回 compact，不闪白、不抖动 |
| 正常最后活动移除 | 先播放约 180ms 顶部中心退场，再关闭窗口 |
| 退场 180ms 内新活动 | 取消关闭、复用同一窗口并恢复可见 |
| 禁用/服务停止 | 立即关闭，不等待 180ms |

保存至少 compact、两活动 expanded、五活动贴底三张截图到临时目录；截图只用于验收，不提交仓库。

- [ ] **步骤 4：做一次集中自审**

只审本计划新增提交相对实施起点的 diff：

在实施前状态中记录开始实现时的确切 HEAD 为 `MOTION_BASE_SHA`，然后运行：

```bash
git diff MOTION_BASE_SHA...HEAD -- \
  src/main/services/conversationIsland \
  src/shared/types/conversationIsland.ts \
  src/main/i18n/locales \
  src/renderer/windows/conversationIsland
```

逐项确认：

- 正常退场与强制关闭边界没有混淆；
- 老 timer 不能关闭新 window id；
- `activityCountText` 在 main 本地化，icon 只在 renderer 推导；
- compact/capsule 和既有 hover/fresh-reentry 合同未漂移；
- 没有 NotificationService、IPC、Preference 或 WindowManager 扩张；
- 没有重复动画状态源、未清理 timer 或无意义抽象。

- [ ] **步骤 5：核对所有提交签名、DCO 与工作区所有权**

```bash
git log --format='%h %s%n%b' MOTION_BASE_SHA..HEAD
for commit in $(git rev-list MOTION_BASE_SHA..HEAD); do
  git cat-file commit "$commit" | rg -q '^gpgsig '
  git show -s --format=%B "$commit" | rg -q '^Signed-off-by: '
done
git status --short
```

预期：每个实现提交都有 `gpgsig` 和 `Signed-off-by`；最终 status 只保留实施前已记录且未被所有者提交的平台隔离改动，不出现新的未跟踪或未提交 motion 文件。

## 规格覆盖自检

- “多条消息底部不要留有下边距” → 任务 1 的 `38 + min(count, 5) × 44` 和任务 6 的五行截图。
- “刘海屏左右侧展示 icon 或其他信息” → 任务 4 的 Assistant/Agent 图标、状态点/状态文本、总数与 capsule 隔离测试。
- “出现和消失仿照 Cindy 添加动画” → 任务 2 的权威 reduced-motion、任务 3 的 180ms 可取消关闭、任务 5 的顶部中心弹簧与 crossfade、任务 6 的运行时时序。
- 既有 hover/点击/滚动行为 → 任务 4/5 focused tests 与任务 6 回归矩阵。
- 架构边界 → main 管关闭与状态，renderer 管视觉，未扩通用 IPC/WindowManager/Preference。

## 占位符与类型一致性检查

实现结束前运行：

```bash
rg -n "TODO|FIXME|to be translated|as any" \
  src/main/services/conversationIsland \
  src/shared/types/conversationIsland.ts \
  src/main/i18n/locales \
  src/renderer/windows/conversationIsland
pnpm typecheck:node
pnpm typecheck:web
```

预期：不新增 placeholder 或 `as any`；共享快照在 main producer 与 renderer consumer 两端同时通过类型检查。
