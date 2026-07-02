import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  interface TestZipEntry {
    name: string
    content?: Uint8Array
    compressedSize?: number
    uncompressedSize?: number
  }

  const asciiBytes = (value: string): Uint8Array => Uint8Array.from(value, (char) => char.charCodeAt(0))

  const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
    const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
    let offset = 0

    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    return bytes
  }

  const createZipBytes = (entries: TestZipEntry[]): Uint8Array => {
    const localRecords: Uint8Array[] = []
    const centralRecords: Uint8Array[] = []
    let localOffset = 0

    for (const entry of entries) {
      const name = asciiBytes(entry.name)
      const content = entry.content ?? new Uint8Array()
      const compressedSize = entry.compressedSize ?? content.byteLength
      const uncompressedSize = entry.uncompressedSize ?? content.byteLength

      const localRecord = new Uint8Array(30 + name.byteLength + content.byteLength)
      const localView = new DataView(localRecord.buffer)
      localView.setUint32(0, 0x04034b50, true)
      localView.setUint16(4, 20, true)
      localView.setUint32(18, compressedSize, true)
      localView.setUint32(22, uncompressedSize, true)
      localView.setUint16(26, name.byteLength, true)
      localRecord.set(name, 30)
      localRecord.set(content, 30 + name.byteLength)

      const centralRecord = new Uint8Array(46 + name.byteLength)
      const centralView = new DataView(centralRecord.buffer)
      centralView.setUint32(0, 0x02014b50, true)
      centralView.setUint16(4, 20, true)
      centralView.setUint16(6, 20, true)
      centralView.setUint32(20, compressedSize, true)
      centralView.setUint32(24, uncompressedSize, true)
      centralView.setUint16(28, name.byteLength, true)
      centralView.setUint32(42, localOffset, true)
      centralRecord.set(name, 46)

      localRecords.push(localRecord)
      centralRecords.push(centralRecord)
      localOffset += localRecord.byteLength
    }

    const centralDirectoryOffset = localOffset
    const centralDirectorySize = centralRecords.reduce((size, record) => size + record.byteLength, 0)
    const eocd = new Uint8Array(22)
    const eocdView = new DataView(eocd.buffer)
    eocdView.setUint32(0, 0x06054b50, true)
    eocdView.setUint16(8, entries.length, true)
    eocdView.setUint16(10, entries.length, true)
    eocdView.setUint32(12, centralDirectorySize, true)
    eocdView.setUint32(16, centralDirectoryOffset, true)

    return concatBytes([...localRecords, ...centralRecords, eocd])
  }

  const validDocxBytes = createZipBytes([{ name: 'word/document.xml', content: asciiBytes('<w:document />') }])

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
    intersectionObserverInstances: instances,
    createZipBytes,
    validDocxBytes
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
  EmptyState: ({
    title,
    description,
    actions
  }: {
    title?: string
    description?: string
    actions?: React.ReactNode
  }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
      {actions}
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
  mocks.fsRead.mockResolvedValue(mocks.validDocxBytes)
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
      mocks.validDocxBytes,
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
          { target: page1, isIntersecting: false } as unknown as IntersectionObserverEntry,
          { target: page2, isIntersecting: true } as unknown as IntersectionObserverEntry
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

  it('rejects oversized DOCX ZIP entries before rendering', async () => {
    const oversizedDocxBytes = mocks.createZipBytes([
      {
        name: 'word/document.xml',
        uncompressedSize: 32 * 1024 * 1024 + 1
      }
    ])
    mocks.fsRead.mockResolvedValueOnce(oversizedDocxBytes)

    render(
      <WordPreviewPanel
        filePath="/tmp/zip-bomb.docx"
        fileName="zip-bomb.docx"
        refreshKey={0}
        sourceSize={oversizedDocxBytes.byteLength}
        actions={<button type="button">Open externally</button>}
      />
    )

    expect(await screen.findByText('common.error')).toBeInTheDocument()
    expect(screen.getByText('files.preview.error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open externally' })).toBeInTheDocument()
    expect(mocks.renderAsync).not.toHaveBeenCalled()
  })

  it('allows only safe hyperlink protocols and hardens remaining links', async () => {
    mocks.renderAsync.mockImplementationOnce(async (_data: Uint8Array, bodyContainer: HTMLElement) => {
      bodyContainer.innerHTML =
        '<section>' +
        '<a href="javascript:alert(1)" id="malicious">malicious</a>' +
        '<a href="unknownscheme:payload" id="exotic">exotic</a>' +
        '<a href="https://example.com" id="safe">safe</a>' +
        '<a href="#bookmark" id="internal">internal</a>' +
        '</section>'
    })

    render(<WordPreviewPanel filePath="/tmp/report.docx" fileName="report.docx" refreshKey={0} sourceSize={1024} />)

    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))

    const malicious = await screen.findByText('malicious')
    expect(malicious).not.toHaveAttribute('href')
    expect(malicious).toHaveAttribute('rel', 'noopener noreferrer')

    // Anything outside the allowlist is stripped, even unknown schemes the denylist would have missed.
    const exotic = screen.getByText('exotic')
    expect(exotic).not.toHaveAttribute('href')
    expect(exotic).toHaveAttribute('rel', 'noopener noreferrer')

    const safe = screen.getByText('safe')
    expect(safe).toHaveAttribute('href', 'https://example.com')
    expect(safe).toHaveAttribute('rel', 'noopener noreferrer')

    // In-document bookmarks inherit the base https: scheme, so they survive the allowlist.
    const internal = screen.getByText('internal')
    expect(internal).toHaveAttribute('href', '#bookmark')
    expect(internal).toHaveAttribute('rel', 'noopener noreferrer')
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
