// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
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
})
