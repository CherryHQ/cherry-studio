import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import AdmZip from 'adm-zip'
import { dialog } from 'electron'
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
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('# Title\n\nBody paragraph', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      expect(documentXml).toContain('Title')
      expect(documentXml).toContain('Body paragraph')
    })

    describe('blockquotes', () => {
      async function exportXml(markdown: string) {
        vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
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
        ['> - item', 1440],
        ['> > - item', 2160]
      ])('styles the list item in %j as a quote', async (markdown, indent) => {
        const xml = await exportXml(`${markdown}\n\nafter`)
        const paragraphs = xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
        const item = paragraphs.find((value) => value.includes('>item</w:t>'))
        expect(item).toBeDefined()
        expect(item).toContain('>•</w:t>')
        expect(item).toContain(`<w:ind w:left="${indent}"`)
        expect(item).toContain('<w:pBdr>')
        expect(item).toContain('<w:i/>')
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
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

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
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('[empty]()', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      expect(documentXml).not.toContain('<w:hyperlink')
      expect(documentXml).not.toContain('Hyperlink')
      expect(textsOf(documentXml)).toEqual(['empty'])
    })

    // Catches the block switch dropping markdown-it's `code_block` token: four-space-indented
    // code used to vanish from the document while the export still reported success.
    it('exports indented code as a monospace code block', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('Intro\n\n    const answer = 42\n    return answer\n', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const runs = documentXml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []
      const codeRuns = runs.filter((run) => /const answer = 42|return answer/.test(run))
      expect(codeRuns).toHaveLength(2)
      expect(codeRuns.every((run) => run.includes('Consolas'))).toBe(true)
    })

    // Catches ordered lists falling through the block switch: items came out as unindented
    // bullets, and a nested ordered list did not push the indent level.
    it('numbers ordered list items from their start value and indents nested lists', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('- a\n  1. b\n  2. c\n- d\n\n5. e\n6. f\n', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const paragraphs = documentXml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
      const items = paragraphs.map((paragraph) => {
        const texts = textsOf(paragraph)
        return { marker: texts[0], text: texts[texts.length - 1], indent: paragraph.match(/w:left="(\d+)"/)?.[1] }
      })
      expect(items).toEqual([
        { marker: '•', text: 'a', indent: '720' },
        { marker: '1.', text: 'b', indent: '1440' },
        { marker: '2.', text: 'c', indent: '1440' },
        { marker: '•', text: 'd', indent: '720' },
        { marker: '5.', text: 'e', indent: '720' },
        { marker: '6.', text: 'f', indent: '720' }
      ])
    })

    // Catches the code paragraph putting a line break before every line and keeping the
    // trailing newline: the shaded box used to open and close with an empty line.
    it('exports a code block without leading or trailing blank lines', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('```\nline1\nline2\n```\n', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const paragraphs = documentXml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
      expect(paragraphs).toHaveLength(1)
      const [codeParagraph = ''] = paragraphs
      expect(textsOf(codeParagraph)).toEqual(['line1', 'line2'])
      expect(codeParagraph.match(/<w:br\/>/g)).toHaveLength(1)
    })

    // Catches the inline switch dropping the `image` token together with its alt text.
    it('exports image alt text as plain text', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('before ![alt **text**](x.png) after', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      expect(textsOf(documentXml)).toEqual(['before ', 'alt text', ' after'])
    })

    // Catches alt text being built from token.content alone: soft and hard breaks carry an
    // empty content, so a multi-line alt used to glue its words together.
    it('keeps word boundaries across lines in image alt text', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('![first\nsecond  \nthird `code` ![inner](y.png) tail](x.png)', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      expect(textsOf(documentXml)).toEqual(['first second third code inner tail'])
    })

    // Catches `s_open` / `s_close` being ignored: struck text came out as plain text.
    it('strikes through text wrapped in ~~', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('keep ~~gone~~ tail', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const runs = documentXml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []
      expect(runs.map((run) => textsOf(run)[0])).toEqual(['keep ', 'gone', ' tail'])
      expect(runs.map((run) => run.includes('<w:strike/>'))).toEqual([false, true, false])
    })

    // Catches the heading handler exporting the raw inline source: `# Title ![alt](x.png) ~~old~~`
    // came out as literal markdown, with no alt text and no strikethrough.
    it('renders inline markdown in headings', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('# Head ![alt **x**](a.png) ~~gone~~ **b** tail', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const paragraphs = documentXml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
      expect(paragraphs).toHaveLength(1)
      const [heading = ''] = paragraphs
      expect(heading).toContain('<w:pStyle w:val="Heading1"/>')
      const runs = heading.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []
      expect(runs.map((run) => textsOf(run)[0])).toEqual(['Head ', 'alt x', ' ', 'gone', ' ', 'b', ' tail'])
      expect(runs.map((run) => run.includes('<w:strike/>'))).toEqual([false, false, false, true, false, false, false])
      expect(runs.map((run) => run.includes('<w:b/>'))).toEqual([false, false, false, false, false, true, false])
    })

    // Catches runs writing off flags as `w:val="false"`: an explicit off overrides the
    // paragraph style, so Heading 4 lost the italics its style defines.
    it('does not override heading style formatting with off flags', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('#### Title', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const [heading = ''] = documentXml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
      expect(heading).toContain('<w:pStyle w:val="Heading4"/>')
      expect(textsOf(heading)).toEqual(['Title'])
      expect(heading).not.toContain('w:val="false"')
    })

    // Catches `list_item_open` skipping items whose first block is not a paragraph: the code
    // block or nested list was rendered, but the item's own number or bullet was dropped.
    it('keeps the marker of a list item whose first block is not a paragraph', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      const service = await freshService()
      await service.exportToWord('1. ```\n   code\n   ```\n2. two\n\n- - nested\n- top\n', 'doc.docx')

      const documentXml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const paragraphs = documentXml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
      const items = paragraphs.map((paragraph) => ({
        texts: textsOf(paragraph).filter((text) => text !== '\t'),
        indent: paragraph.match(/w:left="(\d+)"/)?.[1]
      }))
      expect(items).toEqual([
        { texts: ['1.'], indent: '720' },
        { texts: ['code'], indent: '720' },
        { texts: ['2.', 'two'], indent: '720' },
        { texts: ['•'], indent: '720' },
        { texts: ['•', 'nested'], indent: '1440' },
        { texts: ['•', 'top'], indent: '720' }
      ])
    })
    it.each([
      ['1. ```\n   code\n   ```', 720],
      ['1.     code', 720],
      ['- 1. ```\n     code\n     ```', 1440],
      ['> 1. ```\n>    code\n>    ```', 1440]
    ])('keeps code inside its list in %j without indenting following content', async (markdown, indent) => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
      const service = await freshService()
      await service.exportToWord(`${markdown}\n\noutside`, 'doc.docx')

      const xml = new AdmZip(tmpFile).readAsText('word/document.xml')
      const paragraphs = xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
      const code = paragraphs.find((paragraph) => textsOf(paragraph).includes('code'))
      const outside = paragraphs.find((paragraph) => textsOf(paragraph).includes('outside'))
      expect(code).toContain(`<w:ind w:left="${indent}"`)
      expect(outside).toBeDefined()
      expect(outside).not.toContain('<w:ind')
    })
  })
})
