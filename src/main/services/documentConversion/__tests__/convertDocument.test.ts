import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { printService } from '../../PrintService'
import { convertDocument } from '../convertDocument'

const table = '| Name | Value |\n| --- | --- |\n| 中文 | =SUM(A1:A2) |'
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('document conversion', () => {
  // Protect actual Office contents, slide boundaries and local image ownership, not SDK invocation details.
  it('keeps five sections on five slides with editable tables, bullets and code', async () => {
    const markdown = [
      `## Revenue\n\n- recurring revenue\n\n${table}`,
      `## Expenses\n\n${table}`,
      `## Forecast\n\n${table}`,
      '## Technical notes\n\n```ts\nconst revenue = 210\n```',
      '## Conclusion\n\n季度报告'
    ].join('\n\n')
    const zip = await JSZip.loadAsync(await convertDocument({ markdown, format: 'pptx' }))
    const slides = zip.file(/^ppt\/slides\/slide\d+\.xml$/)
    expect(slides).toHaveLength(5)
    const contents = await Promise.all(slides.map((slide) => slide.async('string')))
    expect(contents[0]).toContain('<a:tbl>')
    expect(contents[0]).toContain('recurring revenue')
    expect(contents[0]).toContain('<a:buChar')
    expect(contents[3]).toContain('const revenue = 210')
    expect(contents[4]).toContain('季度报告')
  })

  it('paginates long text and embeds images from headings and table cells', async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    const source = `data:image/png;base64,${image.toString('base64')}`
    const markdown = `## Picture ![heading](${source})\n\n${'Long text '.repeat(500)}\n\n| Image |\n| --- |\n| ![cell](${source}) |`
    const zip = await JSZip.loadAsync(await convertDocument({ markdown, format: 'pptx' }))
    const slides = await Promise.all(zip.file(/^ppt\/slides\/slide\d+\.xml$/).map((slide) => slide.async('string')))
    expect(slides.length).toBeGreaterThan(2)
    expect(slides.join('')).toContain('descr="heading"')
    expect(slides.join('')).toContain('descr="cell"')
    expect(zip.file(/^ppt\/media\//).length).toBeGreaterThan(0)
  })

  it('exports one sheet per table with unique valid names and literal formula-like text', async () => {
    const name = `${'a'.repeat(30)}'tail`
    const markdown = `## ${name}\n\n${table}\n\n## ${name}\n\n${table}\n\n## History\n\n${table}`
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(await convertDocument({ markdown, format: 'xlsx' })).buffer)
    expect(workbook.worksheets).toHaveLength(3)
    expect(new Set(workbook.worksheets.map(({ name }) => name.toLowerCase())).size).toBe(3)
    for (const sheet of workbook.worksheets) {
      expect(sheet.name.length).toBeLessThanOrEqual(31)
      expect(sheet.name).not.toMatch(/^'|'$/)
      expect(sheet.getCell('A2').value).toBe('中文')
      expect(sheet.getCell('B2').value).toBe('=SUM(A1:A2)')
      expect(sheet.getCell('B2').formula).toBeUndefined()
    }
  })

  it('preserves plain text when a spreadsheet has no tables', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      Uint8Array.from(await convertDocument({ markdown: '# Report\n\nQuarterly text', format: 'xlsx' })).buffer
    )
    expect(workbook.worksheets[0].getCell('A2').value).toBe('Quarterly text')
  })

  it('validates malformed tables without rejecting valid nested Markdown tables', async () => {
    await expect(
      convertDocument({ markdown: '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |', format: 'xlsx' })
    ).rejects.toMatchObject({ code: 'INVALID_TABLE', preview: expect.stringContaining('| 1 | 2 | 3 |') })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      Uint8Array.from(await convertDocument({ markdown: '- | A | B |\n  | --- | --- |\n  | 1 | 2 |', format: 'xlsx' }))
        .buffer
    )
    expect(workbook.worksheets[0].getCell('B2').value).toBe('2')
  })

  it('keeps the existing DOCX heading, formatting and permissive table behavior', async () => {
    const zip = await JSZip.loadAsync(
      await convertDocument({
        markdown: '# Report\n\n**bold** and `code`\n\n| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',
        format: 'docx'
      })
    )
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('w:val="Heading1"')
    expect(xml).toContain('bold')
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('Consolas')
    expect(xml).toContain('<w:tbl>')
  })

  it('embeds validated image bytes before sending Markdown to the shared print renderer', async () => {
    const source = `data:image/png;base64,${(
      await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
        .png()
        .toBuffer()
    ).toString('base64')}`
    const toPdf = vi.spyOn(printService, 'toDocumentPdfBuffer').mockResolvedValue(Buffer.from('%PDF'))
    const markdown = `# Report\n\n![image](${source})`
    await convertDocument({ markdown, format: 'pdf' })
    const payload = toPdf.mock.calls[0][0]
    expect(payload.markdown).toBe(markdown)
    expect(payload.images[source]).toMatch(/^data:image\/png;base64,/)
    const metadata = await sharp(Buffer.from(payload.images[source].split(',')[1], 'base64')).metadata()
    expect(metadata).toMatchObject({ width: 2, height: 2, format: 'png' })
  })

  it.each(['pptx', 'pdf'] as const)('embeds verified file URL images in %s output', async (format) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'document-export-'))
    roots.push(root)
    const imagePath = path.join(root, '季度 chart.png')
    const image = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    await writeFile(imagePath, image)
    const source = pathToFileURL(imagePath).href
    const markdown = `# Report\n\n![Inline chart](${source})\n\n![Reference chart][chart]\n\n[chart]: ${source}`

    await expect(convertDocument({ markdown, format })).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    if (format === 'pptx') {
      const zip = await JSZip.loadAsync(await convertDocument({ markdown, format, assetRoot: root }))
      const slides = await Promise.all(zip.file(/^ppt\/slides\/slide\d+\.xml$/).map((slide) => slide.async('string')))
      expect(slides.join('')).toContain('descr="Inline chart"')
      expect(slides.join('')).toContain('descr="Reference chart"')
      expect(slides.join('')).not.toContain('file:')
      const exportedImage = zip.file(/^ppt\/media\/.*\.png$/)[0]
      expect(exportedImage).toBeDefined()
      expect(await sharp(await exportedImage.async('nodebuffer')).metadata()).toMatchObject({
        width: 3,
        height: 2,
        format: 'png'
      })
    } else {
      const toPdf = vi.spyOn(printService, 'toDocumentPdfBuffer').mockResolvedValue(Buffer.from('%PDF'))
      await convertDocument({ markdown, format, sourcePath: path.join(root, 'report.md') })
      const payload = toPdf.mock.calls[0][0]
      expect(payload.markdown).toBe(markdown)
      expect(payload.images[source]).toMatch(/^data:image\/png;base64,/)
      expect(await sharp(Buffer.from(payload.images[source].split(',')[1], 'base64')).metadata()).toMatchObject({
        width: 3,
        height: 2,
        format: 'png'
      })
    }
  })

  it.each(['pptx', 'pdf'] as const)('rejects images outside the workspace in %s output', async (format) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'document-export-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'document-outside-'))
    roots.push(root, outside)
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    await writeFile(path.join(outside, 'private.png'), image)
    await symlink(outside, path.join(root, 'linked'))
    for (const source of [
      `../${path.basename(outside)}/private.png`,
      'linked/private.png',
      pathToFileURL(path.join(outside, 'private.png')).href,
      pathToFileURL(path.join(root, 'linked/private.png')).href
    ]) {
      await expect(
        convertDocument({ markdown: `| Image |\n| --- |\n| ![secret](${source}) |`, format, assetRoot: root })
      ).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    }
  })

  it('embeds a sibling-directory image while keeping its document inside the selected workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'document-export-'))
    roots.push(root)
    await Promise.all([mkdir(path.join(root, 'reports')), mkdir(path.join(root, 'images'))])
    const image = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    await writeFile(path.join(root, 'images/chart.png'), image)
    const input = {
      markdown: '# Report\n\n![Chart](../images/chart.png)',
      format: 'pptx' as const,
      sourcePath: path.join(root, 'reports/report.md')
    }

    await expect(convertDocument(input)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    const zip = await JSZip.loadAsync(await convertDocument({ ...input, assetRoot: root }))
    const exportedImage = zip.file(/^ppt\/media\/.*\.png$/)[0]
    expect(exportedImage).toBeDefined()
    expect(await sharp(await exportedImage.async('nodebuffer')).metadata()).toMatchObject({ width: 3, height: 2 })
  })

  it('rejects cancellation and oversized documents before producing a file', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(convertDocument({ markdown: '# report', format: 'pptx' }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await expect(convertDocument({ markdown: 'x'.repeat(2 * 1024 * 1024 + 1), format: 'xlsx' })).rejects.toMatchObject({
      code: 'DOCUMENT_TOO_LARGE'
    })
  })
})
