import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useConversationShellPaneState } from '../useConversationShellPaneState'
import { WindowFrameContext } from '../useWindowFrame'

interface HarnessProps {
  persistedPaneOpen?: boolean
}

function renderPaneState({
  initialProps = {},
  setPersistedPaneOpen = vi.fn(),
  onManualPaneOpen,
  windowFrame
}: {
  initialProps?: HarnessProps
  setPersistedPaneOpen?: ReturnType<typeof vi.fn>
  onManualPaneOpen?: () => void
  windowFrame?: 'window'
} = {}) {
  const rendered = renderHook(
    ({ persistedPaneOpen = true }: HarnessProps) =>
      useConversationShellPaneState({
        persistedPaneOpen,
        setPersistedPaneOpen,
        onManualPaneOpen
      }),
    {
      initialProps,
      wrapper: windowFrame
        ? ({ children }: { children: ReactNode }) => (
            <WindowFrameContext value={{ mode: 'window' }}>{children}</WindowFrameContext>
          )
        : undefined
    }
  )

  return { ...rendered, setPersistedPaneOpen }
}

describe('useConversationShellPaneState', () => {
  it('mirrors the persisted pane state when embedded and writes programmatic opens to it', () => {
    const { result, rerender, setPersistedPaneOpen } = renderPaneState({ initialProps: { persistedPaneOpen: false } })

    expect(result.current.isWindowFrame).toBe(false)
    expect(result.current.shellPaneOpen).toBe(false)

    act(() => result.current.setShellPaneOpen(true))
    expect(setPersistedPaneOpen).toHaveBeenCalledWith(true)

    rerender({ persistedPaneOpen: true })
    expect(result.current.shellPaneOpen).toBe(true)
    // Programmatic opens (history locate, layout resets) must not emit a manual signal.
    expect(result.current.paneManualToggle).toBeUndefined()
  })

  it('uses local detached state in a window frame and never writes the preference', () => {
    const { result, setPersistedPaneOpen } = renderPaneState({
      initialProps: { persistedPaneOpen: true },
      windowFrame: 'window'
    })

    expect(result.current.isWindowFrame).toBe(true)
    expect(result.current.shellPaneOpen).toBe(false)

    act(() => result.current.setShellPaneOpen(true))
    expect(result.current.shellPaneOpen).toBe(true)
    expect(setPersistedPaneOpen).not.toHaveBeenCalled()
  })

  it('closes on auto-collapse without touching the preference and reopens on the next explicit open', () => {
    const { result, setPersistedPaneOpen } = renderPaneState()

    act(() => result.current.handlePaneAutoCollapseChange(true))
    expect(result.current.shellPaneOpen).toBe(false)
    expect(setPersistedPaneOpen).not.toHaveBeenCalled()

    act(() => result.current.setShellPaneOpen(true))
    expect(result.current.shellPaneOpen).toBe(true)
  })

  it('bumps the manual signal in both directions and reports manual opens', () => {
    const onManualPaneOpen = vi.fn()
    const { result, rerender, setPersistedPaneOpen } = renderPaneState({ onManualPaneOpen })

    act(() => result.current.toggleShellPane())
    expect(result.current.paneManualToggle).toEqual({ seq: 1, open: false })
    expect(setPersistedPaneOpen).toHaveBeenLastCalledWith(false)
    expect(onManualPaneOpen).not.toHaveBeenCalled()

    rerender({ persistedPaneOpen: false })
    act(() => result.current.toggleShellPane())
    expect(result.current.paneManualToggle).toEqual({ seq: 2, open: true })
    expect(setPersistedPaneOpen).toHaveBeenLastCalledWith(true)
    expect(onManualPaneOpen).toHaveBeenCalledTimes(1)
  })

  it('treats a toggle while auto-collapsed as a manual reopen', () => {
    const onManualPaneOpen = vi.fn()
    const { result } = renderPaneState({ onManualPaneOpen })

    act(() => result.current.handlePaneAutoCollapseChange(true))
    expect(result.current.shellPaneOpen).toBe(false)

    act(() => result.current.toggleShellPane())
    expect(result.current.shellPaneOpen).toBe(true)
    expect(result.current.paneManualToggle).toEqual({ seq: 1, open: true })
    expect(onManualPaneOpen).toHaveBeenCalledTimes(1)
  })

  it('emits the manual signal from setShellPaneOpenManually for direct collapse controls', () => {
    const { result, setPersistedPaneOpen } = renderPaneState()

    act(() => result.current.setShellPaneOpenManually(false))
    expect(result.current.paneManualToggle).toEqual({ seq: 1, open: false })
    expect(setPersistedPaneOpen).toHaveBeenCalledWith(false)
  })
})
