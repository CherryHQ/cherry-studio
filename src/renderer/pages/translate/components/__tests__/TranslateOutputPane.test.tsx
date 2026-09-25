import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { popup } from '@renderer/services/popup'
import { speechPlaybackService } from '@renderer/services/voice'

import TranslateOutputPane from '../TranslateOutputPane'

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

// The renderer-wide setup substitutes a text-echo StreamingMarkdown, which is
// exactly the regression guarded here — opt back into the real @cherrystudio/ui.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const baseProps = () => ({
  translatedContent: '',
  enableMarkdown: false,
  translating: false,
  copied: false,
  onCopy: vi.fn(),
  onExportToNotes: vi.fn(),
  onScroll: vi.fn()
})

describe('TranslateOutputPane', () => {
  it('renders streamed output as formatted markdown, not the raw source', () => {
    const props = baseProps()
    props.enableMarkdown = true
    props.translating = true
    props.translatedContent = '## Streamed title\n\n**bold** pick:\n\n- one\n- two'

    const { container, rerender } = render(<TranslateOutputPane {...props} />)

    expect(screen.getByRole('heading', { name: 'Streamed title' })).toBeInTheDocument()
    // Streamdown renders bold as a marked span (data-streamdown="strong"), not a <strong> tag.
    expect(container.querySelector('[data-streamdown="strong"]')).toHaveTextContent('bold')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    // A plain-text fallback would echo the markers verbatim.
    const output = container.querySelector('[data-ui="translate.output"]')
    expect(output?.textContent).not.toContain('##')
    expect(output?.textContent).not.toContain('**')

    // Later stream frames keep the formatted rendering.
    props.translatedContent += '\n- three'
    rerender(<TranslateOutputPane {...props} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('keeps the raw source as plain text when markdown is disabled', () => {
    const props = baseProps()
    props.translatedContent = '**bold** pick'

    const { container } = render(<TranslateOutputPane {...props} />)

    expect(screen.getByText('**bold** pick')).toBeInTheDocument()
    expect(container.querySelector('.markdown')).toBeNull()
    expect(container.querySelector('[data-streamdown="strong"]')).toBeNull()
  })

  it('shows the processing indicator while waiting for output', () => {
    const props = baseProps()
    props.translating = true

    render(<TranslateOutputPane {...props} />)

    expect(screen.getByText('translate.processing')).toBeInTheDocument()
  })

  it('shows translated content length and an enabled copy button', () => {
    const props = baseProps()
    props.translatedContent = 'partial output'

    render(<TranslateOutputPane {...props} />)

    expect(screen.getByText('partial output')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.copy' })).toBeEnabled()
  })

  it('calls onExportToNotes from the footer button', () => {
    const props = baseProps()
    props.translatedContent = 'translated output'

    render(<TranslateOutputPane {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'notes.save' }))

    expect(props.onExportToNotes).toHaveBeenCalledTimes(1)
  })

  it('plays only a completed, nonempty result after a manual click', async () => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({ status: 'started' })
    const props = { ...baseProps(), translatedContent: 'translated output', translating: true }
    const view = render(<TranslateOutputPane {...props} />)

    const readButton = screen.getByRole('button', { name: 'chat.message.read_aloud.label' })
    expect(readButton).toBeDisabled()
    expect(start).not.toHaveBeenCalled()

    view.rerender(<TranslateOutputPane {...props} translating={false} />)
    fireEvent.click(readButton)
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith({
        text: 'translated output',
        trigger: 'manual',
        mode: 'document',
        confirmed: false,
        sourceLabel: 'document',
        sourceEntityId: 'translate-page-result'
      })
    )
    start.mockRestore()
  })

  it('keeps the read control disabled for whitespace output', () => {
    render(<TranslateOutputPane {...baseProps()} translatedContent="   " />)
    expect(screen.getByRole('button', { name: 'chat.message.read_aloud.label' })).toBeDisabled()
  })

  it('does not confirm playback of a result replaced while the long-text dialog is open', async () => {
    const start = vi.spyOn(speechPlaybackService, 'start').mockResolvedValue({
      status: 'confirmation_required',
      normalizedLength: 5_001
    })
    let resolveConfirm: (confirmed: boolean) => void = () => undefined
    vi.mocked(popup.confirm).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve
        })
    )
    const view = render(<TranslateOutputPane {...baseProps()} translatedContent="old result" />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.message.read_aloud.label' }))
    await waitFor(() => expect(popup.confirm).toHaveBeenCalled())
    view.rerender(<TranslateOutputPane {...baseProps()} translatedContent="new result" />)
    await act(async () => resolveConfirm(true))
    expect(start).toHaveBeenCalledTimes(1)
    start.mockRestore()
  })
})
