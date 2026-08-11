import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { FILE_TYPE, FileInfoSchema } from '@shared/types/file'
import sharp from 'sharp'
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

  it('re-encodes a JPEG to PNG bytes on Windows before recognition', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-ocr-test-'))
    try {
      const jpegPath = path.join(tempDir, 'scan.jpg')
      const jpegBytes = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 100, b: 50 } }
      })
        .jpeg()
        .toBuffer()
      await fs.writeFile(jpegPath, jpegBytes)

      // Model the @napi-rs/system-ocr@1.1.0 Windows binding: path input is decoded with a
      // hardcoded PNG WIC decoder and buffer sniffing only recognizes PNG — all else fails.
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      let receivedImage: string | Uint8Array | undefined
      vi.mocked(recognize).mockImplementation(async (image) => {
        receivedImage = image
        if (typeof image === 'string') {
          throw Object.assign(new Error('Windows error 图像格式未知。 (0x88982F07)'), { code: 'GenericFailure' })
        }
        if (!Buffer.from(image).subarray(0, 8).equals(pngSignature)) {
          throw Object.assign(new Error('Windows error Could not recognize file (0x80070005)'), {
            code: 'GenericFailure'
          })
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
      const meta = await sharp(Buffer.from(receivedImage as Uint8Array)).metadata()
      expect(meta.format).toBe('png')
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
