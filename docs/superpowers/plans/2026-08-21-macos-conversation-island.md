# macOS 对话灵动岛实现计划

> **状态：已被取代。** 本计划记录当前分支的历史实施步骤，但其“无悬停展开”和 `show_title` 约束已由 [`macOS Conversation Island Design`](../specs/2026-08-21-macos-conversation-island-design.md) 取代。后续工作改用 [`macOS 对话灵动岛悬停展开实现计划`](./2026-08-21-macos-conversation-island-hover-expansion.md)。

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 macOS 上增加默认关闭、按对话状态惰性显示的 Conversation Island，同时让它与现有系统通知共用 `NotificationService` 的状态、标题和跳转归一化逻辑。

**架构：** `NotificationService` 通过两条现有 Cache 模板订阅产出统一的进程内 `ConversationActivityChangedEvent`；现有系统通知继续只展示完成和待确认，新的 macOS 条件生命周期服务消费完整状态流并维护短生命周期活动表。该服务仅在有可见活动时创建一个无焦点 Electron panel，主进程计算优先级、文案和显示器位置，极简 React renderer 只负责绘制和调用已有导航 IPC。

**技术栈：** Electron、TypeScript、React、Vitest、`@cherrystudio/ui`、Tailwind CSS、Preference、Cache、IpcApi、WindowManager、JXA/AppKit。

---

## 实施前约束

- 先阅读并遵守 `CLAUDE.local.md`（若存在）、`DESIGN.md`、`docs/references/testing/frontend-testing.md`、`docs/references/lifecycle/README.md`、`docs/references/window-manager/README.md`、`docs/references/ipc/README.md` 和 `docs/references/data/preference-overview.md`。
- 不修改 `AiStreamManager`、`CacheService`、Cache 模板匹配规则、`WindowManager` 公共契约、DataApi、数据库或迁移。
- 不添加原生二进制、第三方 Dynamic Island 依赖、常驻窗口、轮询、声音、悬停展开、消息正文或逐 token 更新。
- 每次提交执行 `git commit -S --signoff`，再用 `git cat-file commit HEAD | rg '^gpgsig '` 验证签名。
- 每个测试必须保护产品契约，不添加快照、仅“能渲染”的测试或普通样式类名测试。

## 文件职责总览

### 修改

- `src/main/services/NotificationService.ts`：唯一的对话状态、导航目标和标题归一化入口；新增主进程事件。
- `src/main/services/__tests__/NotificationService.test.ts`：覆盖 Assistant/Agent 两类 Cache key 和既有系统通知行为不变。
- `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`：新增两个 v2-only Preference 定义。
- `src/shared/data/preference/preferenceSchemas.ts`：由生成器更新，禁止手改。
- `src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx`：macOS 专属开关。
- `src/main/core/window/types.ts`、`src/main/core/window/windowRegistry.ts`：新增惰性 singleton panel 类型。
- `src/main/core/window/__tests__/windowRegistry.invariants.test.ts`、`src/main/core/window/__tests__/windowRegistry.test.ts`：保护 sandbox、preload、全屏和 Dock 配置。
- `src/main/core/application/serviceRegistry.ts`：注册 macOS 条件服务。
- `electron.vite.config.ts`：新增 preload 和 renderer 入口。
- `src/main/i18n/locales/*.json`：主进程状态文案。
- `src/renderer/i18n/locales/*.json`：设置页文案。

### 新增

- `src/shared/types/conversationIsland.ts`：跨进程只读快照类型。
- `src/main/services/conversationIsland/activityReducer.ts`：纯状态归并、优先级、过期和 `+N`。
- `src/main/services/conversationIsland/macScreenGeometry.ts`：一次性 JXA 探测、严格解析和 fallback bounds。
- `src/main/services/conversationIsland/ConversationIslandService.ts`：偏好、事件、显示器、计时器和窗口编排。
- `src/main/services/conversationIsland/__tests__/*.test.ts`：reducer、geometry 和 service 契约测试。
- `src/preload/conversationIsland.ts`：自包含 IpcApi-only sandbox preload。
- `src/renderer/windows/conversationIsland/index.html`、`entryPoint.tsx`、`ConversationIsland.tsx` 及组件测试。
- `src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx`。

不要为 `conversationIsland` 增加 barrel `index.ts`：目前只有一个服务消费者，深层导入没有需要封闭的公共 API。

