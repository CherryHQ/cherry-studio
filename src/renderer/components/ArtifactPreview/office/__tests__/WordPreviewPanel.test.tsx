import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockIntersectionObserver {
    callback: IntersectionObserverCallback
    observed: HTMLElement[] = []

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
      instances.push(this)
    }

    observe(element: Element) {
      this.observed.push(element as HTMLElement)
    }

    unobserve() {}
    disconnect() {}
  }

  const instances: InstanceType<typeof MockIntersectionObserver>[] = []

  return {
    fsRead: vi.fn(),
    renderAsync: vi.fn(),
    MockIntersectionObserver,
    intersectionObserverInstances: instances
  }
})

vi.mock('docx-preview', () => ({
  renderAsync: mocks.renderAsync
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren<{ content: string }>) => <>{children}</>,
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import WordPreviewPanel from '../WordPreviewPanel'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.intersectionObserverInstances.length = 0
  mocks.fsRead.mockResolvedValue(new Uint8Array([80, 75, 3, 4]))
  mocks.renderAsync.mockImplementation(async (_data: Uint8Array, bodyContainer: HTMLElement) => {
    bodyContainer.innerHTML = '<section>Page 1</section><section>Page 2</section>'
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: {
        read: mocks.fsRead
      }
    }
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('IntersectionObserver', mocks.MockIntersectionObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WordPreviewPanel', () => {
  it('loads docx bytes into docx-preview and exposes navigation controls', async () => {
    render(<WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={0} sourceSize={1024} />)

    expect(await screen.findByTestId('docx-preview-panel')).toBeInTheDocument()
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledWith('/tmp/report.docx'))
    expect(mocks.renderAsync).toHaveBeenCalledWith(
      new Uint8Array([80, 75, 3, 4]),
      expect.any(HTMLElement),
      expect.any(HTMLElement),
      expect.objectContaining({
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderAltChunks: false,
        useBase64URL: true
      })
    )
    expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('1 / 2')
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    await waitFor(() => expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('2 / 2'))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))

    await waitFor(() => expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('110%'))
    expect(screen.getByTestId('docx-preview-content')).toHaveAttribute('data-zoom', '1.1')
  })

  it('tracks the current page as the topmost visible page while scrolling', async () => {
    render(<WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={0} sourceSize={1024} />)

    await waitFor(() => expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('1 / 2'))

    const observer = mocks.intersectionObserverInstances.at(-1)
    expect(observer).toBeDefined()
    const [page1, page2] = observer!.observed
    expect(page1.dataset.docxPreviewPage).toBe('1')
    expect(page2.dataset.docxPreviewPage).toBe('2')

    act(() => {
      observer!.callback(
        [
          { target: page1, isIntersecting: false } as IntersectionObserverEntry,
          { target: page2, isIntersecting: true } as IntersectionObserverEntry
        ],
        observer as unknown as IntersectionObserver
      )
    })

    await waitFor(() => expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('2 / 2'))
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('rejects oversized sources before reading bytes', async () => {
    render(
      <WordPreviewPanel
        filePath="/tmp/huge.docx"
        fileName="huge.docx"
        refreshKey={0}
        sourceSize={25 * 1024 * 1024 + 1}
      />
    )

    expect(await screen.findByTestId('empty-state')).toHaveTextContent('files.preview.error')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.renderAsync).not.toHaveBeenCalled()
  })

  it('strips dangerous hyperlink protocols and hardens remaining links', async () => {
    mocks.renderAsync.mockImplementationOnce(async (_data: Uint8Array, bodyContainer: HTMLElement) => {
      bodyContainer.innerHTML =
        '<section>' +
        '<a href="javascript:alert(1)" id="malicious">malicious</a>' +
        '<a href="https://example.com" id="safe">safe</a>' +
        '</section>'
    })

    render(<WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={0} sourceSize={1024} />)

    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))

    const malicious = await screen.findByText('malicious')
    expect(malicious).not.toHaveAttribute('href')
    expect(malicious).toHaveAttribute('rel', 'noopener noreferrer')

    const safe = screen.getByText('safe')
    expect(safe).toHaveAttribute('href', 'https://example.com')
    expect(safe).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('cleans and re-renders when refreshKey changes', async () => {
    const { rerender } = render(
      <WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={0} sourceSize={1024} />
    )

    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))

    rerender(<WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={1} sourceSize={1024} />)

    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('Page 1')).toHaveLength(1)
  })

  it('does not let a stale render blank a newer render sharing the same container', async () => {
    let resolveStaleRender: (() => void) | undefined
    const staleRenderGate = new Promise<void>((resolve) => {
      resolveStaleRender = resolve
    })
    let renderCount = 0
    mocks.renderAsync.mockImplementation(async (_data: Uint8Array, bodyContainer: HTMLElement) => {
      renderCount += 1
      if (renderCount === 1) {
        await staleRenderGate
        bodyContainer.innerHTML = '<section>Stale</section>'
        return
      }
      bodyContainer.innerHTML = '<section>Fresh</section>'
    })

    const { rerender } = render(
      <WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={0} sourceSize={1024} />
    )
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))

    rerender(<WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={1} sourceSize={1024} />)
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('docx-preview-content')).toHaveTextContent('Fresh'))

    resolveStaleRender?.()
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('docx-preview-content')).toHaveTextContent('Fresh')
  })
})
