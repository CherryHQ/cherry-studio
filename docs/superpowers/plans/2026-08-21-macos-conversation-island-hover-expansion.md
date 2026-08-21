# macOS 对话灵动岛悬停展开实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 保留现有紧凑 Conversation Island，在至少两个活动时经 500 ms 悬停将同一窗口展开成最多五行可见的稳定活动列表，离开 250 ms 后收起，并彻底移除 `show_title` 偏好。

**架构：** Renderer 只解释指针事件、维护悬停/离开计时器和点击后的重新进入锁，再发送 `conversation_island.set_expanded({ expanded })` 语义命令。主进程验证命令来自当前 Conversation Island 窗口，持有权威展开状态、冻结顺序/显示器、标题快照和窗口 bounds；现有 singleton `BrowserWindow` 原位横向居中、向下扩缩，不扩展 WindowManager 或 preload 公共契约。

**技术栈：** Electron 41、TypeScript、React、Vitest、Testing Library、`@cherrystudio/ui`、Tailwind CSS、IpcApi、Preference、WindowManager、JXA/AppKit。

---

## 实施前约束

- 以 [`macOS Conversation Island Design`](../specs/2026-08-21-macos-conversation-island-design.md) 为唯一产品与架构依据；两份旧 Conversation Island 计划只作历史记录。
- 当前工作区已有用户未提交改动：`ConversationIslandService.ts` 根据 `awaitingApprovalAnchors` 映射“等待确认”，对应测试也未提交。必须保留；除非用户明确授权，否则所有触及这两个文件的提交都用选择性暂存排除原有 hunks。若 planned edit 与原有 hunk 重叠到无法安全拆分，停止并请求用户决定，不得重写或顺带提交。
- 开始实现前重新阅读 `DESIGN.md`、`docs/references/testing/frontend-testing.md`、`docs/references/ipc/README.md`、`docs/references/window-manager/README.md`、`docs/references/data/preference-overview.md`，以及每个待编辑目录向上的 `README.md`。
- 不修改 `AiStreamManager`、`CacheService`、`NotificationService` 的既有事件契约、WindowManager API、通用 `window.*` IPC、preload、DataApi、数据库或迁移。
- 不添加消息正文、工具详情、inline approval、声音、pin、键盘展开、全局鼠标监听、第二个窗口或预分配透明大窗口。
- 新 UI 继续使用 `@cherrystudio/ui` 的 `Button`，用户可见字符串继续来自 main i18n；展开列表不新增 renderer 文案。
- 每个提交使用 `git commit -S --signoff`，并用 `git cat-file commit HEAD | rg '^gpgsig '` 验证签名。
- 仅运行受影响测试、`pnpm lint` 和 `pnpm docs:check`；本变更范围明确，不运行全量 `pnpm test`。

## 文件职责总览

### 新增

- `src/main/services/conversationIsland/expandedActivityState.ts`：纯函数维护冻结行序、追加新活动、保留过期终态和移除失效目标。
- `src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts`：保护展开结构稳定性。
- `src/shared/ipc/schemas/conversationIsland.ts`：声明唯一的 `set_expanded` 请求。
- `src/main/ipc/handlers/conversationIsland.ts`：验证 sender 类型并委托生命周期服务。
- `src/main/ipc/handlers/__tests__/conversationIsland.test.ts`：保护 IPC 能力边界。

### 修改

- `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`：删除 branch-only `show_title` 定义。
- `src/shared/data/preference/preferenceSchemas.ts`：由生成器删除 `show_title` 类型与默认值，禁止手改。
- `src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx`：只保留一个 macOS enable 开关。
- `src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx`：删除标题开关行为，继续保护平台 gate 和 enable 写入。
- `src/renderer/i18n/locales/*.json`：通过 `pnpm i18n:sync` 删除标题设置文案。
- `src/shared/types/conversationIsland.ts`：抽出活动行类型，并给 snapshot 增加权威展开模式和有序行。
- `src/main/services/conversationIsland/activityReducer.ts`：提供确定性的 eligible 排序，并允许展开态指定保留 ID。
- `src/main/services/conversationIsland/__tests__/activityReducer.test.ts`：保护排序、正常过期与保留集合边界。
- `src/main/services/conversationIsland/macScreenGeometry.ts`：接受明确 size，并计算 2–5 行的 compact/notch/capsule bounds。
- `src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts`：保护水平中心、顶部锚定和高度上限。
- `src/main/services/conversationIsland/ConversationIslandService.ts`：持有冻结状态、标题列表、动态 bounds、reduced motion 和失败回退。
- `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`：覆盖跨模块主流程和资源清理。
- `src/shared/ipc/schemas/ipcSchemas.ts`、`src/main/ipc/handlers/ipcHandlers.ts`：分别聚合 schema 与 handler。
- `src/renderer/windows/conversationIsland/ConversationIsland.tsx`：实现 compact/expanded 两种表面和指针计时。
- `src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`：用 fake timers 保护用户交互和导航顺序。

### 明确不修改

- `src/main/core/window/windowRegistry.ts`：保留 `resizable: false`；这只禁止用户拖动，main 仍可调用 `setBounds`。
- `src/preload/conversationIsland.ts`：继续只暴露通用 IpcApi bridge。
- `electron.vite.config.ts`、`src/main/core/window/types.ts`：窗口与构建入口已经存在。

## 任务 1：删除标题偏好并固定展示标题