## 任务 1：让 NotificationService 成为统一对话状态源

**文件：**

- 修改：`src/main/services/__tests__/NotificationService.test.ts`
- 修改：`src/main/services/NotificationService.ts`

- [ ] 在测试的 hoisted mocks 中加入 `cacheSubscriptions`，按订阅模板保存 callback；`application.get('CacheService')` 返回只记录订阅的最小对象。

```ts
cacheSubscriptions: new Map<string, (value: unknown, oldValue: unknown, concreteKey: string) => void>()
```

```ts
if (name === 'CacheService') {
  return {
    subscribeSharedChange: (
      key: string,
      listener: (value: unknown, oldValue: unknown, concreteKey: string) => void
    ) => {
      mocks.cacheSubscriptions.set(key, listener)
      return vi.fn()
    }
  }
}
```

- [ ] 先写两个失败测试。第一个向普通 topic 模板 listener 传入普通 key，第二个向 Agent 模板 listener 传入带冒号 key；两者都必须得到同形事件。

```ts
it.each([
  {
    pattern: 'topic.stream.statuses.${topicId}',
    concreteKey: 'topic.stream.statuses.topic-1',
    target: { conversationType: 'assistant', conversationId: 'topic-1' }
  },
  {
    pattern: 'topic.stream.statuses.agent-session:${sessionId}',
    concreteKey: 'topic.stream.statuses.agent-session:session-1',
    target: { conversationType: 'agent', conversationId: 'session-1' }
  }
])('normalizes $concreteKey into one conversation activity event', ({ pattern, concreteKey, target }) => {
  const listener = vi.fn()
  service.onConversationActivityChanged(listener)
  const snapshot = {
    status: 'streaming' as const,
    turnId: 'turn-1',
    activeExecutions: [],
    awaitingApprovalAnchors: []
  }

  mocks.cacheSubscriptions.get(pattern)?.(snapshot, null, concreteKey)

  expect(listener).toHaveBeenCalledWith({
    topicId: target.conversationType === 'agent' ? 'agent-session:session-1' : 'topic-1',
    target,
    snapshot,
    changedAt: expect.any(Number)
  })
})
```

- [ ] 运行测试，确认新增两例因事件 API 和 Cache 订阅不存在而失败，既有完成/待确认测试继续通过。

```bash
pnpm exec vitest run --silent --project main src/main/services/__tests__/NotificationService.test.ts
```

- [ ] 在 `NotificationService.ts` 增加主进程事件契约和 emitter。删除 Cache 时以 `snapshot: null` 发出，不能丢事件。

```ts
export interface ConversationActivityChangedEvent {
  topicId: string
  target: ConversationNavigationTarget
  snapshot: TopicStatusSnapshotEntry | null
  changedAt: number
}
```

```ts
private readonly _onConversationActivityChanged = this.registerDisposable(
  new Emitter<ConversationActivityChangedEvent>()
)
public readonly onConversationActivityChanged: Event<ConversationActivityChangedEvent> =
  this._onConversationActivityChanged.event
```

- [ ] 在 `onInit()` 注册两条模板订阅，并集中解析 concrete key。普通模板不会匹配冒号，Agent 模板把冒号放在固定前缀中，因此无需修改 Cache 基础设施。

```ts
const TOPIC_STATUS_PREFIX = 'topic.stream.statuses.'

private emitConversationActivity(snapshot: TopicStatusSnapshotEntry | null | undefined, concreteKey: string): void {
  const topicId = concreteKey.slice(TOPIC_STATUS_PREFIX.length)
  if (!topicId) return
  this._onConversationActivityChanged.fire({
    topicId,
    target: this.resolveConversationTarget(topicId),
    snapshot: snapshot ?? null,
    changedAt: Date.now()
  })
}
```

```ts
const cacheService = application.get('CacheService')
this.registerDisposable(
  cacheService.subscribeSharedChange('topic.stream.statuses.${topicId}', (snapshot, _old, key) =>
    this.emitConversationActivity(snapshot, key)
  )
)
this.registerDisposable(
  cacheService.subscribeSharedChange('topic.stream.statuses.agent-session:${sessionId}', (snapshot, _old, key) =>
    this.emitConversationActivity(snapshot, key)
  )
)
```

