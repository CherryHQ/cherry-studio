import { useMultiplePreferences } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/PreferenceService')
vi.unmock('@data/hooks/usePreference')
vi.mock('@renderer/i18n/resolver', () => ({ initI18n: vi.fn() }))

const KEY_A = 'chat.code.show_line_numbers' as const
const KEY_B = 'chat.code.wrappable' as const
const KEY_C = 'chat.code.collapsible' as const

function installPreferenceBoundary() {
  const values = new Map<UnifiedPreferenceKeyType, unknown>([
    [KEY_A, true],
    [KEY_B, false],
    [KEY_C, true]
  ])
  const subscriptions: Array<{ key: UnifiedPreferenceKeyType; unsubscribe: ReturnType<typeof vi.fn> }> = []

  const subscribeChange = vi
    .spyOn(preferenceService, 'subscribeChange')
    .mockImplementation((key) => (): (() => void) => {
      const unsubscribe = vi.fn()
      subscriptions.push({ key, unsubscribe })
      return unsubscribe
    })
  vi.spyOn(preferenceService, 'getCachedValue').mockImplementation((key) => values.get(key) as never)
  vi.spyOn(preferenceService, 'isCached').mockReturnValue(true)
  const setMultiple = vi.spyOn(preferenceService, 'setMultiple').mockResolvedValue(undefined)

  return { setMultiple, subscribeChange, subscriptions }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useMultiplePreferences', () => {
  it('keeps subscriptions and actions stable for a new equivalent key map', () => {
    const boundary = installPreferenceBoundary()
    const { result, rerender } = renderHook(
      ({ keys }: { keys: Record<'lineNumbers' | 'wrappable', UnifiedPreferenceKeyType> }) =>
        useMultiplePreferences(keys),
      {
        initialProps: {
          keys: { lineNumbers: KEY_A, wrappable: KEY_B }
        }
      }
    )
    const updateValues = result.current[1]
    const initialSubscriptions = [...boundary.subscriptions]

    rerender({ keys: { wrappable: KEY_B, lineNumbers: KEY_A } })

    expect(boundary.subscribeChange).toHaveBeenCalledTimes(2)
    expect(initialSubscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 0)).toBe(true)
    expect(result.current[1]).toBe(updateValues)
  })

  it('rebinds values and actions when the key map changes', async () => {
    const boundary = installPreferenceBoundary()
    const { result, rerender } = renderHook(
      ({ keys }: { keys: Record<'primary' | 'secondary', UnifiedPreferenceKeyType> }) => useMultiplePreferences(keys),
      {
        initialProps: {
          keys: { primary: KEY_A, secondary: KEY_B } as Record<'primary' | 'secondary', UnifiedPreferenceKeyType>
        }
      }
    )
    const initialUpdateValues = result.current[1]
    const initialSubscriptions = [...boundary.subscriptions]

    rerender({ keys: { primary: KEY_A, secondary: KEY_C } })

    expect(result.current[0]).toEqual({ primary: true, secondary: true })
    expect(result.current[1]).not.toBe(initialUpdateValues)
    expect(initialSubscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(boundary.subscriptions.slice(2).map(({ key }) => key)).toEqual([KEY_A, KEY_C])

    await act(() => result.current[1]({ secondary: false }))
    expect(boundary.setMultiple).toHaveBeenCalledWith({ [KEY_C]: false }, { optimistic: true })
  })
})
