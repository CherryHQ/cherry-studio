# macOS Conversation Island 展示层级实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让灵动岛在单条/多条活动与 hover/非 hover 组合下拥有稳定的信息层级，并让刘海与胶囊外壳展示等价内容。

**架构：** main 继续拥有活动、排序、展开权威、窗口 bounds 与退出时序；renderer 从现有快照派生私有的 `compact | single-detail | activity-list` surface。展示逻辑留在 conversation-island 窗口内，不扩张共享快照或 IPC；窗口几何改为统一的 38 px 摘要、44 px 单条详情、52 px 多条列表项与最多 4 条可见项。

**技术栈：** TypeScript、Electron 41、React 19、`@cherrystudio/ui`、Tailwind CSS、Motion (`motion/react`)、Vitest 3、Testing Library。

**设计依据：** `docs/superpowers/specs/2026-08-22-macos-conversation-island-surface-hierarchy-design.md`

---

## 实施前状态与边界

计划编写时：

- 基线提交为 `57e45db64d`；
- 工作区干净；
- `.context/cherry-electron-dev/instance.json` 指向旧提交和失效 PID，只能作为线索，不能当作可用实例；
- 另有未验证 CDP 的用户开发进程时，不得停止或接管它。

开始实现前运行：

```bash
git status --short
git rev-parse HEAD
git log -2 --oneline
```

预期：除执行计划时新产生的计划进度外没有用户改动，HEAD 包含规格提交 `57e45db64d`。若出现不属于本计划的改动，保留它们，并仅暂存本计划列出的文件。

## 不变量

- 不修改 `src/shared/types/conversationIsland.ts`、IPC schema/handler、Preference、DataApi、数据库、WindowManager 或原生 helper。
- main 继续决定 Primary Activity、展开期间顺序、窗口位置、退出与 reduced-motion。
- 保留 500 ms 展开、250 ms 收起、180 ms 正常退场、fresh re-entry 和 collapse-before-navigation。
- compact 保持 320 × 38；expanded 保持宽 420；窗口不预扩张、不保留透明 carrier。
- 使用现有 `activityCountText`，不增加 i18n key。
- capsule 使用语义 token；notch 使用黑色外壳与受控白色透明度。
- 不把 feature-local surface 抽到 `@shared`、`@renderer/components` 或 `packages/ui`。

## 测试价值门槛

新增或改写的测试只保护以下回归：

1. presentation、exiting 或 reduced-motion 意外改变业务 surface；
2. compact 再次把状态放在标题之前，或把 `+N` 当成总数；
3. single-detail 与 activity-list 再次使用不一致的身份/状态/标题顺序；
4. capsule 再次丢失展开摘要；
5. Primary Activity 再次获得永久选中背景；
6. 52 px / 4 条可见项与 82/142/194/246 px bounds 失配；
7. 现有 hover、导航、退出或 reduced-motion 行为被展示重构破坏。

明确不新增：DOM snapshot、图标 SVG 结构测试、逐个 Tailwind class 快照、动画中间帧测试、畸形快照兜底测试，以及重复 notch/capsule 每个 prop 组合的枚举测试。

## 文件结构

### 新增

- `src/renderer/windows/conversationIsland/conversationIslandSurface.ts`：定义并解析 renderer 私有 surface；无 JSX、无副作用。
- `src/renderer/windows/conversationIsland/__tests__/conversationIslandSurface.test.ts`：保护四态解析与正交标志。

### 修改

- `src/renderer/windows/conversationIsland/ConversationIsland.tsx`：按 surface 渲染 compact、single detail、activity list，以及 notch/capsule 等价外壳。
- `src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`：用用户可见文本、角色、可访问名称和维护中的物理布局 selector 替换旧展示断言；保留交互合同测试。
- `src/main/services/conversationIsland/macScreenGeometry.ts`：将展开尺寸改为 presentation 无关的 38/44/52 px 公式与 4 条上限。
- `src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts`：锁定 1/2/3/4/5+ 条精确 bounds。
- `src/main/services/conversationIsland/ConversationIslandService.ts`：调用新的 activity-count-only 尺寸解析签名。
- `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`：验证服务把冻结活动数量交给几何层，并使用返回 bounds。

