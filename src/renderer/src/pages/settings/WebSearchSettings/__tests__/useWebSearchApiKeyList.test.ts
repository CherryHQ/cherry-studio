import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../../tests/__mocks__/RendererLoggerService'
import { useWebSearchApiKeyList } from '../hooks/useWebSearchApiKeyList'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

describe('useWebSearchApiKeyList', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      tavily: { apiKeys: ['key-a'] }
    })
  })

  it('persists added keys and clears the pending item', async () => {
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    expect(result.current.displayItems).toEqual([
      {
        id: 'saved-0-key-a',
        key: 'key-a',
        index: 0,
        isNew: false
      }
    ])

    act(() => {
      result.current.addPendingKey()
    })

    expect(result.current.hasPendingNewKey).toBe(true)
    expect(result.current.displayItems.at(-1)).toMatchObject({
      key: '',
      index: 1,
      isNew: true
    })

    await act(async () => {
      await result.current.updateListItem(result.current.displayItems.at(-1)!, 'key-b')
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-a', 'key-b'] }
    })
    expect(result.current.hasPendingNewKey).toBe(false)
  })

  it('persists updates to existing keys', async () => {
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    await act(async () => {
      await result.current.updateListItem(result.current.displayItems[0], 'key-b')
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-b'] }
    })
  })

  it('persists removal of existing keys', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      tavily: { apiKeys: ['key-a', 'key-b'] }
    })
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    await act(async () => {
      await result.current.removeListItem(result.current.displayItems[0])
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-b'] }
    })
  })

  it('clears a pending key without writing preferences', async () => {
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    act(() => {
      result.current.addPendingKey()
    })

    await act(async () => {
      await result.current.removeListItem(result.current.displayItems.at(-1)!)
    })

    expect(result.current.hasPendingNewKey).toBe(false)
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-a'] }
    })
  })

  it('does not persist invalid keys', async () => {
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    const validation = await result.current.updateListItem(result.current.displayItems[0], ' ')

    expect(validation).toMatchObject({ isValid: false })
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-a'] }
    })
  })

  it('does not persist duplicate keys', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      tavily: { apiKeys: ['key-a', 'key-b'] }
    })
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    const validation = await result.current.updateListItem(result.current.displayItems[0], 'key-b')

    expect(validation).toMatchObject({
      isValid: false,
      error: 'settings.provider.api.key.error.duplicate'
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-a', 'key-b'] }
    })
  })

  it('returns an empty model for missing providers', async () => {
    const { result } = renderHook(() => useWebSearchApiKeyList('missing-provider' as any))

    expect(result.current.provider).toBeUndefined()
    expect(result.current.keys).toEqual([])
    expect(result.current.displayItems).toEqual([])

    await act(async () => {
      result.current.addPendingKey()
    })
    await act(async () => {
      await result.current.updateListItem(result.current.displayItems.at(-1)!, 'key-b')
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-a'] }
    })
  })

  it('rejects when preference persistence fails', async () => {
    MockUsePreferenceUtils.mockPreferenceError('chat.web_search.provider_overrides', new Error('persist failed'))
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    await expect(result.current.removeListItem(result.current.displayItems[0])).rejects.toThrow('persist failed')
  })

  it('logs invalid index updates without persisting preferences', async () => {
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    const validation = await result.current.updateListItem(
      {
        id: 'stale-key',
        key: 'key-b',
        index: 2,
        isNew: false
      },
      'key-c'
    )

    expect(validation).toEqual({
      isValid: false,
      error: 'error.diagnosis.unknown'
    })
    expect(loggerErrorSpy).toHaveBeenCalledWith('Invalid web search API key index', { index: 2, length: 1 })
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-a'] }
    })
  })

  it('logs invalid index removals without persisting preferences', async () => {
    const { result } = renderHook(() => useWebSearchApiKeyList('tavily'))

    await result.current.removeListItem({
      id: 'stale-key',
      key: 'key-b',
      index: 2,
      isNew: false
    })

    expect(loggerErrorSpy).toHaveBeenCalledWith('Invalid web search API key index', { index: 2, length: 1 })
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toMatchObject({
      tavily: { apiKeys: ['key-a'] }
    })
  })
})
