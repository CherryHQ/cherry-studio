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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WordFilePreview', () => {
  /** Puts a body-level paragraph into the rendered body and selects it, the way docx-preview would. */
  async function selectRenderedParagraph(text: string, attributes: Record<string, string>) {
    const bodyContainer = screen.getByTestId('docx-preview-content')
    const paragraph = document.createElement('p')
    for (const [name, value] of Object.entries(attributes)) paragraph.setAttribute(name, value)
    const textNode = document.createTextNode(text)
    paragraph.appendChild(textNode)
    bodyContainer.appendChild(paragraph)

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }

  it('turns a selection in the rendered body into a reference for the host', async () => {
    const onSelectionReference = vi.fn()
    render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 7 }}
        refreshKey={0}
        onSelectionReference={onSelectionReference}
      />
    )
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))

    await selectRenderedParagraph('selected sentence', {
      'data-docx-part': 'body',
      'data-docx-index': '3',
      'data-para-id': '1A2B3C4D'
    })

    await waitFor(() => expect(onSelectionReference).toHaveBeenCalled())
    expect(onSelectionReference).toHaveBeenLastCalledWith({
      path: filePath,
      anchor: { format: 'docx', paragraph: 3, paraId: '1A2B3C4D' },
      excerpt: 'selected sentence',
      fileStamp: { size: 1024, mtimeMs: 7 }
    })
  })

  it('reports null when the selection leaves the rendered body', async () => {
    const onSelectionReference = vi.fn()
    render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 7 }}
        refreshKey={0}
        onSelectionReference={onSelectionReference}
      />
    )
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))
    await selectRenderedParagraph('selected sentence', { 'data-docx-part': 'body', 'data-docx-index': '3' })
    await waitFor(() => expect(onSelectionReference).toHaveBeenCalled())
    onSelectionReference.mockClear()

    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))

    await waitFor(() => expect(onSelectionReference).toHaveBeenLastCalledWith(null))
  })

  it('reports null for a paragraph the docx-preview patch left unnumbered', async () => {
    // Headers, footers and text boxes render without a body ordinal; anchoring them would name a
    // paragraph the document does not address that way.
    const onSelectionReference = vi.fn()
    render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 7 }}
        refreshKey={0}
        onSelectionReference={onSelectionReference}
      />
    )
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))

    await selectRenderedParagraph('header text', { 'data-docx-part': 'header', 'data-docx-index': '0' })

    await waitFor(() => expect(onSelectionReference).toHaveBeenLastCalledWith(null))
  })

  it('loads and renders DOCX pages with a centered standalone toolbar', async () => {
    render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )

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
    const toolbar = screen.getByRole('toolbar', { name: 'preview.label' })
    expect(toolbar).toHaveClass('h-11', 'min-h-11')
    expect(toolbar).not.toHaveClass('bg-background')
    expect(toolbar.firstElementChild).toHaveClass('mx-auto', 'justify-center')
    await waitFor(() => expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('1 / 2'))

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    await waitFor(() => expect(screen.getByTestId('docx-preview-page-indicator')).toHaveTextContent('2 / 2'))

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('110%')
    expect(screen.getByTestId('docx-preview-content')).toHaveAttribute('data-zoom', '1.1')
  })

  it('sanitizes unsafe hyperlinks rendered by docx-preview', async () => {
    mocks.renderAsync.mockImplementationOnce(async (_data: Uint8Array, body: HTMLElement) => {
      body.innerHTML =
        '<section><a href="javascript:alert(1)">unsafe</a><a href="https://example.com">safe</a></section>'
    })

    render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )

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
        metadata={{ size: 25 * 1024 * 1024 + 1, modifiedAt: 1 }}
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

    render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(mocks.loggerError).toHaveBeenCalledWith(`Failed to load DOCX preview: ${filePath}`, error)
  })

  it('reloads the file when refreshKey changes', async () => {
    const view = render(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(1))

    view.rerender(
      <WordFilePreview
        filePath={filePath}
        fileName="report.docx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={1}
      />
    )

    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(2))
  })
})
