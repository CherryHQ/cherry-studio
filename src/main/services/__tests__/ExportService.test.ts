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
