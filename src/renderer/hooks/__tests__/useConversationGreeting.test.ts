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
      'app.user.name': 'Siin'
    })
    mocks.request.mockReset()
  })

  it('shows the localized fallback while CherryAI generates a contextual greeting', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.get_ip_country') {
        return Promise.resolve('US')
      }
      if (route === 'ai.generate_text') {
        return Promise.resolve({ text: '晚上好，Siin！想聊点什么？' })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { result } = renderHook(() => useConversationGreeting('今天想聊点什么？'))

    expect(result.current).toBe('今天想聊点什么？')
    await waitFor(() => expect(result.current).toBe('晚上好，Siin！想聊点什么？'))

    expect(mocks.request).toHaveBeenCalledWith('system.get_ip_country')
    expect(mocks.request).toHaveBeenCalledWith(
      'ai.generate_text',
      expect.objectContaining({
        prompt: 'Generate the greeting now.',
        uniqueModelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      })
    )

    const generateRequest = mocks.request.mock.calls.find(([route]) => route === 'ai.generate_text')?.[1]
    expect(generateRequest.system).toContain('"userName": "Siin"')
    expect(generateRequest.system).toContain('"language": "zh-cn"')
    expect(generateRequest.system).toContain('"countryOrRegion": "US"')
    expect(generateRequest.system).toContain('"fallbackGreeting": "今天想聊点什么？"')
  })

  it('keeps the localized fallback when generation fails', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.get_ip_country') {
        return Promise.resolve('CN')
      }
      return Promise.reject(new Error('CherryAI unavailable'))
    })

    const { result } = renderHook(() => useConversationGreeting('今天想聊点什么？'))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('ai.generate_text', expect.any(Object)))
    expect(result.current).toBe('今天想聊点什么？')
  })

  it('still generates when IP-region detection fails', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.get_ip_country') {
        return Promise.reject(new Error('region unavailable'))
      }
      if (route === 'ai.generate_text') {
        return Promise.resolve({ text: '周末愉快，要来玩个游戏吗？' })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { result } = renderHook(() => useConversationGreeting('今天想聊点什么？'))

    await waitFor(() => expect(result.current).toBe('周末愉快，要来玩个游戏吗？'))
    const generateRequest = mocks.request.mock.calls.find(([route]) => route === 'ai.generate_text')?.[1]
    expect(generateRequest.system).toContain('"countryOrRegion": "CN"')
  })

  it('regenerates for a new conversation and ignores the previous result', async () => {
    let resolveFirstGreeting: (result: { text: string }) => void = () => undefined
    const firstGreeting = new Promise<{ text: string }>((resolve) => {
      resolveFirstGreeting = resolve
    })
    let generationCount = 0
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.get_ip_country') {
        return Promise.resolve('CN')
      }
      if (route === 'ai.generate_text') {
        generationCount += 1
        return generationCount === 1 ? firstGreeting : Promise.resolve({ text: '第二个会话的问候' })
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`))
    })

    const { rerender, result } = renderHook(
      ({ conversationId }) => useConversationGreeting('今天想聊点什么？', conversationId),
      { initialProps: { conversationId: 'conversation-1' } }
    )
    await waitFor(() => expect(generationCount).toBe(1))

    rerender({ conversationId: 'conversation-2' })
    expect(result.current).toBe('今天想聊点什么？')
    await waitFor(() => expect(result.current).toBe('第二个会话的问候'))

    await act(async () => {
      resolveFirstGreeting({ text: '第一个会话的迟到问候' })
      await firstGreeting
    })
    expect(result.current).toBe('第二个会话的问候')
  })
})
