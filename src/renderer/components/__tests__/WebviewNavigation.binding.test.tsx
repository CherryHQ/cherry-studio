// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WebviewNavigation } from '../WebviewNavigation'

vi.mock('@renderer/components/WebviewAnnotationControls', () => ({ WebviewAnnotationControls: () => null }))

function createGuest(url: string) {
  const guest = document.createElement('webview')
  Object.assign(guest, { getURL: () => url, canGoBack: () => false, canGoForward: () => false })
  return guest
}

describe('WebviewNavigation guest replacement', () => {
  it('follows the replacement guest and ignores navigation from the retired guest', () => {
    const first = createGuest('https://first.example/')
    const second = createGuest('https://second.example/')
    const ref = { current: first }
    const toolbar = (revision: number) => (
      <WebviewNavigation
        webviewRef={ref}
        webviewRevision={revision}
        initialUrl="https://initial.example/"
        isWebviewReady
        isHostActive
        target={{ id: 'browser', label: 'Browser' }}
      />
    )
    const { rerender } = render(toolbar(1))
    ref.current = second
    rerender(toolbar(2))
    act(() => {
      second.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://current.example/' }))
    })
    const address = screen.getByRole('textbox')
    fireEvent.focus(address)
    expect(address).toHaveValue('https://current.example/')
    act(() => {
      first.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://stale.example/' }))
    })
    expect(address).toHaveValue('https://current.example/')
  })
})
