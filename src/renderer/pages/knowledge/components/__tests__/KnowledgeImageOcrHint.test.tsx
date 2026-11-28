import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgeImageOcrHint } from '../KnowledgeImageOcrHint'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options: { formats: string }) =>
      `Supported images: ${options.formats}. Images are indexed using OCR.`
  })
}))

describe('KnowledgeImageOcrHint', () => {
  it('lists all accepted image extensions and explains OCR', () => {
    render(<KnowledgeImageOcrHint />)
    expect(
      screen.getByText('Supported images: JPG, JPEG, PNG, GIF, BMP, WEBP. Images are indexed using OCR.')
    ).toBeTruthy()
  })
})