### 明确不修改

- `src/shared/**`
- `src/main/ipc/**`、`src/shared/ipc/**`
- `packages/ui/**`
- `src/renderer/i18n/**`、`src/main/i18n/**`
- `src/main/core/window/**`

## 任务 1：建立 renderer 私有 surface 模型

**文件：**

- 创建：`src/renderer/windows/conversationIsland/conversationIslandSurface.ts`
- 创建：`src/renderer/windows/conversationIsland/__tests__/conversationIslandSurface.test.ts`
- 修改：`src/renderer/windows/conversationIsland/ConversationIsland.tsx:5-15,144-190`

- [ ] **步骤 1：编写失败的四态解析测试**

创建完整测试文件：

```ts
import type { ConversationIslandActivityItem, ConversationIslandSnapshot } from '@shared/types/conversationIsland'
import { describe, expect, it } from 'vitest'

import { resolveConversationIslandSurface } from '../conversationIslandSurface'

const activity = (activityId: string, title: string): ConversationIslandActivityItem => ({
  activityId,
  identityAvatar: '🌸',
  identityName: 'Cherry Assistant',
  target: { conversationType: 'assistant', conversationId: activityId },
  state: 'streaming',
  statusText: 'Responding',
  title
})

const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  ...activity('topic-1', 'New Chat'),
  activityCountText: 'Total: 1',
  secondaryCount: 0,
  presentation: 'capsule',
  expanded: false,
  exiting: false,
  reducedMotion: false,
  ...overrides
})

const second = activity('topic-2', 'Review plan')

describe('resolveConversationIslandSurface', () => {
  it.each([
    ['single compact', snapshot(), 'compact'],
    ['multiple compact', snapshot({ secondaryCount: 1, activityCountText: 'Total: 2' }), 'compact'],
    ['single expanded', snapshot({ expanded: true, activities: [activity('topic-1', 'New Chat')] }), 'single-detail'],
    [
      'multiple expanded',
      snapshot({ expanded: true, secondaryCount: 1, activityCountText: 'Total: 2', activities: [activity('topic-1', 'New Chat'), second] }),
      'activity-list'
    ]
  ] as const)('resolves %s to %s', (_label, value, expectedKind) => {
    expect(resolveConversationIslandSurface(value).kind).toBe(expectedKind)
  })

  it('projects the payload required by each surface', () => {
    expect(resolveConversationIslandSurface(snapshot({ secondaryCount: 2 }))).toMatchObject({
      kind: 'compact',
      primary: { activityId: 'topic-1' },
      totalCount: 3
    })

    expect(resolveConversationIslandSurface(snapshot({ expanded: true }))).toMatchObject({
      kind: 'single-detail',
      activity: { activityId: 'topic-1' }
    })

    expect(
      resolveConversationIslandSurface(
        snapshot({ expanded: true, secondaryCount: 1, activities: [activity('topic-1', 'New Chat'), second] })
      )
    ).toMatchObject({
      kind: 'activity-list',
      primaryActivityId: 'topic-1',
      activities: [{ activityId: 'topic-1' }, { activityId: 'topic-2' }]
    })
  })

  it.each([
    { presentation: 'notch' as const, notchWidth: 120 },
    { exiting: true },
    { reducedMotion: true }
  ])('keeps presentation and lifecycle flags orthogonal: $presentation $exiting $reducedMotion', (overrides) => {
    const value = snapshot({
      expanded: true,
      secondaryCount: 1,
      activities: [activity('topic-1', 'New Chat'), second],
      ...overrides
    })

    expect(resolveConversationIslandSurface(value).kind).toBe('activity-list')
  })
})
```

该测试会在模块不存在时失败，并能捕获 surface 再次按物理外壳或生命周期标志分叉。

- [ ] **步骤 2：运行 RED 测试**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandSurface.test.ts
```

预期：FAIL，错误为无法解析 `../conversationIslandSurface`。

- [ ] **步骤 3：实现最小 surface 解析器**

创建：

```ts
import type { ConversationIslandActivityItem, ConversationIslandSnapshot } from '@shared/types/conversationIsland'

