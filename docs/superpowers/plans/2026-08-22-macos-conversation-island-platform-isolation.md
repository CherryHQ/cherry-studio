# macOS Conversation Island 平台隔离实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 Conversation Island 的持续活动观察和设置订阅只在 macOS 运行，并从 Windows/Linux 安装包移除功能专属 preload、HTML 和 renderer entry，同时不新增平台专用 Vite 构建或注册表。

**架构：** `ConversationIslandService` 继续通过 `@Conditional(onPlatform('darwin'))` 在启动时被排除，并直接订阅现有共享 Cache、完成 topic/target/title 投影；`NotificationService` 恢复为仅处理完成与确认通知。Electron Vite 仍统一产出所有入口，electron-builder 的目标感知 `beforePack` 过滤器只在非 macOS 包中排除三个功能专属输出。

**技术栈：** TypeScript、Electron 41、生命周期 `BaseService`/`@Conditional`、共享 Cache、React、Vitest 3、electron-builder `beforePack`。

---

## 实施前状态与保护规则

当前工作区已有两处用户未提交改动：

- `src/main/services/conversationIsland/ConversationIslandService.ts`：将 live `awaitingApprovalAnchors` 投影为 `awaiting-approval`；
- `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`：保护该行为。

实现时必须保留这两处行为和断言。每次提交前使用 `git diff` 和 `git add -p`，不得把用户原有 hunk 自动纳入本计划的提交。如果 Cache 测试适配与原有测试 hunk 无法安全拆分，停止并请求用户决定提交归属。

## 文件结构

### 修改

- `src/main/services/conversationIsland/ConversationIslandService.ts`：直接观察 Cache，拥有 topic/target/title 投影，移除对 `NotificationService` 的功能依赖。
- `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`：用 Cache 模板回调驱动现有场景，保护 Assistant、Agent、资源清理和标题 fallback。
- `src/main/services/NotificationService.ts`：删除持续活动 Cache、Emitter 和公开标题方法，保留原通知流程。
- `src/main/services/__tests__/NotificationService.test.ts`：删除活动事件测试，保护服务初始化不再访问 Cache 以及原通知行为不变。
- `src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx`：把 Conversation Island Preference Hook 下沉到只在 macOS 挂载的私有子组件。
- `src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx`：保护非 macOS 不调用 Island Preference Hook。
- `scripts/before-pack.js`：根据 electron-builder 目标平台生成 Conversation Island 文件排除项。
- `scripts/__tests__/before-pack.test.ts`：保护 Darwin 保留、Win32/Linux 排除的打包合同。

### 明确不修改

- `electron.vite.config.ts`、`package.json`：不引入目标平台环境变量或条件入口。
- `src/main/core/application/serviceRegistry.ts`：继续静态注册条件服务。
- `src/main/core/window/types.ts`、`src/main/core/window/windowRegistry.ts`：继续保留静态窗口类型和元数据。
- `src/shared/ipc/schemas/**`、`src/main/ipc/handlers/**`：继续保留封闭、穷尽的 IPC schema/handler map。
- Preference schema、DataApi、数据库和迁移。

## 任务 1：把持续活动源收回 macOS 条件服务

**文件：**

- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts:1-220,275-360,380-470,720-755`
- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts:1-180,379-386`
- 修改：`src/main/services/__tests__/NotificationService.test.ts:1-200`
- 修改：`src/main/services/NotificationService.ts:1-176`

- [ ] **步骤 1：把 Conversation Island 测试改成观察 Cache 模板**

在 `ConversationIslandService.test.ts` 中保留 `mocks.resolveName`，让新的数据服务 mock 继续支持现有动态标题、空标题和调用次数断言：

先把 transport type import 改为：

```ts
import type { TopicStatusSnapshotEntry, TopicStreamStatus } from '@shared/ai/transport'
```

```ts
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: (conversationId: string) => ({
      name: mocks.resolveName({ conversationType: 'agent', conversationId })
    })
  }
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    getById: (conversationId: string) => ({
      name: mocks.resolveName({ conversationType: 'assistant', conversationId })
    })
  }
}))
```

把 `mocks` 中原先由 `NotificationService` 设置的 listener 改成 Cache listener map；保留 `activitiesListener` 作为测试输入适配器，使用户已有 Awaiting Confirmation 测试无需改写语义：

