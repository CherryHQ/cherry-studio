# 划词翻译延迟修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在保留 V2 检测错误降级行为的前提下，把划词翻译恢复为一次语言检测加一次翻译，并把语言和 quick model 的 DataApi 加载移出用户可见关键路径。

**架构：** selection action 的 eager pooled window 在没有 action 时就创建检测控制器，预热语言列表和 quick model；控制器明确暴露 `isPending`，将“加载中”与“真实检测失败”分开。`ActionTranslate` 通过语义依赖和 request token 驱动单次流水线，忽略 SWR 刷新和回调引用变化，并继续把真实检测错误降级为 `unknown`。

**技术栈：** React 19、TypeScript、SWR/DataApi、Preference、Vitest 3、Testing Library、Electron tracked instance、OpenAI-compatible controlled mock server。

---

## 文件结构

### 修改的生产文件

- `src/renderer/hooks/useModel.ts`：新增只解析 quick model 及其加载状态的 `useQuickModel`。
- `src/renderer/hooks/translate/useDetectLang.ts`：改为返回检测控制器，暴露 `isPending`，继续保留现有检测算法和异常抛出行为。
- `src/renderer/hooks/translate/index.ts`：导出检测控制器类型。
- `src/renderer/pages/translate/TranslatePage.tsx`：适配 `useDetectLang` 的新返回结构，不改变页面行为。
- `src/renderer/windows/selection/action/entryPoint.tsx`：在首帧前预加载翻译检测依赖的 Preference。
- `src/renderer/windows/selection/action/ActionWindow.tsx`：在空 action guard 之前创建检测控制器并传给划词翻译组件，同时传递现有 `sessionId`。
- `src/renderer/windows/selection/action/components/ActionTranslate.tsx`：用 pending gate、语义 effect 和 request token 替代回调身份驱动的重复执行。

### 修改的测试文件

- `src/renderer/hooks/__tests__/useModel.test.ts`：保护 focused quick-model 查询及 fallback 契约。
- `src/renderer/hooks/translate/__tests__/useDetectLang.test.ts`：保护 pending、settled error 和 `franc` 不等待 quick model 的契约。
- `src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx`：保护单次请求、错误降级、同文本新 session 和 stale detection 隔离。
- `src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx`：仅适配显式检测控制器依赖；不添加锁定内部 hook 次数的测试。

### 已有手动测试资产

- `.context/cherry-electron-dev/selection-translate-mock.mjs`：固定 150 ms 的检测/翻译服务并记录请求顺序。
- `.context/cherry-electron-dev/run-selection-latency.mjs`：从 main window 发起划词 action 并测量结果出现时间。
- `.context/cherry-electron-dev/selection-translate-mock.ndjson`：已有改动前基线日志。

---

### 任务 1：提供 focused quick-model 查询

**文件：**
- 修改：`src/renderer/hooks/useModel.ts:21-60`
- 测试：`src/renderer/hooks/__tests__/useModel.test.ts:1-10,570-670`

- [ ] **步骤 1：确认依赖已按仓库锁定版本安装**

运行：

```bash
pnpm install
```

预期：命令以 0 退出，Node 和 pnpm 版本满足 `package.json` 的 pin。

- [ ] **步骤 2：为 quick model 独立查询编写失败测试**

把测试导入改为包含 `useQuickModel`：

```ts
import { useDefaultModel, useModelById, useModelMutations, useModels, useQuickModel } from '../useModel'
```

在 `useDefaultModel` 测试组之前新增：

```ts
describe('useQuickModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))
  })

  it('loads only the configured quick model and exposes its pending state', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::default')
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.model_id', 'openai::quick')

    const { result } = renderHook(() => useQuickModel())

    expect(mockUseQuery).toHaveBeenCalledTimes(1)
    expect(mockUseQuery).toHaveBeenCalledWith('/models/openai::quick', {
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
    expect(result.current.isLoading).toBe(true)
  })

  it('falls back to the default model id when no quick model is configured', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::default')
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.model_id', null)

    renderHook(() => useQuickModel())

    expect(mockUseQuery).toHaveBeenCalledWith('/models/openai::default', {
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })
})
```

