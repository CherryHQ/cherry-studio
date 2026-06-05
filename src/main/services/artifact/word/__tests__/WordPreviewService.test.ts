import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { WORD_PREVIEW_MAX_SIZE_BYTES } from '@shared/types/wordPreview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readWordPreview } from '../WordPreviewService'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

let tempDir: string

const writeWorkspaceFile = async (relativePath: string, data: string | Uint8Array): Promise<void> => {
  const filePath = path.join(tempDir, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, data)
}

describe('WordPreviewService', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'cherry-word-preview-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('reads docx bytes from a workspace-relative path', async () => {
    await writeWorkspaceFile('docs/proposal.docx', new Uint8Array([1, 2, 3]))

    const result = await readWordPreview({
      filePath: 'docs/proposal.docx',
      workspacePath: tempDir
    })

    expect(result).toEqual({
      data: new Uint8Array([1, 2, 3]),
      success: true
    })
  })

  it('rejects paths that escape the workspace with parent segments', async () => {
    const outsidePath = path.join(path.dirname(tempDir), 'outside.docx')
    await writeFile(outsidePath, 'outside')

    const result = await readWordPreview({
      filePath: '../outside.docx',
      workspacePath: tempDir
    })

    expect(result).toMatchObject({
      error: { code: 'invalid_word_preview_request' },
      success: false
    })
  })

  it('rejects workspace symlinks that resolve outside the workspace', async () => {
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'cherry-word-preview-outside-'))
    try {
      await writeFile(path.join(outsideDir, 'outside.docx'), 'outside')
      await symlink(path.join(outsideDir, 'outside.docx'), path.join(tempDir, 'link.docx'))

      const result = await readWordPreview({
        filePath: 'link.docx',
        workspacePath: tempDir
      })

      expect(result).toMatchObject({
        error: { code: 'invalid_word_preview_request' },
        success: false
      })
    } finally {
      await rm(outsideDir, { force: true, recursive: true })
    }
  })

  it('rejects unsupported Word preview extensions', async () => {
    await writeWorkspaceFile('notes.txt', 'hello')

    const result = await readWordPreview({
      filePath: 'notes.txt',
      workspacePath: tempDir
    })

    expect(result).toMatchObject({
      error: { code: 'unsupported_word_extension' },
      success: false
    })
  })

  it('rejects docx paths that are not files', async () => {
    await mkdir(path.join(tempDir, 'folder.docx'))

    const result = await readWordPreview({
      filePath: 'folder.docx',
      workspacePath: tempDir
    })

    expect(result).toMatchObject({
      error: { code: 'invalid_word_preview_request' },
      success: false
    })
  })

  it('returns read_failed when the workspace cannot be resolved', async () => {
    const result = await readWordPreview({
      filePath: 'missing.docx',
      workspacePath: path.join(tempDir, 'missing-workspace')
    })

    expect(result).toMatchObject({
      error: { code: 'word_read_failed' },
      success: false
    })
  })

  it('rejects docx files above the Word preview size cap', async () => {
    await writeWorkspaceFile('large.docx', new Uint8Array(WORD_PREVIEW_MAX_SIZE_BYTES + 1))

    const result = await readWordPreview({
      filePath: 'large.docx',
      workspacePath: tempDir
    })

    expect(result).toMatchObject({
      error: { code: 'word_file_too_large' },
      success: false
    })
  })
})
