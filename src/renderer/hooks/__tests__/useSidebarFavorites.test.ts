import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSidebarFavorites } from '../useSidebarFavorites'

describe('useSidebarFavorites', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('should skip removing a mini app that is not favorited', () => {
    const setFavorites = vi.fn().mockResolvedValue(undefined)
    MockUsePreferenceUtils.mockPreferenceReturn(
      'ui.sidebar.favorites',
      [{ type: 'mini_app', id: 'other-app' }],
      setFavorites
    )

    const { result } = renderHook(() => useSidebarFavorites())

    act(() => {
      result.current.removeMiniApp('missing-app')
    })

    expect(setFavorites).not.toHaveBeenCalled()
  })

  describe('entity favorites (agents / assistants)', () => {
    it('toggles an agent favorite on and exposes it in agentFavoriteIds', () => {
      const setFavorites = vi.fn().mockResolvedValue(undefined)
      MockUsePreferenceUtils.mockPreferenceReturn('ui.sidebar.favorites', [], setFavorites)

      const { result } = renderHook(() => useSidebarFavorites())

      act(() => {
        result.current.toggleAgent('agent-1')
      })

      expect(setFavorites).toHaveBeenCalledWith([{ type: 'agent', id: 'agent-1' }])
    })

    it('toggles an assistant favorite off and removes it from assistantFavoriteIds', () => {
      const setFavorites = vi.fn().mockResolvedValue(undefined)
      MockUsePreferenceUtils.mockPreferenceReturn(
        'ui.sidebar.favorites',
        [{ type: 'assistant', id: 'assistant-1' }],
        setFavorites
      )

      const { result } = renderHook(() => useSidebarFavorites())
      expect(result.current.assistantFavoriteIds).toEqual(['assistant-1'])

      act(() => {
        result.current.toggleAssistant('assistant-1')
      })

      expect(setFavorites).toHaveBeenCalledWith([])
    })

    it('segregates agent and assistant favorite ids by type', () => {
      MockUsePreferenceUtils.mockPreferenceReturn('ui.sidebar.favorites', [
        { type: 'agent', id: 'agent-1' },
        { type: 'assistant', id: 'assistant-1' },
        { type: 'mini_app', id: 'calculator' }
      ])

      const { result } = renderHook(() => useSidebarFavorites())

      expect(result.current.agentFavoriteIds).toEqual(['agent-1'])
      expect(result.current.assistantFavoriteIds).toEqual(['assistant-1'])
    })

    it('removes an agent favorite via removeAgent', () => {
      const setFavorites = vi.fn().mockResolvedValue(undefined)
      MockUsePreferenceUtils.mockPreferenceReturn(
        'ui.sidebar.favorites',
        [
          { type: 'agent', id: 'agent-1' },
          { type: 'assistant', id: 'assistant-1' }
        ],
        setFavorites
      )

      const { result } = renderHook(() => useSidebarFavorites())

      act(() => {
        result.current.removeAgent('agent-1')
      })

      expect(setFavorites).toHaveBeenCalledWith([{ type: 'assistant', id: 'assistant-1' }])
    })

    it('skips removing an assistant that is not favorited', () => {
      const setFavorites = vi.fn().mockResolvedValue(undefined)
      MockUsePreferenceUtils.mockPreferenceReturn('ui.sidebar.favorites', [], setFavorites)

      const { result } = renderHook(() => useSidebarFavorites())

      act(() => {
        result.current.removeAssistant('missing-assistant')
      })

      expect(setFavorites).not.toHaveBeenCalled()
    })
  })
})
