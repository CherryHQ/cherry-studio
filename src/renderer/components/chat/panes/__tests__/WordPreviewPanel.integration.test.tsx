import { render, screen, waitFor } from '@testing-library/react'
import { Document, Packer, PageBreak, Paragraph } from 'docx'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WordPreviewPanel from '../WordPreviewPanel'

const mocks = vi.hoisted(() => ({
  fsRead: vi.fn(),
  t: vi.fn((key: string) => key)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ label }: { label: string }) => <div data-testid="loading-state">{label}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t
  })
}))

const createMultiPageDocx = async (): Promise<Uint8Array> => {
  const doc = new Document({
    sections: [
      {
        children: [new Paragraph('Page 1'), new Paragraph({ children: [new PageBreak()] }), new Paragraph('Page 2')]
      }
    ]
  })

  return new Uint8Array(await Packer.toBuffer(doc))
}

describe('WordPreviewPanel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: {
          read: mocks.fsRead
        }
      }
    })
  })

  it('renders manual page breaks as separate document pages', async () => {
    mocks.fsRead.mockResolvedValue(await createMultiPageDocx())

    render(<WordPreviewPanel filePath="/tmp/workspace/multipage.docx" fileName="multipage.docx" />)

    await waitFor(() => {
      expect(screen.getByTestId('word-preview-document').querySelectorAll('section.docx')).toHaveLength(2)
    })
    expect(screen.getByTestId('word-preview-document')).toHaveTextContent('Page 1')
    expect(screen.getByTestId('word-preview-document')).toHaveTextContent('Page 2')
  })
})