export type ConversationIslandSurface =
  | {
      kind: 'compact'
      primary: ConversationIslandActivityItem
      totalCount: number
    }
  | {
      kind: 'single-detail'
      activity: ConversationIslandActivityItem
    }
  | {
      kind: 'activity-list'
      activities: ConversationIslandActivityItem[]
      primaryActivityId: string
    }

export function resolveConversationIslandSurface(snapshot: ConversationIslandSnapshot): ConversationIslandSurface {
  if (!snapshot.expanded) {
    return { kind: 'compact', primary: snapshot, totalCount: snapshot.secondaryCount + 1 }
  }

  if (snapshot.secondaryCount === 0) {
    return { kind: 'single-detail', activity: snapshot }
  }

  return {
    kind: 'activity-list',
    activities: snapshot.activities!,
    primaryActivityId: snapshot.activityId
  }
}
```

非空断言表达 main 的既有合同：多条 expanded 快照必有冻结后的 `activities`。不要为不可能输入增加重排或空列表兜底。

- [ ] **步骤 4：让现有 renderer 使用模型，但不改变当前视觉**

在 `ConversationIsland.tsx` 引入解析器，并用它替换 `isSingleActivity` 与手工 activities 分支：

```ts
import { resolveConversationIslandSurface } from './conversationIslandSurface'

const surfaceModel = resolveConversationIslandSurface(snapshot)
const usesSingleNotchDetail = usesNotchLayout && surfaceModel.kind === 'single-detail'

const activities =
  surfaceModel.kind === 'single-detail'
    ? [surfaceModel.activity]
    : surfaceModel.kind === 'activity-list'
      ? surfaceModel.activities
      : []
```

保留其余 JSX、IPC、timer 和 Motion key 不变。本步骤是无视觉变化的所有权重构。

- [ ] **步骤 5：运行 GREEN 与现有 renderer 回归**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandSurface.test.ts
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git diff --check
```

预期：新解析测试和现有 renderer 测试全部 PASS。

- [ ] **步骤 6：创建聚焦提交**

```bash
git add src/renderer/windows/conversationIsland/conversationIslandSurface.ts \
  src/renderer/windows/conversationIsland/__tests__/conversationIslandSurface.test.ts \
  src/renderer/windows/conversationIsland/ConversationIsland.tsx
git diff --cached --check
git commit -S --signoff -m "refactor(conversation-island): model renderer surfaces"
```

## 任务 2：落实统一信息层级与精确窗口尺寸

**文件：**

