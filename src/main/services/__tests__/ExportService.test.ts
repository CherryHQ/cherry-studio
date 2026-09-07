import AdmZip from 'adm-zip'
import { dialog } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `t` pulls in i18n + preference machinery that isn't initialized under test; the
// dialog title it produces is irrelevant to these contracts, so stub it to the key.
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// Each test re-imports ExportService after vi.resetModules so per-test vi.doMock
// variants (spied docx for the cancel path, real modules for the product path) apply.
async function freshService() {
  vi.resetModules()
  const { ExportService } = await import('../ExportService')
  return new ExportService()
}

describe('ExportService.exportToWord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.doUnmock('markdown-it')
    vi.doUnmock('docx')
    vi.restoreAllMocks()
  })

  // Catches a regression to convert-before-dialog: any markdown-it / Packer
  // invocation on the cancel path means the user paid conversion cost for nothing.
  describe('cancel path (zero conversion cost)', () => {
    it('does not invoke markdown-it or docx.Packer.toBuffer when the dialog is canceled', async () => {
      const toBuffer = vi.fn()
      const markdownItCtor = vi.fn()
      vi.doMock('docx', () => ({ Document: vi.fn(), Packer: { toBuffer } }))
      vi.doMock('markdown-it', () => ({ default: markdownItCtor }))
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      const service = await freshService()
      await expect(service.exportToWord('# Title', 'doc.docx')).resolves.toBeUndefined()

      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
      expect(markdownItCtor).not.toHaveBeenCalled()
      expect(toBuffer).not.toHaveBeenCalled()
    })
  })

  // Catches the confirm path breaking in the reorder: a wrong canceled/filePath check
  // or lost write leaves no file; broken conversion leaves document.xml without paragraphs.
  describe('confirm path (docx product)', () => {
    let tmpFile: string

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `export-word-test-${process.pid}-${Math.floor(Math.random() * 1e9)}.docx`)
    })

    afterEach(() => {
      fs.rmSync(tmpFile, { force: true })
    })

    it('writes an openable docx whose document.xml contains the converted paragraphs', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile } as never)

      const service = await freshService()
      await service.exportToWord('# Title\n\nBody paragraph', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      expect(documentXml).toContain('Title')
      expect(documentXml).toContain('Body paragraph')
    })

    describe('blockquotes', () => {
      async function exportXml(markdown: string) {
        vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile } as never)
        const service = await freshService()
        await service.exportToWord(markdown, 'doc.docx')
        return new AdmZip(tmpFile).readAsText('word/document.xml')
      }

      const countIndent = (xml: string, twips: number) => xml.split(`<w:ind w:left="${twips}"`).length - 1

      it.each([
        ['soft break', '\n', ' '],
        ['two-space hard break', '  \n', '\n'],
        ['backslash hard break', '\\\n', '\n']
      ])('keeps formatted quote text and a %s inside the hyperlink', async (_name, separator, boundary) => {
        const xml = await exportXml(`> [**bold**${separator}> \`code\`](https://example.com) tail`)
        const hyperlinks = xml.match(/<w:hyperlink[^>]*>[\s\S]*?<\/w:hyperlink>/g) ?? []
        expect(hyperlinks).toHaveLength(1)
        const [hyperlink = ''] = hyperlinks
        const linkText = [...hyperlink.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\s*\/>/g)]
          .map((match) => match[1] ?? '\n')
          .join('')
        expect(linkText).toBe(`bold${boundary}code`)
        const linkRuns = hyperlink.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []
        const boldRun = linkRuns.find((run) => run.includes('>bold</w:t>'))
        const codeRun = linkRuns.find((run) => run.includes('>code</w:t>'))
        expect(boldRun).toContain('<w:b/>')
        expect(boldRun).toContain('<w:i/>')
        expect(codeRun).toContain('Consolas')
        expect(codeRun).toContain('<w:i/>')
        expect(textsOf(xml.replace(hyperlink, ''))).toEqual([' tail'])
        expect(countIndent(xml, 720)).toBe(1)
        expect(xml).toContain('<w:pBdr>')
      })

      it('exports a document that is only an empty blockquote', async () => {
        await expect(exportXml('>')).resolves.toContain('<w:body>')
      })

      it('exports an empty blockquote at the end of the document', async () => {
        const xml = await exportXml('Body text\n\n>')
        expect(xml).toContain('Body text')
      })

      it('keeps the paragraph that follows an empty blockquote, unquoted', async () => {
        const xml = await exportXml('>\n\nafter the quote')
        expect(xml).toContain('after the quote')
        expect(countIndent(xml, 720)).toBe(0)
      })

      it('indents every paragraph of a multi-paragraph blockquote', async () => {
        const xml = await exportXml('> first quoted\n>\n> second quoted')
        expect(xml).toContain('first quoted')
        expect(xml).toContain('second quoted')
        expect(countIndent(xml, 720)).toBe(2)
      })

      it('indents nested blockquotes one level deeper and keeps their text', async () => {
        const xml = await exportXml('> > nested quote')
        expect(xml).toContain('nested quote')
        expect(countIndent(xml, 1440)).toBe(1)
      })

      it('keeps a quote inside a list from changing a later quote', async () => {
        const xml = await exportXml('- > inner\n\n> later\n\nafter')
        const paragraphs = xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
        for (const text of ['inner', 'later']) {
          const paragraph = paragraphs.find((value) => value.includes(`>${text}</w:t>`))
          expect(paragraph).toBeDefined()
          expect(paragraph).toContain('<w:ind w:left="720"')
          expect(paragraph).toContain('<w:pBdr>')
          expect(paragraph).toContain('<w:i/>')
        }
        const followingParagraph = paragraphs.find((value) => value.includes('>after</w:t>'))
        expect(followingParagraph).toBeDefined()
        expect(followingParagraph).not.toContain('<w:ind')
        expect(followingParagraph).not.toContain('<w:i/>')
      })

      it.each([
        ['soft break', '\n', 'first second'],
        ['two-space hard break', '  \n', 'first\nsecond'],
        ['backslash hard break', '\\\n', 'first\nsecond']
      ])('preserves the word boundary at a %s in a quote', async (_name, separator, expected) => {
        const xml = await exportXml(`> first${separator}> second`)
        const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\s*\/>/g)]
          .map((match) => match[1] ?? '\n')
          .join('')
        expect(text).toBe(expected)
      })
    })

    const textsOf = (xml: string) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])

    // Catches the link handler taking only the first text token: `[A **B** C](url)` used to
    // come out as B, C, then a hyperlink holding just "A ".
    it('exports a link with inline formatting as one hyperlink in source order', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile } as never)

      const service = await freshService()
      await service.exportToWord('[A **B** C](https://example.com) tail', 'doc.docx')

      const zip = new AdmZip(tmpFile)
      const documentXml = zip.readAsText('word/document.xml')
      const hyperlinks = documentXml.match(/<w:hyperlink[^>]*>[\s\S]*?<\/w:hyperlink>/g) ?? []
      expect(hyperlinks).toHaveLength(1)
      const [hyperlink = ''] = hyperlinks

      const linkRuns = hyperlink.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []
      expect(linkRuns.map((run) => textsOf(run)[0])).toEqual(['A ', 'B', ' C'])
      expect(linkRuns.map((run) => run.includes('<w:b/>'))).toEqual([false, true, false])
      expect(textsOf(documentXml.replace(hyperlink, ''))).toEqual([' tail'])

      const relId = hyperlink.match(/r:id="([^"]+)"/)?.[1]
      const rels = zip.readAsText('word/_rels/document.xml.rels')
      expect(rels).toMatch(new RegExp(`Id="${relId}"[^>]*Target="https://example.com"`))
    })

    it('keeps the text of a link with an empty target as plain text', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile } as never)

      const service = await freshService()
      await service.exportToWord('[empty]()', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      expect(documentXml).not.toContain('<w:hyperlink')
      expect(documentXml).not.toContain('Hyperlink')
      expect(textsOf(documentXml)).toEqual(['empty'])
    })
  })
})
