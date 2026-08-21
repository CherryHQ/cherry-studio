# macOS 对话灵动岛刘海避让实现计划

> **状态：已被取代。** 本计划记录当前分支的历史实施步骤，但其固定窗口尺寸和 `show_title` 约束已由 [`macOS Conversation Island Design`](../specs/2026-08-21-macos-conversation-island-design.md) 取代。不得继续执行本计划的未完成步骤；设计规格复核后应另写实现计划。

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让已识别刘海屏上的 Conversation Island 使用黑色两翼布局，并按真实刘海宽度严格避开中央物理遮挡区，同时保持普通屏幕胶囊不变。

**架构：** 现有 AppKit 几何探针已经计算了可信的 notch gap；本改动只把该宽度从 feature-local placement 传入现有 WindowManager init-data snapshot。渲染器将合法的 notch snapshot 分成状态翼、中央遮挡区和标题翼，非法或缺失宽度继续按 capsule 渲染。窗口生命周期、尺寸、活动仲裁和性能模型都不改变。

**技术栈：** Electron、TypeScript、React、Tailwind CSS、`@cherrystudio/ui`、Vitest、Testing Library、AppKit JXA probe

---

## 文件结构

- 修改 `src/main/services/conversationIsland/macScreenGeometry.ts`：让已验证的 notch placement 携带 `notchWidth`，fallback 不携带。
- 修改 `src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts`：锁定真实 gap 宽度的几何契约。
- 修改 `src/shared/types/conversationIsland.ts`：给现有 snapshot 增加仅 notch 模式使用的可选宽度。
- 修改 `src/main/services/conversationIsland/ConversationIslandService.ts`：原样转发 placement 的 presentation 与宽度，不重新计算几何。
- 修改 `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`：验证主进程把宽度送入首次及后续 init data。
- 修改 `src/renderer/windows/conversationIsland/ConversationIsland.tsx`：实现合法 notch 的黑色三列布局，并保留 capsule 分支。
- 修改 `src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`：验证中央留空、黑色处理、内容归属和非法宽度 fallback。

## 约束

- 不新增 preference、IPC route、window、timer、polling、dependency 或 native helper。
- 不改变固定的 `320 × 38` 活动窗口尺寸；两翼文字在不足时截断。
- 不把物理刘海宽度从窗口宽度反推；只信任 `macScreenGeometry` 已验证的 gap。
- 不运行全量 `pnpm test`，遵守用户明确要求；只运行三个受影响测试文件以及仓库 lint/build/docs 门禁。

### 任务 1：让几何 placement 暴露可信的物理刘海宽度

**文件：**
- 修改：`src/main/services/conversationIsland/macScreenGeometry.ts:59-62,134-178`
- 测试：`src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts:20-57`

- [ ] **步骤 1：把合法 notch gap 的期望宽度写进失败测试**

在第一个几何测试中把期望值改为：

```ts
expect(resolveConversationIslandBounds(display, geometries, 320)).toEqual({
  bounds: { x: 1400, y: 24, width: 320, height: 38 },
  presentation: 'notch',
  notchWidth: 120
})
```

保留现有 capsule 测试的完整对象断言；它不应出现 `notchWidth`，因此同时保护 fallback 不泄漏无效遮挡宽度。

- [ ] **步骤 2：运行几何测试，确认新增契约当前失败**

运行：

```bash
pnpm exec vitest run --silent --project main \
  src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
```

预期：FAIL；合法 notch placement 缺少 `notchWidth: 120`，其余几何用例仍通过。

- [ ] **步骤 3：在 placement 类型和合法 notch 返回值中加入宽度**

将 placement 类型改为：

```ts
export interface ConversationIslandPlacement {
  bounds: Rectangle
  presentation: 'notch' | 'capsule'
  notchWidth?: number
}
```

仅在通过顶部、宽度和居中校验的返回对象中增加：

```ts
return {
  bounds: {
    x: Math.round(display.bounds.x + (gapCenter - frame.x) - width / 2),
    y: Math.round(display.bounds.y),
    width,
    height: ISLAND_HEIGHT
  },
  presentation: 'notch',
  notchWidth: gapWidth
}
```

不要修改 `fallbackPlacement()`；缺字段就是 capsule 无物理遮挡区的契约。

- [ ] **步骤 4：运行几何测试，确认合法与 fallback 契约都通过**

