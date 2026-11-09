import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import EpubFilePreview from '../EpubFilePreview'
import { EPUB_SOURCE_MAX_BYTES } from '../epubParser'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { number?: number }) => (options?.number ? `Chapter ${options.number}` : key)
  })
}))
const path = '/tmp/book.epub' as AbsoluteFilePath
async function bookBytes() {
  const zip = new JSZip()
  zip.file('META-INF/container.xml', '<container><rootfile full-path="book.opf"/></container>')
  zip.file(
    'book.opf',
    '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'
  )
  zip.file('a.xhtml', '<html><body><p>First chapter content</p></body></html>')
  zip.file('b.xhtml', '<html><body><p>Second chapter content</p></body></html>')
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
const props = (size: number, refreshKey = 0) => ({
  filePath: path,
  fileName: 'book.epub',
  metadata: { size, modifiedAt: 1 },
  refreshKey
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('EPUB preview', () => {
  it('shows and switches chapters', async () => {
    const bytes = await bookBytes()
    mocks.request.mockResolvedValue({ content: bytes, version: { size: bytes.length, mtime: 1 } })
    render(<EpubFilePreview {...props(bytes.length)} />)
    expect(await screen.findByText('First chapter content')).toBeInTheDocument()
    expect(screen.getByText('file_preview.epub.text_only')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chapter 2' }))
    expect(await screen.findByText('Second chapter content')).toBeInTheDocument()
    expect(screen.queryByText('First chapter content')).not.toBeInTheDocument()
  })
  it('rejects oversized files before reading', async () => {
    render(<EpubFilePreview {...props(EPUB_SOURCE_MAX_BYTES + 1)} />)
    expect(await screen.findByText('file_preview.epub.too_large.title')).toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('shows the damaged reason for invalid bytes', async () => {
    const bytes = new Uint8Array([1, 2])
    mocks.request.mockResolvedValue({ content: bytes, version: { size: 2, mtime: 1 } })
    render(<EpubFilePreview {...props(2)} />)
    expect(await screen.findByText('file_preview.epub.damaged.title')).toBeInTheDocument()
  })
  it('does not restore an old result after refresh', async () => {
    const bytes = await bookBytes()
    let resolve!: (value: unknown) => void
    mocks.request
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValueOnce({ content: new Uint8Array([1, 2]), version: { size: 2, mtime: 1 } })
    const view = render(<EpubFilePreview {...props(bytes.length)} />)
    await waitFor(() => expect(mocks.request).toHaveBeenCalled())
    view.rerender(<EpubFilePreview {...props(2, 1)} />)
    expect(await screen.findByText('file_preview.epub.damaged.title')).toBeInTheDocument()
    resolve({ content: bytes, version: { size: bytes.length, mtime: 1 } })
    await waitFor(() => expect(screen.queryByText('First chapter content')).not.toBeInTheDocument())
  })
})
