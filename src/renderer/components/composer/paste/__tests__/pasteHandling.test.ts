import { COMPOSER_FILE_KIND, FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LONG_TEXT_PASTE_THRESHOLD } from '../../composerPaste'
import pasteHandling from '../pasteHandling'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      verbose: vi.fn()
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

  it('marks long pasted text files with the pasted-text composer kind', async () => {
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

    const handled = await pasteHandling.handlePaste(event, [], setFiles, undefined, '', undefined, (key) =>
      key === 'chat.input.pasted_text_file_name' ? 'pasted text.txt' : key
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
        origin_name: 'pasted text.txt',
        ext: selectedFile.ext,
        size: selectedFile.size,
        type: selectedFile.type,
        composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
      }
    ])
    expect(files[0]?.fileTokenSourceId).not.toBe(selectedFile.id)
  })

  it('leaves short pasted text untouched', async () => {
    const clipboardText = 'x'.repeat(LONG_TEXT_PASTE_THRESHOLD)
    const preventDefault = vi.fn()
    const setFiles = vi.fn()
    const event = {
      preventDefault,
      clipboardData: {
        getData: (type: string) => (type === 'text' ? clipboardText : ''),
        files: []
      }
    } as unknown as ClipboardEvent

    const handled = await pasteHandling.handlePaste(event, [], setFiles, undefined, '')

    expect(handled).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(setFiles).not.toHaveBeenCalled()
  })

  describe('handler registration and lifecycle', () => {
    it('registers a handler and allows manual unregistration', () => {
      const handler = vi.fn().mockResolvedValue(true)

      pasteHandling.init()

      // register
      pasteHandling.registerHandler('inputbar', handler)

      // verify registration
      const event = new Event('paste') as ClipboardEvent
      document.dispatchEvent(event)
      expect(handler).toHaveBeenCalled()

      // unregister via unregisterHandler (matching reference)
      pasteHandling.unregisterHandler('inputbar', handler)

      // verify unregistration
      handler.mockClear()
      document.dispatchEvent(event)
      expect(handler).not.toHaveBeenCalled()
    })

    it('does not unregister if a different handler was registered in the meantime', () => {
      const handler1 = vi.fn().mockResolvedValue(true)
      const handler2 = vi.fn().mockResolvedValue(true)

      pasteHandling.init()

      // register handler1, then handler2 on the same component key
      const cleanup1 = pasteHandling.registerHandler('inputbar', handler1)
      const cleanup2 = pasteHandling.registerHandler('inputbar', handler2)

      // calling cleanup1 should NOT remove handler2 because references differ
      cleanup1()

      const event = new Event('paste') as ClipboardEvent
      document.dispatchEvent(event)
      expect(handler2).toHaveBeenCalled()
      expect(handler1).not.toHaveBeenCalled()

      // calling cleanup2 should successfully remove handler2
      cleanup2()
      handler2.mockClear()
      document.dispatchEvent(event)
      expect(handler2).not.toHaveBeenCalled()
    })

    it('prevents unregisterHandler from removing a newer handler if reference is supplied', () => {
      const handler1 = vi.fn().mockResolvedValue(true)
      const handler2 = vi.fn().mockResolvedValue(true)

      pasteHandling.init()

      pasteHandling.registerHandler('inputbar', handler1)
      pasteHandling.registerHandler('inputbar', handler2)

      // unregisterHandler with handler1 should be ignored since current handler is handler2
      pasteHandling.unregisterHandler('inputbar', handler1)

      const event = new Event('paste') as ClipboardEvent
      document.dispatchEvent(event)
      expect(handler2).toHaveBeenCalled()
    })
  })
})