- [ ] **步骤 3：运行测试并确认失败原因正确**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/hooks/__tests__/useModel.test.ts
```

预期：FAIL，TypeScript/模块错误指出 `useQuickModel` 尚未从 `useModel.ts` 导出。

- [ ] **步骤 4：实现最小 `useQuickModel` hook**

在 `useDefaultModel` 之前加入：

```ts
export function useQuickModel(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [quickModelId] = usePreference('feature.quick_assistant.model_id')
  const modelId = (quickModelId ?? defaultModelId) as UniqueModelId | null

  return useModelById(enabled ? modelId : null)
}
```

不要修改 `useDefaultModel` 的 setter 或其他模型 fallback。

- [ ] **步骤 5：运行 focused test 并确认通过**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/hooks/__tests__/useModel.test.ts
```

预期：PASS，现有 model-hook 测试和两个新契约测试均通过。

- [ ] **步骤 6：提交 focused hook**

```bash
git add src/renderer/hooks/useModel.ts src/renderer/hooks/__tests__/useModel.test.ts
git commit -S --signoff -m "refactor(model-hooks): expose focused quick model state"
```

预期：commit 成功，`git cat-file commit HEAD` 包含 `gpgsig`，commit message body 包含 `Signed-off-by`。

---

### 任务 2：把语言检测改为明确的 pending 控制器

**文件：**
- 修改：`src/renderer/hooks/translate/useDetectLang.ts:1-4,175-232`
- 修改：`src/renderer/hooks/translate/index.ts:1`
- 修改：`src/renderer/pages/translate/TranslatePage.tsx:139-145`
- 测试：`src/renderer/hooks/translate/__tests__/useDetectLang.test.ts:55-65,222-300`

- [ ] **步骤 1：把 hook mock 改为可表达 loading/error 的 quick-model 查询**

在 `useDetectLang.test.ts` 中用下面的 mock 替换 `useDefaultModelMock`：

```ts
interface QuickModelHookState {
  model?: unknown
  isLoading: boolean
  error?: Error
}

const useQuickModelMock = vi.fn<() => QuickModelHookState>(() => ({
  model: TEST_MODEL,
  isLoading: false,
  error: undefined
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useQuickModel: (options?: { enabled?: boolean }) => {
    void options
    return useQuickModelMock()
  }
}))
```

把 hook 测试调用从 `result.current(text)` 机械改为 `result.current.detectLanguage(text)`，纯 helper 测试不变。

- [ ] **步骤 2：编写 pending 与 settled error 的失败测试**

在 `describe('useDetectLang hook')` 中加入：

```ts
it('stays pending while the quick model is loading', () => {
  useQuickModelMock.mockReturnValue({ model: undefined, isLoading: true, error: undefined })

  const { result } = renderHook(() => useDetectLang())

  expect(result.current.isPending).toBe(true)
})

it('leaves pending after a quick-model failure so the caller can use the existing fallback', () => {
  useQuickModelMock.mockReturnValue({
    model: undefined,
    isLoading: false,
    error: new Error('model query failed')
  })

  const { result } = renderHook(() => useDetectLang())

  expect(result.current.isPending).toBe(false)
})

it('does not wait for the quick model in franc-only mode', () => {
  mockUsePreference.mockImplementation(() => ['franc', vi.fn()] as any)
  useQuickModelMock.mockReturnValue({ model: undefined, isLoading: true, error: undefined })

  const { result } = renderHook(() => useDetectLang())

  expect(result.current.isPending).toBe(false)
})
```

在现有“languages are still loading”测试中额外断言：

```ts
expect(result.current.isPending).toBe(true)
```

