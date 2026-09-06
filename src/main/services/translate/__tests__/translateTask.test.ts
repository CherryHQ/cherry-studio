import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const streamPromptMock = vi.fn()
const abortMock = vi.fn()
const ipcSendMock = vi.fn()
const resolvePayloadMock = vi.fn(() => ({ uniqueModelId: 'openai::gpt', content: 'prompt', model: {} }))
const resolveParamsMock = vi.fn(() => ({ reasoningEffort: 'none', callOverrides: {} }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: { streamPrompt: streamPromptMock, abort: abortMock },
    IpcApiService: { send: ipcSendMock },
    TranslateService: { resolveTranslatePayload: resolvePayloadMock, resolveRequestParameters: resolveParamsMock }
  } as never)
})

const detectMock = vi.fn<() => Promise<TranslateLangCode>>()
vi.mock('../detectLanguage', () => ({ detectLanguageOrUnknown: () => detectMock() }))

vi.mock('@main/data/services/TranslateLanguageService', () => ({
  translateLanguageService: { getByLangCode: (code: string) => ({ langCode: code, value: code }) }
}))

vi.mock('../../../ai/streamManager', () => ({
  WebContentsListener: vi.fn().mockImplementation(() => ({
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn()
  }))
}))

const { TranslateTask } = await import('../translateTask')

/** A WebContents stand-in that records its `destroyed` listener so tests can fire it. */
function fakeSender() {
  const listeners = new Set<() => void>()
  return {
    wc: {
      once: (_event: string, listener: () => void) => listeners.add(listener),
      removeListener: (_event: string, listener: () => void) => listeners.delete(listener)
    } as unknown as Electron.WebContents,
    destroy: () => {
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size
  }
}

const REQUEST = {
  text: 'hello',
  sourceLangCode: 'auto' as const,
  targetLangCode: 'zh-cn' as TranslateLangCode,
  bidirectional: false,
  bidirectionalPair: ['en-us', 'zh-cn'] as [TranslateLangCode, TranslateLangCode]
}

const finish = vi.fn()

function makeTask(overrides: Partial<typeof REQUEST> = {}, sender = fakeSender()) {
  const task = new TranslateTask('task-1', 'translate:task-1', { ...REQUEST, ...overrides }, 'window-1', sender.wc, {
    finish
  })
  return { task, sender }
}

const eventsOf = (name: string) => ipcSendMock.mock.calls.filter(([, event]) => event === name)

beforeEach(() => {
  vi.clearAllMocks()
  detectMock.mockResolvedValue('en-us' as TranslateLangCode)
})

describe('TranslateTask', () => {
  it('opens the stream only after detection resolves', async () => {
    const { task } = makeTask()
    let releaseDetection = (): void => undefined
    detectMock.mockReturnValueOnce(
      new Promise<TranslateLangCode>((resolve) => {
        releaseDetection = () => resolve('en-us' as TranslateLangCode)
      })
    )

    const run = task.run()
    expect(streamPromptMock).not.toHaveBeenCalled()

    releaseDetection()
    await run
    expect(streamPromptMock).toHaveBeenCalledWith(expect.objectContaining({ streamId: 'translate:task-1' }))
  })

  it('cancelling during detection never opens a stream', async () => {
    // The renderer-side version could not do this: detection lived in a promise the tab session
    // had no handle on, so a cancel landed before a run that started anyway and owned by nobody.
    const { task } = makeTask()
    let releaseDetection = (): void => undefined
    detectMock.mockReturnValueOnce(
      new Promise<TranslateLangCode>((resolve) => {
        releaseDetection = () => resolve('en-us' as TranslateLangCode)
      })
    )

    const run = task.run()
    task.cancel()
    releaseDetection()
    await run

    expect(streamPromptMock).not.toHaveBeenCalled()
    expect(eventsOf('translate.task.aborted')).toHaveLength(1)
  })

  it('cancels itself when the window that started it is destroyed', async () => {
    // A destroyed window runs no renderer effects, so nothing on that side is left to notice.
    const { task, sender } = makeTask()
    await task.run()
    expect(streamPromptMock).toHaveBeenCalled()

    sender.destroy()

    expect(abortMock).toHaveBeenCalledWith('translate:task-1', expect.any(String))
    expect(finish).toHaveBeenCalledWith('task-1')
  })

  it('hands a re-attaching window what it missed', async () => {
    const { task } = makeTask()
    await task.run()
    task.onChunk({ type: 'text-delta', delta: 'partial' } as never)

    const next = fakeSender()
    const state = task.attach('window-2', next.wc)

    expect(state.accumulated).toBe('partial')
    expect(state.streamId).toBe('translate:task-1')
    expect(state.busy).toBe(true)
  })

  it('stops watching the window it left behind', async () => {
    const { task, sender } = makeTask()
    await task.run()

    const next = fakeSender()
    task.attach('window-2', next.wc)
    sender.destroy()

    expect(abortMock).not.toHaveBeenCalled()
  })

  it('keeps translating when detection fails, rather than failing the task', async () => {
    detectMock.mockResolvedValue('unknown' as TranslateLangCode)
    const { task } = makeTask()

    await task.run()

    expect(streamPromptMock).toHaveBeenCalled()
    expect(eventsOf('translate.task.failed')).toHaveLength(0)
  })

  it('reports a target that cannot be resolved instead of opening a stream', async () => {
    detectMock.mockResolvedValue('zh-cn' as TranslateLangCode)
    const { task } = makeTask({ sourceLangCode: 'zh-cn' as never, targetLangCode: 'zh-cn' as TranslateLangCode })

    await task.run()

    expect(streamPromptMock).not.toHaveBeenCalled()
    expect(eventsOf('translate.task.failed')[0][2]).toMatchObject({ messageKey: 'translate.language.same' })
  })

  it('reports the accumulated text once the stream is done', async () => {
    const { task } = makeTask()
    await task.run()
    task.onChunk({ type: 'text-delta', delta: '  translated  ' } as never)

    task.onDone({ status: 'success' } as never)

    expect(eventsOf('translate.task.completed')[0][2]).toMatchObject({ taskId: 'task-1', text: 'translated' })
    expect(finish).toHaveBeenCalledWith('task-1')
  })
})
