import { beforeEach, describe, expect, it, vi } from 'vitest'

const { wordExtractMock } = vi.hoisted(() => ({ wordExtractMock: vi.fn() }))
vi.mock('word-extractor', () => ({
  default: class {
    extract = wordExtractMock
  }
}))

import { extractLegacyDocText } from '@main/utils/legacyDoc'

const document = (streams: Partial<Record<'body' | 'textboxes' | 'footnotes' | 'endnotes', string>>) => ({
  getBody: () => streams.body ?? '',
  getTextboxes: () => streams.textboxes ?? '',
  getFootnotes: () => streams.footnotes ?? '',
  getEndnotes: () => streams.endnotes ?? ''
})

describe('extractLegacyDocText', () => {
  beforeEach(() => {
    wordExtractMock.mockReset()
  })

  it('keeps the text boxes, which a .doc stores outside the body', async () => {
    wordExtractMock.mockResolvedValueOnce(
      document({ body: 'Paragraph 1\n\nParagraph 2', textboxes: 'First text box, regular' })
    )

    await expect(extractLegacyDocText(Buffer.from(''))).resolves.toBe(
      'Paragraph 1\n\nParagraph 2\n\nFirst text box, regular'
    )
  })

  it('keeps the footnotes and endnotes', async () => {
    wordExtractMock.mockResolvedValueOnce(
      document({
        body: 'Endnotes and footnotes test',
        footnotes: ' This is a footnote\n',
        endnotes: ' This is an endnote\n'
      })
    )

    await expect(extractLegacyDocText(Buffer.from(''))).resolves.toBe(
      'Endnotes and footnotes test\n\nThis is a footnote\n\nThis is an endnote'
    )
  })

  it('leaves a document that only has a body unchanged', async () => {
    wordExtractMock.mockResolvedValueOnce(document({ body: ' word body ' }))

    await expect(extractLegacyDocText(Buffer.from(''))).resolves.toBe('word body')
  })

  it('returns an empty string when every stream is empty', async () => {
    wordExtractMock.mockResolvedValueOnce(document({}))

    await expect(extractLegacyDocText(Buffer.from(''))).resolves.toBe('')
  })
})
