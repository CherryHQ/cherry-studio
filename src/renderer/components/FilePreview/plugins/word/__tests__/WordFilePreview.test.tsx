// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const createValidDocxBytes = () => {
    const bytes = new Uint8Array(22)
    new DataView(bytes.buffer).setUint32(0, 0x06054b50, true)
    return bytes
  }

  class MockIntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }

  return {
    createValidDocxBytes,
    fsRead: vi.fn(),
    loggerError: vi.fn(),
    renderAsync: vi.fn(),
    MockIntersectionObserver
  }
})

vi.mock('docx-preview', () => ({
  renderAsync: mocks.renderAsync
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() })
  }
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
  ),
  Scrollbar: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import WordFilePreview from '../WordFilePreview'

const filePath = '/tmp/documents/report.docx' as AbsoluteFilePath

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fsRead.mockResolvedValue(mocks.createValidDocxBytes())
  mocks.renderAsync.mockImplementation(async (_data: Uint8Array, body: HTMLElement) => {
    body.innerHTML = '<section>Page 1</section><section>Page 2</section>'
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fs: { read: mocks.fsRead } }
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('IntersectionObserver', mocks.MockIntersectionObserver)
  vi.stubGlobal('PointerEvent', MouseEvent)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WordFilePreview', () => {
  it('loads and renders DOCX pages with preview controls', async () => {
    render(<WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={0} />)

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))

    expect(mocks.fsRead).toHaveBeenCalledWith(filePath)
    expect(mocks.renderAsync).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(HTMLElement),
      expect.any(HTMLElement),
      expect.objectContaining({
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderAltChunks: false,
        useBase64URL: true
      })
    )
    await waitFor(() => expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('1 / 2'))

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    await waitFor(() => expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('2 / 2'))

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('110%')
    expect(screen.getByTestId('docx-preview-content')).toHaveAttribute('data-zoom', '1.1')
  })

  it('fits rendered DOCX pages to a narrow preview width before manual zoom', async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.getAttribute('aria-label') === 'report.docx' ? 524 : 0
    })
    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('aria-label') === 'report.docx') {
        const zoom = Number(screen.queryByTestId('docx-preview-content')?.getAttribute('data-zoom') ?? '1')
        return Math.max(524, Math.round(800 * zoom))
      }
      if (this.classList.contains('docx-preview-wrapper')) return 800
      if (this.classList.contains('docx-preview-page')) return 760
      return 0
    })
    mocks.renderAsync.mockImplementationOnce(async (_data: Uint8Array, body: HTMLElement) => {
      body.innerHTML = '<div class="docx-preview-wrapper"><section>Page 1</section></div>'
    })

    try {
      render(<WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={0} />)

      await waitFor(() => expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('63%'))
      expect(screen.getByTestId('docx-preview-content')).toHaveAttribute('data-zoom', '0.63')

      fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
      expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('73%')
      await waitFor(() => expect(screen.getByRole('region', { name: 'report.docx' }).scrollLeft).toBe(30))

      fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
      expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('63%')
      await waitFor(() => expect(screen.getByRole('region', { name: 'report.docx' }).scrollLeft).toBe(0))
    } finally {
      clientWidthSpy.mockRestore()
      scrollWidthSpy.mockRestore()
    }
  })

  it('resets to the same fit zoom when browser geometry reflects the current CSS zoom', async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.getAttribute('aria-label') === 'report.docx' ? 524 : 0
    })
    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('aria-label') !== 'report.docx') return 0
      const zoom = Number(screen.queryByTestId('docx-preview-content')?.getAttribute('data-zoom') ?? '1')
      return Math.max(524, Math.round(800 * zoom))
    })
    const boundingRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const zoom = Number(this.closest('[data-testid="docx-preview-content"]')?.getAttribute('data-zoom') ?? '1')
      const width =
        this.classList.contains('docx-preview-wrapper') || this.classList.contains('docx-preview-page') ? 800 * zoom : 0
      return { bottom: 0, height: 0, left: 0, right: width, top: 0, width, x: 0, y: 0, toJSON: () => ({}) }
    })
    mocks.renderAsync.mockImplementationOnce(async (_data: Uint8Array, body: HTMLElement) => {
      body.innerHTML = '<div class="docx-preview-wrapper"><section>Page 1</section></div>'
    })

    try {
      render(<WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={0} />)

      await waitFor(() => expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('63%'))
      fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
      expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('73%')

      fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))

      expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('63%')
    } finally {
      clientWidthSpy.mockRestore()
      scrollWidthSpy.mockRestore()
      boundingRectSpy.mockRestore()
    }
  })

  it('pans zoomed DOCX pages by dragging the preview canvas', async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.getAttribute('aria-label') === 'report.docx' ? 300 : 0
    })
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.getAttribute('aria-label') === 'report.docx' ? 220 : 0
    })
    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('aria-label') === 'report.docx') {
        const zoom = Number(screen.queryByTestId('docx-preview-content')?.getAttribute('data-zoom') ?? '1')
        return Math.max(300, Math.round(800 * zoom))
      }
      if (this.classList.contains('docx-preview-wrapper')) return 800
      if (this.classList.contains('docx-preview-page')) return 760
      return 0
    })
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('aria-label') === 'report.docx') {
        const zoom = Number(screen.queryByTestId('docx-preview-content')?.getAttribute('data-zoom') ?? '1')
        return Math.max(220, Math.round(900 * zoom))
      }
      return 0
    })
    mocks.renderAsync.mockImplementationOnce(async (_data: Uint8Array, body: HTMLElement) => {
      body.innerHTML = '<div class="docx-preview-wrapper"><section><strong>Selectable text</strong></section></div>'
    })

    try {
      render(<WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={0} />)

      const region = await screen.findByRole('region', { name: 'report.docx' })
      await waitFor(() => expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('50%'))

      region.scrollLeft = 20
      region.scrollTop = 30

      const selectableText = screen.getByText('Selectable text')
      // `selectable` overrides the renderer's global user-select:none contract.
      expect(selectableText.closest('.docx-preview-page')).toHaveClass('selectable')
      expect(
        fireEvent.pointerDown(selectableText, { button: 0, buttons: 1, pointerId: 6, clientX: 100, clientY: 100 })
      ).toBe(true)
      fireEvent.pointerMove(selectableText, { pointerId: 6, clientX: 80, clientY: 70 })
      expect(region.scrollLeft).toBe(20)
      expect(region.scrollTop).toBe(30)

      fireEvent.pointerDown(region, { button: 0, buttons: 1, pointerId: 7, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(region, { pointerId: 7, clientX: 80, clientY: 70 })

      expect(region.scrollLeft).toBe(40)
      expect(region.scrollTop).toBe(60)

      fireEvent.pointerUp(region, { pointerId: 7 })
    } finally {
      clientWidthSpy.mockRestore()
      clientHeightSpy.mockRestore()
      scrollWidthSpy.mockRestore()
      scrollHeightSpy.mockRestore()
    }
  })

  it('sanitizes unsafe hyperlinks rendered by docx-preview', async () => {
    mocks.renderAsync.mockImplementationOnce(async (_data: Uint8Array, body: HTMLElement) => {
      body.innerHTML =
        '<section><a href="javascript:alert(1)">unsafe</a><a href="https://example.com">safe</a></section>'
    })

    render(<WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={0} />)

    const unsafeLink = await screen.findByText('unsafe')
    expect(unsafeLink).not.toHaveAttribute('href')
    expect(unsafeLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('safe')).toHaveAttribute('href', 'https://example.com')
  })

  it('rejects oversized DOCX via metadata before reading bytes', async () => {
    render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 25 * 1024 * 1024 + 1 }}
        refreshKey={0}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.renderAsync).not.toHaveBeenCalled()
  })

  it('contains read failures inside the preview and logs the cause', async () => {
    const error = new Error('corrupt docx')
    mocks.fsRead.mockRejectedValueOnce(error)

    render(<WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={0} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(mocks.loggerError).toHaveBeenCalledWith(`Failed to load DOCX preview: ${filePath}`, error)
  })

  it('reloads the file when refreshKey changes', async () => {
    const view = render(
      <WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={0} />
    )
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(1))

    view.rerender(
      <WordFilePreview filePath={filePath} fileName="report.docx" metadata={{ size: 1024 }} refreshKey={1} />
    )

    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(2))
  })
})
