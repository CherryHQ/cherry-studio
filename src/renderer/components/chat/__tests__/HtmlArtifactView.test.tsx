import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HtmlArtifactView } from '../HtmlArtifactView'

const mocks = vi.hoisted(() => ({
  resizeObserverCallbacks: [] as ResizeObserverCallback[],
  CodeViewer: vi.fn(({ value }) => <pre data-testid="code-viewer">{value}</pre>),
  HtmlPreviewFrame: vi.fn(({ title }: { html: string; title: string }) => (
    <div data-testid="html-preview-frame" title={title} />
  ))
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/CodeViewer', () => ({ default: mocks.CodeViewer }))
vi.mock('@renderer/components/CodeBlockView/HtmlPreviewFrame', () => ({
  default: mocks.HtmlPreviewFrame
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('HtmlArtifactView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resizeObserverCallbacks = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          mocks.resizeObserverCallbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('switches directly between HTML and code in the message surface', () => {
    render(<HtmlArtifactView html="<h1>Hello</h1>" title="Preview" />)

    expect(screen.getByTestId('html-preview-frame')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.code' }))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('<h1>Hello</h1>')
    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.preview' }))
    expect(screen.getByTestId('html-preview-frame')).toBeInTheDocument()
  })

  it('keeps a stable 16:9 desktop viewport and uses the shared preview frame defaults', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const viewport = screen.getByTestId('desktop-html-preview')
    const canvas = screen.getByTestId('desktop-html-canvas')
    expect(viewport).toHaveClass('aspect-video')
    expect(canvas).toHaveStyle({ width: '1440px', height: '810px' })

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 720 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 405 })
    mocks.resizeObserverCallbacks[0]?.([], {} as ResizeObserver)
    expect(canvas).toHaveStyle({ transform: 'scale(0.5)' })

    expect(mocks.HtmlPreviewFrame).toHaveBeenCalledWith(
      {
        html: '<main>Page</main>',
        title: 'Preview'
      },
      undefined
    )
  })

  it('keeps a static HTML fallback outside the live preview capture boundary', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const fallback = screen.getByTestId('html-artifact-capture-fallback')
    const previewFrame = screen.getByTestId('html-preview-frame')
    const livePreview = previewFrame.parentElement
    if (!livePreview) throw new Error('Expected live HTML preview wrapper')

    expect(fallback).toHaveTextContent('Preview')
    expect(fallback).toHaveTextContent('<main>Page</main>')
    expect(livePreview).toHaveAttribute('data-html-artifact-live-preview')
    expect(livePreview).not.toContainElement(fallback)
    expect(livePreview.parentElement).toContainElement(fallback)
  })

  it('zooms the HTML viewport without changing the message dimensions', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const surface = screen.getByTestId('html-artifact-surface')
    const controls = screen.getByTestId('html-artifact-controls')
    const zoomLayer = screen.getByTestId('desktop-html-zoom-layer')
    expect(surface).toHaveClass('aspect-video')
    expect(surface).toContainElement(controls)
    expect(controls).toHaveClass('opacity-0', 'group-hover:opacity-100')
    expect(zoomLayer).toHaveStyle({ width: '100%', height: '100%', transform: 'scale(1)' })

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(screen.getByRole('button', { name: 'preview.reset' })).toHaveTextContent('110%')
    expect(zoomLayer).toHaveStyle({
      width: '90.9090909090909%',
      height: '90.9090909090909%',
      transform: 'scale(1.1)'
    })

    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    expect(screen.getByRole('button', { name: 'preview.reset' })).toHaveTextContent('100%')
    expect(zoomLayer).toHaveStyle({ width: '100%', height: '100%', transform: 'scale(1)' })
  })
})
