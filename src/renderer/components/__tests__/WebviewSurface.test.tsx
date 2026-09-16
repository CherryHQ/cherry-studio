// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, render, waitFor } from '@testing-library/react'
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
    expect(surface).toHaveStyle({ opacity: '0', width: '640px', height: '480px' })
    expect(surface.inert).toBe(true)

    view.rerender(
      <WebviewSurface anchor={anchor}>
        <Guest />
      </WebviewSurface>
    )
    expect(view.getByTestId('guest')).toBe(guest)
    expect(surface).toHaveStyle({ opacity: '1' })
    act(() => view.unmount())
    expect(live).toBe(0)
    expect(guest.isConnected).toBe(false)
    anchor.remove()
  })
  it('yields input during ancestor resize without hiding or remounting the guest', async () => {
    const pane = document.createElement('div')
    const anchor = document.createElement('div')
    pane.append(anchor)
    document.body.append(pane)
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(8, 0, 640, 480))
    const view = render(
      <WebviewSurface anchor={anchor}>
        <webview data-testid="guest" />
      </WebviewSurface>
    )
    const guest = view.getByTestId('guest')
    const plane = guest.parentElement!

    pane.dataset.resizing = 'true'
    await waitFor(() => expect(plane.inert).toBe(true))
    expect(plane).toHaveStyle({ opacity: '1', pointerEvents: 'none' })
    delete pane.dataset.resizing
    await waitFor(() => expect(plane.inert).toBe(false))
    expect(plane).toHaveStyle({ pointerEvents: 'auto' })
    expect(view.getByTestId('guest')).toBe(guest)
    view.unmount()
    pane.remove()
  })
  it('tracks same-size anchor reparenting and sibling reordering without remounting its guest', async () => {
    let live = 0
    function Guest() {
      useEffect(() => {
        live += 1
        return () => {
          live -= 1
        }
      }, [])
      return <webview data-testid="moving-guest" />
    }
    const first = document.createElement('div')
    const second = document.createElement('div')
    const anchor = document.createElement('div')
    const sibling = document.createElement('div')
    first.append(anchor)
    second.append(sibling)
    document.body.append(first, second)
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(anchor.parentElement === first ? 10 : 200, anchor.previousSibling ? 90 : 20, 640, 480)
    )
    const view = render(
      <WebviewSurface anchor={anchor}>
        <Guest />
      </WebviewSurface>
    )
    const guest = view.getByTestId('moving-guest')
    const surface = guest.parentElement!
    second.append(anchor)
    await waitFor(() => expect(surface).toHaveStyle({ left: '200px', top: '90px' }))

    second.prepend(anchor)
    await waitFor(() => expect(surface).toHaveStyle({ left: '200px', top: '20px' }))
    expect(view.getByTestId('moving-guest')).toBe(guest)
    expect(live).toBe(1)

    anchor.remove()
    await waitFor(() => expect(surface).toHaveStyle({ opacity: '0' }))
    expect(surface.inert).toBe(true)
    second.append(anchor)
    await waitFor(() => expect(surface).toHaveStyle({ opacity: '1', top: '90px' }))
    expect(live).toBe(1)
    view.unmount()
    expect(live).toBe(0)
    first.remove()
    second.remove()
  })
})
