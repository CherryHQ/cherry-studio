// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../context-menu'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu'
import { KeyboardLayerProvider, type KeyboardLayerProps } from '../keyboard-layer'

const layers = new Map<symbol, Omit<KeyboardLayerProps, 'children'>>()

function LayerAdapter({ children, active, element, releaseAfterFocusRestore }: KeyboardLayerProps) {
  const id = useRef(Symbol())
  useLayoutEffect(() => {
    const key = id.current
    layers.set(key, { active, element })
    return () => {
      const release = () => {
        layers.delete(key)
      }
      if (releaseAfterFocusRestore) releaseAfterFocusRestore(release)
      else release()
    }
  }, [active, element, releaseAfterFocusRestore])
  return children
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  expect(layers.size).toBe(0)
})

const activeLayers = () => [...layers.values()].filter((layer) => layer.active)

describe('keyboard layer integration', () => {
  it('publishes a dialog boundary before autofocus and releases it after close restoration', async () => {
    const user = userEvent.setup()
    let boundaryAtAutofocus = false
    let boundaryAtRestoration = false
    render(
      <KeyboardLayerProvider adapter={LayerAdapter}>
        <Dialog>
          <DialogTrigger>Open dialog</DialogTrigger>
          <DialogContent
            onCloseAutoFocus={() => {
              boundaryAtRestoration = activeLayers().length === 1
            }}
            onOpenAutoFocus={() => {
              boundaryAtAutofocus = activeLayers().length === 1
            }}>
            <DialogTitle>Preferences</DialogTitle>
          </DialogContent>
        </Dialog>
      </KeyboardLayerProvider>
    )
    expect(activeLayers()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    expect(boundaryAtAutofocus).toBe(true)
    expect(activeLayers().map((layer) => layer.element)).toEqual([screen.getByRole('dialog')])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(activeLayers()).toHaveLength(0))
    expect(boundaryAtRestoration).toBe(true)
    expect(screen.getByRole('button', { name: 'Open dialog' })).toHaveFocus()
  })

  it('keeps closed force-mounted content outside the active boundary set', () => {
    const { rerender } = render(
      <KeyboardLayerProvider adapter={LayerAdapter}>
        <Dialog open={false}>
          <DialogContent forceMount>
            <DialogTitle>Retained dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </KeyboardLayerProvider>
    )
    expect(screen.getByText('Retained dialog')).toBeInTheDocument()
    expect(activeLayers()).toHaveLength(0)
    rerender(
      <KeyboardLayerProvider adapter={LayerAdapter}>
        <Dialog open>
          <DialogContent forceMount>
            <DialogTitle>Retained dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </KeyboardLayerProvider>
    )
    expect(activeLayers().map((layer) => layer.element)).toEqual([screen.getByRole('dialog')])
    rerender(
      <KeyboardLayerProvider adapter={LayerAdapter}>
        <Dialog open={false}>
          <DialogContent forceMount>
            <DialogTitle>Retained dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </KeyboardLayerProvider>
    )
    expect(activeLayers()).toHaveLength(0)
  })

  it('preserves an outer boundary when a nested dropdown closes', async () => {
    const user = userEvent.setup()
    render(
      <KeyboardLayerProvider adapter={LayerAdapter}>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Preferences</DialogTitle>
            <DropdownMenu>
              <DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Action</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DialogContent>
        </Dialog>
      </KeyboardLayerProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Open actions' }))
    expect(activeLayers()).toHaveLength(2)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(activeLayers()).toHaveLength(1))
    expect(activeLayers()[0].element).toBe(screen.getByRole('dialog'))
  })

  it('uses controlled context-menu state for its force-mounted keyboard boundary', () => {
    let requestedOpen: boolean | undefined
    const tree = (open: boolean) => (
      <KeyboardLayerProvider adapter={LayerAdapter}>
        <ContextMenu
          open={open}
          onOpenChange={(nextOpen) => {
            requestedOpen = nextOpen
          }}>
          <ContextMenuTrigger>Controlled context target</ContextMenuTrigger>
          <ContextMenuContent forceMount>
            <ContextMenuItem>Controlled context action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </KeyboardLayerProvider>
    )
    const { rerender } = render(tree(false))
    expect(screen.getByText('Controlled context action')).toBeInTheDocument()
    expect(activeLayers()).toHaveLength(0)

    fireEvent.contextMenu(screen.getByText('Controlled context target'), { button: 2 })
    expect(requestedOpen).toBe(true)
    expect(activeLayers()).toHaveLength(0)

    rerender(tree(true))
    expect(activeLayers().map((layer) => layer.element)).toEqual([screen.getByRole('menu')])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(requestedOpen).toBe(false)
    expect(activeLayers().map((layer) => layer.element)).toEqual([screen.getByRole('menu')])

    rerender(tree(false))
    expect(screen.getByText('Controlled context action')).toBeInTheDocument()
    expect(activeLayers()).toHaveLength(0)
  })

  it('tracks context-menu cancellation and controlled dropdown visibility', async () => {
    const tree = (open: boolean) => (
      <KeyboardLayerProvider adapter={LayerAdapter}>
        <DropdownMenu open={open}>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ContextMenu>
          <ContextMenuTrigger>Context target</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Context action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </KeyboardLayerProvider>
    )
    const { rerender } = render(tree(true))
    expect(activeLayers()).toHaveLength(1)
    rerender(tree(false))
    await waitFor(() => expect(activeLayers()).toHaveLength(0))
    fireEvent.contextMenu(screen.getByText('Context target'), { button: 2 })
    expect(activeLayers().map((layer) => layer.element)).toEqual([screen.getByRole('menu')])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(activeLayers()).toHaveLength(0))
  })
})
