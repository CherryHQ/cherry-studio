import { LONG_TEXT_PASTE_THRESHOLD } from '@renderer/config/constant'
import { COMPOSER_FILE_KIND, FILE_TYPE, type FileMetadata } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import pasteHandling from '../pasteHandling'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

describe('pasteHandling', () => {
  const selectedFile: FileMetadata = {
    id: 'file-1',
    name: 'pasted_text.txt',
    origin_name: 'pasted_text.txt',
    path: '/tmp/pasted_text.txt',
    size: 2048,
    ext: '.txt',
    type: FILE_TYPE.TEXT,
    created_at: '2026-06-08T00:00:00.000Z',
    count: 1
  }

  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          createTempFile: vi.fn().mockResolvedValue('/tmp/pasted_text.txt'),
          get: vi.fn().mockResolvedValue(selectedFile),
          write: vi.fn()
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        info: vi.fn()
      }
    })
  })

  it('marks long pasted text files with the pasted-text composer kind when the preference is enabled', async () => {
    const clipboardText = 'x'.repeat(LONG_TEXT_PASTE_THRESHOLD + 1)
    const preventDefault = vi.fn()
    let files: ComposerAttachment[] = []
    const setFiles = vi.fn((updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => {
      files = updater(files)
    })
    const event = {
      preventDefault,
      clipboardData: {
        getData: (type: string) => (type === 'text' ? clipboardText : ''),
        files: []
      }
    } as unknown as ClipboardEvent

    const handled = await pasteHandling.handlePaste(
      event,
      [],
      setFiles,
      undefined,
      true,
      LONG_TEXT_PASTE_THRESHOLD,
      '',
      undefined,
      (key) => (key === 'chat.input.pasted_text_file_name' ? '已粘贴的文本.txt' : key)
    )

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(window.api.file.createTempFile).toHaveBeenCalledWith('pasted_text.txt')
    expect(window.api.file.write).toHaveBeenCalledWith('/tmp/pasted_text.txt', clipboardText)
    expect(files).toEqual([
      {
        fileTokenSourceId: expect.any(String),
        path: selectedFile.path,
        name: selectedFile.name,
        origin_name: '已粘贴的文本.txt',
        ext: selectedFile.ext,
        size: selectedFile.size,
        type: selectedFile.type,
        composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
      }
    ])
    expect(files[0]?.fileTokenSourceId).not.toBe(selectedFile.id)
  })

  it('leaves long pasted text untouched when the preference is disabled', async () => {
    const clipboardText = 'x'.repeat(LONG_TEXT_PASTE_THRESHOLD + 1)
    const preventDefault = vi.fn()
    const setFiles = vi.fn()
    const event = {
      preventDefault,
      clipboardData: {
        getData: (type: string) => (type === 'text' ? clipboardText : ''),
        files: []
      }
    } as unknown as ClipboardEvent

    const handled = await pasteHandling.handlePaste(
      event,
      [],
      setFiles,
      undefined,
      false,
      LONG_TEXT_PASTE_THRESHOLD,
      ''
    )

    expect(handled).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(setFiles).not.toHaveBeenCalled()
  })
})
