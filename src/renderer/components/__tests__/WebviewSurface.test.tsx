// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WebviewSurface } from '../WebviewSurface'

describe('WebviewSurface', () => {
  it('preserves guest identity and effects when presentation disappears or moves', () => {
    let live = 0
    function Guest() {
      useEffect(() => {
        live += 1
        return () => {
          live -= 1
        }
      }, [])
      return <webview data-testid="guest" />
    }
    const anchor = document.createElement('div')
    document.body.append(anchor)
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 640, 480))
    const view = render(
      <WebviewSurface anchor={anchor}>
        <Guest />
      </WebviewSurface>
    )
    const guest = view.getByTestId('guest')
    const surface = guest.parentElement!
    expect(surface).toHaveStyle({ width: '640px', height: '480px', left: '10px', top: '20px' })

    view.rerender(
      <WebviewSurface anchor={null}>
        <Guest />
      </WebviewSurface>
    )
    expect(view.getByTestId('guest')).toBe(guest)
    expect(live).toBe(1)
    expect(surface).toHaveStyle({ visibility: 'hidden', width: '640px', height: '480px' })
    expect(surface.inert).toBe(true)

    view.rerender(
      <WebviewSurface anchor={anchor}>
        <Guest />
      </WebviewSurface>
    )
    expect(view.getByTestId('guest')).toBe(guest)
    expect(surface).toHaveStyle({ visibility: 'visible' })
    act(() => view.unmount())
    expect(live).toBe(0)
    expect(guest.isConnected).toBe(false)
    anchor.remove()
  })
})