```ts
type CacheListener = (snapshot: TopicStatusSnapshotEntry | null | undefined, oldValue: unknown, key: string) => void

return {
  activitiesListener: undefined as
    | ((event: { topicId: string; snapshot: TopicStatusSnapshotEntry | null }) => void)
    | undefined,
  cacheSubscriptions: new Map<string, CacheListener>(),
  cacheDisposers: new Map<string, ReturnType<typeof vi.fn>>()
}
```

以上三个字段替换原 `activitiesListener` 字段并加入现有 return object；其余现有 mock 字段保持原顺序和值。

用 CacheService 替换 `services.notificationService`：

```ts
const cacheService = {
  subscribeSharedChange: vi.fn((pattern: string, listener: CacheListener) => {
    mocks.cacheSubscriptions.set(pattern, listener)
    const dispose = vi.fn(() => mocks.cacheSubscriptions.delete(pattern))
    mocks.cacheDisposers.set(pattern, dispose)
    return dispose
  })
}

return { cacheService, powerService, preferenceService, windowManager }
```

`application.get()` 的测试服务表改为：

```ts
const service = {
  CacheService: services.cacheService,
  PowerService: services.powerService,
  PreferenceService: services.preferenceService,
  WindowManager: services.windowManager
}[name]
```

在 `service._doInit()` 之后安装只用于测试的输入适配器：

```ts
mocks.activitiesListener = ({ topicId, snapshot }) => {
  const pattern = topicId.startsWith('agent-session:')
    ? 'topic.stream.statuses.agent-session:${sessionId}'
    : 'topic.stream.statuses.${topicId}'
  mocks.cacheSubscriptions.get(pattern)?.(snapshot, null, `topic.stream.statuses.${topicId}`)
}
```

在 `beforeEach()` 中和其他可变 mock 一起重置：

```ts
mocks.activitiesListener = undefined
mocks.cacheDisposers.clear()
mocks.cacheSubscriptions.clear()
```

保留现有 `emitActivity()` API，但让 Agent 输入使用真实 namespaced topic，并通过上述适配器发送：

```ts
function emitActivity(
  status: TopicStreamStatus | null,
  changedAt: number,
  topicId = 'topic-1',
  conversationType: 'assistant' | 'agent' = 'assistant',
  turnId = `${topicId}-turn`
): void {
  vi.setSystemTime(changedAt)
  const concreteTopicId =
    conversationType === 'agent' && !topicId.startsWith('agent-session:') ? `agent-session:${topicId}` : topicId
  mocks.activitiesListener?.({
    topicId: concreteTopicId,
    snapshot: status === null ? null : { status, turnId, activeExecutions: [], awaitingApprovalAnchors: [] }
  })
}
```

现有 Agent expanded 测试中的 activity ID 必须从 `topic-approval` 更新为 `agent-session:topic-approval`；标题 map 仍以解析后的 `conversationId` `topic-approval` 为 key。

- [ ] **步骤 2：新增模板、target 和资源清理回归测试**

在服务测试中增加以下合同测试：

```ts
it('subscribes to Assistant and namespaced Agent activity only inside the conditional service', () => {
  expect([...mocks.cacheSubscriptions.keys()]).toEqual([
    'topic.stream.statuses.${topicId}',
    'topic.stream.statuses.agent-session:${sessionId}'
  ])
})

it.each([
  {
    topicId: 'topic-1',
    conversationType: 'assistant' as const,
    target: { conversationType: 'assistant', conversationId: 'topic-1' }
  },
  {
    topicId: 'session-1',
    conversationType: 'agent' as const,
    target: { conversationType: 'agent', conversationId: 'session-1' }
  }
])('projects $conversationType Cache activity into its navigation target', ({ topicId, conversationType, target }) => {
  changePreference('feature.conversation_island.enabled', true)
  emitActivity('streaming', 100, topicId, conversationType)

  expect(latestSnapshot()).toMatchObject({ target, title: 'Research notes' })
})

```

现有 Awaiting Confirmation 测试必须继续保留 `awaitingApprovalAnchors` 非空且 snapshot status 为 `streaming` 的输入，以及 `state: 'awaiting-confirmation'` 断言。现有 `cleans listeners, active probes, timers, and the transient window on stop` 测试中的旧 listener 断言：

```ts
expect(mocks.activitiesListener).toBeUndefined()
```

替换为 feature-owned Cache 清理合同：

```ts
expect([...mocks.cacheDisposers.values()]).toHaveLength(2)
expect([...mocks.cacheDisposers.values()].every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
expect(mocks.cacheSubscriptions.size).toBe(0)
```

