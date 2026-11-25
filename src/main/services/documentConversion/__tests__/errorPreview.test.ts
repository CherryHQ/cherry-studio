import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { printService } from '../../PrintService'
import { convertDocumentBundle } from '../convertDocument'
import { saveDocument } from '../saveDocument'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

let root: string
let filePath: string
let outputPath: string
const draft = `Unsaved draft\n${'Latest content '.repeat(400)}`
const markdown = '# Inline document'

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'document-error-preview-'))
  filePath = path.join(root, 'report.md')
  outputPath = path.join(root, 'existing.docx')
  await writeFile(filePath, 'Saved content')
  await writeFile(outputPath, 'Existing output')
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: outputPath })
  vi.spyOn(application, 'getPath').mockImplementation((_key, filename) => path.join(root, filename ?? ''))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

function source(kind: 'inline' | 'draft' | 'file') {
  if (kind === 'inline') return { input: { markdown, draft }, preview: markdown }
  if (kind === 'draft') return { input: { filePath, draft }, preview: draft.slice(0, 4000) }
  return { input: { filePath }, preview: filePath }
}

describe('document conversion error previews', () => {
  it.each(['inline', 'draft', 'file'] as const)(
    'identifies the effective %s input when printing fails',
    async (kind) => {
      vi.spyOn(printService, 'toDocumentPdfBuffer').mockRejectedValue(new Error('Printer unavailable'))
      const { input, preview } = source(kind)
      await expect(convertDocumentBundle({ ...input, format: 'pdf' })).rejects.toMatchObject({
        code: 'CONVERSION_FAILED',
        message: 'Printer unavailable',
        preview
      })
    }
  )

  it.each(['inline', 'draft', 'file'] as const)('identifies the effective %s input when saving fails', async (kind) => {
    const { input, preview } = source(kind)
    await expect(saveDocument({ ...input, format: 'docx', defaultName: 'report' })).rejects.toMatchObject({
      code: 'TARGET_EXISTS',
      preview
    })
    expect(await readFile(outputPath, 'utf8')).toBe('Existing output')
  })

  it('preserves the parser-specific table excerpt through conversion and saving', async () => {
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |'
    const input = { filePath, draft: `Introductory text\n\n${table}`, format: 'xlsx' as const }
    await expect(convertDocumentBundle(input)).rejects.toMatchObject({ code: 'INVALID_TABLE', preview: table })
    await expect(saveDocument({ ...input, defaultName: 'report' })).rejects.toMatchObject({
      code: 'INVALID_TABLE',
      preview: table
    })
  })
})
