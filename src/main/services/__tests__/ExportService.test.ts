import * as fs from 'fs'
import { pathToFileURL } from 'node:url'
import * as os from 'os'
import * as path from 'path'

import AdmZip from 'adm-zip'
import type * as Docx from 'docx'
import { dialog } from 'electron'
import { fileTypeFromBuffer } from 'file-type'
import MarkdownIt from 'markdown-it'
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
      const stat = vi.spyOn(fs.promises, 'stat')
      const readFile = vi.spyOn(fs.promises, 'readFile')
      const toBuffer = vi.fn()
      const markdownItCtor = vi.fn()
      vi.doMock('docx', () => ({ Document: vi.fn(), Packer: { toBuffer } }))
      vi.doMock('markdown-it', () => ({ default: markdownItCtor }))
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      const service = await freshService()
      await expect(service.exportToWord('# Title ![image](file:///missing.png)', 'doc.docx')).resolves.toBe(false)

      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
      expect(markdownItCtor).not.toHaveBeenCalled()
      expect(toBuffer).not.toHaveBeenCalled()
      expect(stat).not.toHaveBeenCalled()
      expect(readFile).not.toHaveBeenCalled()
    })
  })

  // A parented native dialog avoids the unparented-save crash with Unicode file
  // names on Windows; the Unicode defaultPath must reach the dialog verbatim.
  describe('dialog parenting (Unicode file names)', () => {
    const senderId = 'main-1'

    async function serviceWithWindow(ownerWindow: unknown) {
      const service = await freshService()
      const { application } = await import('@application')
      const windowManager = vi.mocked(application.get)('WindowManager') as unknown as {
        getWindow: ReturnType<typeof vi.fn>
      }
      vi.mocked(windowManager.getWindow).mockReturnValue(ownerWindow)
      return { service, windowManager }
    }

    it('parents the save dialog to the caller window, keeping a Unicode file name', async () => {
      const ownerWindow = { id: 'owner-window', isDestroyed: () => false }
      const { service, windowManager } = await serviceWithWindow(ownerWindow)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await service.exportToWord('# Title', '测试-笔记.docx', senderId)

      expect(windowManager.getWindow).toHaveBeenCalledWith(senderId)
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        ownerWindow,
        expect.objectContaining({ defaultPath: '测试-笔记.docx' })
      )
    })

    it('falls back to an unparented dialog when the caller window is gone', async () => {
      const { service, windowManager } = await serviceWithWindow(undefined)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await service.exportToWord('# Title', '测试-笔记.docx', null)

      expect(windowManager.getWindow).not.toHaveBeenCalled()
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '测试-笔记.docx' }))
    })

    it('falls back to an unparented dialog when the caller window is destroyed', async () => {
      const { service } = await serviceWithWindow({ id: 'owner-window', isDestroyed: () => true })
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await service.exportToWord('# Title', '测试-笔记.docx', senderId)

      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
      expect(vi.mocked(dialog.showSaveDialog).mock.calls[0]).toHaveLength(1)
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '测试-笔记.docx' }))
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
      await expect(service.exportToWord('# Title\n\nBody paragraph', 'doc.docx')).resolves.toBe(true)

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

    describe('embedded images', () => {
      let imageDir: string
      const maxBytes = 10 * 1024 * 1024

      beforeEach(() => {
        imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-word-images-'))
      })

      afterEach(() => {
        fs.rmSync(imageDir, { recursive: true, force: true })
        vi.doUnmock('@main/utils/image')
      })

      async function imageBytes(
        format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png',
        width = 120,
        height = 80,
        color = 'red'
      ) {
        const sharp = (await import('sharp')).default
        return sharp({ create: { width, height, channels: 3, background: color } })
          .toFormat(format)
          .toBuffer()
      }

      function imageFile(bytes: Uint8Array, name = 'image.png') {
        const file = path.join(imageDir, name)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, bytes)
        return file
      }

      async function exportImages(markdown: string) {
        vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
        await (await freshService()).exportToWord(markdown, 'doc.docx')
        const zip = new AdmZip(tmpFile)
        const xml = zip.readAsText('word/document.xml')
        const rels = zip.readAsText('word/_rels/document.xml.rels')
        expect(xml).not.toContain('r:link=')
        const relationships = rels.match(/<Relationship\s[^>]+\/>/g) ?? []
        const mediaEntries = [...xml.matchAll(/<a:blip r:embed="([^"]+)"/g)].map((match) => {
          const rel = relationships.find((value) => value.includes(`Id="${match[1]}"`))
          expect(rel).toContain('/image"')
          expect(rel).not.toContain('TargetMode="External"')
          const target = rel?.match(/Target="([^"]+)"/)?.[1]
          expect(target).toBeDefined()
          const entry = zip.getEntry(path.posix.join('word', target!))
          expect(entry?.entryName).toMatch(/^word\/media\//)
          return entry!
        })
        const media = mediaEntries.map((entry) => entry.getData())
        for (const [index, bytes] of media.entries()) {
          const detected = await fileTypeFromBuffer(bytes)
          const extension = path.posix.extname(mediaEntries[index].entryName).slice(1)
          expect(extension).toBe(detected?.ext)
          expect(zip.readAsText('[Content_Types].xml')).toContain(
            `ContentType="${detected?.mime}" Extension="${extension}"`
          )
        }
        const imageRelationships = relationships.filter((value) => value.includes('/image"'))
        expect(imageRelationships.every((value) => !value.includes('TargetMode="External"'))).toBe(true)
        return { zip, xml, rels, media }
      }

      it.each(['png', 'jpeg'] as const)(
        'embeds unchanged %s bytes from file URLs and absolute paths in source order',
        async (format) => {
          const bytes = await imageBytes(format)
          const file = imageFile(bytes, `空 格%25.${format}`)
          const { xml, media, rels } = await exportImages(
            `before ![url](<${pathToFileURL(file).href}>) middle ![path](<${file}>) after`
          )
          expect(media).toEqual([bytes, bytes])
          expect(rels).not.toContain('TargetMode="External"')
          expect(xml.match(/<wp:extent cx="1143000" cy="762000"\/>/g)).toHaveLength(2)
          expect(
            [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:drawing>/g)].map((match) => match[1] ?? 'drawing')
          ).toEqual(['before ', 'drawing', ' middle ', 'drawing', ' after'])
        }
      )

      it('scales a wide image to 600 pixels without changing the embedded bytes', async () => {
        const bytes = await imageBytes('png', 1200, 800)
        const { xml, media } = await exportImages(`![](${pathToFileURL(imageFile(bytes)).href})`)
        expect(media).toEqual([bytes])
        expect(xml).toContain('<wp:extent cx="5715000" cy="3810000"/>')
      })

      it('transcodes a WebP data URI to decodable PNG with the original dimensions and pixels', async () => {
        const bytes = await imageBytes('webp')
        const { xml, media } = await exportImages(`![webp](data:image/webp;base64,${bytes.toString('base64')})`)
        expect(media).toHaveLength(1)
        expect((await fileTypeFromBuffer(media[0]))?.mime).toBe('image/png')
        const sharp = (await import('sharp')).default
        expect(await sharp(media[0]).metadata()).toMatchObject({ width: 120, height: 80 })
        expect(await sharp(media[0]).raw().toBuffer()).toEqual(await sharp(bytes).raw().toBuffer())
        expect(xml).toContain('<wp:extent cx="1143000" cy="762000"/>')
      })

      it('embeds unchanged GIF data and percent-encoded PNG data', async () => {
        const gif = await imageBytes('gif')
        const png = await imageBytes()
        const percentData = [...png].map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')
        const { media } = await exportImages(
          `![gif](data:image/gif;base64,${gif.toString('base64')}) ![png](data:image/png,${percentData})`
        )
        expect(media).toEqual([gif, png])
      })

      it('keeps images and formatting in headings, quotes, nested lists, table headers and table bodies', async () => {
        const bytes = await imageBytes()
        const image = `![alt](${pathToFileURL(imageFile(bytes)).href})`
        const { xml, media } = await exportImages(
          [
            `# head **bold** ${image} ~~gone~~`,
            `> quote *italic* ${image}`,
            `- bullet ${image}\n  1. nested ${image}`,
            `| header **bold** ${image} | other |\n| --- | --- |\n| body ${image} | cell |`
          ].join('\n\n')
        )
        expect(media).toEqual(Array.from({ length: 6 }, () => bytes))
        const paragraphs = xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
        const paragraphWith = (text: string) =>
          paragraphs.find((paragraph) => textsOf(paragraph).join('').includes(text))!
        for (const label of ['head', 'quote', 'bullet', 'nested', 'header', 'body']) {
          expect(paragraphWith(label)).toContain('<w:drawing>')
        }
        expect(paragraphWith('head')).toContain('<w:pStyle w:val="Heading1"/>')
        expect(paragraphWith('head')).toContain('<w:b/>')
        expect(paragraphWith('head')).toContain('<w:strike/>')
        expect(paragraphWith('quote')).toContain('<w:pBdr>')
        expect(paragraphWith('quote')).toContain('<w:i/>')
        expect(paragraphWith('bullet')).toContain('<w:ind w:left="720"')
        expect(paragraphWith('nested')).toContain('<w:ind w:left="1440"')
        const cells = xml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []
        expect(cells.filter((cell) => cell.includes('<w:drawing>'))).toHaveLength(2)
        expect(cells[0]).toContain('<w:b/>')
        expect(xml).toContain('<w:tblBorders>')
      })

      it('keeps an embedded image between formatted text runs inside one external hyperlink', async () => {
        const bytes = await imageBytes()
        const { xml, media, rels } = await exportImages(
          `[before **bold** ![alt](${pathToFileURL(imageFile(bytes)).href}) after](https://example.com) tail`
        )
        expect(media).toEqual([bytes])
        const hyperlinks = xml.match(/<w:hyperlink[^>]*>[\s\S]*?<\/w:hyperlink>/g) ?? []
        expect(hyperlinks).toHaveLength(1)
        const [hyperlink = ''] = hyperlinks
        expect(
          [...hyperlink.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:drawing>/g)].map((match) => match[1] ?? 'drawing')
        ).toEqual(['before ', 'bold', ' ', 'drawing', ' after'])
        expect(hyperlink).toContain('<w:b/>')
        expect(textsOf(xml.replace(hyperlink, ''))).toEqual([' tail'])
        expect(rels).toContain('Target="https://example.com" TargetMode="External"')
      })

      it('embeds a reference-style local image', async () => {
        const bytes = await imageBytes()
        const { media, xml } = await exportImages(
          `before ![reference][img] after\n\n[img]: ${pathToFileURL(imageFile(bytes)).href}`
        )
        expect(media).toEqual([bytes])
        expect(textsOf(xml)).toEqual(['before ', ' after'])
      })

      it('does not confuse different images with the same basename in different source directories', async () => {
        const red = await imageBytes('png', 120, 80, 'red')
        const blue = await imageBytes('png', 120, 80, 'blue')
        const first = imageFile(red, 'first/image.png')
        const second = imageFile(blue, 'second/image.png')
        const { media } = await exportImages(
          `![red](${pathToFileURL(first).href}) ![blue](${pathToFileURL(second).href})`
        )
        expect(media).toEqual([red, blue])
      })

      it('keeps good images while missing, corrupt, oversized and non-image files fall back to alt', async () => {
        const bytes = await imageBytes()
        const corrupt = Buffer.from(bytes)
        for (let offset = 8; offset < corrupt.length;) {
          const length = corrupt.readUInt32BE(offset)
          if (corrupt.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
            corrupt.fill(0, offset + 8, offset + 8 + length)
          }
          offset += length + 12
        }
        const sharp = (await import('sharp')).default
        expect(await sharp(corrupt).metadata()).toMatchObject({ width: 120, height: 80 })
        await expect(sharp(corrupt).stats()).rejects.toThrow()
        const files = [
          ['good', imageFile(bytes)],
          ['missing', path.join(imageDir, 'missing.png')],
          ['corrupt', imageFile(corrupt, 'corrupt.png')],
          ['large', imageFile(Buffer.alloc(maxBytes + 1), 'large.png')],
          ['unknown', imageFile(Buffer.from('not an image'), 'unknown.png')],
          ['directory', imageDir]
        ]
        const { media, xml } = await exportImages(
          `${files.map(([alt, file]) => `![${alt}](<${pathToFileURL(file).href}>)`).join(' ')}\n\nafter`
        )
        expect(media).toHaveLength(1)
        expect(media[0].equals(bytes)).toBe(true)
        expect(textsOf(xml).filter((text) => text.trim())).toEqual([
          'missing',
          'corrupt',
          'large',
          'unknown',
          'directory',
          'after'
        ])
      })

      it.each(['file', 'data'] as const)(
        'allows exactly 10 MiB and rejects 10 MiB plus one byte for %s inputs',
        async (source) => {
          const bytes = await imageBytes()
          const atLimit = Buffer.concat([bytes, Buffer.alloc(maxBytes - bytes.length)])
          const overLimit = Buffer.concat([atLimit, Buffer.from([0])])
          const src = (buffer: Buffer, name: string) =>
            source === 'file'
              ? pathToFileURL(imageFile(buffer, name)).href
              : `data:image/png;base64,${buffer.toString('base64')}`
          const { media, xml } = await exportImages(
            `![accepted](${src(atLimit, 'limit.png')}) ![rejected](${src(overLimit, 'over.png')})`
          )
          expect(media).toHaveLength(1)
          expect(media[0].equals(atLimit)).toBe(true)
          expect(textsOf(xml)).toEqual([' ', 'rejected'])
        }
      )

      it('does not read a file rejected by stat and rechecks bytes after reading', async () => {
        const bytes = await imageBytes()
        const large = imageFile(Buffer.alloc(maxBytes + 1), 'large.png')
        const growing = imageFile(bytes, 'growing.png')
        const read = fs.promises.readFile.bind(fs.promises)
        const readFile = vi.spyOn(fs.promises, 'readFile').mockImplementation(((file, ...args) => {
          if (file === large) throw new Error('must not read oversized file')
          if (file === growing) return Promise.resolve(Buffer.alloc(maxBytes + 1))
          return read(file, ...args)
        }) as typeof fs.promises.readFile)
        const { media, xml } = await exportImages(
          `![large](${pathToFileURL(large).href}) ![growing](${pathToFileURL(growing).href}) after`
        )
        expect(media).toHaveLength(0)
        expect(textsOf(xml)).toEqual(['large', ' ', 'growing', ' after'])
        expect(readFile.mock.calls.some(([file]) => file === large)).toBe(false)
      })

      it('rejects final embedded bytes above 10 MiB after transcoding', async () => {
        const bytes = await imageBytes('webp')
        const png = await imageBytes()
        vi.doMock('@main/utils/image', () => ({
          transcodeToPng: async () => Buffer.concat([png, Buffer.alloc(maxBytes + 1)])
        }))
        const { media, xml } = await exportImages(
          `![large-output](data:image/webp;base64,${bytes.toString('base64')}) after`
        )
        expect(media).toHaveLength(0)
        expect(textsOf(xml)).toEqual(['large-output', ' after'])
      })

      it('rejects remote, relative, cherry-media, SVG and malformed image data sources', async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"/>')
        const sources = [
          'http://example.com/image.png',
          'https://example.com/image.png',
          'assets/a.png',
          'x.png',
          'cherry-media://image/id',
          pathToFileURL(imageFile(svg, 'image.svg')).href,
          `data:image/svg+xml;base64,${svg.toString('base64')}`,
          'data:image/png;base64,%%%'
        ]
        const { media, xml, rels } = await exportImages(sources.map((src, i) => `![alt${i}](${src})`).join(' '))
        expect(media).toEqual([])
        expect(textsOf(xml).filter((text) => text.trim())).toEqual(sources.map((_src, i) => `alt${i}`))
        expect(rels).not.toContain('TargetMode="External"')
      })

      it('keeps unsafe links rejected when the document also contains an embedded image', async () => {
        const bytes = await imageBytes()
        const unsafe =
          '![script](javascript:alert%281%29) [script](vbscript:alert) ![text](data:text/plain;base64,QQ==)'
        const { media, xml, rels } = await exportImages(
          `![good](data:image/png;base64,${bytes.toString('base64')}) ${unsafe}`
        )
        expect(media).toEqual([bytes])
        expect(textsOf(xml).join('')).toBe(` ${unsafe}`)
        expect(xml).not.toContain('<w:hyperlink')
        expect(rels).not.toContain('TargetMode="External"')
      })

      it.each([
        String.raw`file://C:\kb\空 格%25.png`,
        String.raw`C:\kb\空 格%25.png`,
        'file:///C:/kb/%E7%A9%BA%20%E6%A0%BC%2525.png'
      ])('normalizes Windows reference %s before Markdown URL encoding', async (src) => {
        const bytes = await imageBytes()
        const expectedPath = process.platform === 'win32' ? String.raw`C:\kb\空 格%25.png` : '/C:/kb/空 格%25.png'
        const read = fs.promises.readFile.bind(fs.promises)
        const stat = fs.promises.stat.bind(fs.promises)
        const fixture = imageFile(bytes)
        vi.spyOn(fs.promises, 'stat').mockImplementation(((file, ...args) =>
          stat(file === expectedPath ? fixture : file, ...args)) as typeof fs.promises.stat)
        vi.spyOn(fs.promises, 'readFile').mockImplementation(((file, ...args) =>
          read(file === expectedPath ? fixture : file, ...args)) as typeof fs.promises.readFile)
        const { media } = await exportImages(`![windows](<${src}>)`)
        expect(media).toEqual([bytes])
      })
    })

    it.each([
      '[file](file:///image.png)',
      '[file][id]\n\n[id]: file:///image.png',
      '[data](data:image/tiff;base64,QQ==)',
      '[data][id]\n\n[id]: data:image/tiff;base64,QQ==',
      '[data](data:image/png;base64,QQ==)',
      '[web](https://example.com)',
      '[script](javascript:alert%281%29)',
      '[script](vbscript:alert)',
      '[data](data:text/plain;base64,QQ==)',
      '![invalid](file:///a b.png)'
    ])('preserves default parsing of image-free document %s', async (markdown) => {
      const tokens = new MarkdownIt().parse(markdown, {})
      const inline = tokens.flatMap((token) => token.children ?? [])
      const expected = inline
        .filter((token) => token.type === 'text' || token.type === 'softbreak')
        .map((token) => (token.type === 'softbreak' ? ' ' : token.content))
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
      await (await freshService()).exportToWord(markdown, 'doc.docx')
      const zip = new AdmZip(tmpFile)
      const xml = zip.readAsText('word/document.xml')
      expect(textsOf(xml)).toEqual(expected)
      const link = inline.find((token) => token.type === 'link_open')
      expect(xml.match(/<w:hyperlink\s/g) ?? []).toHaveLength(link ? 1 : 0)
      if (link) expect(zip.readAsText('word/_rels/document.xml.rels')).toContain(`Target="${link.attrGet('href')}"`)
      expect(zip.getEntries().filter((entry) => entry.entryName.startsWith('word/media/'))).toEqual([])
    })

    it('still rejects packing failures', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
      vi.doMock('docx', async (importOriginal) => {
        const actual = await importOriginal<typeof Docx>()
        return {
          ...actual,
          Packer: {
            toBuffer: async () => {
              throw new Error('packing failed')
            }
          }
        }
      })
      await expect((await freshService()).exportToWord('body', 'doc.docx')).rejects.toThrow('packing failed')
      expect(fs.existsSync(tmpFile)).toBe(false)
    })

    it('still rejects destination write failures', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
      vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('write failed'))
      await expect((await freshService()).exportToWord('body', 'doc.docx')).rejects.toThrow('write failed')
      expect(fs.existsSync(tmpFile)).toBe(false)
    })

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
    it('falls back to image alt text when a relative path cannot be located', async () => {
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