- [ ] 将 `resolveConversationName` 改为 public，保持 target 解析私有。系统通知仍只从既有 completion/approval 事件触发，绝不能从 Cache 事件触发。

- [ ] 重新运行测试并提交。

```bash
pnpm exec vitest run --silent --project main src/main/services/__tests__/NotificationService.test.ts
git add src/main/services/NotificationService.ts src/main/services/__tests__/NotificationService.test.ts
git commit -S --signoff -m "feat(notification): expose conversation activity source"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 2：实现一次性 AppKit 几何探测和 fallback

**文件：**

- 新增：`src/main/services/conversationIsland/macScreenGeometry.ts`
- 新增：`src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts`

- [ ] 先写纯函数测试：合法双辅助区得到 notch presentation；缺字段、非有限数字、负尺寸、左右区重叠、过大 gap、display ID 不匹配都得到 capsule fallback；外接屏 bounds 使用该屏坐标而非主屏坐标。

```ts
expect(resolveConversationIslandBounds(display, geometry, 320)).toEqual({
  bounds: { x: 1400, y: 0, width: 320, height: 38 },
  presentation: 'notch'
})
```

- [ ] 运行并确认模块不存在导致失败。

```bash
pnpm exec vitest run --silent --project main src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
```

- [ ] 实现 `parseMacScreenGeometry(raw: string)`：只接受 JSON array，逐字段 `Number.isFinite`，尺寸必须非负，screen number 必须是整数；任何一行非法时丢弃该行，不让异常越过 feature boundary。

- [ ] 实现常量 JXA 脚本。脚本不拼接用户输入，只输出 `screenNumber`、`frame`、`safeAreaInsets`、`auxiliaryTopLeftArea`、`auxiliaryTopRightArea`。

```ts
const SCREEN_GEOMETRY_JXA = String.raw`
ObjC.import('AppKit')
function rect(value) {
  return {
    x: Number(value.origin.x),
    y: Number(value.origin.y),
    width: Number(value.size.width),
    height: Number(value.size.height)
  }
}
function main() {
  return JSON.stringify($.NSScreen.screens.js.map((screen) => ({
    screenNumber: Number(screen.deviceDescription.objectForKey('NSScreenNumber').js),
    frame: rect(screen.frame),
    safeAreaInsets: {
      top: Number(screen.safeAreaInsets.top),
      left: Number(screen.safeAreaInsets.left),
      bottom: Number(screen.safeAreaInsets.bottom),
      right: Number(screen.safeAreaInsets.right)
    },
    auxiliaryTopLeftArea: rect(screen.auxiliaryTopLeftArea),
    auxiliaryTopRightArea: rect(screen.auxiliaryTopRightArea)
  })))
}
`
```

- [ ] 实现 `probeMacScreenGeometry(signal?: AbortSignal)`：先用 `findExecutableInEnv('osascript')`，再用 `execFile(path, ['-l', 'JavaScript', '-e', SCREEN_GEOMETRY_JXA], { shell: false, timeout: 1500, maxBuffer: 64 * 1024, signal })`。命令缺失、timeout、abort、stderr、解析异常均记录一次 warn 并返回空 Map。

- [ ] 实现 `resolveConversationIslandBounds(display, geometry, width)`。notch gap 必须位于屏幕顶部、居中误差不超过屏宽的 10%、宽度在 40–260 pt；否则返回 `x = display.bounds.x + (display.bounds.width - width) / 2`、`y = display.bounds.y + 8` 的 capsule。所有坐标取整。

- [ ] 运行测试并提交。

```bash
pnpm exec vitest run --silent --project main src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
git add src/main/services/conversationIsland/macScreenGeometry.ts src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts
git commit -S --signoff -m "feat(conversation-island): resolve macOS screen geometry"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 3：注册惰性窗口和自包含 sandbox preload

**文件：**

- 修改：`src/main/core/window/types.ts`
- 修改：`src/main/core/window/windowRegistry.ts`
- 修改：`src/main/core/window/__tests__/windowRegistry.invariants.test.ts`
- 修改：`src/main/core/window/__tests__/windowRegistry.test.ts`
- 新增：`src/preload/conversationIsland.ts`
- 修改：`electron.vite.config.ts`