- 修改：`src/renderer/windows/conversationIsland/ConversationIsland.tsx:18-37,144-317,335-344`
- 修改：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx:117-241,371-407,560-604`
- 修改：`src/main/services/conversationIsland/macScreenGeometry.ts:15-28,78-85`
- 修改：`src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts:34-43,61-67,98-109`
- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts:381-390`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts:296-305,866-884`

- [ ] **步骤 1：先把几何合同改成批准的尺寸**

把 `macScreenGeometry.test.ts` 的展开尺寸用例替换为：

```ts
it.each([
  [1, { width: 420, height: 82 }],
  [2, { width: 420, height: 142 }],
  [3, { width: 420, height: 194 }],
  [4, { width: 420, height: 246 }],
  [5, { width: 420, height: 246 }],
  [8, { width: 420, height: 246 }]
] as const)('resolves the expanded size for %i activities', (activityCount, expected) => {
  expect(resolveConversationIslandSize(activityCount)).toEqual(expected)
})
```

同时把 8 条活动的 notch/capsule placement 期望高度都改成 `246`。这些测试能捕获 presentation-specific 高度、旧 44 px 多条行或 5 条上限被保留。

在 `ConversationIslandService.test.ts` 中让 mock 返回固定边界，不复制生产公式：

```ts
mocks.geometrySize.mockReturnValue({ width: 420, height: 142 })
```

并把服务边界断言改为：

```ts
expect(mocks.geometrySize).toHaveBeenLastCalledWith(2)
expect(mocks.geometryResolve).toHaveBeenNthCalledWith(2, internalDisplay, expect.any(Map), {
  width: 420,
  height: 142
})
```

- [ ] **步骤 2：把展示测试改成用户可见合同**

删除或改写旧的“状态在左、标题在右”“capsule 无 expanded header”“Primary 有 `bg-accent`”“五条 `h-11`”断言。保留现有 timer、IPC、navigation、exit 和 motion 测试。

加入以下 compact 合同：

```tsx
it.each(['notch', 'capsule'] as const)('prioritizes the compact title in the %s shell', (presentation) => {
  mocks.initData = snapshot({
    presentation,
    notchWidth: presentation === 'notch' ? 120 : undefined,
    title: 'Research notes',
    secondaryCount: 2,
    activityCountText: 'Total: 3'
  })
  render(<ConversationIsland />)

  expect(screen.getByText('Research notes')).toBeVisible()
  expect(screen.getByText('Responding')).toBeVisible()
  expect(screen.getByLabelText('Total: 3')).toHaveTextContent('3')
  expect(screen.queryByText('+2')).toBeNull()

  if (presentation === 'notch') {
    expect(within(screen.getByTestId('notch-leading')).getByText('Research notes')).toBeVisible()
    expect(within(screen.getByTestId('notch-trailing')).getByText('Responding')).toBeVisible()
    expect(screen.getByTestId('notch-occlusion')).toHaveStyle({ width: '120px' })
  }
})
```

加入 single-detail parity 合同：

```tsx
it.each(['notch', 'capsule'] as const)('shows identity, status, and title in the %s single detail', (presentation) => {
  mocks.initData = snapshot({
    expanded: true,
    presentation,
    notchWidth: presentation === 'notch' ? 120 : undefined,
    identityAvatar: '🧠',
    identityName: 'Research Assistant',
    title: 'Investigate rendering behavior'
  })
  render(<ConversationIsland />)

  const summary = screen.getByTestId('expanded-summary')
  expect(within(summary).getByText('Research Assistant')).toBeVisible()
  expect(within(summary).getByText('Responding')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Responding: Investigate rendering behavior' })).toBeVisible()
  expect(screen.queryByRole('list')).toBeNull()
})
```

加入 multi-activity 合同：

```tsx
it.each(['notch', 'capsule'] as const)('keeps summary statistics above consistent %s activity rows', (presentation) => {
  const activities = [
    activity('topic-1', 'New Chat'),
    activity('topic-2', 'Review plan', {
      identityAvatar: '🧭',
      identityName: 'Planning Agent',
      state: 'awaiting-confirmation',
      statusText: 'Waiting'
    })
  ]
  mocks.initData = expandedSnapshot({
    presentation,
    notchWidth: presentation === 'notch' ? 120 : undefined,
    activityCountText: 'Total: 2',
    activities
  })
  render(<ConversationIsland />)

  const summary = screen.getByTestId('expanded-summary')
  expect(within(summary).getByText('Responding')).toBeVisible()
  expect(within(summary).getByText('Total: 2')).toBeVisible()

  const rows = screen.getAllByRole('button')
  expect(rows).toHaveLength(2)
  expect(within(rows[0]).getByText('Cherry Assistant')).toBeVisible()
  expect(within(rows[0]).getByText('New Chat')).toBeVisible()
  expect(within(rows[1]).getByText('Planning Agent')).toBeVisible()
  expect(within(rows[1]).getByText('Waiting')).toBeVisible()
  expect(within(rows[1]).getByText('Review plan')).toBeVisible()
})
```

把六条滚动用例收敛为批准的布局合同：

```tsx
it('shows four 52px activity rows before scrolling without permanent primary emphasis', () => {
  const activities = Array.from({ length: 6 }, (_, index) =>
    activity(`topic-${index + 1}`, `Activity ${index + 1}`, {
      statusText: index === 2 ? 'Waiting' : 'Responding',
      state: index === 2 ? 'awaiting-confirmation' : 'streaming'
    })
  )
  mocks.initData = expandedSnapshot({ activityId: 'topic-3', activities, secondaryCount: 5 })
  render(<ConversationIsland />)

  const rows = screen.getAllByRole('button')
  expect(rows).toHaveLength(6)
  for (const row of rows) expect(row).toHaveClass('h-[52px]')

  // Permanent fill would again make Primary Activity look selected rather than merely first in priority order.
  expect(screen.getByRole('button', { name: 'Waiting: Activity 3' })).not.toHaveClass(
    'bg-accent',
    'bg-white/10',
    'font-medium'
  )
  expect(screen.getByRole('list')).toHaveClass('max-h-[208px]', 'overflow-y-auto')
})
```

- [ ] **步骤 3：运行 RED 测试并记录失败原因**

```bash
pnpm test src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
pnpm test src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

预期：

- geometry 仍返回 capsule `60/104/236` 与 notch `82/126/258`；
- service 仍以 `(presentation, activityCount)` 调用尺寸函数；
- compact 标题/状态位置、capsule header、两层 activity row、52 px 高度和无永久 Primary 背景断言失败。

- [ ] **步骤 4：实现 presentation-independent 几何**

把 `macScreenGeometry.ts` 的尺寸常量与函数替换为：

```ts
const EXPANDED_WIDTH = 420
const EXPANDED_HEADER_HEIGHT = 38
const SINGLE_DETAIL_HEIGHT = 44
const ACTIVITY_LIST_ROW_HEIGHT = 52

export const COMPACT_ISLAND_SIZE: ConversationIslandSize = { width: 320, height: 38 }
export const MAX_VISIBLE_EXPANDED_ROWS = 4

export function resolveConversationIslandSize(activityCount: number): ConversationIslandSize {
  const contentHeight =
    activityCount === 1
      ? SINGLE_DETAIL_HEIGHT
      : Math.min(MAX_VISIBLE_EXPANDED_ROWS, activityCount) * ACTIVITY_LIST_ROW_HEIGHT

  return { width: EXPANDED_WIDTH, height: EXPANDED_HEADER_HEIGHT + contentHeight }
}
```

删除 `CAPSULE_VERTICAL_PADDING` 和旧 `EXPANDED_ROW_HEIGHT`。在 `ConversationIslandService.refreshPresentation()` 改为：

```ts
const size = resolveConversationIslandSize(activities.length)
```

- [ ] **步骤 5：实现 compact 与统一 expanded summary**

将 `stateIndicator()` 提升为无状态 `StateIndicator` 组件，继续使用既有 `STATE_INDICATOR_CLASS`：

```tsx
function StateIndicator({ state }: { state: ConversationIslandStateKind }) {
  return (
    <span
      data-testid="state-indicator"
      className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[state]}`}
      aria-hidden="true"
    />
  )
}
```

在解析 `surfaceModel` 后建立统一 summary。`expanded-summary` 是 feature-owned 稳定 selector；只有物理遮挡仍使用 notch 专用 selector：

```tsx
const isSingleDetail = surfaceModel.kind === 'single-detail'
const ActivityIcon = snapshot.target.conversationType === 'agent' ? Bot : MessageCircle

