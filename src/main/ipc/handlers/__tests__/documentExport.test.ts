import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { dialog } from 'electron'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exportHandlers } from '../export'

const ctx = { senderId: 'main' }
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'document-save-'))
})

afterEach(async () => {
  vi.clearAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('document export IPC', () => {
  it('cancels without converting invalid content or writing a file', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })
    await expect(
      exportHandlers['export.document.convert_and_save']({ markdown: '', format: 'docx', defaultName: 'Report' }, ctx)
    ).resolves.toBeNull()
    expect(await readdir(directory)).toEqual([])
  })

  it('writes the actual Office file to exactly the selected destination and returns its identity', async () => {
    const target = path.join(directory, 'report')
    const other = `${target}.docx`
    await writeFile(other, 'must not overwrite an unconfirmed target')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target })
    const result = await exportHandlers['export.document.convert_and_save'](
      { markdown: '# Exported report', format: 'docx', defaultName: 'Report' },
      ctx
    )
    expect(result).toMatchObject({
      path: target,
      format: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
    const zip = await JSZip.loadAsync(await readFile(target))
    expect(await zip.file('word/document.xml')!.async('string')).toContain('Exported report')
    expect(await readFile(other, 'utf8')).toBe('must not overwrite an unconfirmed target')
    expect((await readdir(directory)).sort()).toEqual(['report', 'report.docx'])
  })

  it('returns a structured preview and preserves the selected original file if conversion fails', async () => {
    const target = path.join(directory, 'report.xlsx')
    await writeFile(target, 'original')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target })
    await expect(
      exportHandlers['export.document.convert_and_save'](
        {
          markdown: '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',
          format: 'xlsx',
          defaultName: 'Report'
        },
        ctx
      )
    ).rejects.toMatchObject({ code: 'INVALID_TABLE', data: { preview: expect.stringContaining('| 1 | 2 | 3 |') } })
    expect(await readFile(target, 'utf8')).toBe('original')
    expect(await readdir(directory)).toEqual(['report.xlsx'])
  })

  it('cleans up converted bytes and preserves existing contents when the destination cannot be replaced', async () => {
    const target = path.join(directory, 'report.docx')
    await mkdir(target)
    await writeFile(path.join(target, 'original.txt'), 'original')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target })

    await expect(
      exportHandlers['export.document.convert_and_save'](
        { markdown: '# Exported report', format: 'docx', defaultName: 'Report' },
        ctx
      )
    ).rejects.toMatchObject({ code: 'DOCUMENT_SAVE_FAILED', data: { preview: '# Exported report' } })

    expect(await readFile(path.join(target, 'original.txt'), 'utf8')).toBe('original')
    expect(await readdir(directory)).toEqual(['report.docx'])
  })
})
