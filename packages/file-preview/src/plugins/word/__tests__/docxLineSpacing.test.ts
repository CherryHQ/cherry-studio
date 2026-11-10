import { renderAsync } from 'docx-preview'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

async function renderSpacing(spacing: string, docDefaults = false) {
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
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" />
  </Types>`
  )
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="word/document.xml" /></Relationships>`
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}/styles" Target="styles.xml" /></Relationships>`
  )
  zip.file(
    'word/styles.xml',
    `<w:styles xmlns:w="${ns}">${docDefaults ? `<w:docDefaults><w:pPrDefault><w:pPr>${spacing}</w:pPr></w:pPrDefault></w:docDefaults>` : ''}</w:styles>`
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${ns}"><w:body><w:p>
    ${docDefaults ? '' : `<w:pPr>${spacing}</w:pPr>`}
    <w:r><w:rPr><w:sz w:val="56"/></w:rPr><w:t>First line</w:t><w:br/><w:t>Second line</w:t></w:r>
  </w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`
  )
  const body = document.createElement('div')
  const styles = document.createElement('div')
  const doc = await renderAsync(await zip.generateAsync({ type: 'uint8array' }), body, styles)
  const paragraph = body.querySelector('p')!
  expect(paragraph.textContent).toBe('First lineSecond line')
  return { body, styles, paragraph, doc }
}

describe('DOCX line spacing', () => {
  // Missing lineRule must scale with the font instead of fixing a 28pt run to an 18pt line.
  it('uses auto line spacing from docDefaults when lineRule is omitted', async () => {
    const { body, styles, paragraph } = await renderSpacing('<w:spacing w:line="360"/>', true)
    document.body.append(styles, body)
    try {
      const documentStyles = Array.from(styles.childNodes).find(
        (node) => node.nodeType === Node.COMMENT_NODE && node.textContent === 'docxjs document styles'
      )?.nextSibling
      expect(documentStyles).toBeInstanceOf(HTMLStyleElement)
      const rule = documentStyles!.textContent!.match(/\.docx p \{[^}]*\}/)?.[0]
      expect.soft(rule).toBe('.docx p {\n  line-height: 1.50;\n}')
      expect.soft(getComputedStyle(paragraph).lineHeight).toBe('1.5')
      expect(paragraph.style.lineHeight).toBe('')
      expect(paragraph.style.minHeight).toBe('')
    } finally {
      body.remove()
      styles.remove()
    }
  })

  // Explicit rules, including empty/unknown values, retain their existing layout contract.
  it.each([
    { name: 'omitted lineRule', attributes: 'w:line="360"', lineHeight: '1.5', minHeight: '', lineRule: 'auto' },
    {
      name: 'explicit auto',
      attributes: 'w:line="360" w:lineRule="auto"',
      lineHeight: '1.5',
      minHeight: '',
      lineRule: 'auto'
    },
    {
      name: 'explicit exact',
      attributes: 'w:line="360" w:lineRule="exact"',
      lineHeight: '18pt',
      minHeight: '18pt',
      lineRule: 'exact'
    },
    {
      name: 'explicit atLeast',
      attributes: 'w:line="360" w:lineRule="atLeast"',
      lineHeight: 'calc(100% + 24px)',
      minHeight: '',
      lineRule: 'atLeast'
    },
    {
      name: 'empty lineRule',
      attributes: 'w:line="360" w:lineRule=""',
      lineHeight: '18pt',
      minHeight: '18pt',
      lineRule: ''
    },
    {
      name: 'unknown lineRule',
      attributes: 'w:line="360" w:lineRule="bogus"',
      lineHeight: '18pt',
      minHeight: '18pt',
      lineRule: 'bogus'
    },
    { name: 'spacing without line', attributes: '', lineHeight: '', minHeight: '', lineRule: 'auto' },
    {
      name: 'single spacing without lineRule',
      attributes: 'w:line="240"',
      lineHeight: '1',
      minHeight: '',
      lineRule: 'auto'
    },
    {
      name: 'double spacing without lineRule',
      attributes: 'w:line="480"',
      lineHeight: '2',
      minHeight: '',
      lineRule: 'auto'
    }
  ])('renders and parses $name at paragraph level', async ({ attributes, lineHeight, minHeight, lineRule }) => {
    const { paragraph, doc } = await renderSpacing(`<w:spacing ${attributes}/>`)
    expect.soft(paragraph.style.lineHeight).toBe(lineHeight)
    expect.soft(paragraph.style.minHeight).toBe(minHeight)
    expect.soft(doc.documentPart.body.children[0].lineSpacing.lineRule).toBe(lineRule)
  })
})