**文件：**
- 修改：`src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx:24-71`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts:220-416`
- 修改：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx:26-147`
- 修改：`v2-refactor-temp/tools/data-classify/data/target-key-definitions.json:79-92`
- 生成：`src/shared/data/preference/preferenceSchemas.ts`
- 修改：`src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx:1-109`
- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts:72-120,279-305`
- 修改：`src/shared/types/conversationIsland.ts:1-15`
- 修改：`src/renderer/windows/conversationIsland/ConversationIsland.tsx:34-88`
- 修改：`src/renderer/i18n/locales/en-us.json:6248-6251`
- 生成：其余 `src/renderer/i18n/locales/*.json`

- [ ] **步骤 1：把单开关与固定标题契约写成失败测试**

将设置测试收敛为两个行为：macOS 只显示 enable，其他平台不显示该组。

```tsx
const enabledSwitch = () => screen.getByRole('switch', { name: 'settings.notification.conversation_island.enabled' })

describe('NotificationSettings Conversation Island preference', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.conversation_island.enabled', false)
    platform.isMac = true
  })

  it('persists the macOS-only enable switch', async () => {
    const user = userEvent.setup()
    render(<NotificationSettings />)
    const switchCount = screen.getAllByRole('switch').length

    await user.click(enabledSwitch())

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.conversation_island.enabled')).toBe(true)
    )
    expect(screen.getAllByRole('switch')).toHaveLength(switchCount)
  })

  it('does not expose Conversation Island settings off macOS', () => {
    platform.isMac = false
    render(<NotificationSettings />)

    expect(screen.queryByRole('switch', { name: 'settings.notification.conversation_island.enabled' })).toBeNull()
  })
})
```

在 service 测试中删除“关闭标题时不查询”的旧用例，把语言切换用例改成固定标题：

```ts
it('always resolves a title and refreshes it with localized text when language changes', () => {
  changePreference('feature.conversation_island.enabled', true)
  emitActivity('streaming', 100)

  expect(mocks.resolveName).toHaveBeenCalledOnce()
  expect(services.windowManager.open.mock.calls[0][1]).toMatchObject({
    initData: { title: 'Research notes', state: 'streaming' }
  })

  mocks.name = 'Notes translated'
  mocks.i18nSuffix = '-fr'
  changePreference('app.language', 'fr-FR')

  expect(mocks.resolveName).toHaveBeenCalledTimes(2)
  expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
    title: 'Notes translated',
    statusText: 'conversation_island.status.assistant.streaming-fr'
  })
})
```

在 renderer fixture 中令 `title` 必填并删除 `navigationTitle`，点击断言改为使用同一标题：

```ts
const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  activityId: 'topic-1',
  target: { conversationType: 'assistant', conversationId: 'topic-1' },
  state: 'streaming',
  statusText: 'Responding',
  title: 'Research notes',
  secondaryCount: 0,
  presentation: 'capsule',
  ...overrides
})
```

- [ ] **步骤 2：运行测试验证旧行为失败**

运行：

```bash
pnpm test src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：FAIL；当前设置页仍渲染 title switch，shared snapshot 仍要求 `navigationTitle`，service 仍读取 `show_title`。

- [ ] **步骤 3：删除偏好源并重新生成 schema**

从 `target-key-definitions.json` 删除整个 `feature.conversation_island.show_title` 对象，仅保留 enable 定义，然后运行：

```bash
cd v2-refactor-temp/tools/data-classify
npm run generate:preferences
```

预期：`src/shared/data/preference/preferenceSchemas.ts` 的类型与默认值中都只剩 `feature.conversation_island.enabled`。

- [ ] **步骤 4：删除设置文案并同步所有 locale**

从 `src/renderer/i18n/locales/en-us.json` 删除：

```json
"show_title": "Show conversation title"
```

运行：

```bash
pnpm i18n:sync
```

预期：所有 renderer locale 的 `conversation_island` 对象只含 `enabled`。

- [ ] **步骤 5：把设置页改为单 Preference consumer**

将 import 和状态改为：

```tsx
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'

const [conversationIslandEnabled, setConversationIslandEnabled] = usePreference(
  'feature.conversation_island.enabled'
)
```

macOS 分支只保留：

```tsx
{isMac && (
  <>
    <SettingDivider />
    <SettingRow>
      <SettingRowTitle>{t('settings.notification.conversation_island.enabled')}</SettingRowTitle>
      <Switch
        aria-label={t('settings.notification.conversation_island.enabled')}
        checked={conversationIslandEnabled}
        onCheckedChange={(enabled) => void setConversationIslandEnabled(enabled)}
      />
    </SettingRow>
  </>
)}
```

- [ ] **步骤 6：令 snapshot 标题必填并删除导航标题副本**

把 shared 类型改为：

```ts
import type { ConversationNavigationTarget } from './navigation'

export type ConversationIslandStateKind = 'pending' | 'streaming' | 'awaiting-confirmation' | 'done' | 'error'

export interface ConversationIslandSnapshot {
  activityId: string
  target: ConversationNavigationTarget
  state: ConversationIslandStateKind
  statusText: string
  title: string
  secondaryCount: number
  presentation: 'notch' | 'capsule'
  notchWidth?: number
}
```

删除 service 的 `showTitle` 字段和订阅。`buildSnapshot()` 总是按 turn 缓存并解析标题：

```ts
const fallback = activity.target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
const cached = this.titleCache.get(activity.topicId)
let title = cached && cached.turnId === activity.turnId ? cached.title : undefined
if (title === undefined) {
  title = application.get('NotificationService').resolveConversationName(activity.target) || fallback
  this.titleCache.set(activity.topicId, { turnId: activity.turnId, title })
}

return {
  activityId: activity.topicId,
  target: activity.target,
  state: snapshotState(activity.status),
  statusText: statusText(activity),
  title,
  secondaryCount,
  presentation: placement.presentation,
  notchWidth: placement.notchWidth
}
```

Renderer 的导航请求使用 `snapshot.title`，compact 两个布局都无条件渲染经过 fallback 的标题。

- [ ] **步骤 7：运行聚焦测试与引用扫描**

运行：

```bash
pnpm test src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
rg -n "feature\.conversation_island\.show_title|conversation_island\.show_title|navigationTitle" src v2-refactor-temp/tools/data-classify/data/target-key-definitions.json
```

预期：测试 PASS；`rg` 无输出。用户已有 `awaitingApprovalAnchors` 测试也必须继续通过。

- [ ] **步骤 8：提交偏好清理**

先确认用户 hunks 仍存在：

```bash
git diff -- src/main/services/conversationIsland/ConversationIslandService.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

暂存所有无冲突文件；对上述两个文件使用 `git add -p`，只选择本任务删除 `show_title` 与固定标题的 hunks。然后运行：

```bash
git commit -S --signoff -m "refactor(conversation-island): remove title preference"
git cat-file commit HEAD | rg '^gpgsig '
```

预期：提交成功且显示 `gpgsig`；原有等待确认 hunks 仍是未暂存改动。

## 任务 2：实现纯展开结构冻结

**文件：**
- 修改：`src/main/services/conversationIsland/activityReducer.ts:27-94`
- 修改：`src/main/services/conversationIsland/__tests__/activityReducer.test.ts:1-120`
- 创建：`src/main/services/conversationIsland/expandedActivityState.ts`
- 创建：`src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts`

- [ ] **步骤 1：为排序、保留和追加写失败测试**

新增 reducer 测试，证明正常 compact 选择仍会清除过期项，但 retained ID 可继续列出：

```ts
it('orders eligible activities by priority, recency, and stable topic id', () => {
  const activities = state()
  reduceActivities(activities, update('topic-b', 'streaming', 100))
  reduceActivities(activities, update('topic-a', 'streaming', 100))
  reduceActivities(activities, update('topic-approval', 'awaiting-approval', 50))

  expect(selectEligibleActivities(activities, 101).map((activity) => activity.topicId)).toEqual([
    'topic-approval',
    'topic-a',
    'topic-b'
  ])
})

it('retains an expired terminal activity only when its id is frozen', () => {
  const activities = state()
  reduceActivities(activities, update('topic-done', 'done', 100))

  expect(
    selectEligibleActivities(activities, 100 + TERMINAL_TTL_MS.done, new Set(['topic-done'])).map(
      (activity) => activity.topicId
    )
  ).toEqual(['topic-done'])
  expect(selectEligibleActivities(activities, 100 + TERMINAL_TTL_MS.done).length).toBe(0)
})
```

创建 `expandedActivityState.test.ts`，覆盖完整纯状态机：

```ts
import { describe, expect, it } from 'vitest'

import { type ConversationIslandActivity } from '../activityReducer'
import {
  createExpandedActivityState,
  reconcileExpandedActivityState,
  resolveExpandedActivities
} from '../expandedActivityState'

function activity(topicId: string, changedAt: number, status: ConversationIslandActivity['status'] = 'streaming') {
  return {
    topicId,
    turnId: `${topicId}-turn`,
    target: { conversationType: 'assistant' as const, conversationId: topicId },
    status,
    changedAt,
    originDisplayId: 1,
    expiresAt: status === 'done' ? changedAt + 4_000 : undefined
  }
}

it('freezes initial order, updates in place, and appends new activity', () => {
  const activities = new Map([
    ['topic-new', activity('topic-new', 200)],
    ['topic-old', activity('topic-old', 100)]
  ])
  const frozen = createExpandedActivityState(activities, 201, 7)
  expect(frozen).toEqual({ displayId: 7, primaryActivityId: 'topic-new', activityIds: ['topic-new', 'topic-old'] })

  activities.set('topic-old', activity('topic-old', 300, 'awaiting-approval'))
  activities.set('topic-appended', activity('topic-appended', 400))
  const next = reconcileExpandedActivityState(frozen!, activities, 401)

  expect(next?.activityIds).toEqual(['topic-new', 'topic-old', 'topic-appended'])
  expect(resolveExpandedActivities(next!, activities).map((item) => item.status)).toEqual([
    'streaming',
    'awaiting-approval',
    'streaming'
  ])
})

it('retains expired terminal rows but removes aborted targets immediately', () => {
  const activities = new Map([
    ['topic-live', activity('topic-live', 100)],
    ['topic-done', activity('topic-done', 200, 'done')],
    ['topic-third', activity('topic-third', 300)]
  ])
  const frozen = createExpandedActivityState(activities, 301, 1)!

  const afterExpiry = reconcileExpandedActivityState(frozen, activities, 4_201)!
  expect(afterExpiry.activityIds).toContain('topic-done')

  activities.delete(afterExpiry.primaryActivityId)
  const afterRemoval = reconcileExpandedActivityState(afterExpiry, activities, 4_201)!
  expect(afterRemoval.primaryActivityId).toBe(afterRemoval.activityIds[0])

  activities.delete(afterRemoval.activityIds[1])
  expect(reconcileExpandedActivityState(afterRemoval, activities, 4_201)).toBeNull()
})
```

- [ ] **步骤 2：运行纯函数测试验证缺少 API**

运行：

```bash
pnpm test src/main/services/conversationIsland/__tests__/activityReducer.test.ts src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts
```

预期：FAIL；`selectEligibleActivities` 和 expanded state 模块尚不存在。

- [ ] **步骤 3：提供确定性的 eligible 列表**

在 `activityReducer.ts` 中让优先级比较可复用，并以 retained IDs 控制过期删除：

```ts
function compareActivities(a: ConversationIslandActivity, b: ConversationIslandActivity): number {
  return priority(b.status) - priority(a.status) || b.changedAt - a.changedAt || a.topicId.localeCompare(b.topicId)
}

export function selectEligibleActivities(
  activities: Map<string, ConversationIslandActivity>,
  now: number,
  retainedActivityIds: ReadonlySet<string> = new Set()
): ConversationIslandActivity[] {
  const eligible: ConversationIslandActivity[] = []
  for (const [topicId, activity] of activities) {
    const expired = activity.expiresAt !== undefined && activity.expiresAt <= now
    if (expired && !retainedActivityIds.has(topicId)) {
      activities.delete(topicId)
      continue
    }
    eligible.push(activity)
  }
  return eligible.sort(compareActivities)
}

export function selectPrimaryActivity(
  activities: Map<string, ConversationIslandActivity>,
  now: number
): ConversationActivitySelection {
  const eligible = selectEligibleActivities(activities, now)
  return { primary: eligible[0], secondaryCount: Math.max(0, eligible.length - 1) }
}
```

- [ ] **步骤 4：实现冻结状态纯函数**

创建完整文件 `expandedActivityState.ts`：

```ts
import {
  type ConversationIslandActivity,
  selectEligibleActivities
} from './activityReducer'

export interface ExpandedActivityState {
  displayId: number
  primaryActivityId: string
  activityIds: string[]
}

export function createExpandedActivityState(
  activities: Map<string, ConversationIslandActivity>,
  now: number,
  displayId: number
): ExpandedActivityState | null {
  const ordered = selectEligibleActivities(activities, now)
  if (ordered.length < 2) return null
  return {
    displayId,
    primaryActivityId: ordered[0].topicId,
    activityIds: ordered.map((activity) => activity.topicId)
  }
}

export function reconcileExpandedActivityState(
  state: ExpandedActivityState,
  activities: Map<string, ConversationIslandActivity>,
  now: number
): ExpandedActivityState | null {
  const retainedIds = new Set(state.activityIds)
  const eligible = selectEligibleActivities(activities, now, retainedIds)
  const eligibleIds = new Set(eligible.map((activity) => activity.topicId))
  const activityIds = state.activityIds.filter((activityId) => eligibleIds.has(activityId))
  const seen = new Set(activityIds)

  for (const activity of eligible) {
    if (!seen.has(activity.topicId)) {
      activityIds.push(activity.topicId)
      seen.add(activity.topicId)
    }
  }

  if (activityIds.length < 2) return null
  return {
    displayId: state.displayId,
    primaryActivityId: seen.has(state.primaryActivityId) ? state.primaryActivityId : activityIds[0],
    activityIds
  }
}

export function resolveExpandedActivities(
  state: ExpandedActivityState,
  activities: ReadonlyMap<string, ConversationIslandActivity>
): ConversationIslandActivity[] {
  return state.activityIds.flatMap((activityId) => {
    const activity = activities.get(activityId)
    return activity ? [activity] : []
  })
}
```

- [ ] **步骤 5：运行纯函数测试**

运行：

```bash
pnpm test src/main/services/conversationIsland/__tests__/activityReducer.test.ts src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts
```

预期：PASS；compact 过期仍删除，expanded retained ID 保留，顺序不因状态更新改变。

- [ ] **步骤 6：提交纯状态逻辑**

```bash
git add src/main/services/conversationIsland/activityReducer.ts src/main/services/conversationIsland/expandedActivityState.ts src/main/services/conversationIsland/__tests__/activityReducer.test.ts src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts
git commit -S --signoff -m "feat(conversation-island): freeze expanded activity order"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 3：计算 compact 与 expanded 的精确窗口 bounds

**文件：**
- 修改：`src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts:1-80`
- 修改：`src/main/services/conversationIsland/macScreenGeometry.ts:8-180`
- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts:28-30,258-271`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts:209-213,246-271,346-361`

- [ ] **步骤 1：先锁定布局尺寸和锚点**

把现有 placement 调用改为显式 size，并新增表驱动测试：

```ts
it.each([
  { presentation: 'capsule' as const, count: 1, expected: { width: 320, height: 38 } },
  { presentation: 'capsule' as const, count: 2, expected: { width: 420, height: 104 } },
  { presentation: 'capsule' as const, count: 5, expected: { width: 420, height: 236 } },
  { presentation: 'capsule' as const, count: 8, expected: { width: 420, height: 236 } },
  { presentation: 'notch' as const, count: 2, expected: { width: 420, height: 134 } },
  { presentation: 'notch' as const, count: 5, expected: { width: 420, height: 266 } },
  { presentation: 'notch' as const, count: 8, expected: { width: 420, height: 266 } }
])('resolves $presentation size for $count activities', ({ presentation, count, expected }) => {
  expect(resolveConversationIslandSize(presentation, count)).toEqual(expected)
})

it('keeps expanded notch bounds centered and top-anchored', () => {
  const geometries = parseMacScreenGeometry(JSON.stringify([validGeometry]))

  expect(resolveConversationIslandBounds(display, geometries, { width: 420, height: 266 })).toEqual({
    bounds: { x: 1350, y: 24, width: 420, height: 266 },
    presentation: 'notch',
    notchWidth: 120
  })
})

it('keeps expanded capsule bounds centered eight pixels below the display top', () => {
  expect(resolveConversationIslandBounds(display, new Map(), { width: 420, height: 236 })).toEqual({
    bounds: { x: 1350, y: 32, width: 420, height: 236 },
    presentation: 'capsule'
  })
})
```

- [ ] **步骤 2：运行 geometry 测试验证旧签名失败**

运行：

```bash
pnpm test src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
```

预期：FAIL；helper 仍只接受 width，也没有动态 size 函数。

- [ ] **步骤 3：实现唯一的布局尺寸规则**

在 `macScreenGeometry.ts` 增加：

```ts
export type ConversationIslandPresentation = 'notch' | 'capsule'

export interface ConversationIslandSize {
  width: number
  height: number
}

export const COMPACT_ISLAND_SIZE: ConversationIslandSize = { width: 320, height: 38 }
export const MAX_VISIBLE_EXPANDED_ROWS = 5

const EXPANDED_WIDTH = 420
const EXPANDED_ROW_HEIGHT = 44
const CAPSULE_VERTICAL_PADDING = 16
const NOTCH_TOP_INSET = 38
const NOTCH_BOTTOM_PADDING = 8

export function resolveConversationIslandSize(
  presentation: ConversationIslandPresentation,
  activityCount: number
): ConversationIslandSize {
  if (activityCount < 2) return COMPACT_ISLAND_SIZE
  const visibleRows = Math.min(MAX_VISIBLE_EXPANDED_ROWS, activityCount)
  const chromeHeight = presentation === 'notch' ? NOTCH_TOP_INSET + NOTCH_BOTTOM_PADDING : CAPSULE_VERTICAL_PADDING
  return { width: EXPANDED_WIDTH, height: visibleRows * EXPANDED_ROW_HEIGHT + chromeHeight }
}
```

把 `fallbackPlacement` 与 `resolveConversationIslandBounds` 的第三参数改成 `ConversationIslandSize`，所有 `width`/固定 height 改读 `size.width`、`size.height`。notch 合法性判断不随 size 改变。

- [ ] **步骤 4：让 service 的 compact 路径使用显式 size**

先保持产品行为不变，只把调用改为：

```ts
const placement = resolveConversationIslandBounds(display, this.geometries, COMPACT_ISLAND_SIZE)
```

同步更新测试 mock：

```ts
mocks.geometryResolve.mockImplementation((display: any, _geometry: unknown, size: { width: number; height: number }) => ({
  bounds: { x: display.bounds.x, y: display.bounds.y + 8, ...size },
  presentation: 'capsule'
}))
```

- [ ] **步骤 5：运行 geometry 与 service 测试**

```bash
pnpm test src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：PASS；compact 仍为 `320×38`，展开尺寸上限已由纯函数锁定但尚未被用户触发。

- [ ] **步骤 6：提交动态 geometry**

对 service 与其测试只选择本任务 size 签名 hunks：

```bash
git add src/main/services/conversationIsland/macScreenGeometry.ts src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
git add -p src/main/services/conversationIsland/ConversationIslandService.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git commit -S --signoff -m "feat(conversation-island): calculate expanded bounds"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 4：接通主进程展开状态与受限 IpcApi 命令

**文件：**
- 修改：`src/shared/types/conversationIsland.ts`
- 创建：`src/shared/ipc/schemas/conversationIsland.ts`
- 修改：`src/shared/ipc/schemas/ipcSchemas.ts:1-85`
- 创建：`src/main/ipc/handlers/conversationIsland.ts`
- 创建：`src/main/ipc/handlers/__tests__/conversationIsland.test.ts`
- 修改：`src/main/ipc/handlers/ipcHandlers.ts:1-90`
- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`

- [ ] **步骤 1：先写 IPC sender 边界测试**

创建完整测试文件：

```ts
import { WindowType } from '@main/core/window/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  getWindowType: vi.fn(),
  setExpanded: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.appGet } }))

import { conversationIslandHandlers } from '../conversationIsland'

const setExpanded = conversationIslandHandlers['conversation_island.set_expanded']

describe('conversationIslandHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appGet.mockImplementation((name: string) => {
      if (name === 'WindowManager') return { getWindowType: mocks.getWindowType }
      if (name === 'ConversationIslandService') return { setExpanded: mocks.setExpanded }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('accepts mode changes only from the managed Conversation Island window', async () => {
    mocks.getWindowType.mockReturnValue(WindowType.ConversationIsland)

    await setExpanded({ expanded: true }, { senderId: 'island-1' })

    expect(mocks.getWindowType).toHaveBeenCalledWith('island-1')
    expect(mocks.setExpanded).toHaveBeenCalledWith(true)
  })

  it.each([null, 'main-1'])('ignores an untrusted sender %s', async (senderId) => {
    mocks.getWindowType.mockReturnValue(senderId ? WindowType.Main : undefined)

    await setExpanded({ expanded: true }, { senderId })

    expect(mocks.setExpanded).not.toHaveBeenCalled()
  })
})
```

- [ ] **步骤 2：扩充 service mock 并写主流程失败测试**

让测试 window 的 bounds 可变，并 mock reduced motion。先在 hoisted `mocks` 对象增加：

```ts
prefersReducedMotion: false,
```

```ts
function createWindow(initialBounds = { x: 0, y: 0, width: 320, height: 38 }) {
  let bounds = initialBounds
  return {
    getBounds: vi.fn(() => bounds),
    isDestroyed: vi.fn(() => false),
    setBounds: vi.fn((next: typeof bounds) => {
      bounds = next
    }),
    showInactive: vi.fn()
  }
}
```

`electron` mock 增加：

```ts
systemPreferences: {
  getAnimationSettings: () => ({ prefersReducedMotion: mocks.prefersReducedMotion })
}
```

新增这些服务级行为测试：

```ts
it('refuses expansion with one activity and expands two activities in frozen order', () => {
  changePreference('feature.conversation_island.enabled', true)
  emitActivity('streaming', 100, 'topic-old')
  service.setExpanded(true)
  expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({ expanded: false })

  emitActivity('awaiting-approval', 200, 'topic-primary')
  service.setExpanded(true)

  expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
    expanded: true,
    activityId: 'topic-primary',
    activities: [
      { activityId: 'topic-primary' },
      { activityId: 'topic-old' }
    ]
  })
  expect(mocks.geometryResolve.mock.lastCall?.[2]).toEqual({ width: 420, height: 104 })
})

it('retains expired terminal rows until collapse then re-arbitrates compact state', async () => {
  changePreference('feature.conversation_island.enabled', true)
  emitActivity('done', 100, 'topic-done')
  emitActivity('streaming', 200, 'topic-live')
  service.setExpanded(true)

  await vi.advanceTimersByTimeAsync(4_000)
  expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
    expanded: true,
    activities: expect.arrayContaining([expect.objectContaining({ activityId: 'topic-done' })])
  })

  service.setExpanded(false)
  expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
    expanded: false,
    activityId: 'topic-live',
    secondaryCount: 0
  })
})

it('collapses frozen state for display changes, disablement, and reduced motion', () => {
  changePreference('feature.conversation_island.enabled', true)
  emitActivity('streaming', 100, 'topic-1')
  emitActivity('streaming', 200, 'topic-2')
  service.setExpanded(true)

  mocks.prefersReducedMotion = true
  mocks.screen.emit('display-metrics-changed', {}, internalDisplay, ['bounds'])

  const window = mocks.windows.get('island-1')
  expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({ expanded: false })
  expect(window.setBounds.mock.lastCall?.[1]).toBe(false)

  changePreference('feature.conversation_island.enabled', false)
  expect(services.windowManager.close).toHaveBeenCalled()
})
```

另加测试验证：新 eligible 活动追加；状态更新不改顺序；abort 删除 primary 后首行接替；只剩一行自动收起；语言切换只更新文案/标题不改 frozen IDs；expanded `setBounds` 抛错时记录错误并回到 compact bounds。

- [ ] **步骤 3：运行测试验证路由与 service 尚未实现**

```bash
pnpm test src/main/ipc/handlers/__tests__/conversationIsland.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：FAIL；route、handler、`setExpanded()`、expanded snapshot 和动态 service bounds 尚不存在。

- [ ] **步骤 4：定义最终 shared snapshot**

将 `src/shared/types/conversationIsland.ts` 改为：

```ts
import type { ConversationNavigationTarget } from './navigation'

export type ConversationIslandStateKind = 'pending' | 'streaming' | 'awaiting-confirmation' | 'done' | 'error'

export interface ConversationIslandActivityItem {
  activityId: string
  target: ConversationNavigationTarget
  state: ConversationIslandStateKind
  statusText: string
  title: string
}

export interface ConversationIslandSnapshot extends ConversationIslandActivityItem {
  secondaryCount: number
  presentation: 'notch' | 'capsule'
  notchWidth?: number
  expanded: boolean
  activities?: ConversationIslandActivityItem[]
}
```

约束由 service 测试保护：`expanded: false` 不发送 `activities`；`expanded: true` 必须发送至少两行。

- [ ] **步骤 5：定义并聚合唯一语义 route**

创建完整 schema 文件：

```ts
import * as z from 'zod'

import { defineRoute } from '../define'

export const conversationIslandRequestSchemas = {
  'conversation_island.set_expanded': defineRoute({
    input: z.object({ expanded: z.boolean() }),
    output: z.void()
  })
}
```

在 `ipcSchemas.ts` import 并 spread `conversationIslandRequestSchemas`。创建完整 handler：

```ts
import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import type { conversationIslandRequestSchemas } from '@shared/ipc/schemas/conversationIsland'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const conversationIslandHandlers: IpcHandlersFor<typeof conversationIslandRequestSchemas> = {
  'conversation_island.set_expanded': async ({ expanded }, { senderId }) => {
    if (!senderId || application.get('WindowManager').getWindowType(senderId) !== WindowType.ConversationIsland) return
    application.get('ConversationIslandService').setExpanded(expanded)
  }
}
```

在 `ipcHandlers.ts` import 并 spread `conversationIslandHandlers`。不要新增 event、preload 方法或 `window.set_bounds`。

- [ ] **步骤 6：在 service 中持有 authoritative expanded state**

增加字段与 public semantic method：

```ts
private expandedState: ExpandedActivityState | null = null

public setExpanded(expanded: boolean): void {
  if (!this.enabled) return
  if (!expanded) {
    if (!this.expandedState) return
    this.expandedState = null
    this.refreshPresentation()
    return
  }
  if (this.expandedState) return

  const selection = selectPrimaryActivity(this.activities, Date.now())
  if (!selection.primary || selection.secondaryCount === 0) return
  const display = this.resolveActivityDisplay(selection.primary.originDisplayId)
  const next = createExpandedActivityState(this.activities, Date.now(), display.id)
  if (!next) return

  this.expandedState = next
  this.clearExpiryTimer()
  this.refreshPresentation()
}
```

将 snapshot 构建拆成单行投影和模式投影：

```ts
private buildActivityItem(activity: ConversationIslandActivity): ConversationIslandActivityItem {
  const fallback = activity.target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
  const cached = this.titleCache.get(activity.topicId)
  let title = cached && cached.turnId === activity.turnId ? cached.title : undefined
  if (title === undefined) {
    title = application.get('NotificationService').resolveConversationName(activity.target) || fallback
    this.titleCache.set(activity.topicId, { turnId: activity.turnId, title })
  }
  return {
    activityId: activity.topicId,
    target: activity.target,
    state: snapshotState(activity.status),
    statusText: statusText(activity),
    title
  }
}
```

`refreshPresentation(now)` 先 reconcile frozen state。expanded 路径：

1. 确认 frozen display 仍存在，否则清空 expanded state 并进入 compact 路径。
2. `reconcileExpandedActivityState()`；返回 null 时自动收起。
3. 用 `resolveExpandedActivities()` 取稳定行，找到 `primaryActivityId` 对应行。
4. 先用 compact size 解析 notch/capsule variant，再用 `resolveConversationIslandSize(variant, rows.length)` 得到最终 size 并再次解析 bounds。
5. snapshot 顶层复制强调行，并附 `expanded: true`、所有 `activities`；不调度 terminal expiry timer。

compact 路径继续 `selectPrimaryActivity()`，发送 `expanded: false`，不含 `activities`，并调度原有 terminal expiry。

- [ ] **步骤 7：处理强制收起、动画和失败回退**

- `deactivateResources()`、当前 island `onWindowDestroyed`、display added/removed/metrics changed、power resume 都先清空 `expandedState`。
- display/resume 回调顺序固定为：清空 expanded → `refreshPresentation()` → `probeGeometry()`。
- `showOrUpdateWindow()` 在已有窗口 bounds 实际变化时读取：

```ts
const animate = !systemPreferences.getAnimationSettings().prefersReducedMotion
window.setBounds(bounds, animate)
```

新建窗口第一次定位传 `false`；相同 bounds 的普通状态更新不重复动画。`setBounds` 或 expanded snapshot 发布失败时记录集中日志，清空 `expandedState`，再尝试一次 compact presentation；第二次失败则关闭窗口，不能保留大透明 hit area。

- [ ] **步骤 8：运行 main 与 IPC 测试**

```bash
pnpm test src/main/ipc/handlers/__tests__/conversationIsland.test.ts src/main/services/conversationIsland/__tests__/activityReducer.test.ts src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：PASS；错误 sender 无副作用，main-only 状态冻结和 bounds 契约全部成立。

- [ ] **步骤 9：提交 main/IPC 接线**

对用户已有两个 dirty 文件继续选择性暂存：

```bash
git add src/shared/types/conversationIsland.ts src/shared/ipc/schemas/conversationIsland.ts src/shared/ipc/schemas/ipcSchemas.ts src/main/ipc/handlers/conversationIsland.ts src/main/ipc/handlers/__tests__/conversationIsland.test.ts src/main/ipc/handlers/ipcHandlers.ts
git add -p src/main/services/conversationIsland/ConversationIslandService.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git commit -S --signoff -m "feat(conversation-island): control expanded window state"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 5：实现 renderer 悬停列表和点击后重新进入锁

**文件：**
- 修改：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`
- 修改：`src/renderer/windows/conversationIsland/ConversationIsland.tsx`

- [ ] **步骤 1：用 fake timers 写悬停与离开测试**

把 Testing Library import 加上 `fireEvent`。在 renderer 测试 `beforeEach` 使用 `vi.useFakeTimers()`，`afterEach` 执行 `vi.clearAllTimers()` 和 `vi.useRealTimers()`。先把 fixture 扩展为最终 shared contract：

```ts
const activityItem = (activityId: string, title: string, statusText = 'Responding') => ({
  activityId,
  target: { conversationType: 'assistant' as const, conversationId: activityId },
  state: 'streaming' as const,
  statusText,
  title
})

const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  ...activityItem('topic-1', 'Research notes'),
  secondaryCount: 0,
  presentation: 'capsule',
  expanded: false,
  ...overrides
})

const expandedSnapshot = (): ConversationIslandSnapshot => {
  const primary = activityItem('topic-1', 'Research notes')
  const secondary = activityItem('topic-2', 'Release checklist', 'Waiting for confirmation')
  return {
    ...primary,
    secondaryCount: 1,
    presentation: 'capsule',
    expanded: true,
    activities: [primary, secondary]
  }
}
```

然后以 `fireEvent.pointerEnter/Leave` 驱动 root surface。关键回归测试：

```tsx
it('expands after 500 ms only when a secondary activity exists', async () => {
  mocks.initData = snapshot({ expanded: false, secondaryCount: 1 })
  const { container } = render(<ConversationIsland />)

  fireEvent.pointerEnter(container.firstElementChild!)
  await vi.advanceTimersByTimeAsync(499)
  expect(mocks.ipcRequest).not.toHaveBeenCalledWith('conversation_island.set_expanded', { expanded: true })
  await vi.advanceTimersByTimeAsync(1)
  expect(mocks.ipcRequest).toHaveBeenCalledWith('conversation_island.set_expanded', { expanded: true })

  mocks.ipcRequest.mockClear()
  mocks.initData = snapshot({ expanded: false, secondaryCount: 0 })
  const single = render(<ConversationIsland />)
  fireEvent.pointerEnter(single.container.firstElementChild!)
  await vi.advanceTimersByTimeAsync(500)
  expect(mocks.ipcRequest).not.toHaveBeenCalled()
})

it('collapses 250 ms after full leave and cancels collapse on re-entry', async () => {
  mocks.initData = expandedSnapshot()
  const { container } = render(<ConversationIsland />)
  const surface = container.firstElementChild!

  fireEvent.pointerLeave(surface)
  await vi.advanceTimersByTimeAsync(249)
  expect(mocks.ipcRequest).not.toHaveBeenCalledWith('conversation_island.set_expanded', { expanded: false })
  fireEvent.pointerEnter(surface)
  await vi.advanceTimersByTimeAsync(1)
  expect(mocks.ipcRequest).not.toHaveBeenCalled()

  fireEvent.pointerLeave(surface)
  await vi.advanceTimersByTimeAsync(250)
  expect(mocks.ipcRequest).toHaveBeenCalledWith('conversation_island.set_expanded', { expanded: false })
})
```

点击测试必须验证外部效果顺序和 latch：

```tsx
it('collapses before navigating and requires a leave/re-enter cycle before reopening', async () => {
  const calls: string[] = []
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  mocks.ipcRequest.mockImplementation(async (route: string) => {
    calls.push(route)
  })
  mocks.initData = expandedSnapshot()
  const view = render(<ConversationIsland />)

  await user.click(screen.getByRole('button', { name: 'Responding: Research notes' }))
  expect(calls).toEqual(['conversation_island.set_expanded', 'navigation.focus_or_open_conversation'])

  mocks.initData = snapshot({ expanded: false, secondaryCount: 1 })
  view.rerender(<ConversationIsland />)
  fireEvent.pointerEnter(view.container.firstElementChild!)
  await vi.advanceTimersByTimeAsync(500)
  expect(calls.filter((route) => route === 'conversation_island.set_expanded')).toHaveLength(1)

  fireEvent.pointerLeave(view.container.firstElementChild!)
  fireEvent.pointerEnter(view.container.firstElementChild!)
  await vi.advanceTimersByTimeAsync(500)
  expect(calls.filter((route) => route === 'conversation_island.set_expanded')).toHaveLength(2)
})
```

另加测试：pointer leave 在 500 ms 前取消展开；snapshot 降为单活动取消 pending timer；六行全部在 DOM 且 list 使用维护中的 `overflow-y-auto` 布局契约；notch expanded 有 38 px 顶部安全带而 capsule 没有；unmount 清理所有 timers；展开或导航 IPC 失败只记录日志并保留表面。

- [ ] **步骤 2：运行 renderer 测试验证交互尚不存在**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

预期：FAIL；当前 component 没有 root pointer handlers、expanded rows、timer 或 semantic expansion request。

- [ ] **步骤 3：实现计时器和重新进入锁**

在 component 中定义：

```ts
const EXPAND_DELAY_MS = 500
const COLLAPSE_DELAY_MS = 250

const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
const [requiresReentry, setRequiresReentry] = useState(false)
```

提供清理 helper，并在 unmount 清理。行为固定为：

```ts
const handlePointerEnter = () => {
  clearCollapseTimer()
  if (!snapshot.expanded && snapshot.secondaryCount > 0 && !requiresReentry) {
    clearExpandTimer()
    expandTimer.current = setTimeout(() => {
      expandTimer.current = null
      void requestExpanded(true)
    }, EXPAND_DELAY_MS)
  }
}

const handlePointerLeave = () => {
  clearExpandTimer()
  if (requiresReentry) setRequiresReentry(false)
  if (snapshot.expanded) {
    clearCollapseTimer()
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null
      void requestExpanded(false)
    }, COLLAPSE_DELAY_MS)
  }
}
```

当 `secondaryCount === 0` 或 snapshot 已 expanded 时，以 effect 取消 pending expand。所有 IPC rejection 使用现有 `logger` 记录，不能切换 renderer-local expanded 状态。

`requestExpanded` 只封装语义请求和日志：

```ts
const requestExpanded = async (expanded: boolean) => {
  try {
    await ipcApi.request('conversation_island.set_expanded', { expanded })
  } catch (error) {
    logger.error('Failed to change Conversation Island expansion', error)
  }
}
```

- [ ] **步骤 4：实现 compact 与 expanded 两个明确分支**

根节点负责 pointer enter/leave 和轻量淡入：

先把任务 1 完成的 compact Button 原样赋给 `compactSurface`；只把它的 `onClick` 改成 `() => void openActivity(snapshot)`，notch wings/capsule 内容不重复实现。expanded JSX 为：

```tsx
const expandedSurface = (
  <div
    className={
      usesNotchLayout
        ? 'h-full w-full overflow-hidden rounded-t-none rounded-b-[16px] bg-black pt-[38px] pb-2 text-white'
        : 'h-full w-full overflow-hidden rounded-[16px] border border-border bg-popover/95 p-2 text-popover-foreground shadow-md backdrop-blur-xs'
    }>
    <div data-ui="conversation-island-activity-list" className="h-full overflow-y-auto">
      {(snapshot.activities ?? []).map((activity) => {
        const isPrimary = activity.activityId === snapshot.activityId
        return (
          <Button
            key={activity.activityId}
            type="button"
            variant="ghost"
            aria-label={`${activity.statusText}: ${activity.title}`}
            onClick={() => void openActivity(activity)}
            className={`h-11 w-full min-w-0 justify-start gap-2 rounded-lg px-3 py-0 text-xs ${
              isPrimary ? (usesNotchLayout ? 'bg-white/10' : 'bg-accent/50') : ''
            }`}>
            <span
              className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[activity.state]}`}
              aria-hidden="true"
            />
            <span className="w-20 shrink-0 truncate text-left font-medium">{activity.statusText}</span>
            <span className="min-w-0 flex-1 truncate text-left opacity-70" title={activity.title}>
              {activity.title}
            </span>
          </Button>
        )
      })}
    </div>
  </div>
)
```

`snapshot.activities ?? []` 只防御窗口销毁边界上的旧 init data；正常 expanded snapshot 由 main 保证至少两行。最终根节点为：

```tsx
<div
  className="h-full w-full overflow-hidden motion-safe:transition-opacity motion-reduce:transition-none"
  onPointerEnter={handlePointerEnter}
  onPointerLeave={handlePointerLeave}>
  {snapshot.expanded ? expandedSurface : compactSurface}
</div>
```

expanded surface：

- notch：`bg-black text-white rounded-t-none rounded-b-[16px] pt-[38px] pb-2`；物理 notch 顶部 38 px 内不放 row。
- capsule：`rounded-[16px] border border-border bg-popover/95 p-2 shadow-md backdrop-blur-xs`。
- list 始终 `h-full overflow-y-auto`；每行使用 `Button variant="ghost"`、`h-11`、单行截断。
- `snapshot.activityId` 对应行用轻微 `bg-accent/50` 或 notch 等价的 `bg-white/10`，不改变行高。
- 每行 accessible name 为 ``${item.statusText}: ${item.title}``，state indicator 复用现有 semantic color map。

点击函数严格先收起再导航，即使收起失败也继续打开目标：

```ts
const openActivity = async (activity: ConversationIslandActivityItem) => {
  setRequiresReentry(true)
  clearExpandTimer()
  clearCollapseTimer()
  try {
    await ipcApi.request('conversation_island.set_expanded', { expanded: false })
  } catch (error) {
    logger.error('Failed to collapse Conversation Island before navigation', error)
  }
  try {
    await ipcApi.request('navigation.focus_or_open_conversation', {
      target: activity.target,
      title: activity.title
    })
  } catch (error) {
    logger.error('Failed to open conversation from Conversation Island', error)
  }
}
```

compact 点击调用同一 `openActivity(snapshot)`；单活动永远没有 expand timer。

- [ ] **步骤 5：运行 renderer 与跨进程聚焦测试**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx src/main/ipc/handlers/__tests__/conversationIsland.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：PASS；renderer 只发 boolean mode request，main 仍是 snapshot 与 bounds 的唯一 owner。

- [ ] **步骤 6：提交 renderer 交互**

```bash
git add src/renderer/windows/conversationIsland/ConversationIsland.tsx src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git commit -S --signoff -m "feat(conversation-island): expand activities on hover"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 6：完成静态门禁和 tracked-app 验收

**文件：**
- 复核：本计划列出的全部生产与测试文件
- 不新增生产文件

- [ ] **步骤 1：运行完整的受影响测试集合**

```bash
pnpm test src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx src/main/ipc/handlers/__tests__/conversationIsland.test.ts src/main/services/conversationIsland/__tests__/activityReducer.test.ts src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts src/main/core/window/__tests__/windowRegistry.invariants.test.ts src/main/core/window/__tests__/windowRegistry.test.ts
```

预期：全部 PASS。每个测试都应对应本计划写明的产品或安全回归，不保留仅记录当前实现的 mock-call 测试。

- [ ] **步骤 2：运行仓库静态门禁**

```bash
pnpm lint
pnpm docs:check
git diff --check
```

预期：全部退出 0。若 `pnpm lint` 写入格式化结果，只保留本功能相关文件的变化；不顺手修复其他文件。

- [ ] **步骤 3：扫描被删除的契约与禁止扩张点**

```bash
rg -n "feature\.conversation_island\.show_title|conversation_island\.show_title|navigationTitle" src v2-refactor-temp/tools/data-classify/data/target-key-definitions.json
rg -n "window\.set_bounds|setBounds" src/shared/ipc/schemas/conversationIsland.ts src/renderer/windows/conversationIsland src/preload/conversationIsland.ts
```

预期：第一条无输出；第二条不出现任何 bounds IPC 或 renderer `setBounds`，只允许 main service 直接调用 `BrowserWindow.setBounds`。

- [ ] **步骤 4：使用 tracked Electron 做真实交互验收**

执行本步骤时必须使用 `cherry-electron-dev` 技能启动并控制现有 profile，且先记录/最后恢复 `feature.conversation_island.enabled`。逐项验证：

1. 一个 eligible 活动：停留超过 500 ms 仍保持 `320×38` compact。
2. 两个活动：499 ms 不展开，500 ms 后同一窗口围绕中心横向、向下展开。
3. 展开后状态变化不移动已有行；新活动追加到底部；结束行过 TTL 仍保留到收起。
4. 离开 249 ms 不收起，250 ms 收起；短暂重入取消收起。
5. 点击任意行打开正确 Assistant 或 Agent target，立即收起；鼠标未完成 leave/re-enter 前不再展开。
6. 六个以上活动只显示五行高度，滚轮可访问其余行，窗口外透明区域不拦截其他应用点击。
7. 刘海屏使用顶部连接黑色表面，所有活动行在物理 notch 下方；外接/非刘海屏保持距顶 8 px 的主题化圆角 capsule。
8. Cherry 在后台和 fullscreen Space 时显示/展开均不抢焦点，点击才聚焦目标。
9. 开启 macOS“减少动态效果”后 bounds 立即变化且内容无非必要动画；关闭后使用短 native resize。
10. display metrics 变化、断连和 sleep/resume 会先收起、重新探测并定位；禁用 feature 立即关闭窗口。

- [ ] **步骤 5：最终审查提交边界**

```bash
git status --short
git log --show-signature --format=fuller -5
git diff -- src/main/services/conversationIsland/ConversationIslandService.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：所有本计划提交均已签名和 DCO 签署；用户原有 `awaitingApprovalAnchors` hunks 仍未暂存，除非用户在执行开始时明确授权将它们纳入独立提交；不存在其他意外文件。

## 规格覆盖自检

- 500 ms 展开、250 ms 收起、重入取消和点击锁：任务 5。
- 单活动不展开、两行起动态高度、五行高度上限和内部滚动：任务 3、4、5。
- 固定标题并删除 `show_title`：任务 1。
- 稳定顺序、状态原位更新、新活动追加、终态保留、abort 删除和 collapse 重算：任务 2、4。
- renderer/main 语义边界与 sender 校验：任务 4、5。
- 同窗口原位扩缩、notch/capsule 差异、reduced motion：任务 3、4、5。
- disable、display/resume、窗口失败、语言变化和无透明 click blocker：任务 4、6。
- no WindowManager/preload/DataApi/Cache infrastructure expansion：实施前约束、任务 4、任务 6 扫描。
