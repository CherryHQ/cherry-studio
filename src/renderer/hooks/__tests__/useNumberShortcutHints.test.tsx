import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { getNumberShortcutUpdates, TAB_NUMBER_COMMANDS } from '@renderer/utils/numberShortcuts'
import { isMac } from '@renderer/utils/platform'

import { useNumberShortcutHints } from '../useNumberShortcutHints'

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <CommandContextKeyProvider>
      <CommandProvider>{children}</CommandProvider>
    </CommandContextKeyProvider>
  )
}

afterEach(() => {
  cleanup()
  mockPreferenceState.clear()
  vi.useRealTimers()
})

it('reveals tab bindings only after holding the tab modifier and clears on release and blur', async () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNumberShortcutHints(TAB_NUMBER_COMMANDS), { wrapper: Wrapper })
  const key = isMac ? 'Control' : 'Alt'
  const modifier = isMac ? { ctrlKey: true } : { altKey: true }
  expect(result.current.size).toBe(0)
  fireEvent.keyDown(window, { key, ...modifier })
  await act(() => vi.advanceTimersByTimeAsync(499))
  expect(result.current.size).toBe(0)
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(result.current.get('tab.open_1')).toBe(isMac ? '⌃1' : 'Alt+1')
  expect(result.current.size).toBe(9)
  fireEvent.keyUp(window, { key })
  expect(result.current.size).toBe(0)
  fireEvent.keyDown(window, { key, ...modifier })
  await act(() => vi.advanceTimersByTimeAsync(500))
  fireEvent.blur(window)
  expect(result.current.size).toBe(0)
})

it('follows the swapped tab modifier instead of continuing to reveal on the old modifier', async () => {
  vi.useFakeTimers()
  for (const [key, value] of Object.entries(getNumberShortcutUpdates('tab', isMac ? 'darwin' : 'win32'))) {
    mockPreferenceState.set(key, value)
  }
  const { result } = renderHook(() => useNumberShortcutHints(TAB_NUMBER_COMMANDS), { wrapper: Wrapper })
  fireEvent.keyDown(window, { key: isMac ? 'Control' : 'Alt', ctrlKey: isMac, altKey: !isMac })
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(result.current.size).toBe(0)
  fireEvent.keyUp(window, { key: isMac ? 'Control' : 'Alt' })
  fireEvent.keyDown(window, { key: isMac ? 'Meta' : 'Control', metaKey: isMac, ctrlKey: !isMac })
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(result.current.get('tab.open_1')).toBe(isMac ? '⌘1' : 'Ctrl+1')
})