const expandedSummary = surfaceModel.kind === 'compact' ? null : (
  <div
    data-testid="expanded-summary"
    className={
      usesNotchLayout
        ? 'grid h-[38px] w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] text-xs'
        : 'grid h-[38px] w-full grid-cols-2 text-xs'
    }>
    <div className="flex min-w-0 items-center gap-2 overflow-hidden px-3 text-left">
      {isSingleDetail ? (
        <>
          <IdentityAvatar avatar={snapshot.identityAvatar} />
          <span className="min-w-0 truncate">{snapshot.identityName}</span>
        </>
      ) : (
        <>
          <ActivityIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <StateIndicator state={snapshot.state} />
          <span className="min-w-0 truncate">{snapshot.statusText}</span>
        </>
      )}
    </div>
    {usesNotchLayout ? (
      <div data-testid="notch-expanded-occlusion" aria-hidden="true" style={{ width: snapshot.notchWidth }} />
    ) : null}
    <div
      className={`flex min-w-0 items-center justify-end gap-2 overflow-hidden px-3 ${
        usesNotchLayout ? 'text-white/60' : 'text-muted-foreground'
      }`}>
      {isSingleDetail ? (
        <>
          <StateIndicator state={snapshot.state} />
          <span className="min-w-0 truncate">{snapshot.statusText}</span>
        </>
      ) : (
        <span className="min-w-0 truncate">{snapshot.activityCountText}</span>
      )}
    </div>
  </div>
)
```

compact notch 与 capsule 都按以下语义顺序渲染：leading 为 `StateIndicator + title`，trailing 为 `status + total badge`。完整 compact 内容分支为：

```tsx
const totalBadge =
  surfaceModel.kind === 'compact' && surfaceModel.totalCount > 1 ? (
    <span
      aria-label={snapshot.activityCountText}
      className={
        usesNotchLayout
          ? 'shrink-0 rounded-full bg-white/10 px-1.5 text-white/70'
          : 'shrink-0 rounded-full bg-accent px-1.5 text-muted-foreground'
      }>
      {surfaceModel.totalCount}
    </span>
  ) : null

