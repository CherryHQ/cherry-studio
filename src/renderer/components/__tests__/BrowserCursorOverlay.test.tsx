// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { BrowserCursorState } from '@shared/types/browserCursor'

import { BrowserCursorOverlay } from '../BrowserCursorOverlay'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) }, useIpcOn: vi.fn() }))

describe('Agent cursor presentation', () => {
  const identity = { sessionId: 'session', tabId: 'tab' }
  let guest: WebviewTag
  const emit = (state: BrowserCursorState) =>
    act(() => {
      const handler = vi.mocked(useIpcOn).mock.calls.findLast(([event]) => event === 'browser.cursor.state')?.[1]
      if (!handler) throw new Error('Missing cursor subscription')
      handler(state)
    })
  const move = (sequence: number): BrowserCursorState => ({
    ...identity,
    kind: 'move',
    sequence,
    documentId: 'document',
    x: 80,
    y: 40,
    scale: 1.5,
    animate: true
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    guest = document.createElement('webview') as unknown as WebviewTag
    vi.spyOn(guest, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('maps guest coordinates into host CSS pixels and acknowledges reduced-motion moves without waiting', async () => {
    render(<BrowserCursorOverlay {...identity} guest={guest} active />)
    emit(move(1))
    expect(ipcApi.request).toHaveBeenCalledWith('browser.cursor.arrive', {
      ...identity,
      documentId: 'document',
      sequence: 1
    })
    const overlay = screen.getByTestId('browser-cursor-overlay')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
    // Pointer transparency and transform coordinates are the overlay's input/geometry contract.
    expect(overlay).toHaveClass('pointer-events-none')
    await waitFor(() => expect(overlay.firstElementChild).toHaveStyle({ transform: 'translate3d(120px, 60px, 0)' }))
  })

  it('ignores another binding and does not revive a cursor after a newer hide', async () => {
    render(<BrowserCursorOverlay {...identity} guest={guest} active />)
    emit({ ...move(1), tabId: 'other' })
    expect(vi.mocked(ipcApi.request).mock.calls.filter(([route]) => route === 'browser.cursor.arrive')).toEqual([])
    emit(move(2))
    emit({ ...identity, kind: 'hidden', sequence: 3 })
    emit(move(2))
    await waitFor(() =>
      expect(screen.getByTestId('browser-cursor-overlay').firstElementChild).toHaveStyle({ opacity: '0' })
    )
    expect(vi.mocked(ipcApi.request).mock.calls.filter(([route]) => route === 'browser.cursor.arrive')).toHaveLength(1)
  })

  it('acknowledges but never displays moves delivered to an inactive surface', async () => {
    const view = render(<BrowserCursorOverlay {...identity} guest={guest} active={false} />)
    emit(move(1))
    expect(ipcApi.request).toHaveBeenCalledWith('browser.cursor.arrive', {
      ...identity,
      documentId: 'document',
      sequence: 1
    })
    await waitFor(() =>
      expect(screen.getByTestId('browser-cursor-overlay').firstElementChild).toHaveStyle({ opacity: '0' })
    )
    view.unmount()
    expect(ipcApi.request).toHaveBeenLastCalledWith('browser.cursor.present', { ...identity, presented: false })
  })
})