运行：

```bash
pnpm exec vitest run --silent --project main \
  src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
```

预期：PASS；全部 7 个现有/新增参数化用例通过。

- [ ] **步骤 5：提交几何契约**

```bash
git add src/main/services/conversationIsland/macScreenGeometry.ts \
  src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
git commit -S --signoff -m "feat(conversation-island): expose physical notch width"
```

### 任务 2：把 notch 宽度转发到跨进程 snapshot

**文件：**
- 修改：`src/shared/types/conversationIsland.ts:5-14`
- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts:17-21,251-298`
- 测试：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts:291-316`

- [ ] **步骤 1：编写宽度转发的失败测试**

在 service 测试的 snapshot 用例附近增加：

```ts
it('forwards the measured physical notch width to initial and updated snapshots', () => {
  mocks.geometryResolve.mockReturnValue({
    bounds: { x: 596, y: 0, width: 320, height: 38 },
    presentation: 'notch',
    notchWidth: 184
  })
  changePreference('feature.conversation_island.enabled', true)

  emitActivity('pending', 100)
  emitActivity('streaming', 200)

  expect(services.windowManager.open.mock.calls[0][1]).toMatchObject({
    initData: { presentation: 'notch', notchWidth: 184 }
  })
  expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
    presentation: 'notch',
    notchWidth: 184
  })
})
```

- [ ] **步骤 2：运行 service 测试，确认宽度尚未转发**

运行：

```bash
pnpm exec vitest run --silent --project main \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：FAIL；`initData` 有 `presentation: 'notch'`，但没有 `notchWidth`。

- [ ] **步骤 3：扩展 snapshot 类型并让 service 接收完整 placement**

在共享类型中增加可选字段：

```ts
export interface ConversationIslandSnapshot {
  activityId: string
  target: ConversationNavigationTarget
  state: ConversationIslandStateKind
  statusText: string
  title?: string
  navigationTitle: string
  secondaryCount: number
  presentation: 'notch' | 'capsule'
  notchWidth?: number
}
```

在 service 中把几何 import 改为同时导入 placement 类型：

```ts
import {
  type ConversationIslandPlacement,
  type MacScreenGeometry,
  probeMacScreenGeometry,
  resolveConversationIslandBounds
} from './macScreenGeometry'
```

把 snapshot 构建调用改为：

```ts
const snapshot = this.buildSnapshot(selection.primary, selection.secondaryCount, placement)
```

把 `buildSnapshot` 的第三个参数和返回字段改为：

```ts
private buildSnapshot(
  activity: ConversationIslandActivity,
  secondaryCount: number,
  placement: ConversationIslandPlacement
): ConversationIslandSnapshot {
  const fallback = activity.target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
  let title: string | undefined
  if (this.showTitle) {
    const cached = this.titleCache.get(activity.topicId)
    title = cached && cached.turnId === activity.turnId ? cached.title : undefined
    if (title === undefined) {
      title = application.get('NotificationService').resolveConversationName(activity.target)
      this.titleCache.set(activity.topicId, { turnId: activity.turnId, title })
    }
  }

  return {
    activityId: activity.topicId,
    target: activity.target,
    state: snapshotState(activity.status),
    statusText: statusText(activity),
    title,
    navigationTitle: title ?? fallback,
    secondaryCount,
    presentation: placement.presentation,
    notchWidth: placement.notchWidth
  }
}
```

不要在 service 中重新校验或重算 gap；几何 owner 已经完成校验。

- [ ] **步骤 4：运行 service 测试，确认 snapshot 契约通过**

运行：

```bash
pnpm exec vitest run --silent --project main \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：PASS；现有生命周期、标题缓存、TTL 和显示器用例不变，新用例确认 `184` 原样转发。

- [ ] **步骤 5：提交 snapshot 转发**

```bash
git add src/shared/types/conversationIsland.ts \
  src/main/services/conversationIsland/ConversationIslandService.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git commit -S --signoff -m "feat(conversation-island): forward notch occlusion width"
```

### 任务 3：实现黑色两翼布局并保留 capsule 回归