const compactContent = usesNotchLayout ? (
  <span className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
    <span data-testid="notch-leading" className="flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-left">
      <StateIndicator state={snapshot.state} />
      <span className="min-w-0 truncate text-white">{snapshot.title}</span>
    </span>
    <span data-testid="notch-occlusion" aria-hidden="true" style={{ width: snapshot.notchWidth }} />
    <span data-testid="notch-trailing" className="flex min-w-0 items-center justify-end gap-2 overflow-hidden pr-3">
      <span className="min-w-0 truncate text-white/60">{snapshot.statusText}</span>
      {totalBadge}
    </span>
  </span>
) : (
  <span className="flex w-full min-w-0 items-center gap-3">
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <StateIndicator state={snapshot.state} />
      <span className="min-w-0 truncate text-left text-popover-foreground">{snapshot.title}</span>
    </span>
    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
      <span>{snapshot.statusText}</span>
      {totalBadge}
    </span>
  </span>
)

const compactSurface = (
  <Button
    type="button"
    variant="ghost"
    aria-hidden={snapshot.exiting ? true : undefined}
    disabled={snapshot.exiting}
    onClick={() => void openActivity(snapshot)}
    onPointerEnter={handlePointerEnter}
    onPointerLeave={handlePointerLeave}
    data-testid="conversation-island-surface"
    data-state={snapshot.state}
    className={`${
      usesNotchLayout
        ? 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black px-0 py-0 text-xs text-white shadow-none hover:bg-black hover:text-white focus-visible:bg-black focus-visible:text-white'
        : 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-full border border-border bg-popover/95 px-3 py-0 text-xs text-popover-foreground shadow-md backdrop-blur-xs hover:bg-accent focus-visible:bg-accent'
    } ${snapshot.exiting ? 'pointer-events-none' : ''}`}>
    {compactContent}
  </Button>
)
```

不要再渲染 `+{snapshot.secondaryCount}`。

- [ ] **步骤 6：实现 single detail 与 52 px activity list**

expanded 外壳不再让 capsule 使用 `p-2`，两种 presentation 都先渲染 `expandedSummary`。先定义 single detail 的 44 px 标题按钮：

```tsx
const singleDetail =
  surfaceModel.kind === 'single-detail' ? (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${snapshot.statusText}: ${snapshot.title}`}
      disabled={snapshot.exiting}
      onClick={() => void openExpandedActivity(surfaceModel.activity)}
      className={
        usesNotchLayout
          ? 'h-11 min-h-11 w-full justify-start rounded-none border-t border-white/10 px-3 text-xs text-white hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white'
          : 'h-11 min-h-11 w-full justify-start rounded-none border-t border-border px-3 text-xs text-popover-foreground hover:bg-accent focus-visible:bg-accent'
      }>
      <span className="min-w-0 flex-1 truncate text-left">{snapshot.title}</span>
    </Button>
  ) : null
```

activity list 使用 `max-h-[208px]`，每个按钮完整渲染两层信息：

```tsx
const activityList =
  surfaceModel.kind === 'activity-list' ? (
    <div
      role="list"
      className={`max-h-[208px] overflow-y-auto border-t ${usesNotchLayout ? 'border-white/10' : 'border-border'}`}>
      {surfaceModel.activities.map((activity) => (
        <div role="listitem" key={activity.activityId}>
          <Button
            type="button"
            variant="ghost"
            aria-label={`${activity.statusText}: ${activity.title}`}
            data-state={activity.state}
            disabled={snapshot.exiting}
            onClick={() => void openExpandedActivity(activity)}
            className={
              usesNotchLayout
                ? 'h-[52px] min-h-[52px] w-full min-w-0 flex-col items-stretch justify-center gap-1 rounded-none px-3 py-0 text-xs font-normal text-white shadow-none hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white'
                : 'h-[52px] min-h-[52px] w-full min-w-0 flex-col items-stretch justify-center gap-1 rounded-none px-3 py-0 text-xs font-normal text-popover-foreground shadow-none hover:bg-accent focus-visible:bg-accent'
            }>
            <span
              className={`flex w-full min-w-0 items-center gap-1.5 text-[11px] leading-4 ${
                usesNotchLayout ? 'text-white/60' : 'text-muted-foreground'
              }`}>
              <IdentityAvatar avatar={activity.identityAvatar} />
              <span className="min-w-0 flex-1 truncate text-left">{activity.identityName}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <StateIndicator state={activity.state} />
                <span>{activity.statusText}</span>
              </span>
            </span>
            <span className="min-w-0 truncate pl-6 text-left text-xs text-inherit">{activity.title}</span>
          </Button>
        </div>
      ))}
    </div>
  ) : null
```

不要读取 `primaryActivityId` 来加背景或字重；顺序本身表达优先级。最后用同一个 expanded 外壳组合 summary 和 body：

```tsx
const expandedContent = (
  <div
    data-testid="conversation-island-surface"
    data-state={snapshot.state}
    aria-hidden={snapshot.exiting ? true : undefined}
    onPointerEnter={handlePointerEnter}
    onPointerLeave={handlePointerLeave}
    className={`${
      usesNotchLayout
        ? 'h-full w-full overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black text-white'
        : 'h-full w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md'
    } ${snapshot.exiting ? 'pointer-events-none' : ''}`}>
    {expandedSummary}
    {singleDetail ?? activityList}
  </div>
)

const surface = surfaceModel.kind === 'compact' ? compactSurface : expandedContent
```

外层 Motion 内容 key 改为：

```tsx
key={surfaceModel.kind}
```

这样 compact、single-detail 与 activity-list 间按既有 spring/crossfade 切换，presentation 变化不会制造新的业务 surface。

- [ ] **步骤 7：运行 GREEN、lint 与格式检查**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandSurface.test.ts
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts
pnpm test src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
pnpm test src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
pnpm lint
git diff --check
```

预期：全部 PASS；`pnpm lint` 无 i18n、类型、格式错误。因为 `pnpm lint` 会写文件，运行后重新查看 `git diff --stat`，确认只触及本任务文件。

- [ ] **步骤 8：创建完整行为提交**

```bash
git add src/renderer/windows/conversationIsland/ConversationIsland.tsx \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx \
  src/main/services/conversationIsland/macScreenGeometry.ts \
  src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts \
  src/main/services/conversationIsland/ConversationIslandService.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git diff --cached --check
git diff --cached --stat
git commit -S --signoff -m "fix(conversation-island): unify activity surface hierarchy"
```

## 任务 3：集中自审与 Electron 运行时验收

**文件：**

- 检查：本计划列出的全部生产与测试文件
- 运行时证据：`.context/cherry-electron-dev/`（gitignored，不提交）

- [ ] **步骤 1：使用仓库验证技能做集中自审**

读取并执行 `cherry-change-verification`；检查：

- diff 是否只实现批准规格；
- 是否出现可删除的重复分支、无消费抽象或硬编码可见字符串；
- surface resolver 是否仍是 renderer 私有；
- notch/capsule 是否只在物理布局上分叉；
- 每个新增测试是否会因对应生产回归而失败，并能经受等价重构。

运行：

```bash
git diff 57e45db64d...HEAD --check
git diff 57e45db64d...HEAD --stat
git status --short
```

预期：两个签名提交构成全部实现差异，工作区干净。

- [ ] **步骤 2：重复最窄完整验证**

```bash
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandSurface.test.ts
pnpm test src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
pnpm test src/renderer/windows/conversationIsland/__tests__/conversationIslandMotion.test.ts
pnpm test src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
pnpm test src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
pnpm lint
git status --short
```

预期：全部 PASS，lint 后工作区仍干净。无需运行全仓 `pnpm test`：改动限于 renderer window 与 feature-local 几何函数，最接近的 main/renderer 契约测试已覆盖跨层边界。

- [ ] **步骤 3：按 persistent policy 建立可信 Electron 实例**

严格使用 `.agents/skills/cherry-electron-dev/references/electron-instance.md`：

1. 重新验证 `instance.json` 的 PID、cwd、CDP listener、target URL 和 launch HEAD；
2. 发现同 workspace 实例时先验证，不能因端口存在就认领；
3. 本变更包含 main 几何代码，launch HEAD 不一致时不能只依赖 HMR；
4. 只能按文档优雅替换经验证的旧实例，绝不 broad `pkill` 或停止未验证的用户进程；
5. 启动/借用后把真实 PID、CDP port、target URL 与当前 HEAD 写回 `instance.json`；
6. 使用 persistent policy，验收结束后让健康实例继续运行。

实例验证命令：

```bash
jq '{workspace, launch_git_head, policy, ownership, workflow_relation, electron_pid, cdp_port, target_url}' .context/cherry-electron-dev/instance.json
git rev-parse HEAD
ps -axo pid=,ppid=,pgid=,command= | rg -i 'Cherry Studio|CherryStudio|electron-vite|remote-debugging-port'
```

再用记录中的精确 PID/port 执行 reference 规定的 `lsof` 与 `/json/list` 检查，匹配 `/windows/main/index.html`，不得假定 target index 0。

- [ ] **步骤 4：验证四态、滚动与 presentation parity**

在可信 CDP 会话中复用现有 cache activity 注入方式，保存证据：

```text
.context/cherry-electron-dev/conversation-island-surface-single-compact.png
.context/cherry-electron-dev/conversation-island-surface-multi-compact.png
.context/cherry-electron-dev/conversation-island-surface-single-expanded.png
.context/cherry-electron-dev/conversation-island-surface-multi-expanded.png
.context/cherry-electron-dev/conversation-island-surface-capsule.png
.context/cherry-electron-dev/conversation-island-surface-evidence.json
```

逐项断言：

1. single compact 为 320 × 38，标题在状态之前且无数量 badge；
2. multi compact 为 320 × 38，显示总数而非 `+N`；
3. single hover 在 500 ms 后变为 420 × 82，顶部为身份/状态，底部为标题；
4. two/three/four/five activities 分别为 142/194/246/246 px；
5. 第 5 条可滚动，顶部 summary 固定；
6. multi summary 保留 Primary 状态与本地化总数；每行按身份/状态/标题阅读；
7. 无行永久高亮，只在真实 hover/focus 时出现轻量背景；
8. 强制或模拟 capsule 后，信息与 notch 等价，仅遮挡区、圆角和主题表面不同；
9. leave 250 ms 收起，点击仍先收起再导航，reduced-motion 不播放 spring/crossfade；
10. 清除所有临时 cache activity，恢复原 preference。

- [ ] **步骤 5：最终签名、状态与运行时交接检查**

```bash
git log -2 --show-signature --format=fuller
git cat-file commit HEAD | rg '^(gpgsig|Signed-off-by:)'
git status --short
jq '{electron_pid, cdp_port, target_url, policy, ownership, workflow_relation, launch_git_head}' .context/cherry-electron-dev/instance.json
```

预期：实现提交均有签名与 DCO sign-off；工作区干净；健康 Electron 实例仍运行。交付时报告 PID、CDP port、tracking file、截图/JSON 路径、测试结果，以及未运行全仓测试的范围理由。

## 完成定义

- 四态 resolver、UI 与 bounds 合同全部通过测试。
- compact 标题优先；multi compact 使用总数。
- single detail 和 multi rows 共享身份/状态/标题语法。
- multi 顶部统计保留；Primary 无永久选中面。
- notch/capsule 信息等价。
- 多条行高 52 px、最多 4 条可见、最大高度 246 px。
- 现有 timer、导航、exit、motion 与 reduced-motion 行为保持。
- `pnpm lint` 和所有列出的 targeted tests 通过。
- Electron 四态和 capsule parity 已留存运行时证据，临时状态已清理，实例保持运行。