- [ ] 先写 registry 测试：ConversationIsland 必须是 manual singleton、无 `singletonConfig`、使用 `conversationIsland.js`、sandbox true、contextIsolation true、nodeIntegration false、focusable false、screen-saver、fullscreen Spaces、Dock false、reapplyAlwaysOnTop true。

- [ ] 收窄现有 shared-preload invariant：只有 `entry.preload === undefined` 才代表默认 code-split `preload.js` 并要求 sandbox false；`preload: ''` 和显式自包含 preload 不适用。加入显式断言确保 ConversationIsland 是 sandbox true。

- [ ] 运行并确认 WindowType/registry entry 不存在导致失败。

```bash
pnpm exec vitest run --silent --project main src/main/core/window/__tests__/windowRegistry.test.ts src/main/core/window/__tests__/windowRegistry.invariants.test.ts
```

- [ ] 新增 `WindowType.ConversationIsland = 'conversationIsland'`，并注册窗口契约：宽度 320、高度 38，`frame:false`、`transparent:true`、`focusable:false`、`resizable/minimizable/maximizable/fullscreenable:false`、`skipTaskbar:true`、`roundedCorners:false`、macOS `type:'panel'`、`acceptFirstMouse:true`、`hiddenInMissionControl:true`。不要添加 `singletonConfig`，因此 `WindowManager.close()` 会销毁窗口。

- [ ] 新增自包含 preload，不导入 `@shared/IpcChannel` 或 `src/preload/ipc.ts`，避免 Rollup 拆出本地 chunk。固定字符串是现有 IpcApi transport contract，不是新 IPC。

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const ipcApi = {
  request: (route: string, input?: unknown, meta?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('ipc-api:request', route, input, meta),
  on: (event: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) callback(payload)
    }
    ipcRenderer.on('ipc-api:event', listener)
    return () => ipcRenderer.removeListener('ipc-api:event', listener)
  }
}

contextBridge.exposeInMainWorld('api', { ipcApi })
```

- [ ] 在 electron-vite preload input 加 `conversationIsland`；renderer input 留到任务 7 与 HTML 一起加入。

- [ ] 运行 registry 测试并构建 preload。

```bash
pnpm exec vitest run --silent --project main src/main/core/window/__tests__/windowRegistry.test.ts src/main/core/window/__tests__/windowRegistry.invariants.test.ts
pnpm exec electron-vite build
```

- [ ] 验证产物自包含：只允许 `require("electron")` 或 `require('electron')`，不得含相对 `require()`。

```bash
test -f out/preload/conversationIsland.js
! rg -n "require\(['\"]\.\.?/" out/preload/conversationIsland.js
rg -n "require\(['\"]electron['\"]\)" out/preload/conversationIsland.js
```

- [ ] 提交。

```bash
git add src/main/core/window/types.ts src/main/core/window/windowRegistry.ts src/main/core/window/__tests__/windowRegistry.invariants.test.ts src/main/core/window/__tests__/windowRegistry.test.ts src/preload/conversationIsland.ts electron.vite.config.ts
git commit -S --signoff -m "feat(conversation-island): register transient panel"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 4：增加 Preference 和 macOS 设置入口

**文件：**

- 修改：`v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`
- 生成：`src/shared/data/preference/preferenceSchemas.ts`
- 可能生成：`src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts`
- 修改：`src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx`
- 新增：`src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx`

- [ ] 先写设置页测试：mock `@renderer/utils/platform` 为可变 `{ isMac: true }`，用统一 Preference mock 注入默认值；断言 macOS 显示主开关、启用后显示标题开关、两个操作写入正确 key，非 macOS 不显示该组。

```ts
expect(screen.getByRole('switch', { name: 'settings.notification.conversation_island.enabled' })).toBeVisible()
await user.click(screen.getByRole('switch', { name: 'settings.notification.conversation_island.enabled' }))
expect(mocks.setPreference).toHaveBeenCalledWith('feature.conversation_island.enabled', true)
expect(screen.getByRole('switch', { name: 'settings.notification.conversation_island.show_title' })).toBeVisible()
```

- [ ] 运行并确认测试失败。

```bash
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
```

- [ ] 在 feature 定义附近加入两个 v2-only boolean 定义。

```json
{
  "targetKey": "feature.conversation_island.enabled",
  "type": "boolean",
  "defaultValue": false,
  "status": "classified",
  "description": "Whether the macOS Conversation Island presents transient conversation activity"
},
{
  "targetKey": "feature.conversation_island.show_title",
  "type": "boolean",
  "defaultValue": true,
  "status": "classified",
  "description": "Whether the macOS Conversation Island displays the conversation title"
}
```

