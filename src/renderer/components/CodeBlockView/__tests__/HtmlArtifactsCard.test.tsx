import type * as CherryStudioUi from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsCard from '../HtmlArtifactsCard'

const mocks = vi.hoisted(() => ({
  createTempFile: vi.fn(),
  HtmlArtifactsPopup: vi.fn(({ open, title }: { open: boolean; title: string }) =>
    open ? <div role="dialog" aria-label={title} /> : null
  ),
  loadHtmlArtifactsPopup: vi.fn(),
  openPath: vi.fn(),
  save: vi.fn(),
  t: (key: string, fallback?: string) => fallback ?? key,
  write: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('../HtmlArtifactsPopup', () => {
  mocks.loadHtmlArtifactsPopup()

  return {
    default: mocks.HtmlArtifactsPopup
  }
})

describe('HtmlArtifactsCard', () => {
  const html = '<!doctype html><html><head><title>Sample Page</title></head><body>Hello</body></html>'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTempFile.mockResolvedValue('/tmp/artifacts-preview.html')
    mocks.openPath.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue('/tmp/Sample-Page.html')
    mocks.write.mockResolvedValue(undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        file: {
          createTempFile: mocks.createTempFile,
          openPath: mocks.openPath,
          save: mocks.save,
          write: mocks.write
        }
      }
    })
  })

  it('opens the generated HTML file through the file API', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifactsCard html={html} />)

    await user.click(screen.getByRole('button', { name: 'chat.artifacts.button.openExternal' }))

    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/artifacts-preview.html'))
    expect(mocks.createTempFile).toHaveBeenCalledWith('artifacts-preview.html')
    expect(mocks.write).toHaveBeenCalledWith('/tmp/artifacts-preview.html', html)
  })

  it('reports a failure to open the generated file', async () => {
    const user = userEvent.setup()
    mocks.openPath.mockRejectedValueOnce(new Error('open failed'))
    render(<HtmlArtifactsCard html={html} />)

    await user.click(screen.getByRole('button', { name: 'chat.artifacts.button.openExternal' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('chat.artifacts.preview.openExternal.error.content: open failed')
    )
  })

  it('downloads the HTML artifact with its document title', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifactsCard html={html} />)

    await user.click(screen.getByRole('button', { name: 'code_block.download.label' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('Sample-Page.html', html))
    expect(toast.success).toHaveBeenCalledWith('message.download.success')
  })

  it('reports a failed HTML download', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValueOnce(new Error('save failed'))
    render(<HtmlArtifactsCard html={html} />)

    await user.click(screen.getByRole('button', { name: 'code_block.download.label' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('message.download.failed: save failed'))
  })

  it('opens the titled artifact preview', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifactsCard html={html} />)

    expect(mocks.loadHtmlArtifactsPopup).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'chat.artifacts.button.preview: Sample Page' }))

    expect(await screen.findByRole('dialog', { name: 'Sample Page' })).toBeInTheDocument()
    expect(mocks.loadHtmlArtifactsPopup).toHaveBeenCalledOnce()
  })

  it('uses a localized accessible name when the document has no title', () => {
    render(<HtmlArtifactsCard html="<main>Page</main>" />)

    expect(screen.getByRole('button', { name: 'chat.artifacts.button.preview: common.html_preview' })).toHaveAttribute(
      'title',
      'common.html_preview'
    )
  })

  it('keeps the selector that isolates the card from Markdown code styling', () => {
    const { container } = render(<HtmlArtifactsCard html={html} />)

    // `markdown.css` treats this maintained selector as a semantic boundary.
    expect(container.firstElementChild).toHaveClass('special-preview', 'font-[var(--font-family-body)]')
  })
})
