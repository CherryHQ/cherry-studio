import {
  ThemeMode,
  type UnifiedPreferenceKeyType,
  type UnifiedPreferenceType
} from '@shared/data/preference/preferenceTypes'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/PreferenceService')
vi.unmock('@data/hooks/usePreference')

const apiValues = new Map<UnifiedPreferenceKeyType, unknown>()
let onChanged: ((key: UnifiedPreferenceKeyType, value: unknown) => void) | undefined
const subscribe = vi.fn(async () => {})
const setMultiple = vi.fn(async (updates: Partial<UnifiedPreferenceType>) => {
  for (const [key, value] of Object.entries(updates)) apiValues.set(key as UnifiedPreferenceKeyType, value)
})
const getMultipleRaw = vi.fn(async (keys: UnifiedPreferenceKeyType[]) =>
  Object.fromEntries(keys.map((key) => [key, apiValues.get(key)]))
)

Object.defineProperty(window, 'api', {
  configurable: true,
  value: {
    preference: {
      get: vi.fn(async (key: UnifiedPreferenceKeyType) => apiValues.get(key)),
      getAll: vi.fn(async () => Object.fromEntries(apiValues)),
      getMultipleRaw,
      onChanged: vi.fn((callback: typeof onChanged) => {
        onChanged = callback
        return () => {
          onChanged = undefined
        }
      }),
      setMultiple,
      subscribe
    }
  }
})

const { preferenceService } = await import('../../PreferenceService')
const { useMultiplePreferences } = await import('../usePreference')

describe('useMultiplePreferences', () => {
  beforeEach(() => {
    apiValues.clear()
    preferenceService.clearCache()
    subscribe.mockClear()
    setMultiple.mockClear()
    getMultipleRaw.mockClear()
  })

  it('keeps values, setter, and subscriptions stable for equivalent inline key maps', async () => {
    apiValues.set('app.language', 'en-US')
    await preferenceService.getMultipleRaw(['app.language'])
    const subscribeChange = vi.spyOn(preferenceService, 'subscribeChange')

    const { result, rerender, unmount } = renderHook(
      ({ renderId }) => {
        void renderId
        return useMultiplePreferences({ language: 'app.language' }, { optimistic: false })
      },
      { initialProps: { renderId: 0 } }
    )
    const firstValues = result.current[0]
    const firstSetter = result.current[1]

    rerender({ renderId: 1 })

    expect(result.current[0]).toBe(firstValues)
    expect(result.current[1]).toBe(firstSetter)
    expect(subscribeChange).toHaveBeenCalledTimes(1)

    unmount()
    subscribeChange.mockRestore()
  })

  it('updates the snapshot only when a subscribed value changes', async () => {
    apiValues.set('app.language', 'en-US')
    await preferenceService.getMultipleRaw(['app.language'])
    const { result } = renderHook(() => useMultiplePreferences({ language: 'app.language' }))
    const firstValues = result.current[0]

    act(() => onChanged?.('app.language', 'en-US'))
    expect(result.current[0]).toBe(firstValues)

    act(() => onChanged?.('app.language', 'zh-CN'))
    expect(result.current[0]).not.toBe(firstValues)
    expect(result.current[0].language).toBe('zh-CN')
  })

  it('rebinds reads and writes when the key mapping content changes', async () => {
    apiValues.set('app.language', 'en-US')
    apiValues.set('ui.theme_mode', ThemeMode.dark)
    await preferenceService.getMultipleRaw(['app.language', 'ui.theme_mode'])
    const setMultipleSpy = vi.spyOn(preferenceService, 'setMultiple').mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ preferenceKey }: { preferenceKey: 'app.language' | 'ui.theme_mode' }) =>
        useMultiplePreferences({ value: preferenceKey }, { optimistic: false }),
      {
        initialProps: {
          preferenceKey: 'app.language'
        } as { preferenceKey: 'app.language' | 'ui.theme_mode' }
      }
    )

    expect(result.current[0].value).toBe('en-US')
    rerender({ preferenceKey: 'ui.theme_mode' })
    expect(result.current[0].value).toBe(ThemeMode.dark)

    await act(async () => {
      await result.current[1]({ value: ThemeMode.light })
    })
    expect(setMultipleSpy).toHaveBeenLastCalledWith({ 'ui.theme_mode': ThemeMode.light }, { optimistic: false })

    setMultipleSpy.mockRestore()
  })
})