- [ ] 运行生成器并检查生成 diff；禁止手改生成文件。

```bash
cd v2-refactor-temp/tools/data-classify && npm run generate
cd ../../..
git diff -- src/shared/data/preference/preferenceSchemas.ts src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts
```

- [ ] 在通知设置页复用 `Switch` 和 settings primitives，加入 `isMac` 条件组。用 `useMultiplePreferences` 订阅两个 key；标题行仅在主开关开启时渲染。每个 Switch 添加本地化 `aria-label`。

- [ ] 重新运行测试并提交。若生成器没有修改 mapping 文件，从 `git add` 中去掉该路径。

```bash
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
git add v2-refactor-temp/tools/data-classify/data/target-key-definitions.json src/shared/data/preference/preferenceSchemas.ts src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
git commit -S --signoff -m "feat(conversation-island): add macOS preferences"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 5：定义快照并用纯 reducer 固化状态优先级

**文件：**

- 新增：`src/shared/types/conversationIsland.ts`
- 新增：`src/main/services/conversationIsland/activityReducer.ts`
- 新增：`src/main/services/conversationIsland/__tests__/activityReducer.test.ts`

- [ ] 先写 reducer 测试，覆盖：Awaiting Confirmation 高于终态、终态高于 live、同级按 `changedAt`、done 4 秒、error 6 秒、aborted/null 立即删除、每个终态独立过期、`secondaryCount` 统计所有其他 eligible activity。

```ts
it('selects awaiting confirmation ahead of newer terminal and live activity', () => {
  const state = reduceActivities(new Map(), update('topic-live', 'streaming', 100, 1))
  reduceActivities(state, update('topic-done', 'done', 200, 1))
  reduceActivities(state, update('topic-approval', 'awaiting-approval', 150, 1))

  expect(selectPrimaryActivity(state, 201)).toMatchObject({
    primary: { topicId: 'topic-approval' },
    secondaryCount: 2
  })
})
```

- [ ] 运行并确认模块不存在导致失败。

```bash
pnpm exec vitest run --silent --project main src/main/services/conversationIsland/__tests__/activityReducer.test.ts
```

- [ ] 定义跨进程快照；`navigationTitle` 永远存在，`title` 只受显示偏好控制。

```ts
import type { ConversationNavigationTarget } from './navigation'

export type ConversationIslandStateKind = 'pending' | 'streaming' | 'awaiting-confirmation' | 'done' | 'error'

export interface ConversationIslandSnapshot {
  activityId: string
  target: ConversationNavigationTarget
  state: ConversationIslandStateKind
  statusText: string
  title?: string
  navigationTitle: string
  secondaryCount: number
  presentation: 'notch' | 'capsule'
}
```

- [ ] reducer 使用唯一优先级和 TTL，不保存终态队列。

```ts
export const TERMINAL_TTL_MS = { done: 4_000, error: 6_000 } as const

function priority(status: TopicStreamStatus): number {
  if (status === 'awaiting-approval') return 3
  if (status === 'done' || status === 'error') return 2
  if (status === 'pending' || status === 'streaming') return 1
  return 0
}
```

`reduceActivities` 原地更新 feature-local `Map`，避免每次状态转换复制全表；`selectPrimaryActivity` 只遍历一次。活动至少保存 `topicId`、`turnId`、`target`、`status`、`changedAt`、`originDisplayId`、`expiresAt`。新 turn 的 `pending` 重新捕获 origin display；同 turn 后续状态保留 display。

- [ ] 重新运行测试并提交。

```bash
pnpm exec vitest run --silent --project main src/main/services/conversationIsland/__tests__/activityReducer.test.ts
git add src/shared/types/conversationIsland.ts src/main/services/conversationIsland/activityReducer.ts src/main/services/conversationIsland/__tests__/activityReducer.test.ts
git commit -S --signoff -m "feat(conversation-island): define activity arbitration"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 6：实现 ConversationIslandService 的惰性生命周期

**文件：**