- [ ] **步骤 3：运行 hook 测试并确认失败**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/hooks/translate/__tests__/useDetectLang.test.ts
```

预期：FAIL，因为 `useDetectLang` 仍返回函数且没有 `isPending`。

- [ ] **步骤 4：实现检测控制器**

把 model import 改为：

```ts
import { useQuickModel } from '@renderer/hooks/useModel'
```

在 hook 之前声明并导出类型：

```ts
export interface DetectLanguageController {
  detectLanguage: (text: string) => Promise<TranslateLangCode>
  isPending: boolean
}
```

把 `useDetectLang` 的模型读取和返回值改为：

```ts
export const useDetectLang = (): DetectLanguageController => {
  const [method] = usePreference('feature.translate.auto_detection_method')
  const { languages, status } = useLanguages()
  const needsQuickModel = method !== 'franc'
  const { model: quickModel, isLoading: isQuickModelLoading } = useQuickModel({ enabled: needsQuickModel })

  // 保留现有 toastedEmptyRef 和 detectLanguage callback 实现。

  return {
    detectLanguage,
    isPending: status === 'loading' || (needsQuickModel && isQuickModelLoading)
  }
}
```

不要吞掉 `detectLanguageByLLM` 的 missing-model/provider 错误；`ActionTranslate` 仍通过 `detectLanguageOrUnknown` 降级。

- [ ] **步骤 5：导出类型并适配 TranslatePage**

把 barrel 改为：

```ts
export {
  type DetectLanguageController,
  detectLanguageOrUnknown,
  useDetectLang
} from './useDetectLang'
```

把 `TranslatePage.tsx` 的读取改为：

```ts
const { detectLanguage } = useDetectLang()
```

不要让 TranslatePage 自动触发 pending 后的翻译；该页面仍由用户的翻译操作驱动。

- [ ] **步骤 6：运行定向测试和 web typecheck**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/hooks/translate/__tests__/useDetectLang.test.ts
pnpm typecheck:web
```

预期：两条命令均以 0 退出；hook 测试 PASS，所有调用点使用新返回结构。

- [ ] **步骤 7：提交检测控制器**

```bash
git add src/renderer/hooks/translate/useDetectLang.ts \
  src/renderer/hooks/translate/index.ts \
  src/renderer/hooks/translate/__tests__/useDetectLang.test.ts \
  src/renderer/pages/translate/TranslatePage.tsx
git commit -S --signoff -m "refactor(translate): expose detection readiness"
```

预期：commit 已签名并 DCO sign-off。

---

### 任务 3：让 ActionTranslate 每个语义请求只执行一次

**文件：**
- 修改：`src/renderer/windows/selection/action/components/ActionTranslate.tsx:7-17,29-47,68-230,406-425`
- 测试：`src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx:15-115,127-330`

- [ ] **步骤 1：把组件测试改为显式传入检测控制器**

从组件测试的 translate mock 中删除 `useDetectLang`，保留 `detectLanguageOrUnknown`、`useLanguages` 和 `useTranslate`。新增统一 render helper，供现有测试和新测试使用：

```tsx
const readyDetection = () => ({
  detectLanguage: state.detectLanguage,
  isPending: false
})

function renderTranslation(
  action = createAction(),
  options: {
    sessionId?: number
    detection?: ReturnType<typeof readyDetection>
  } = {}
) {
  return render(
    <ActionTranslate
      action={action}
      sessionId={options.sessionId ?? 0}
      detection={options.detection ?? readyDetection()}
      scrollToBottom={state.scrollToBottom}
    />
  )
}
```

把现有直接 `render(<ActionTranslate ... />)` 调用改用此 helper；不改变现有 UI 断言。

- [ ] **步骤 2：编写 pending 到 ready 只执行一次的失败测试**

```tsx
it('waits for detection resources and then translates exactly once', async () => {
  state.detectLanguage.mockResolvedValue('en-us')
  const action = createAction()
  const { rerender } = render(
    <ActionTranslate
      action={action}
      sessionId={0}
      detection={{ detectLanguage: state.detectLanguage, isPending: true }}
      scrollToBottom={state.scrollToBottom}
    />
  )

  expect(state.detectLanguage).not.toHaveBeenCalled()
  expect(state.translate).not.toHaveBeenCalled()

  rerender(
    <ActionTranslate
      action={action}
      sessionId={0}
      detection={{ detectLanguage: state.detectLanguage, isPending: false }}
      scrollToBottom={state.scrollToBottom}
    />
  )

  await waitFor(() => expect(state.translate).toHaveBeenCalledWith(action.selectedText, state.chinese))
  expect(state.detectLanguage).toHaveBeenCalledTimes(1)
  expect(state.translate).toHaveBeenCalledTimes(1)
})
```

- [ ] **步骤 3：编写 callback replacement 不重跑的失败测试**