- [ ] **步骤 3：运行服务测试确认失败**

运行：

```bash
pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：FAIL；服务尚未调用 `CacheService.subscribeSharedChange()`，模板 map 为空或 `application.get('NotificationService')` 已不再由测试提供。

- [ ] **步骤 4：在条件服务中实现 feature-local 投影**

在 `ConversationIslandService.ts` 增加数据服务、topic helper、Cache snapshot 和导航 target import：

```ts
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
```

删除 `@main/services/NotificationService` type import，定义 feature-local normalized input：

```ts
const TOPIC_STATUS_PREFIX = 'topic.stream.statuses.'

interface ConversationActivityChangedEvent {
  topicId: string
  target: ConversationNavigationTarget
  snapshot: TopicStatusSnapshotEntry | null
  changedAt: number
}
```

把同阶段依赖收窄为：

```ts
@DependsOn(['WindowManager', 'PowerService'])
```

在 `onInit()` 中用两个 Cache subscriptions 替换 NotificationService event subscription：

```ts
const cacheService = application.get('CacheService')
this.registerDisposable(
  cacheService.subscribeSharedChange('topic.stream.statuses.${topicId}', (snapshot, _oldSnapshot, key) =>
    this.emitConversationActivity(snapshot, key)
  )
)
this.registerDisposable(
  cacheService.subscribeSharedChange(
    'topic.stream.statuses.agent-session:${sessionId}',
    (snapshot, _oldSnapshot, key) => this.emitConversationActivity(snapshot, key)
  )
)
```

新增 feature-local normalization 和标题方法：

```ts
private emitConversationActivity(
  snapshot: TopicStatusSnapshotEntry | null | undefined,
  concreteKey: string
): void {
  const topicId = concreteKey.slice(TOPIC_STATUS_PREFIX.length)
  if (!topicId) return

  this.handleConversationActivity({
    topicId,
    target: isAgentSessionTopic(topicId)
      ? { conversationType: 'agent', conversationId: extractAgentSessionId(topicId) }
      : { conversationType: 'assistant', conversationId: topicId },
    snapshot: snapshot ?? null,
    changedAt: Date.now()
  })
}

private resolveConversationName(target: ConversationNavigationTarget): string {
  const fallback = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')

  try {
    const name =
      target.conversationType === 'agent'
        ? agentSessionService.getById(target.conversationId).name
        : topicService.getById(target.conversationId).name
    return name.trim() || fallback
  } catch (error) {
    logger.warn('Failed to resolve conversation name for Conversation Island', { target, err: error })
    return fallback
  }
}
```

`buildActivityItem()` 改为调用 `this.resolveConversationName(activity.target)`。不得改变用户已有 `awaitingApprovalAnchors` 状态优先级。

- [ ] **步骤 5：运行 Conversation Island 服务测试验证通过**

运行：

```bash
pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：PASS；包括两个 Cache 模板、Assistant/Agent target、标题缓存、Awaiting Confirmation 和 disposer 合同。

- [ ] **步骤 6：先写 NotificationService 所有权回归断言**

在 `NotificationService.test.ts` 删除活动事件参数化测试后，增加：

```ts
it('does not observe the continuous activity Cache', () => {
  expect(mocks.applicationGet).not.toHaveBeenCalledWith('CacheService')
})
```

暂时保留 CacheService mock 并运行：

```bash
pnpm exec vitest run --project main src/main/services/__tests__/NotificationService.test.ts
```

预期：FAIL；当前 `onInit()` 仍访问 `CacheService`。

- [ ] **步骤 7：从 NotificationService 删除 feature-induced surface**

在 `NotificationService.ts` 删除：

- `Emitter`、`Event` 和 `TopicStatusSnapshotEntry` import；
- `TOPIC_STATUS_PREFIX`；
- exported `ConversationActivityChangedEvent`；
- `_onConversationActivityChanged` 和 `onConversationActivityChanged`；
- 两个 Cache subscriptions；
- `emitConversationActivity()`。

把标题方法重新收窄为：

```ts
private resolveConversationName(target: ConversationNavigationTarget): string {
```

在 `NotificationService.test.ts` 删除 `TopicStatusSnapshotEntry` import、`cacheSubscriptions` 状态、CacheService mock 和 reset；保留步骤 6 的“不访问 Cache”断言及所有完成/确认通知测试。

- [ ] **步骤 8：运行两个 main service 测试验证通过**

运行：