- 新增：`src/main/services/conversationIsland/ConversationIslandService.ts`
- 新增：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`
- 修改：`src/main/core/application/serviceRegistry.ts`

- [ ] 先写 service 测试，使用 fake timers 和最小 application services，覆盖以下真实回归：

  - feature off 时状态转换不创建窗口、不探测 JXA、不注册 screen listener；
  - enable 时已有 live activity 立即展示；
  - title off 不调用 `resolveConversationName`，但 snapshot 的 `navigationTitle` 有通用 fallback；
  - 多状态只创建一个 singleton，后续调用 `pushInitData`；
  - done/error 在 4/6 秒准确销毁；新状态重排 timer；aborted 立即销毁；
  - preference enable/show_title/app.language 变化重算；
  - display added/removed/metrics 和 PowerService resume 仅在启用时刷新 geometry；
  - window 或 geometry 失败被日志隔离，不影响下一个状态事件；
  - stop 会移除 listener、abort probe、clear timer、close window。

- [ ] 运行并确认服务不存在导致失败。

```bash
pnpm exec vitest run --silent --project main src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

- [ ] 声明服务为 macOS 条件生命周期服务。

```ts
@Injectable('ConversationIslandService')
@Conditional(onPlatform('darwin'))
@DependsOn(['NotificationService', 'WindowManager', 'PowerService'])
@ServicePhase(Phase.WhenReady)
export class ConversationIslandService extends BaseService {}
```

不要把 BeforeReady 的 `PreferenceService` 或 `CacheService` 写进 `@DependsOn`；阶段顺序已保证它们先就绪。

- [ ] `onInit()` 始终订阅 `NotificationService.onConversationActivityChanged` 和两个 Preference key。feature off 时只转换活动并惰性 prune，不创建 timer、screen listener、JXA 或 window。

- [ ] 第一次观察新 turn 的 `pending` 时，从 `getFullChromeWindowInfos().find(info => info.isFocused)` 找 origin window，通过 `WindowManager.getWindow(id)` 的 bounds 映射 Electron display；无 focused full-chrome window 时使用 internal display，最后用 primary display。

- [ ] enable 时注册 Electron `screen` 的 `display-added`、`display-removed`、`display-metrics-changed`，订阅 `PowerService.onResume`，发起一次可 abort geometry probe，再调用 `refreshPresentation()`。disable 时同步移除这些资源、abort probe、clear timer、close window；活动 map 保留 live 项，终态下次事件/enable 时 prune。

- [ ] `refreshPresentation()` 必须只有一个 Primary Activity 答案。

```ts
private refreshPresentation(now = Date.now()): void {
  const selection = selectPrimaryActivity(this.activities, now)
  if (!this.enabled || !selection.primary) {
    this.closeIslandWindow()
    this.clearExpiryTimer()
    return
  }

  const snapshot = this.buildSnapshot(selection.primary, selection.secondaryCount)
  this.showOrUpdateWindow(snapshot, selection.primary.originDisplayId)
  this.scheduleNextExpiry(now)
}
```

- [ ] `buildSnapshot` 在 `show_title` 开启且活动第一次成为 Primary 时调用 public `NotificationService.resolveConversationName(target)` 并缓存。关闭标题时 `title` 为 undefined，`navigationTitle` 使用主进程本地化的 “New Chat”/“New task” fallback，不做 DB 查询。状态映射 exhaustive：

```ts
const STATUS_KEYS = {
  assistant: {
    pending: 'conversation_island.status.assistant.pending',
    streaming: 'conversation_island.status.assistant.streaming',
    'awaiting-approval': 'conversation_island.status.awaiting_confirmation',
    done: 'conversation_island.status.assistant.done',
    error: 'conversation_island.status.assistant.error'
  },
  agent: {
    pending: 'conversation_island.status.agent.pending',
    streaming: 'conversation_island.status.agent.streaming',
    'awaiting-approval': 'conversation_island.status.awaiting_confirmation',
    done: 'conversation_island.status.agent.done',
    error: 'conversation_island.status.agent.error'
  }
} as const
```

- [ ] 第一次展示用 `WindowManager.open(WindowType.ConversationIsland, { initData: snapshot })`，随后 `setBounds(bounds)`、`showInactive()`；已有 window 时先 `pushInitData(windowId, snapshot)` 再更新 bounds/showInactive。订阅 window destroyed event 清空 ID。业务代码不调用 `create()` 或 `destroy()`。

