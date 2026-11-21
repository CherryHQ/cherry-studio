import { mockPreferenceService, mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMultiplePreferences } from '@data/hooks/usePreference'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

vi.unmock('@data/hooks/usePreference')

const KEY_A = 'chat.code.show_line_numbers' as const
const KEY_B = 'chat.code.wrappable' as const
const KEY_C = 'chat.code.collapsible' as const

beforeEach(() => {
  mockPreferenceService._resetMockState()
  vi.clearAllMocks()
  mockPreferenceState.set(KEY_A, true)
  mockPreferenceState.set(KEY_B, false)
  mockPreferenceState.set(KEY_C, true)
})

afterEach(() => {
  mockPreferenceService._resetMockState()
})

describe('useMultiplePreferences', () => {
  it('reads and updates a reserved local alias without changing object prototypes', async () => {
    const { result, rerender } = renderHook(() => useMultiplePreferences({ ['__proto__']: KEY_A }))

    expect(Object.getOwnPropertyDescriptor(result.current[0], '__proto__')?.value).toBe(true)
    expect(Object.getPrototypeOf(result.current[0])).toBe(Object.prototype)
    rerender()

    await act(() => result.current[1]({ ['__proto__']: false }))

    expect(mockPreferenceService.setMultiple).toHaveBeenCalledWith({ [KEY_A]: false }, { optimistic: true })
    expect(Object.getOwnPropertyDescriptor(result.current[0], '__proto__')?.value).toBe(false)
    expect(Object.getPrototypeOf(result.current[0])).toBe(Object.prototype)
  })

  it('rebinds values and actions when the key map changes', async () => {
    const initialKeys: Record<'primary' | 'secondary', UnifiedPreferenceKeyType> = {
      primary: KEY_A,
      secondary: KEY_B
    }
    const { result, rerender } = renderHook(
      ({ keys }: { keys: Record<'primary' | 'secondary', UnifiedPreferenceKeyType> }) => useMultiplePreferences(keys),
      {
        initialProps: {
          keys: initialKeys
        }
      }
    )
    rerender({ keys: { primary: KEY_A, secondary: KEY_C } })

    expect(result.current[0]).toEqual({ primary: true, secondary: true })

    await act(() => result.current[1]({ secondary: false }))
    expect(mockPreferenceService.setMultiple).toHaveBeenCalledWith({ [KEY_C]: false }, { optimistic: true })
    expect(result.current[0]).toEqual({ primary: true, secondary: false })
  })
})
