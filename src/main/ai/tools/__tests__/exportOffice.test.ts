import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import * as XLSX from '@e965/xlsx'
import * as fileUtils from '@main/utils/file'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as assistantFileSafety from '../assistantFileSafety'
import { exportOfficeArtifact, exportOfficeInputSchema } from '../exportOffice'

const signal = new AbortController().signal
const execFileAsync = promisify(execFile)
const CHERRY_PPT_TEMPLATE_DIRECTORY = path.resolve(
  __dirname,
  '../../../../../resources/builtin-agents/cherry-assistant/.claude/skills/cherry-ppt/assets/templates'
)

describe('exportOfficeArtifact', () => {
  let workspacePath: string
  let outsidePath: string

  const close = vi.fn()
  const executeJavaScript = vi.fn(async () => undefined)
  const loadURL = vi.fn(async () => undefined)
  const printToPDF = vi.fn(async () => Buffer.from('%PDF-1.7\n'))
  const windowManager = {
    open: vi.fn(() => 'print-window'),
    getWindow: vi.fn(() => ({ loadURL, webContents: { executeJavaScript, printToPDF } })),
    close
  }

  it('limits the input contract to supported conversions and three fields', () => {
    expect(
      exportOfficeInputSchema.parse({
        operation: 'markdown_to_pptx',
        source_path: 'slides.md',
        output_path: 'slides.pptx'
      })
    ).toEqual({ operation: 'markdown_to_pptx', source_path: 'slides.md', output_path: 'slides.pptx' })
    expect(
      exportOfficeInputSchema.parse({
        operation: 'cherry_ppt_to_pptx',
        source_path: 'slides.json',
        output_path: 'slides.pptx'
      })
    ).toEqual({ operation: 'cherry_ppt_to_pptx', source_path: 'slides.json', output_path: 'slides.pptx' })
    expect(
      exportOfficeInputSchema.safeParse({ operation: 'docx_to_pdf', source_path: 'a.docx', output_path: 'a.pdf' })
        .success
    ).toBe(false)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    workspacePath = await mkdtemp(path.join(tmpdir(), 'office-export-workspace-'))
    outsidePath = await mkdtemp(path.join(tmpdir(), 'office-export-outside-'))
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'WindowManager') return windowManager as never
      throw new Error(`Unexpected application.get(${name})`)
    })
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'feature.agents.assistant.cherry_ppt.templates') return CHERRY_PPT_TEMPLATE_DIRECTORY
      throw new Error(`Unexpected application.getPath(${key})`)
    })
  })

  afterEach(async () => {
    await Promise.all([
      rm(workspacePath, { recursive: true, force: true }),
      rm(outsidePath, { recursive: true, force: true })
    ])
  })

  it('exports Markdown to a real DOCX inside the workspace', async () => {
    await writeFile(path.join(workspacePath, 'report.md'), '# Weekly report\n\n- Shipped the release')

    const result = await exportOfficeArtifact(
      workspacePath,
      { operation: 'markdown_to_docx', source_path: 'report.md', output_path: 'report.docx' },
      signal
    )

    expect(result).toEqual({ path: 'report.docx' })
    const output = await readFile(path.join(workspacePath, 'report.docx'))
    expect(output.subarray(0, 2).toString()).toBe('PK')
  })

  it('exports Markdown to PDF without opening a save dialog', async () => {
    await writeFile(path.join(workspacePath, 'brief.md'), '# Meeting brief\n\nDecisions and actions.')

    const result = await exportOfficeArtifact(
      workspacePath,
      { operation: 'markdown_to_pdf', source_path: 'brief.md', output_path: 'brief.pdf' },
      signal
    )

    expect(result).toEqual({ path: 'brief.pdf' })
    expect(await readFile(path.join(workspacePath, 'brief.pdf'), 'utf8')).toBe('%PDF-1.7\n')
    expect(printToPDF).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith('print-window')
  })

  it('exports slide-delimited Markdown to a real PPTX', async () => {
    await writeFile(
      path.join(workspacePath, 'review.md'),
      '# Quarterly review\n\nExecutive update\n\n---\n\n## Results\n\n- **Revenue** grew 12%\n- ![Chart](https://example.com/private.png)'
    )

    const result = await exportOfficeArtifact(
      workspacePath,
      { operation: 'markdown_to_pptx', source_path: 'review.md', output_path: 'review.pptx' },
      signal
    )

    expect(result).toEqual({ path: 'review.pptx' })
    const zip = new StreamZip.async({ file: path.join(workspacePath, 'review.pptx') })
    try {
      const names = Object.keys(await zip.entries())
      expect(names).toContain('ppt/slides/slide1.xml')
      expect(names).toContain('ppt/slides/slide2.xml')
      const resultsSlide = (await zip.entryData('ppt/slides/slide2.xml')).toString()
      expect(resultsSlide).toContain('Revenue')
      expect(resultsSlide).toContain('Chart')
      expect(resultsSlide).not.toContain('**')
      expect(resultsSlide).not.toContain('example.com')
    } finally {
      await zip.close()
    }
  })

  it('exports a Cherry-PPT JSON spec with its bundled template', async () => {
    await writeFile(
      path.join(workspacePath, 'deck.json'),
      JSON.stringify({
        template: 'enterprise-blue',
        slides: [
          {
            layout: 'cover',
            title: 'Cherry-PPT',
            subtitle: 'Brand template',
            author: 'Cherry Studio',
            date: '2026 / 07'
          },
          {
            layout: 'closing',
            title: 'Thank you',
            subtitle: 'Bundled master',
            contact: 'CHERRYAI.COM.CN'
          }
        ]
      })
    )

    const result = await exportOfficeArtifact(
      workspacePath,
      { operation: 'cherry_ppt_to_pptx', source_path: 'deck.json', output_path: 'deck.pptx' },
      signal
    )

    expect(result).toEqual({ path: 'deck.pptx' })
    expect(application.getPath).toHaveBeenCalledWith('feature.agents.assistant.cherry_ppt.templates')
    const zip = new StreamZip.async({ file: path.join(workspacePath, 'deck.pptx') })
    try {
      const slideNames = Object.keys(await zip.entries()).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      expect(slideNames).toHaveLength(2)
      expect((await zip.entryData(slideNames[0])).toString()).toContain('Cherry-PPT')
    } finally {
      await zip.close()
    }
  })

  it('exports CSV to a readable XLSX workbook', async () => {
    await writeFile(path.join(workspacePath, 'sales.csv'), 'Region,Revenue\nNorth,120\nSouth,95\n')

    const result = await exportOfficeArtifact(
      workspacePath,
      { operation: 'csv_to_xlsx', source_path: 'sales.csv', output_path: 'sales.xlsx' },
      signal
    )

    expect(result).toEqual({ path: 'sales.xlsx' })
    const workbook = XLSX.read(await readFile(path.join(workspacePath, 'sales.xlsx')), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
    expect(rows).toEqual([
      ['Region', 'Revenue'],
      ['North', '120'],
      ['South', '95']
    ])
  })

  it('removes a UTF-8 BOM before converting CSV headers to XLSX', async () => {
    await writeFile(path.join(workspacePath, 'sales.csv'), '\uFEFFRegion,Revenue\nNorth,120\n')

    await exportOfficeArtifact(
      workspacePath,
      { operation: 'csv_to_xlsx', source_path: 'sales.csv', output_path: 'sales.xlsx' },
      signal
    )

    const workbook = XLSX.read(await readFile(path.join(workspacePath, 'sales.xlsx')), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
    expect(rows[0]).toEqual(['Region', 'Revenue'])
  })

  it('rejects a non-UTF-8 CSV instead of exporting replacement characters', async () => {
    await writeFile(path.join(workspacePath, 'contacts.csv'), Buffer.from('Name\nCaf\xe9\n', 'latin1'))

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'csv_to_xlsx', source_path: 'contacts.csv', output_path: 'contacts.xlsx' },
        signal
      )
    ).rejects.toThrow(/UTF-8/i)

    await expect(readFile(path.join(workspacePath, 'contacts.xlsx'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a BOM-less UTF-16 CSV instead of exporting NUL-corrupted cells', async () => {
    await writeFile(path.join(workspacePath, 'sales.csv'), Buffer.from('Region,Revenue\nNorth,120\n', 'utf16le'))

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'csv_to_xlsx', source_path: 'sales.csv', output_path: 'sales.xlsx' },
        signal
      )
    ).rejects.toThrow(/UTF-8/i)

    await expect(readFile(path.join(workspacePath, 'sales.xlsx'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not report a committed export as failed when staging cleanup is blocked', async () => {
    await writeFile(path.join(workspacePath, 'sales.csv'), 'Region,Revenue\nNorth,120\n')
    const cleanupError = Object.assign(new Error('staging file is busy'), { code: 'EBUSY' })
    const removeSpy = vi.spyOn(fileUtils, 'remove').mockRejectedValueOnce(cleanupError)

    try {
      await expect(
        exportOfficeArtifact(
          workspacePath,
          { operation: 'csv_to_xlsx', source_path: 'sales.csv', output_path: 'sales.xlsx' },
          signal
        )
      ).resolves.toEqual({ path: 'sales.xlsx' })
    } finally {
      removeSpy.mockRestore()
    }

    expect((await readFile(path.join(workspacePath, 'sales.xlsx'))).subarray(0, 2).toString()).toBe('PK')
  })

  it('rejects source and output paths outside the workspace', async () => {
    const outsideSource = path.join(outsidePath, 'secret.md')
    await writeFile(outsideSource, '# Secret')

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: outsideSource, output_path: 'safe.docx' },
        signal
      )
    ).rejects.toThrow(/outside .*workspace/i)

    await writeFile(path.join(workspacePath, 'safe.md'), '# Safe')
    await expect(
      exportOfficeArtifact(
        workspacePath,
        {
          operation: 'markdown_to_docx',
          source_path: 'safe.md',
          output_path: path.join(outsidePath, 'unsafe.docx')
        },
        signal
      )
    ).rejects.toThrow(/outside .*workspace/i)
  })

  it('rejects an output parent symlink that escapes the workspace', async () => {
    await writeFile(path.join(workspacePath, 'safe.md'), '# Safe')
    await symlink(outsidePath, path.join(workspacePath, 'escaped'))

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'safe.md', output_path: 'escaped/unsafe.docx' },
        signal
      )
    ).rejects.toThrow(/outside .*workspace/i)
  })

  it('does not create external directories when an output ancestor changes after path validation', async () => {
    await writeFile(path.join(workspacePath, 'safe.md'), '# Safe')
    const readSource = assistantFileSafety.readBoundedRegularFile
    const readSpy = vi.spyOn(assistantFileSafety, 'readBoundedRegularFile').mockImplementationOnce(async (...args) => {
      const source = await readSource(...args)
      await symlink(outsidePath, path.join(workspacePath, 'output'))
      return source
    })

    try {
      await expect(
        exportOfficeArtifact(
          workspacePath,
          { operation: 'markdown_to_docx', source_path: 'safe.md', output_path: 'output/nested/unsafe.docx' },
          signal
        )
      ).rejects.toThrow(/outside .*workspace|path changed/i)
    } finally {
      readSpy.mockRestore()
    }

    expect(await readdir(outsidePath)).toEqual([])
  })

  it('rejects when an output directory is replaced by an escaping symlink during rendering', async () => {
    const outputDirectory = path.join(workspacePath, 'output')
    await writeFile(path.join(workspacePath, 'safe.md'), '# Safe')
    await mkdir(outputDirectory)
    printToPDF.mockImplementationOnce(async () => {
      await rm(outputDirectory, { recursive: true, force: true })
      await symlink(outsidePath, outputDirectory)
      return Buffer.from('%PDF-1.7\n')
    })

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_pdf', source_path: 'safe.md', output_path: 'output/unsafe.pdf' },
        signal
      )
    ).rejects.toThrow(/outside .*workspace|path changed/i)

    await expect(readFile(path.join(outsidePath, 'unsafe.pdf'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(workspacePath)).filter((entry) => entry.startsWith('.cherry-office-export-'))).toEqual([])
  })

  it('does not expose export content when the output parent escapes after the final path check', async () => {
    const outputDirectory = path.join(workspacePath, 'output')
    await writeFile(path.join(workspacePath, 'safe.md'), '# Safe')
    await mkdir(outputDirectory)

    const publish = assistantFileSafety.publishFileNoClobber
    const publishSpy = vi.spyOn(assistantFileSafety, 'publishFileNoClobber').mockImplementationOnce(async (...args) => {
      await rm(outputDirectory, { recursive: true, force: true })
      await symlink(outsidePath, outputDirectory)
      const [staged, target, options] = args
      return publish(staged, target, {
        ...options,
        validateTarget: async () => {
          expect(await readFile(path.join(outsidePath, 'unsafe.docx'))).toHaveLength(0)
          await options?.validateTarget?.()
        }
      })
    })

    try {
      await expect(
        exportOfficeArtifact(
          workspacePath,
          { operation: 'markdown_to_docx', source_path: 'safe.md', output_path: 'output/unsafe.docx' },
          signal
        )
      ).rejects.toThrow(/outside .*workspace|path changed/i)
    } finally {
      publishSpy.mockRestore()
    }

    await expect(readFile(path.join(outsidePath, 'unsafe.docx'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects mismatched extensions, missing sources, directories, and existing outputs', async () => {
    await writeFile(path.join(workspacePath, 'report.md'), '# Report')
    await writeFile(path.join(workspacePath, 'existing.docx'), 'keep me')
    await mkdir(path.join(workspacePath, 'folder.md'))

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'report.md', output_path: 'report.pdf' },
        signal
      )
    ).rejects.toThrow(/\.docx/i)
    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'missing.md', output_path: 'missing.docx' },
        signal
      )
    ).rejects.toThrow(/not found/i)
    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'folder.md', output_path: 'folder.docx' },
        signal
      )
    ).rejects.toThrow(/regular file/i)
    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'report.md', output_path: 'existing.docx' },
        signal
      )
    ).rejects.toThrow(/already exists/i)
    expect(await readFile(path.join(workspacePath, 'existing.docx'), 'utf8')).toBe('keep me')
  })

  it('does not create output when the call is already canceled', async () => {
    await writeFile(path.join(workspacePath, 'report.md'), '# Report')
    const controller = new AbortController()
    controller.abort()

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'report.md', output_path: 'report.docx' },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(readFile(path.join(workspacePath, 'report.docx'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not publish or leave staging files when canceled after PDF rendering', async () => {
    const controller = new AbortController()
    await writeFile(path.join(workspacePath, 'report.md'), '# Report')
    printToPDF.mockImplementationOnce(async () => {
      controller.abort()
      return Buffer.from('%PDF-1.7\n')
    })

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_pdf', source_path: 'report.md', output_path: 'report.pdf' },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    await expect(readFile(path.join(workspacePath, 'report.pdf'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(workspacePath)).filter((entry) => entry.startsWith('.cherry-office-export-'))).toEqual([])
  })

  it('allows only one concurrent export to publish the same output path', async () => {
    await writeFile(path.join(workspacePath, 'report.md'), '# Report\n\nQuarterly result')
    const input = { operation: 'markdown_to_docx', source_path: 'report.md', output_path: 'report.docx' } as const

    const results = await Promise.allSettled([
      exportOfficeArtifact(workspacePath, input, signal),
      exportOfficeArtifact(workspacePath, input, signal)
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected?.reason).toEqual(expect.objectContaining({ message: expect.stringMatching(/already exists/i) }))
    expect((await readFile(path.join(workspacePath, 'report.docx'))).subarray(0, 2).toString()).toBe('PK')
    expect((await readdir(workspacePath)).filter((entry) => entry.startsWith('.cherry-office-export-'))).toEqual([])
  })

  it('rejects a source larger than the Office export limit', async () => {
    const sourcePath = path.join(workspacePath, 'large.md')
    await writeFile(sourcePath, '')
    await truncate(sourcePath, 10 * 1024 * 1024 + 1)

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'large.md', output_path: 'large.docx' },
        signal
      )
    ).rejects.toThrow(/read limit/i)
    await expect(readFile(path.join(workspacePath, 'large.docx'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('rejects a FIFO source without blocking', async () => {
    const fifoPath = path.join(workspacePath, 'pipe.md')
    await execFileAsync('mkfifo', [fifoPath])

    await expect(
      exportOfficeArtifact(
        workspacePath,
        { operation: 'markdown_to_docx', source_path: 'pipe.md', output_path: 'pipe.docx' },
        signal
      )
    ).rejects.toThrow(/regular file/i)
  })
})