- [ ] timer 只指向最早未过期终态；回调 prune 后调用一次 `refreshPresentation()`。live 和 awaiting 不使用 timer。

- [ ] 将服务加入 `serviceRegistry.ts`。因为 `@Conditional(onPlatform('darwin'))`，非 macOS 不实例化。

- [ ] 运行相关 main 测试并提交。

```bash
pnpm exec vitest run --silent --project main src/main/services/__tests__/NotificationService.test.ts src/main/services/conversationIsland/__tests__/activityReducer.test.ts src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git add src/main/services/conversationIsland/ConversationIslandService.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts src/main/core/application/serviceRegistry.ts
git commit -S --signoff -m "feat(conversation-island): orchestrate transient activity"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 7：增加极简 renderer 并复用已有导航 IPC

**文件：**

- 新增：`src/renderer/windows/conversationIsland/index.html`
- 新增：`src/renderer/windows/conversationIsland/entryPoint.tsx`
- 新增：`src/renderer/windows/conversationIsland/ConversationIsland.tsx`
- 新增：`src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx`
- 修改：`electron.vite.config.ts`

- [ ] 先写 component test，mock `useWindowInitData` 和 `ipcApi.request`。覆盖：无 init data 返回 null；状态文案可见；title 由 `title` 是否存在决定；`+N` 只在 count > 0 显示；点击整个 pill 调用既有 route，传 `target` 和 `navigationTitle`。

```ts
expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.focus_or_open_conversation', {
  target: snapshot.target,
  title: snapshot.navigationTitle
})
```

- [ ] 运行并确认文件不存在导致失败。

```bash
pnpm exec vitest run --silent --project renderer src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

- [ ] 新建 HTML，设置只允许 self script/style 的严格 CSP；body 无 margin、透明背景。

- [ ] entry point 只导入 React、`createRoot`、Tailwind CSS 和 `ConversationIsland`。不要调用 `prepareWindow()`，不要加载 ThemeProvider、Preference、DataApi DevTools 或 renderer i18n。

- [ ] 用 `@cherrystudio/ui` 的基础 icon/primitive 和 Tailwind 构建单行 button。状态点和文字共同表达状态，标题单行 ellipsis，`prefers-reduced-motion` 禁用 pending/streaming 动画。窗口 bounds 与按钮 hit area 相同，不加透明 padding。

- [ ] 点击失败使用 renderer `loggerService` 记录；组件本身不持有业务状态。

- [ ] 在 electron-vite renderer input 加：

```ts
conversationIsland: resolve(__dirname, 'src/renderer/windows/conversationIsland/index.html')
```

- [ ] 运行 component test 并提交。

```bash
pnpm exec vitest run --silent --project renderer src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
git add src/renderer/windows/conversationIsland electron.vite.config.ts
git commit -S --signoff -m "feat(conversation-island): render compact activity pill"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 8：补齐所有主进程和设置页本地化

**文件：**

- 修改：`src/main/i18n/locales/en-us.json` 和其余主进程 Locale
- 修改：`src/renderer/i18n/locales/en-us.json` 和其余 renderer Locale
- 必要时修改：前述测试中的 `t` mock catalog

- [ ] 在主进程 en-us source 增加状态文案。使用现有 `agent.session.new` 和 `chat.conversation.new` 作为导航 fallback，不另造重复 key。

```json
"conversation_island": {
  "status": {
    "agent": {
      "done": "Task complete",
      "error": "Task failed",
      "pending": "Preparing",
      "streaming": "Working"
    },
    "assistant": {
      "done": "Response complete",
      "error": "Response failed",
      "pending": "Thinking",
      "streaming": "Responding"
    },
    "awaiting_confirmation": "Awaiting confirmation"
  }
}
```

- [ ] 在 renderer en-us source 的 `settings.notification` 下加入 group、说明和两个 aria label/标题 key。

- [ ] 运行同步器。

```bash
pnpm i18n:sync
```

- [ ] 翻译所有主进程和 renderer Locale；中文使用已批准文案：正在思考、正在准备、正在回复、正在执行、等待确认、回复完成、任务完成、回复失败、执行失败。不得遗留 `[to be translated]:`。

- [ ] 运行 i18n check 和相关测试。

```bash
pnpm i18n:check
pnpm exec vitest run --silent --project main src/main/services/__tests__/NotificationService.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

