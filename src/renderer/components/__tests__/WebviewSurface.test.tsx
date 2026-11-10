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
    const view = render(<WebviewSurface anchor={anchor} guest={<Guest />} overlay={<div data-testid="overlay" />} />)
    const guest = view.getByTestId('guest')
    const overlay = view.getByTestId('overlay')
    const guestPlane = guest.parentElement!
    const overlayPlane = overlay.parentElement!
    expect(guestPlane).toHaveStyle({ width: '640px', height: '480px', left: '10px', top: '20px' })
    expect(overlayPlane).toHaveStyle({ width: '640px', height: '480px', left: '10px', top: '20px' })
    expect(guestPlane).toHaveStyle({ opacity: '1', pointerEvents: 'auto' })
    expect(overlayPlane).toHaveStyle({ opacity: '1', pointerEvents: 'none' })

    view.rerender(<WebviewSurface anchor={null} guest={<Guest />} overlay={<div data-testid="overlay" />} />)
    expect(view.getByTestId('guest')).toBe(guest)
    expect(view.getByTestId('overlay')).toBe(overlay)
    expect(live).toBe(1)
    expect(guestPlane).toHaveStyle({ opacity: '0', width: '640px', height: '480px' })
    expect(overlayPlane).toHaveStyle({ opacity: '0', width: '640px', height: '480px' })
    expect(guestPlane.inert).toBe(true)
    expect(overlayPlane.inert).toBe(true)

    view.rerender(<WebviewSurface anchor={anchor} guest={<Guest />} overlay={<div data-testid="overlay" />} />)
    expect(view.getByTestId('guest')).toBe(guest)
    expect(view.getByTestId('overlay')).toBe(overlay)
    expect(guestPlane).toHaveStyle({ opacity: '1' })
    expect(overlayPlane).toHaveStyle({ opacity: '1' })
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
    const view = render(<WebviewSurface anchor={anchor} guest={<webview data-testid="guest" />} />)
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
      <WebviewSurface anchor={anchor} guest={<Guest />} overlay={<div data-testid="moving-overlay" />} />
    )
    const guest = view.getByTestId('moving-guest')
    const guestPlane = guest.parentElement!
    const overlayPlane = view.getByTestId('moving-overlay').parentElement!
    second.append(anchor)
    await waitFor(() => expect(guestPlane).toHaveStyle({ left: '200px', top: '90px' }))
    expect(overlayPlane).toHaveStyle({ left: '200px', top: '90px' })

    second.prepend(anchor)
    await waitFor(() => expect(guestPlane).toHaveStyle({ left: '200px', top: '20px' }))
    expect(overlayPlane).toHaveStyle({ left: '200px', top: '20px' })
    expect(view.getByTestId('moving-guest')).toBe(guest)
    expect(live).toBe(1)

    anchor.remove()
    await waitFor(() => expect(guestPlane).toHaveStyle({ opacity: '0' }))
    expect(overlayPlane).toHaveStyle({ opacity: '0' })
    expect(guestPlane.inert).toBe(true)
    expect(overlayPlane.inert).toBe(true)
    second.append(anchor)
    await waitFor(() => expect(guestPlane).toHaveStyle({ opacity: '1', top: '90px' }))
    expect(overlayPlane).toHaveStyle({ opacity: '1', top: '90px' })
    expect(live).toBe(1)
    view.unmount()
    expect(live).toBe(0)
    first.remove()
    second.remove()
  })
})