**文件：**
- 修改：`src/renderer/windows/conversationIsland/ConversationIsland.tsx:17-59`
- 测试：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx:26-91`

- [ ] **步骤 1：编写 notch 两翼和非法宽度 fallback 的失败测试**

在 renderer 测试中增加：

```tsx
it('keeps notch content in two wings around the measured occlusion', () => {
  mocks.initData = snapshot({
    presentation: 'notch',
    notchWidth: 120,
    title: 'Research notes',
    secondaryCount: 2
  })
  const view = render(<ConversationIsland />)

  const button = screen.getByRole('button')
  const leading = screen.getByTestId('notch-leading')
  const occlusion = screen.getByTestId('notch-occlusion')
  const trailing = screen.getByTestId('notch-trailing')

  expect(button).toHaveClass('bg-black', 'border-transparent')
  expect(button).not.toHaveClass('backdrop-blur-xs')
  expect(occlusion).toHaveStyle({ width: '120px' })
  expect(leading).toContainElement(screen.getByText('Responding'))
  expect(trailing).toContainElement(screen.getByText('Research notes'))
  expect(trailing).toContainElement(screen.getByText('+2'))

  mocks.initData = snapshot({ presentation: 'notch', notchWidth: 120, secondaryCount: 2 })
  view.rerender(<ConversationIsland />)

  expect(screen.queryByText('Research notes')).toBeNull()
  expect(screen.getByTestId('notch-trailing')).toContainElement(screen.getByText('+2'))
})

it('keeps capsule styling for capsule snapshots and invalid notch widths', () => {
  mocks.initData = snapshot()
  const view = render(<ConversationIsland />)

  expect(screen.queryByTestId('notch-occlusion')).toBeNull()
  expect(screen.getByRole('button')).toHaveClass('rounded-full', 'bg-popover/95')

  mocks.initData = snapshot({ presentation: 'notch', notchWidth: undefined })
  view.rerender(<ConversationIsland />)

  expect(screen.queryByTestId('notch-occlusion')).toBeNull()
  expect(screen.getByRole('button')).toHaveClass('rounded-full', 'bg-popover/95')
})
```

- [ ] **步骤 2：运行 renderer 测试，确认布局与 fallback 用例失败**

运行：

```bash
pnpm exec vitest run --silent --project renderer \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

预期：FAIL；当前连续 flex 行没有三翼 test id、中央宽度或 `bg-black`，缺宽度时仍使用 notch 圆角。

- [ ] **步骤 3：实现合法宽度 gate 和两种渲染分支**

在读取 snapshot 后定义：