- [ ] 提交所有实际变化的 Locale 和 test mock；不为 `git add` 制造无意义变更。

```bash
git add src/main/i18n/locales src/renderer/i18n/locales
git add -u src/main/services src/renderer/pages/settings/NotificationSettings src/renderer/windows/conversationIsland
git commit -S --signoff -m "feat(conversation-island): localize status surface"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 9：完整自检、构建和实机验收

**文件：**

- 可能修改：上述实现文件中的验证修复
- 必要时修改：`docs/superpowers/specs/2026-08-21-macos-conversation-island-design.md`

- [ ] 运行最接近改动的全部测试。

```bash
pnpm exec vitest run --silent --project main src/main/services/__tests__/NotificationService.test.ts src/main/services/conversationIsland/__tests__/activityReducer.test.ts src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts src/main/core/window/__tests__/windowRegistry.test.ts src/main/core/window/__tests__/windowRegistry.invariants.test.ts
pnpm exec vitest run --silent --project renderer src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx src/renderer/windows/conversationIsland/__tests__/ConversationIsland.test.tsx
```

- [ ] 运行 repo 规定的 lint。该命令会写格式；完成后检查只修改任务相关文件。

```bash
pnpm lint
git status --short
git diff --check
```

- [ ] 运行 docs gate 和生产构建，再验证 preload 自包含。

```bash
pnpm docs:check
pnpm build
test -f out/preload/conversationIsland.js
! rg -n "require\(['\"]\.\.?/" out/preload/conversationIsland.js
```

- [ ] 在 tracked app 中做四组性能基线并记录 Activity Monitor 数据：feature off、enabled idle、单活动、并发活动。结构验收：off/idle 不新增 renderer/helper process；active 最多新增一个临时 renderer；最后终态过期后 renderer 消失。

- [ ] 在实机逐项验收：

  - 带刘海内屏精确贴合；非刘海或外屏顶部居中 fallback；
  - 从不同显示器发起活动、活动中移动窗口、断开 origin display；
  - foreground/background、其他 App fullscreen Space、sleep/resume；
  - Assistant 与 Agent 全部状态文案；
  - title on/off，空标题 fallback，超长标题 ellipsis；
  - awaiting > 新终态 > live，`+N`，终态无队列且独立过期；
  - system notifications 与 Conversation Island 同时启用：系统通知仍只在完成/待确认出现，灵动岛显示完整状态；
  - 点击不需要先激活 pill，且只打开/聚焦一个正确对话；
  - disable 立即关闭，重启后 Preference 保持。

- [ ] 检查无越界改动和无占位符。

```bash
rg -n "TODO|TBD|FIXME|to be translated" src/main/services/conversationIsland src/renderer/windows/conversationIsland src/main/i18n/locales src/renderer/i18n/locales
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

预期：第一条无输出；改动范围与本计划文件清单一致。

- [ ] 若验证产生修复，按责任域提交一个最终修复 commit；否则不制造空提交。

```bash
git add -u
git commit -S --signoff -m "fix(conversation-island): address integration findings"
git cat-file commit HEAD | rg '^gpgsig '
```

- [ ] 对分支每个 commit 验证签名和 DCO trailer。

```bash
git log --format='%H%n%B%n---' origin/main..HEAD
git log --format='%H' origin/main..HEAD | while read commit; do git cat-file commit "$commit" | rg -q '^gpgsig ' || exit 1; git show -s --format='%B' "$commit" | rg -qi '^Signed-off-by: ' || exit 1; done
```

## 完成标准

- 系统通知和 Conversation Island 共用 `NotificationService` 的对话目标、标题 fallback 和状态归一化来源，但保留各自展示策略。
- Assistant 与 Agent Session 的 Cache key 都能产生同形活动事件，且不修改 Cache 通用模板语义。
- 默认关闭；关闭时不创建窗口、renderer、JXA、display listener 或 timer；enabled idle 仅保留被动 display listener 和缓存 geometry。
- 活跃期最多一个无焦点 panel；最后活动过期后由 `WindowManager.close()` 真正销毁。
- 标题开关关闭时不查业务数据，但点击仍用 `navigationTitle` 正确打开对话。
- sandbox preload 单文件且只暴露 IpcApi；没有新增 IPC route。
- targeted tests、`pnpm lint`、`pnpm docs:check`、`pnpm build` 和实机矩阵全部通过。