```bash
pnpm exec vitest run --project main \
  src/main/services/__tests__/NotificationService.test.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：PASS；NotificationService 不访问 Cache，ConversationIslandService 独立消费两个模板。

- [ ] **步骤 9：选择性提交活动所有权迁移**

先检查用户 hunks：

```bash
git diff -- src/main/services/conversationIsland/ConversationIslandService.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

使用交互式暂存，只选择本任务 hunks；原有 Awaiting Confirmation hunk 无法拆分时停止：

```bash
git add -p src/main/services/conversationIsland/ConversationIslandService.ts
git add -p src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
git add src/main/services/NotificationService.ts src/main/services/__tests__/NotificationService.test.ts
git diff --cached --check
git commit -S --signoff -m "refactor(conversation-island): own activity observation"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 2：让非 macOS 设置页不执行 Island Preference Hook

**文件：**

- 修改：`src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx:1-57`
- 修改：`src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx:1-95`

- [ ] **步骤 1：写非 macOS Hook 隔离失败测试**

把 mock import 改为：

```ts
import { MockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
```

在 off-macOS 测试末尾增加：

```ts
expect(MockUsePreference.usePreference).not.toHaveBeenCalled()
```

- [ ] **步骤 2：运行设置测试确认失败**

运行：

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
```

预期：FAIL；父组件仍无条件调用一次 `usePreference('feature.conversation_island.enabled')`。

- [ ] **步骤 3：把 Preference Hook 下沉到私有 macOS 子组件**

在 `NotificationSettings.tsx` 的父组件之前增加：

```tsx
const ConversationIslandSetting: FC = () => {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePreference('feature.conversation_island.enabled')

  return (
    <>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.notification.conversation_island.enabled')}</SettingRowTitle>
        <Switch
          aria-label={t('settings.notification.conversation_island.enabled')}
          checked={enabled}
          onCheckedChange={(nextEnabled) => void setEnabled(nextEnabled)}
        />
      </SettingRow>
    </>
  )
}
```

删除父组件中的 Conversation Island `usePreference()`，把原条件内容替换成：

```tsx
{isMac && <ConversationIslandSetting />}
```

不创建共享组件或新文件。

- [ ] **步骤 4：运行设置测试验证通过**

运行：

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
```

预期：PASS；macOS 开关仍可持久化，off-macOS `usePreference` 调用次数为零。

- [ ] **步骤 5：提交设置隔离**

```bash
git add src/renderer/pages/settings/NotificationSettings/NotificationSettings.tsx \
  src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
git diff --cached --check
git commit -S --signoff -m "fix(notification-settings): isolate macos preference"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 3：从非 macOS 安装包排除功能专属输出

**文件：**

- 修改：`scripts/__tests__/before-pack.test.ts:7-59`
- 修改：`scripts/before-pack.js:90-136,230-265`

- [ ] **步骤 1：写目标平台过滤失败测试**

把测试 import 改为：

```ts
import { assertPrebuiltPackages, conversationIslandPackageFilters, keepPackages } from '../before-pack'
```

新增：

```ts
describe('conversationIslandPackageFilters', () => {
  const featureOutputs = [
    '!out/preload/conversationIsland.js',
    '!out/renderer/windows/conversationIsland/**',
    '!out/renderer/assets/conversationIsland-*.js'
  ]

  it('keeps feature outputs in macOS packages', () => {
    expect(conversationIslandPackageFilters('darwin')).toEqual([])
  })

  it.each(['win32', 'linux'])('excludes only feature-owned outputs from %s packages', (platform) => {
    expect(conversationIslandPackageFilters(platform)).toEqual(featureOutputs)
  })
})
```

- [ ] **步骤 2：运行 script 测试确认失败**

运行：

```bash
pnpm exec vitest run --project scripts scripts/__tests__/before-pack.test.ts
```

预期：FAIL；`conversationIslandPackageFilters` 尚未导出。

- [ ] **步骤 3：实现 target-aware 文件过滤**

在 `platformToArch` 后增加：

```js
const conversationIslandPackageFilters = (platform) =>
  platform === 'darwin'
    ? []
    : [
        '!out/preload/conversationIsland.js',
        '!out/renderer/windows/conversationIsland/**',
        '!out/renderer/assets/conversationIsland-*.js'
      ]

exports.conversationIslandPackageFilters = conversationIslandPackageFilters
```

把末尾按架构分支收敛成一个目标过滤调用：

```js
const architectureExcludePackages = context.arch === Arch.arm64 ? arm64ExcludePackages : x64ExcludePackages
await excludePackages([
  ...architectureExcludePackages,
  ...excludeBundledBinaryFilters,
  ...conversationIslandPackageFilters(platform)
])
```

平台参数继续来自 `context.packager.platform.name` 映射结果；不得改用 `process.platform`。

- [ ] **步骤 4：运行 script 测试验证通过**

运行：

```bash
pnpm exec vitest run --project scripts scripts/__tests__/before-pack.test.ts
```

预期：PASS；Darwin 返回空数组，Win32/Linux 精确返回三个 feature-owned exclusions。

- [ ] **步骤 5：提交打包过滤**

```bash
git add scripts/before-pack.js scripts/__tests__/before-pack.test.ts
git diff --cached --check
git commit -S --signoff -m "fix(packaging): exclude conversation island off macos"
git cat-file commit HEAD | rg '^gpgsig '
```

## 任务 4：完成跨边界验证

**文件：**

- 验证：任务 1–3 的全部修改文件
- 对照：`CONTEXT.md`
- 对照：`docs/superpowers/specs/2026-08-21-macos-conversation-island-design.md`

- [ ] **步骤 1：运行三个项目的聚焦测试**

```bash
pnpm exec vitest run --project main \
  src/main/services/__tests__/NotificationService.test.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/NotificationSettings/__tests__/NotificationSettings.test.tsx
pnpm exec vitest run --project scripts scripts/__tests__/before-pack.test.ts
```

预期：全部 PASS；无新增未处理 warning。现有 `InfoTooltip` 测试若仍打印 `iconProps` DOM warning，记录为既有 warning，不在本任务顺带修改。

- [ ] **步骤 2：运行共享构建/生命周期变更所需完整 gate**

```bash
pnpm build:check
pnpm test:lint
git diff --check
```

预期：命令全部退出 0。`pnpm build:check` 覆盖 lint、docs、typecheck、i18n 和完整 Vitest；`pnpm test:lint` 补充拒绝 warning 的 CI lint gate。

- [ ] **步骤 3：验证引用与文档一致性**

```bash
rg -n 'ConversationActivityChangedEvent|onConversationActivityChanged' src/main/services/NotificationService.ts
rg -n "application.get\('NotificationService'\)|@main/services/NotificationService" \
  src/main/services/conversationIsland
rg -n 'topic\.stream\.statuses' src/main/services/NotificationService.ts
git status --short
```

预期：三个 `rg` 均无输出；`git status` 只显示明确保留的用户 hunks 或当前任务尚未提交的预期文件。

- [ ] **步骤 4：在可用目标打包环境检查安装包内容**

Windows x64 打包机运行：

```bash
pnpm build:win:x64
node -e "const {createRequire}=require('node:module');const r=createRequire(require.resolve('electron-builder/package.json'));console.log(r('@electron/asar').listPackage('dist/win-unpacked/resources/app.asar').join('\n'))" \
  | rg -i 'conversationIsland|conversation-island'
```

预期：第二条命令无输出。若执行环境只有 macOS 且缺少 Windows 原生 optional dependencies，不伪造交叉打包结果；以步骤 1 的纯过滤合同测试为本地证据，并把真实 package inspection 留给 Windows 构建任务。

- [ ] **步骤 5：确认提交签名和工作区保护**

```bash
git log -3 --format='%h %s%n%(trailers:key=Signed-off-by)'
for commit in HEAD HEAD~1 HEAD~2; do git cat-file commit "$commit" | rg '^gpgsig '; done
git diff -- src/main/services/conversationIsland/ConversationIslandService.ts \
  src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
```

预期：三个实现提交均有 `Signed-off-by` trailer 和 `gpgsig`；最后的 diff 仍准确保留任何未纳入提交的用户 hunks。

## 完成条件

- Windows/Linux 启动不注册 Conversation Island service，也不执行其 Cache、Preference、display、timer、geometry 或 window 工作。
- `NotificationService` 不再拥有持续活动 Cache subscription、Emitter 或 feature-only public title API。
- Windows/Linux 安装包不包含 `conversationIsland.js`、Conversation Island HTML tree 或 hashed renderer entry。
- macOS enable switch、活动保留、Assistant/Agent target、标题 fallback、Awaiting Confirmation、展开交互和窗口几何测试继续通过。
- 不新增平台专用 Vite build、service registry、IPC registry 或 window registry。
