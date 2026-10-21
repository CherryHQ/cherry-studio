import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InputFilePreview } from '@renderer/types/inputFilePreview'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import type { MessageListActions } from '../../types'
import MessageAttachments from '../MessageAttachments'

vi.unmock('@cherrystudio/ui')

const { actions, getFileView } = vi.hoisted(() => ({ actions: {} as MessageListActions, getFileView: vi.fn() }))

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => actions,
  useOptionalMessageListUi: () => ({ getFileView })
}))

const handle = { kind: 'path', path: AbsoluteFilePathSchema.parse('/managed/report.pdf') } as const
const inputFilePreview: InputFilePreview = {
  displayName: 'report.pdf',
  previewPath: handle.path,
  fileEntryId: 'entry-report',
  originalPath: AbsoluteFilePathSchema.parse('/original/report.pdf'),
  mediaType: 'application/pdf'
}

describe('MessageAttachments', () => {
  beforeEach(() => {
    getFileView.mockReset()
    actions.previewFile = vi.fn()
    actions.openFile = vi.fn()
    actions.previewInputFile = undefined
  })

  it.each(['suggestions', 'suggestions.pdf'])('uses the PDF icon when the source name is %s', (name) => {
    getFileView.mockReturnValue({ displayName: 'suggestions' })
    render(<MessageAttachments handle={handle} name={name} ext=".pdf" />)

    expect(screen.getByRole('button', { name: 'suggestions' })).toBeEnabled()
    expect(screen.getByText('PDF')).toBeVisible()
    // Iconify's network boundary exposes the selected asset through the shared mock.
    expect(screen.getByTestId('iconify-icon')).toHaveAttribute('data-icon', 'material-icon-theme:pdf')
  })

  it('retains the handle-based preview when right-pane preview is unavailable', async () => {
    const user = userEvent.setup()
    render(<MessageAttachments handle={handle} name="report.pdf" ext=".pdf" />)

    await user.click(screen.getByRole('button', { name: 'report.pdf' }))

    expect(actions.previewFile).toHaveBeenCalledWith({ handle, name: 'report.pdf', ext: '.pdf' })
  })

  it('opens the same original file in the right pane from pointer and keyboard activation', async () => {
    const user = userEvent.setup()
    actions.previewInputFile = vi.fn()
    render(<MessageAttachments handle={handle} inputFilePreview={inputFilePreview} name="report.pdf" ext=".pdf" />)

    const card = screen.getByRole('button', { name: 'report.pdf' })
    await user.click(card)
    expect(actions.previewInputFile).toHaveBeenLastCalledWith(inputFilePreview)
    vi.mocked(actions.previewInputFile).mockClear()
    card.focus()
    await user.keyboard('{Enter}')
    expect(actions.previewInputFile).toHaveBeenLastCalledWith(inputFilePreview)
    expect(actions.previewFile).not.toHaveBeenCalled()
    expect(actions.openFile).not.toHaveBeenCalled()
  })

  it('opens externally when that is the only available file action', async () => {
    const user = userEvent.setup()
    actions.previewFile = undefined
    render(<MessageAttachments handle={handle} name="report.pdf" ext=".pdf" />)

    await user.click(screen.getByRole('button', { name: 'report.pdf' }))

    expect(actions.openFile).toHaveBeenCalledWith({ handle, name: 'report.pdf', ext: '.pdf' })
  })
})