```tsx
const usesNotchLayout =
  snapshot.presentation === 'notch' &&
  typeof snapshot.notchWidth === 'number' &&
  Number.isFinite(snapshot.notchWidth) &&
  snapshot.notchWidth > 0

const stateIndicator = (
  <span className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[snapshot.state]}`} aria-hidden="true" />
)
```

用以下结构替换当前 Button 内容；保留现有点击 handler、`data-state` 和状态色表：

```tsx
<Button
  type="button"
  variant="ghost"
  onClick={openConversation}
  data-state={snapshot.state}
  className={`h-full min-h-0 w-full min-w-0 overflow-hidden py-0 text-xs shadow-md ${
    usesNotchLayout
      ? 'justify-start gap-0 rounded-t-none rounded-b-xl border border-transparent bg-black px-0 text-white hover:bg-black focus-visible:bg-black'
      : 'justify-start rounded-full border border-border bg-popover/95 px-3 text-popover-foreground backdrop-blur-xs hover:bg-accent focus-visible:bg-accent'
  }`}>
  {usesNotchLayout ? (
    <span className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
      <span
        data-testid="notch-leading"
        className="flex min-w-0 items-center gap-2 overflow-hidden pl-3">
        {stateIndicator}
        <span className="min-w-0 truncate font-medium">{snapshot.statusText}</span>
      </span>
      <span
        data-testid="notch-occlusion"
        className="h-full shrink-0"
        style={{ width: snapshot.notchWidth }}
        aria-hidden="true"
      />
      <span
        data-testid="notch-trailing"
        className="flex min-w-0 items-center justify-end gap-1 overflow-hidden pr-3">
        {snapshot.title ? (
          <span className="min-w-0 truncate text-left text-white/60">{snapshot.title}</span>
        ) : null}
        {snapshot.secondaryCount > 0 ? (
          <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-white/70">
            +{snapshot.secondaryCount}
          </span>
        ) : null}
      </span>
    </span>
  ) : (
    <>
      {stateIndicator}
      <span className="shrink-0 font-medium">{snapshot.statusText}</span>
      {snapshot.title ? (
        <>
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{snapshot.title}</span>
        </>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {snapshot.secondaryCount > 0 ? (
        <span className="shrink-0 rounded-full bg-accent px-1.5 text-muted-foreground">
          +{snapshot.secondaryCount}
        </span>
      ) : null}
    </>
  )}
</Button>
```

不要增加 component state、effect 或 resize observer；布局只由 snapshot 派生。

- [ ] **步骤 4：运行 renderer 测试，确认两翼与 capsule 都通过**

运行：

```bash
pnpm exec vitest run --silent --project renderer \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

预期：PASS；新增 2 个行为用例及现有渲染、导航、错误隔离用例全部通过。

- [ ] **步骤 5：提交 renderer 布局**

```bash
git add src/renderer/windows/conversationIsland/ConversationIsland.tsx \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git commit -S --signoff -m "feat(conversation-island): avoid physical notch occlusion"
```

### 任务 4：完成定向门禁和真实刘海屏验证

**文件：**
- 检查：任务 1–3 的全部修改文件
- 证据：`.context/cherry-electron-dev/conversation-island-notch-wings.png`
- 跟踪：`.context/cherry-electron-dev/instance.json`

- [ ] **步骤 1：同时运行三个受影响测试文件**

运行：

```bash
pnpm exec vitest run --silent --project main \
  src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
pnpm exec vitest run --silent --project renderer \
  src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

预期：PASS；不要运行全量 `pnpm test`。

- [ ] **步骤 2：运行仓库 lint、文档和构建门禁**

依次运行：

```bash
pnpm lint
pnpm docs:check
pnpm exec electron-vite build
```

预期：三个命令均退出 0；记录既有 warning，但只修复由本改动引入的问题。

- [ ] **步骤 3：按 persistent policy 重新验证或精确替换跟踪实例**

先读取并验证记录：

```bash
instance_file=.context/cherry-electron-dev/instance.json
electron_pid=$(jq -r '.electron_pid' "$instance_file")
cdp_port=$(jq -r '.cdp_port' "$instance_file")
lsof -a -p "$electron_pid" -d cwd -Fn
lsof -nP -a -p "$electron_pid" -iTCP:"$cdp_port" -sTCP:LISTEN
curl -fsS "http://127.0.0.1:$cdp_port/json/list" | jq '.[] | {id, type, title, url}'
```

当前记录的 launch HEAD 早于任务 1–3 的 main-process 修改，因此必须按 `cherry-electron-dev/references/electron-instance.md` 的精确实例替换流程重启；只终止已验证的 Electron PID/runner，不使用 `pkill` 或进程组信号。使用原 profile suffix、CDP `9230`、inspector `9231`，更新 `instance.json` 后保持 policy 为 `persistent`。

- [ ] **步骤 4：在真实内置刘海屏检查 B 方案**

在跟踪实例中启用 Conversation Island 和标题显示，触发一个 Assistant 或 Agent Session 的 live activity，重新列出 CDP targets 并选择 `/windows/conversationIsland/index.html`。验证并截图：

- 窗口仍位于屏幕顶边且不抢焦点；
- 可见背景为不透明纯黑，与物理刘海连续；
- 状态圆点和状态文字只在左翼；
- 标题和 `+N` 只在右翼，中央没有可见文字；
- 长标题截断，不越过物理刘海；
- 关闭标题 preference 后右翼只保留 `+N`；
- 活动结束后窗口按原 TTL 销毁。

把证据保存为：

```text
.context/cherry-electron-dev/conversation-island-notch-wings.png
```

- [ ] **步骤 5：验证 capsule 回归并恢复偏好**

在非刘海/无法识别的 display 场景确认仍为主题化圆角 capsule，距顶边 8px，内容保持原连续单行。随后把 debug profile 的 `feature.conversation_island.enabled` 恢复为 `false`、`feature.conversation_island.show_title` 恢复为 `true`，并确认没有 island target。

- [ ] **步骤 6：最终自检提交对象**

运行：

```bash
git diff --check origin/main...HEAD
git status --short --branch
git log --format='%h %G? %s' origin/main..HEAD
```

预期：工作树干净；所有新增提交都有签名状态，提交对象均含 DCO sign-off。保持健康的 persistent Electron 实例运行，并在交付中报告 Electron PID、CDP 端口、tracking file 和截图路径。
