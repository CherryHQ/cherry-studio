import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { FILE_TYPE, FileInfoSchema } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../../tests/__mocks__/MainLoggerService'

vi.mock('@main/core/platform', () => ({
  isLinux: false,
  isWin: true
}))

vi.mock('@napi-rs/system-ocr', () => ({
  OcrAccuracy: {
    Accurate: 'accurate'
  },
  recognize: vi.fn()
}))

import { recognize } from '@napi-rs/system-ocr'

import { systemImageToTextHandler } from '../handler'

const imageFile = FileInfoSchema.parse({
  path: '/tmp/scan.png',
  name: 'scan',
  size: 1024,
  ext: 'png',
  mime: 'image/png',
  type: FILE_TYPE.IMAGE,
  createdAt: 1,
  modifiedAt: 1
})

describe('systemImageToTextHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs invalid migrated options before falling back to platform defaults', async () => {
    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})

    const prepared = await systemImageToTextHandler.prepare(
      imageFile,
      {
        id: 'system',
        type: 'builtin',
        capabilities: [
          {
            feature: 'image_to_text',
            inputs: ['image'],
            output: 'text'
          }
        ],
        options: {
          langs: 'eng'
        }
      } as never,
      undefined
    )

    expect(prepared.mode).toBe('background')
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid system OCR options; falling back to platform defaults',
      expect.any(Error),
      {
        processorId: 'system'
      }
    )

    warnSpy.mockRestore()
  })

  it('recognizes a JPEG on Windows by sending the image bytes instead of the path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-ocr-test-'))
    try {
      const jpegPath = path.join(tempDir, 'scan.jpg')
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
      await fs.writeFile(jpegPath, jpegBytes)

      // Model the @napi-rs/system-ocr@1.1.0 Windows binding: path input is decoded with a
      // hardcoded PNG WIC decoder (any JPEG path fails), buffer input decodes by real format.
      let receivedImage: string | Uint8Array | undefined
      vi.mocked(recognize).mockImplementation(async (image) => {
        receivedImage = image
        if (typeof image === 'string') {
          throw Object.assign(new Error('Windows error 图像格式未知。 (0x88982F07)'), { code: 'GenericFailure' })
        }
        return { text: 'jpeg text', confidence: 1 }
      })

      const jpegFile = FileInfoSchema.parse({
        path: jpegPath,
        name: 'scan',
        size: jpegBytes.length,
        ext: 'jpg',
        mime: 'image/jpeg',
        type: FILE_TYPE.IMAGE,
        createdAt: 1,
        modifiedAt: 1
      })

      const prepared = await systemImageToTextHandler.prepare(
        jpegFile,
        {
          id: 'system',
          type: 'builtin',
          capabilities: [{ feature: 'image_to_text', inputs: ['image'], output: 'text' }],
          options: {}
        } as never,
        undefined
      )
      if (prepared.mode !== 'background') {
        throw new Error('expected a background job')
      }

      const result = await prepared.execute({ signal: new AbortController().signal, reportProgress: () => {} })

      expect(result).toEqual({ kind: 'text', text: 'jpeg text' })
      expect(Buffer.from(receivedImage as Uint8Array)).toEqual(jpegBytes)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('systemImageToTextHandler native binding loading', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not load the native OCR binding until execute() runs', async () => {
    // Simulate a broken/missing native binding (the macOS x64 failure mode): loading
    // the module throws. Importing the handler and preparing a job must stay unaffected
    // so a failed binding degrades this one feature instead of crashing the main process.
    vi.doMock('@napi-rs/system-ocr', () => {
      throw new Error('Cannot find native binding')
    })

    const { systemImageToTextHandler: handler } = await import('../handler')

    const prepared = await handler.prepare(
      imageFile,
      {
        id: 'system',
        type: 'builtin',
        capabilities: [{ feature: 'image_to_text', inputs: ['image'], output: 'text' }],
        options: {}
      } as never,
      undefined
    )

    // Importing the handler and preparing the job did not throw despite the broken
    // binding — the failure is deferred to execute().
    expect(prepared.mode).toBe('background')
    if (prepared.mode !== 'background') {
      throw new Error('expected a background job')
    }

    await expect(prepared.execute({ signal: new AbortController().signal, reportProgress: () => {} })).rejects.toThrow()
  })
})
