import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preflightKnowledgeFile, preflightKnowledgePaths } from '../filePreflight'

let directory: string
const config = vi.fn()
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'knowledge-preflight-'))
  MockApplicationUtils.setService('FileProcessingService', { getDocumentPreflightConfig: config })
  config.mockReset()
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
  MockApplicationUtils.resetServices()
})
async function pdf(name: string, texts: string[]) {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (const text of texts) {
    const page = document.addPage()
    if (text) page.drawText(text, { x: 20, y: 40, font })
  }
  const path = join(directory, name)
  await writeFile(path, await document.save())
  return path
}

describe('knowledge file admission', () => {
  it('rejects unsupported and inaccessible files before import', async () => {
    expect((await preflightKnowledgeFile(join(directory, 'script.exe'))).reason).toBe('unsupported_format')
    expect((await preflightKnowledgeFile(join(directory, 'missing.pdf'))).reason).toBe('unreadable_file')
  })
  it('accepts a text PDF but blocks a blank or mixed PDF without a document processor', async () => {
    const text = await pdf('text.pdf', ['A searchable document'])
    const blank = await pdf('scan.pdf', [''])
    const mixed = await pdf('mixed.pdf', ['A searchable first page', ''])
    expect(await preflightKnowledgeFile(text)).toMatchObject({ reason: 'ok', processor: 'pdf', pageCount: 1 })
    expect(await preflightKnowledgeFile(blank)).toMatchObject({ reason: 'ocr_required', pageCount: 1 })
    expect(await preflightKnowledgeFile(mixed)).toMatchObject({ reason: 'ocr_required', pageCount: 2 })
  })
  it('reports selected processor requirements and limits without creating a paid task', async () => {
    const path = await pdf('scan.pdf', [''])
    config.mockImplementation(() => {
      throw new Error('No credentials')
    })
    expect(await preflightKnowledgeFile(path, 'mineru')).toMatchObject({
      reason: 'processor_not_configured',
      processor: 'mineru'
    })
    const size = (await readFile(path)).length
    config.mockReturnValue({ maxInputBytes: size })
    expect((await preflightKnowledgeFile(path, 'mineru')).reason).toBe('size_limit')
    config.mockReturnValue({ maxInputPages: 1 })
    expect(await preflightKnowledgeFile(path, 'mineru')).toMatchObject({ reason: 'ok', pageCount: 1, maxInputPages: 1 })
    const two = await pdf('two.pdf', ['', ''])
    expect((await preflightKnowledgeFile(two, 'mineru')).reason).toBe('page_limit')
  })
  it('does not send Office documents through the PDF processor', async () => {
    const path = join(directory, 'slides.PPTX')
    await writeFile(path, 'Office fixture, reader output is checked separately')
    config.mockImplementation(() => {
      throw new Error('Unconfigured PDF processor')
    })
    expect(await preflightKnowledgeFile(path, 'mineru')).toMatchObject({ reason: 'ok', processor: 'anydoc' })
  })
  it('inspects nested folder PDFs before a directory can start copying', async () => {
    const nested = join(directory, 'nested')
    await mkdir(nested)
    const scan = await pdf('scanned.pdf', [''])
    await writeFile(join(nested, 'scanned.pdf'), await readFile(scan))
    await writeFile(join(nested, 'readme.md'), 'Supported markdown')
    await writeFile(join(nested, 'binary.exe'), 'Unsupported executable')
    const results = await preflightKnowledgePaths([nested])
    expect(results.find((file) => file.path.endsWith('scanned.pdf'))?.reason).toBe('ocr_required')
    expect(results.find((file) => file.path.endsWith('readme.md'))?.reason).toBe('ok')
    expect(results.find((file) => file.path.endsWith('binary.exe'))?.reason).toBe('unsupported_format')
  })

  it('rejects corrupt PDFs with an inspectable reason rather than accepting a failed read', async () => {
    const path = join(directory, 'corrupt.pdf')
    await writeFile(path, 'not a PDF')
    expect((await preflightKnowledgeFile(path)).reason).toBe('unreadable_file')
  })
})
