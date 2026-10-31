import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: { names: string }) => `${key}:${values.names}`
  })
}))

import AttachmentNoticeBlock from '../AttachmentNoticeBlock'

describe('AttachmentNoticeBlock', () => {
  it('names every image that was sent as OCR text', () => {
    render(<AttachmentNoticeBlock data={{ kind: 'image-ocr', fileNames: ['a.png', 'b.jpg'] }} />)

    expect(screen.getByRole('note')).toHaveTextContent('message.attachment_notice.image_ocr:a.png, b.jpg')
  })

  it('renders nothing without affected files', () => {
    const { container } = render(<AttachmentNoticeBlock data={{ kind: 'image-ocr', fileNames: [] }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
