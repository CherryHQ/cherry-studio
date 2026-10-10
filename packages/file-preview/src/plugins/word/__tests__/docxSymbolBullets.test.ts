import { renderAsync } from 'docx-preview'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

async function renderBullet(font: string, text: string, normalizeSymbolBullets?: boolean, format = 'bullet') {
  const zip = new JSZip()
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  zip.file(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
    <Default Extension="xml" ContentType="application/xml" />
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
    <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml" />
  </Types>`
  )
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="word/document.xml" /></Relationships>`
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}/numbering" Target="numbering.xml" /></Relationships>`
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${ns}"><w:body><w:p>
    <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
    <w:r><w:t>List entry</w:t></w:r>
  </w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`
  )
  zip.file(
    'word/numbering.xml',
    `<w:numbering xmlns:w="${ns}">
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/>
      <w:lvlText w:val="${text}"/><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>
    </w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`
  )
  const body = document.createElement('div')
  const styles = document.createElement('div')
  await renderAsync(
    await zip.generateAsync({ type: 'uint8array' }),
    body,
    styles,
    normalizeSymbolBullets === undefined ? {} : { normalizeSymbolBullets }
  )
  expect(body.textContent).toContain('List entry')
  return styles.textContent ?? ''
}

describe('portable DOCX bullet rendering', () => {
  it.each([
    ['Symbol', '\uF0B7', '•'],
    ['Wingdings', '\uF0A7', '▪'],
    ['Wingdings', '\uF0D8', '➢'],
    ['Wingdings', '\uF0FC', '✓']
  ])('renders %s %s without requiring the legacy font when enabled', async (font, input, output) => {
    const css = await renderBullet(font, input, true)
    expect(css).toContain(`content: "${output}`)
    expect(css).not.toContain(input)
    expect(css).not.toMatch(/font-family:/)
  })

  it('preserves desktop font rendering when normalization is omitted', async () => {
    const css = await renderBullet('Symbol', '\uF0B7')
    expect(css).toContain('\uF0B7')
    expect(css).toContain('font-family: Symbol')
  })

  it.each([
    ['Wingdings 2', '\uF0A7', 'bullet'],
    ['CustomFont', '\uF0B7', 'bullet'],
    ['Symbol', '\uF021', 'bullet'],
    ['Symbol', '\uF0B7', 'decimal']
  ])('preserves unmapped characters and non-bullet formats (%s, %s, %s)', async (font, text, format) => {
    const css = await renderBullet(font, text, true, format)
    expect(css).toContain(text)
    expect(css).toContain(font)
    expect(css).toContain('font-family:')
  })
})
