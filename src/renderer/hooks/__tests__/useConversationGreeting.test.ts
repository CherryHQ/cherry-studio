import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

import { useConversationGreeting } from '../useConversationGreeting'

describe('useConversationGreeting', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.language': 'zh-cn',
      'app.user.name': 'Siin',
      'feature.conversation_greeting.enabled': true
    })
    mocks.request.mockReset()
    sessionStorage.clear()
  })

  it('changes the local Chat greeting after refresh without contacting remote services', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.conversation_greeting.enabled', false)

    const firstRender = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'disabled-conversation'))
    await waitFor(() => expect(firstRender.result.current).not.toBe('今天想聊点什么？'))
    const firstGreeting = firstRender.result.current
    firstRender.unmount()

    const refreshedRender = renderHook(() =>
      useConversationGreeting('chat', '今天想聊点什么？', 'disabled-conversation')
    )
    await waitFor(() => expect(refreshedRender.result.current).not.toBe('今天想聊点什么？'))

    expect(refreshedRender.result.current).not.toBe(firstGreeting)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('uses distinct local greetings for Chat and Agent without contacting remote services', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.conversation_greeting.enabled', false)

    const chatRender = renderHook(() =>
      useConversationGreeting('chat', '今天想聊点什么？', 'disabled-chat-conversation')
    )
    const agentRender = renderHook(() =>
      useConversationGreeting('agent', '今天想做点什么？', 'disabled-agent-conversation')
    )

    await waitFor(() => {
      expect(chatRender.result.current).not.toBe('今天想聊点什么？')
      expect(agentRender.result.current).not.toBe('今天想做点什么？')
    })
    expect(agentRender.result.current).not.toBe(chatRender.result.current)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('replaces the local greeting when CherryAI generates a contextual greeting', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') {
        return Promise.resolve('US')
      }
      if (route === 'ai.text.generate') {
        return Promise.resolve({ text: '晚上好，Siin！想聊点什么？' })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { result } = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'chat-conversation'))

    await waitFor(() => expect(result.current).toBe('晚上好，Siin！想聊点什么？'))

    expect(mocks.request).toHaveBeenCalledWith('system.ip_country.detect')
    expect(mocks.request).toHaveBeenCalledWith(
      'ai.text.generate',
      expect.objectContaining({
        requestId: expect.any(String),
        prompt: 'Generate the greeting now.',
        uniqueModelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      })
    )

    const generateRequest = mocks.request.mock.calls.find(([route]) => route === 'ai.text.generate')?.[1]
    expect(generateRequest.system).toContain('"userName": "Siin"')
    expect(generateRequest.system).toContain('"language": "zh-cn"')
    expect(generateRequest.system).toContain('"countryOrRegion": "US"')
    expect(generateRequest.system).toContain('"countryOrRegionSource": "ip"')
    expect(generateRequest.system).toContain('"fallbackGreeting": "今天想聊点什么？"')
  })

  it('uses casual guidance for Chat and task-oriented guidance for Agent', async () => {
    let generationCount = 0
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') {
        return Promise.resolve('CN')
      }
      if (route === 'ai.text.generate') {
        generationCount += 1
        return Promise.resolve({
          text: generationCount === 1 ? '想随便聊聊什么？' : '我可以帮你规划并完成一个具体任务。'
        })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const chatRender = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'chat-conversation'))
    await waitFor(() => expect(chatRender.result.current).toBe('想随便聊聊什么？'))
    chatRender.unmount()

    const agentRender = renderHook(() => useConversationGreeting('agent', '今天想做点什么？', 'agent-conversation'))
    await waitFor(() => expect(agentRender.result.current).toBe('我可以帮你规划并完成一个具体任务。'))

    const generationRequests = mocks.request.mock.calls.filter(([route]) => route === 'ai.text.generate')
    const chatSystem = generationRequests[0]?.[1].system
    const agentSystem = generationRequests[1]?.[1].system
    expect(chatSystem).toContain('This is Chat mode')
    expect(chatSystem).toContain('casual and conversational')
    expect(agentSystem).toContain('This is Agent mode')
    expect(agentSystem).toContain('task-oriented')
    expect(agentSystem).toContain('concrete task')
    expect(agentSystem).not.toBe(chatSystem)
  })

  it('keeps the local greeting when generation fails', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') {
        return Promise.resolve('CN')
      }
      return Promise.reject(new Error('CherryAI unavailable'))
    })

    const { result } = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'failed-conversation'))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('ai.text.generate', expect.any(Object)))
    expect(result.current).not.toBe('今天想聊点什么？')
  })

  it('marks the language region as low-confidence when IP-region detection is unavailable', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') {
        return Promise.resolve(null)
      }
      if (route === 'ai.text.generate') {
        return Promise.resolve({ text: '周末愉快，要来玩个游戏吗？' })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { result } = renderHook(() =>
      useConversationGreeting('chat', '今天想聊点什么？', 'region-fallback-conversation')
    )

    await waitFor(() => expect(result.current).toBe('周末愉快，要来玩个游戏吗？'))
    const generateRequest = mocks.request.mock.calls.find(([route]) => route === 'ai.text.generate')?.[1]
    expect(generateRequest.system).toContain('"countryOrRegion": "CN"')
    expect(generateRequest.system).toContain('"countryOrRegionSource": "language"')
  })

  it('does not generate after unmounting while region detection is pending', async () => {
    let resolveCountry: (country: string) => void = () => undefined
    const pendingCountry = new Promise<string | null>((resolve) => {
      resolveCountry = resolve
    })
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') {
        return pendingCountry
      }
      if (route === 'ai.text.generate') {
        return Promise.resolve({ text: '不应生成的问候' })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { unmount } = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'cancelled-conversation'))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('system.ip_country.detect'))

    unmount()
    await act(async () => {
      resolveCountry('CN')
      await pendingCountry
      await Promise.resolve()
    })

    expect(mocks.request).not.toHaveBeenCalledWith('ai.text.generate', expect.any(Object))
  })

  it('aborts an in-flight model request when the empty view unmounts', async () => {
    let resolveGreeting: (result: { text: string }) => void = () => undefined
    const pendingGreeting = new Promise<{ text: string }>((resolve) => {
      resolveGreeting = resolve
    })
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') return Promise.resolve('US')
      if (route === 'ai.text.generate') return pendingGreeting
      if (route === 'ai.text.abort') return Promise.resolve()
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { unmount } = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'aborted-conversation'))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('ai.text.generate', expect.any(Object)))
    const requestId = mocks.request.mock.calls.find(([route]) => route === 'ai.text.generate')?.[1].requestId

    unmount()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('ai.text.abort', { requestId }))

    await act(async () => {
      resolveGreeting({ text: '迟到的问候' })
      await pendingGreeting
    })
  })

  it.each([
    ['overlong text', 'x'.repeat(121)],
    ['Markdown', '**Hello there**'],
    ['quotation marks', '"Hello there"'],
    ['emoji', 'Hello there 👋'],
    ['multiple lines', 'Hello there\nHow are you?'],
    ['bidirectional override', 'Safe link \u202Emoc.elpmaxe'],
    ['more than two sentences', 'One. Two. Three.']
  ])('keeps the local greeting for invalid model output: %s', async (_caseName, generatedText) => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') return Promise.resolve('US')
      if (route === 'ai.text.generate') return Promise.resolve({ text: generatedText })
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { result } = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', `invalid-${_caseName}`))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('ai.text.generate', expect.any(Object)))
    await act(async () => Promise.resolve())

    expect(result.current).not.toBe('今天想聊点什么？')
    expect(result.current).not.toBe(generatedText)
    expect(sessionStorage.getItem(`conversation-greeting:last:invalid-${_caseName}`)).toBe(result.current)
  })

  it('regenerates for a new conversation and ignores the previous result', async () => {
    let resolveFirstGreeting: (result: { text: string }) => void = () => undefined
    const firstGreeting = new Promise<{ text: string }>((resolve) => {
      resolveFirstGreeting = resolve
    })
    let generationCount = 0
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') {
        return Promise.resolve('CN')
      }
      if (route === 'ai.text.generate') {
        generationCount += 1
        return generationCount === 1 ? firstGreeting : Promise.resolve({ text: '第二个会话的问候' })
      }
      if (route === 'ai.text.abort') return Promise.resolve()
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { rerender, result } = renderHook(
      ({ conversationId }) => useConversationGreeting('chat', '今天想聊点什么？', conversationId),
      { initialProps: { conversationId: 'conversation-1' } }
    )
    await waitFor(() => expect(generationCount).toBe(1))

    rerender({ conversationId: 'conversation-2' })
    await waitFor(() => expect(result.current).toBe('第二个会话的问候'))

    await act(async () => {
      resolveFirstGreeting({ text: '第一个会话的迟到问候' })
      await firstGreeting
    })
    expect(result.current).toBe('第二个会话的问候')
  })

  it('generates a different greeting after refresh and retries a repeated response', async () => {
    const generatedGreetings = ['晚上好，想聊点什么？', '晚上好，想聊点什么？', '周末愉快，要来玩个游戏吗？']
    let generationCount = 0
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.ip_country.detect') {
        return Promise.resolve('CN')
      }
      if (route === 'ai.text.generate') {
        const text = generatedGreetings[generationCount]
        generationCount += 1
        return Promise.resolve({ text })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const firstRender = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'conversation-1'))
    await waitFor(() => expect(firstRender.result.current).toBe('晚上好，想聊点什么？'))
    firstRender.unmount()

    const refreshedRender = renderHook(() => useConversationGreeting('chat', '今天想聊点什么？', 'conversation-1'))
    await waitFor(() => expect(refreshedRender.result.current).toBe('周末愉快，要来玩个游戏吗？'))

    const generationRequests = mocks.request.mock.calls.filter(([route]) => route === 'ai.text.generate')
    expect(generationRequests).toHaveLength(3)
    expect(generationRequests[1][1].system).toContain('"previousGreeting": "晚上好，想聊点什么？"')
    expect(generationRequests[2][1].prompt).toBe('Generate a different greeting now.')
  })
})
