import { describe, expect, it } from 'vitest'

import { canSelectPreview, resolvePreviewPlugin, supportsPreview } from '../filePreviewRegistry'

describe('preview format detection', () => {
  it.each([
    ['application/pdf', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'powerpoint'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet'],
    ['image/svg+xml', 'image']
  ])('opens an extensionless %s source', (mediaType, format) => {
    expect(resolvePreviewPlugin('attachment', mediaType)?.id).toBe(format)
    expect(supportsPreview('attachment', mediaType)).toBe(true)
    expect(canSelectPreview('attachment', mediaType)).toBe(format !== 'image')
  })

  it('prefers a recognized media type over a misleading suffix', () => {
    expect(resolvePreviewPlugin('attachment.xlsx', ' Application/PDF; charset=binary ')?.id).toBe('pdf')
  })

  it.each([undefined, '', ' ', 'application/octet-stream'])('falls back to the suffix for %s', (mediaType) => {
    expect(resolvePreviewPlugin('REPORT.DOCX', mediaType)?.id).toBe('word')
  })

  it('does not treat arbitrary images or legacy Office formats as supported', () => {
    expect(supportsPreview('image', 'image/tiff')).toBe(false)
    expect(supportsPreview('report.doc', 'application/msword')).toBe(false)
  })
})