```tsx
it('does not restart after the detection callback identity changes', async () => {
  state.detectLanguage.mockResolvedValue('en-us')
  const action = createAction()
  const replacement = vi.fn().mockResolvedValue('en-us')
  const { rerender } = render(
    <ActionTranslate
      action={action}
      sessionId={0}
      detection={{ detectLanguage: state.detectLanguage, isPending: false }}
      scrollToBottom={state.scrollToBottom}
    />
  )

  await waitFor(() => expect(state.translate).toHaveBeenCalledTimes(1))
  rerender(
    <ActionTranslate
      action={action}
      sessionId={0}
      detection={{ detectLanguage: replacement, isPending: false }}
      scrollToBottom={state.scrollToBottom}
    />
  )

  await act(async () => {})
  expect(replacement).not.toHaveBeenCalled()
  expect(state.translate).toHaveBeenCalledTimes(1)
})
```

- [ ] **步骤 4：编写 stale detection 与同文本新 session 的失败测试**

在测试文件中添加一个局部 deferred helper：

```ts
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
```

新增：

```tsx
it('discards a stale detection result when a new session arrives', async () => {
  const first = deferred<TranslateLangCode>()
  const second = deferred<TranslateLangCode>()
  state.detectLanguage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const firstAction = createAction({ selectedText: 'first text' })
  const secondAction = createAction({ selectedText: 'second text' })
  const { rerender } = renderTranslation(firstAction, { sessionId: 0 })

  await waitFor(() => expect(state.detectLanguage).toHaveBeenCalledWith('first text'))
  rerender(
    <ActionTranslate
      action={secondAction}
      sessionId={1}
      detection={readyDetection()}
      scrollToBottom={state.scrollToBottom}
    />
  )
  await waitFor(() => expect(state.detectLanguage).toHaveBeenCalledWith('second text'))

  await act(async () => first.resolve('en-us'))
  expect(state.translate).not.toHaveBeenCalledWith('first text', expect.anything())

  await act(async () => second.resolve('en-us'))
  await waitFor(() => expect(state.translate).toHaveBeenCalledWith('second text', state.chinese))
})

it('runs once for a new session even when the selected text is unchanged', async () => {
  state.detectLanguage.mockResolvedValue('en-us')
  const action = createAction({ selectedText: 'same text' })
  const { rerender } = renderTranslation(action, { sessionId: 0 })
  await waitFor(() => expect(state.translate).toHaveBeenCalledTimes(1))

  rerender(
    <ActionTranslate
      action={{ ...action }}
      sessionId={1}
      detection={readyDetection()}
      scrollToBottom={state.scrollToBottom}
    />
  )

  await waitFor(() => expect(state.translate).toHaveBeenCalledTimes(2))
  expect(state.detectLanguage).toHaveBeenCalledTimes(2)
})
```

在现有“detection throws”测试中补充 `expect(state.translate).toHaveBeenCalledTimes(1)`，保护 V2 降级行为不会因本次修复被移除。

