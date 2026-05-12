// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../resizable'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Resizable', () => {
  it('renders a horizontal panel group with panels and a handle', () => {
    render(
      <ResizablePanelGroup id="artifact-layout" direction="horizontal">
        <ResizablePanel id="code" defaultSize={50}>
          Code
        </ResizablePanel>
        <ResizableHandle id="artifact-handle" withHandle />
        <ResizablePanel id="preview" defaultSize={50}>
          Preview
        </ResizablePanel>
      </ResizablePanelGroup>
    )

    expect(screen.getByTestId('artifact-layout')).toHaveAttribute('data-slot', 'resizable-panel-group')
    expect(screen.getByTestId('code')).toHaveTextContent('Code')
    expect(screen.getByTestId('preview')).toHaveTextContent('Preview')
    expect(screen.getByRole('separator')).toHaveAttribute('data-slot', 'resizable-handle')
    expect(screen.getByRole('separator').querySelector('svg')).toBeInTheDocument()
  })

  it('passes vertical orientation through to the group', () => {
    render(
      <ResizablePanelGroup id="vertical-layout" direction="vertical">
        <ResizablePanel id="top" defaultSize={60}>
          Top
        </ResizablePanel>
        <ResizableHandle id="vertical-handle" />
        <ResizablePanel id="bottom" defaultSize={40}>
          Bottom
        </ResizablePanel>
      </ResizablePanelGroup>
    )

    expect(screen.getByTestId('vertical-layout')).toHaveStyle({ flexDirection: 'column' })
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation')
  })

  it('fires onLayout after dragging the handle', async () => {
    const onLayout = vi.fn()
    const rects = {
      'drag-layout': new DOMRect(0, 0, 800, 400),
      left: new DOMRect(0, 0, 400, 400),
      right: new DOMRect(400, 0, 400, 400)
    }

    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.id === 'drag-layout') return 800
      if (this.id === 'left' || this.id === 'right') return 400
      return 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.id === 'drag-layout' || this.id === 'left' || this.id === 'right') return 400
      return 0
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rects[this.id as keyof typeof rects] ?? new DOMRect(400, 0, 0, 400)
    })

    render(
      <div style={{ width: 800, height: 400 }}>
        <ResizablePanelGroup id="drag-layout" direction="horizontal" onLayout={onLayout}>
          <ResizablePanel id="left" defaultSize={50} minSize={20}>
            Left
          </ResizablePanel>
          <ResizableHandle id="drag-handle" withHandle />
          <ResizablePanel id="right" defaultSize={50} minSize={20}>
            Right
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    )

    const separator = screen.getByRole('separator')

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.pointerDown(separator, {
      button: 0,
      buttons: 1,
      clientX: 400,
      clientY: 100,
      pointerId: 1,
      pointerType: 'mouse'
    })
    fireEvent.pointerMove(document, { buttons: 1, clientX: 500, clientY: 100, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 500,
      clientY: 100,
      pointerId: 1,
      pointerType: 'mouse'
    })

    expect(onLayout).toHaveBeenCalled()
  })
})
