import JSZip from 'jszip'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { convertDocumentBundle } from '../convertDocument'
import { normalizeDocumentImage } from '../imageAssets'

describe('document conversion fidelity', () => {
  it('preserves table links and inline formatting in Word exports', async () => {
    const document = await convertDocumentBundle({
      markdown: '| Reference |\n| --- |\n| [Docs](https://example.org/docs) **bold** *italic* ~~removed~~ `code` |',
      format: 'docx'
    })
    const zip = await JSZip.loadAsync(document.bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(xml).toContain('<w:hyperlink')
    expect(relationships).toContain('Target="https://example.org/docs"')
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('<w:strike/>')
    expect(xml).toContain('Consolas')
  })

  it.each(['url(#gradient)', "url('#gradient')", 'url("#gradient")', 'url( #gradient )'])(
    'rasterizes SVG local fragment references: %s',
    async (fill) => {
      const escaped = fill.replaceAll('"', '&quot;')
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><defs><linearGradient id="gradient"><stop stop-color="red"/></linearGradient></defs><rect width="2" height="2" fill="${escaped}"/></svg>`
      )
      const png = await normalizeDocumentImage(svg)
      expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 2, height: 2 })
    }
  )

  it.each([
    'url(https://example.org/image.svg)',
    "url('file:///private/image.svg')",
    'url(#gradient) url(https://example.org/image.svg)'
  ])('rejects SVG external resources: %s', async (fill) => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="${fill}"/></svg>`
    )
    await expect(normalizeDocumentImage(svg)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
  })
})
