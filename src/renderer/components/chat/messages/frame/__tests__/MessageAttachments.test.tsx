import type { AbsoluteFilePath } from '@shared/types/file'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MessageAttachments from '../MessageAttachments'

const { mockUseQuery, mockPreviewFile } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockPreviewFile: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: mockUseQuery
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ previewFile: mockPreviewFile, openFile: vi.fn() }),
  useOptionalMessageListUi: () => undefined
}))

const entryHandle = { kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000001' } as const

describe('MessageAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({ data: undefined })
  })

  // The file part carries no size; without the entry lookup the card reads "0.00 KB".
  it('shows the size the entry row reports', () => {
    mockUseQuery.mockReturnValue({
      data: { id: entryHandle.entryId, origin: 'internal', name: 'report.pdf', ext: '.pdf', size: 2048 }
    })

    render(<MessageAttachments handle={entryHandle} name="report.pdf" ext=".pdf" createdAt="2026-01-01" />)

    expect(screen.getByText('2 KB · PDF')).toBeInTheDocument()
  })

  it('shows the type alone rather than a fabricated zero size', () => {
    render(
      <MessageAttachments
        handle={{ kind: 'path', path: '/tmp/report.pdf' as AbsoluteFilePath }}
        name="report.pdf"
        ext=".pdf"
        createdAt="2026-01-01"
      />
    )

    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.queryByText(/0\.00 KB/)).toBeNull()
  })

  it('hands the untouched handle to the preview action', async () => {
    render(<MessageAttachments handle={entryHandle} name="report.pdf" ext=".pdf" createdAt="2026-01-01" />)

    screen.getByRole('button', { name: 'common.preview' }).click()

    expect(mockPreviewFile).toHaveBeenCalledWith(expect.objectContaining({ handle: entryHandle }))
  })
})