- [ ] **步骤 5：运行组件测试并确认失败原因正确**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
```

预期：FAIL；组件尚不接受 `sessionId`/`detection`，且当前 callback 依赖会导致重复执行。

- [ ] **步骤 6：修改 Props、语言资源 settled gate 和 React imports**

使用显式控制器：

```ts
import {
  type DetectLanguageController,
  detectLanguageOrUnknown,
  useLanguages,
  useTranslate
} from '@renderer/hooks/translate'
import React, { Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

interface Props {
  action: SelectionActionItem
  sessionId: number
  detection: DetectLanguageController
  scrollToBottom: () => void
}

const ActionTranslate: FC<Props> = ({ action, sessionId, detection, scrollToBottom }) => {
  const { detectLanguage, isPending } = detection
```

把语言 hook 读取改为包含状态：

```ts
const { languages, getLanguage, status: languagesStatus } = useLanguages()
const areLanguagesReady = languagesStatus === 'ready'
const areLanguagesSettled = languagesStatus !== 'loading'
```

`updateLanguagePair` 仅在 `areLanguagesReady` 时读取配置语言；`initialize` 在 `areLanguagesSettled` 后完成。语言查询真实失败时保留内置 target/alter fallback，并允许检测控制器返回 `unknown` 后继续翻译，不能永久卡在初始化。

- [ ] **步骤 7：用 request token 和 Effect Event 替换 fetchResult callback**

保留现有 `useTranslate`，删除 `clear`/`fetchResult` 两个 `useCallback` 以及依赖它的 effect，加入：

```ts
const requestTokenRef = useRef(0)
const [regenerationId, setRegenerationId] = useState(0)

const resetRequest = useEffectEvent(() => {
  cancelTranslate()
  setContent('')
  setCompletionError(null)
  setDetectedLanguage(null)
  setIsDetecting(false)
  setIsPreparing(false)
})

const runRequest = useEffectEvent(async (requestToken: number) => {
  setIsDetecting(true)
  const sourceLanguageCode = await detectLanguageOrUnknown(selectedText!, detectLanguage, (error) => {
    logger.error('Error detecting language:', error as Error)
  })

  if (requestTokenRef.current !== requestToken) return
  setIsDetecting(false)

  const detectedLang = getLanguage(sourceLanguageCode) ?? null
  setDetectedLanguage(detectedLang)
  const translateLang = pickBidirectionalTarget(sourceLanguageCode, targetLanguage, alterLanguage)
  setActualTargetLanguage(translateLang)
  setCompletionError(null)
  setIsPreparing(true)

  try {
    await runTranslate(selectedText!, translateLang)
  } catch (error) {
    if (requestTokenRef.current !== requestToken) return
    setContent('')
    setCompletionError(getSelectionActionErrorMessage(error, t))
  } finally {
    if (requestTokenRef.current === requestToken) setIsPreparing(false)
  }
})

useEffect(() => {
  const requestToken = ++requestTokenRef.current
  resetRequest()

  if (!selectedText || !initialized || isPending) return
  void runRequest(requestToken)

  return () => {
    requestTokenRef.current += 1
    cancelTranslate()
  }
  // Effect Events read the latest functions and objects; only semantic inputs restart the request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  sessionId,
  selectedText,
  initialized,
  isPending,
  targetLanguage.langCode,
  alterLanguage.langCode,
  regenerationId
])
```

在 `runRequest` 中保留当前 UNKNOWN/检测成功的 debug log。不要把 `detection`、`detectLanguage`、model 或 SWR 状态对象加入 effect dependencies。

- [ ] **步骤 8：让暂停和重新生成走同一 token 契约**

```ts
const handlePause = () => {
  requestTokenRef.current += 1
  cancelTranslate()
  setIsDetecting(false)
  setIsPreparing(false)
}

const handleRegenerate = () => {
  setRegenerationId((current) => current + 1)
}
```

资源等待时在结果区域显示现有 spinner，但不要把 pending 加入 `WindowFooter` 的 `loading`；这样等待资源时 Esc 仍关闭窗口，不会出现“暂停后 pending 结束又自动重启”的新状态机：

```ts
const isWaitingForResources = Boolean(selectedText) && (!initialized || isPending)
const isStreaming = isTranslating || isDetecting || isPreparing

// render
{(isWaitingForResources || isDetecting || isPreparing) && (
  <Loader2 className="size-4 animate-spin text-muted-foreground" />
)}
```

- [ ] **步骤 9：运行组件测试并确认通过**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
```

预期：PASS；pending 不发请求、callback replacement 不重跑、stale result 被丢弃、同文本新 session 重跑一次、真实错误仍降级一次。

- [ ] **步骤 10：暂存组件改动但等待窗口 wiring 一起提交**

```bash
git add src/renderer/windows/selection/action/components/ActionTranslate.tsx \
  src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
git diff --cached --check
```

预期：无 whitespace 错误。此时不提交，因为新 Props 必须和下一任务的 `ActionWindow` wiring 保持同一个可构建 commit。

---

### 任务 4：在 pooled window 中预热并连接检测控制器

**文件：**
- 修改：`src/renderer/windows/selection/action/entryPoint.tsx:9-19`
- 修改：`src/renderer/windows/selection/action/ActionWindow.tsx:1-45,270-283`
- 修改：`src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx:10-75`
- 已暂存：任务 3 的 ActionTranslate 生产与测试文件

- [ ] **步骤 1：在 ActionWindow 测试中提供稳定检测控制器 mock**

在 hoisted test state 中加入：

```ts
detection: {
  detectLanguage: vi.fn().mockResolvedValue('en-us'),
  isPending: false
}
```

并增加模块 mock：

```ts
vi.mock('@renderer/hooks/translate', () => ({
  useDetectLang: () => detection
}))
```

保留 ActionTranslate 叶子 mock；不要新增“hook 被调用一次”之类的内部实现断言。

- [ ] **步骤 2：在空 action guard 之前创建检测控制器**

在 `ActionWindow.tsx` 导入：

```ts
import { type DetectLanguageController, useDetectLang } from '@renderer/hooks/translate'
```

更新 outer shell：

```tsx
const ActionWindow: FC = () => {
  const detection = useDetectLang()
  const action = useWindowInitData<SelectionActionItem>()
  if (!action) return null
  return <SelectionActionContent action={action} detection={detection} />
}
```

更新 content props：

```ts
interface SelectionActionContentProps {
  action: SelectionActionItem
  detection: DetectLanguageController
}

const SelectionActionContent: FC<SelectionActionContentProps> = ({ action, detection }) => {
```

把 translate render 改为：

```tsx
{action.id === 'translate' && (
  <ActionTranslate
    action={action}
    sessionId={sessionId}
    detection={detection}
    scrollToBottom={handleScrollToBottom}
  />
)}
```

保持 ActionGeneral 的 `key={sessionId}` 行为不变。

- [ ] **步骤 3：在 action window 首帧前预加载翻译 Preference**

把这些 key 追加到 `entryPoint.tsx` 的现有 `preference` 数组：

```ts
'chat.default_model_id',
'feature.quick_assistant.model_id',
'feature.translate.auto_detection_method',
'feature.translate.action.preferred_lang',
'feature.translate.action.alter_lang'
```

不要切换到 `preference: 'all'`；只预加载当前 window 第一条翻译链路实际消费的设置。

- [ ] **步骤 4：运行窗口、组件、hook 的联合定向测试**

运行：

```bash
pnpm exec vitest run --project renderer \
  src/renderer/hooks/__tests__/useModel.test.ts \
  src/renderer/hooks/translate/__tests__/useDetectLang.test.ts \
  src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx \
  src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
```

预期：全部 PASS。不得用全量 `pnpm test` 替代此命令。

- [ ] **步骤 5：运行 web typecheck**

运行：

```bash
pnpm typecheck:web
```

预期：0 errors，ActionWindow、ActionTranslate 和 TranslatePage 的控制器类型一致。

- [ ] **步骤 6：提交完整 selection action wiring**

```bash
git add src/renderer/windows/selection/action/entryPoint.tsx \
  src/renderer/windows/selection/action/ActionWindow.tsx \
  src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx \
  src/renderer/windows/selection/action/components/ActionTranslate.tsx \
  src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
git commit -S --signoff -m "fix(selection-translate): prevent duplicate translation runs"
```

预期：commit 已签名并 DCO sign-off，commit 自身可通过联合定向测试和 web typecheck。

---

### 任务 5：运行限定质量门禁和手动性能对比

**文件：**
- 验证：任务 1–4 的全部生产和测试文件
- 手动资产：`.context/cherry-electron-dev/selection-translate-mock.mjs`
- 手动资产：`.context/cherry-electron-dev/run-selection-latency.mjs`
- 规格：`docs/superpowers/specs/2026-08-18-selection-translate-latency-design.md`

- [ ] **步骤 1：运行最终联合定向测试**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/hooks/__tests__/useModel.test.ts \
  src/renderer/hooks/translate/__tests__/useDetectLang.test.ts \
  src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx \
  src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
```

预期：全部 PASS。不要运行 `pnpm test`。

- [ ] **步骤 2：运行不包含全量测试的仓库质量门禁**

依次运行：

```bash
pnpm lint
pnpm test:lint
pnpm docs:check-links
pnpm format
```

预期：全部以 0 退出。`pnpm lint` 可能报告仓库既有 warning，但不能有 error。

明确不要运行：

```bash
pnpm test
pnpm build:check
```

原因：`pnpm build:check` 会传递调用全量 `pnpm test`，与用户约束冲突。

- [ ] **步骤 3：重新运行联合定向测试，确认 formatter 没有改变行为**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/hooks/__tests__/useModel.test.ts \
  src/renderer/hooks/translate/__tests__/useDetectLang.test.ts \
  src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx \
  src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
```

预期：全部 PASS。

- [ ] **步骤 4：启动或复用 tracked Electron instance 与受控 mock**

按照 `cherry-electron-dev` skill 使用独立 development profile 启动当前 branch。mock 必须满足：

- quick model 与 translate model 都指向 `anthropic/claude-haiku-4.5`。
- endpoint 指向 `.context/cherry-electron-dev/selection-translate-mock.mjs`。
- language detection 和 translation 的有效固定延迟都是 150 ms。
- 日志写入新的 NDJSON 文件，不能覆盖改动前基线。

预期：action window pool 已 eager warm-up；main window 和 selection action targets 可通过 CDP 发现。

- [ ] **步骤 5：执行五次 after-fix action**

对 tracked instance 的实际 CDP port 连续运行：

```bash
node .context/cherry-electron-dev/run-selection-latency.mjs <cdp-port> fixed-1
node .context/cherry-electron-dev/run-selection-latency.mjs <cdp-port> fixed-2
node .context/cherry-electron-dev/run-selection-latency.mjs <cdp-port> fixed-3
node .context/cherry-electron-dev/run-selection-latency.mjs <cdp-port> fixed-4
node .context/cherry-electron-dev/run-selection-latency.mjs <cdp-port> fixed-5
```

预期：每条命令在 10 秒内输出一个包含 `totalMs` 的 JSON 结果。

- [ ] **步骤 6：检查请求序列和耗时验收**

对每个 `fixed-N` 标签检查 mock NDJSON，必须满足：

1. 恰好两个 `received` 事件。
2. 第一条是 `language-detection`，`reasoningEffort` 为 `none`。
3. 第二条是 `translation`。
4. translation 的 received 时间晚于 detection 的 responded 时间。
5. Electron 日志中没有该 action 的 translation abort/restart。

计算五次 `totalMs` 的中位数。验收目标是不高于约 1,300 ms，相比当前 1,738 ms 基线降低至少 25%。如果请求序列正确但未达到该阈值，停止完成声明并继续 profile action dispatch、窗口 init-data 或结果渲染延迟。

- [ ] **步骤 7：检查最终 diff 和 commit 签名**

```bash
git diff origin/main...HEAD --check
git status --short
git log --format='%h %s' origin/main..HEAD
for commit in $(git rev-list origin/main..HEAD); do git cat-file commit "$commit" | grep -q '^gpgsig '; done
git log --format='%B' origin/main..HEAD | grep 'Signed-off-by:'
```

预期：无 whitespace 错误，无意外未提交生产改动；所有 commits 都有 `gpgsig`，并包含 DCO sign-off。

- [ ] **步骤 8：如格式化产生改动，提交最终格式修正**

仅当 `git status --short` 显示任务范围内的格式变化时运行：

```bash
git add src/renderer/hooks/useModel.ts \
  src/renderer/hooks/translate/useDetectLang.ts \
  src/renderer/hooks/translate/index.ts \
  src/renderer/pages/translate/TranslatePage.tsx \
  src/renderer/windows/selection/action/entryPoint.tsx \
  src/renderer/windows/selection/action/ActionWindow.tsx \
  src/renderer/windows/selection/action/components/ActionTranslate.tsx \
  src/renderer/hooks/__tests__/useModel.test.ts \
  src/renderer/hooks/translate/__tests__/useDetectLang.test.ts \
  src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx \
  src/renderer/windows/selection/action/components/__tests__/ActionTranslate.test.tsx
git commit -S --signoff -m "chore(selection-translate): apply verified formatting"
```

预期：只包含 formatter 对任务文件的机械调整。若没有格式变化，不创建空 commit。

---

## 完成报告要求

最终报告必须包含：

- 正常链路由三次模型请求减少为两次的 NDJSON 证据。
- 五次 before/after 耗时和中位数、百分比变化。
- 已运行的四个定向测试文件及结果。
- `pnpm lint`、`pnpm test:lint`、`pnpm docs:check-links`、`pnpm format` 的退出结果。
- 明确说明按用户要求没有运行 `pnpm test` 和 `pnpm build:check`。
- 修改文件清单、commit 列表以及签名/DCO 验证结果。
