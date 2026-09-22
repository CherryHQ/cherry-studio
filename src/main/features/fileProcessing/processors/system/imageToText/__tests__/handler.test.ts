import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FILE_TYPE, type FileInfo, FileInfoSchema } from '@shared/types/file'

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

  it.each([
    ['jpeg', 'jpg', 'image/jpeg'],
    ['webp', 'webp', 'image/webp'],
    ['gif', 'gif', 'image/gif']
  ] as const)('transcodes a %s to PNG on Windows so the binding can decode it', async (format, ext, mime) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-ocr-test-'))
    try {
      const imagePath = path.join(tempDir, `scan.${ext}`)
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
        .toFormat(format)
        .toBuffer()
      await fs.writeFile(imagePath, bytes)

      // Model the @napi-rs/system-ocr@1.1.0 Windows binding: path input is decoded with a
      // hardcoded PNG WIC decoder, and buffer input only sniffs PNG — everything else is
      // rejected with "Could not recognize file" (verified on Windows 11, PR #18335).
      let receivedImage: string | Uint8Array | undefined
      vi.mocked(recognize).mockImplementation(async (image) => {
        receivedImage = image
        if (typeof image === 'string') {
          throw Object.assign(new Error('Windows error 图像格式未知。 (0x88982F07)'), { code: 'GenericFailure' })
        }
        if ((await sharp(image).metadata()).format !== 'png') {
          throw Object.assign(new Error('Could not recognize file (0x80070005)'), { code: 'GenericFailure' })
        }
        return { text: 'ocr text', confidence: 1 }
      })

      const result = await runHandler(
        FileInfoSchema.parse({
          path: imagePath,
          name: 'scan',
          size: bytes.length,
          ext,
          mime,
          type: FILE_TYPE.IMAGE,
          createdAt: 1,
          modifiedAt: 1
        })
      )

      expect(result).toEqual({ kind: 'text', text: 'ocr text' })
      expect((await sharp(receivedImage as Uint8Array).metadata()).width).toBe(8)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('sends a PNG on Windows untouched instead of re-encoding it', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-ocr-test-'))
    try {
      const pngPath = path.join(tempDir, 'scan.png')
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
        .png()
        .toBuffer()
      await fs.writeFile(pngPath, bytes)

      let receivedImage: string | Uint8Array | undefined
      vi.mocked(recognize).mockImplementation(async (image) => {
        receivedImage = image
        return { text: 'png text', confidence: 1 }
      })

      const result = await runHandler(
        FileInfoSchema.parse({
          path: pngPath,
          name: 'scan',
          size: bytes.length,
          ext: 'png',
          mime: 'image/png',
          type: FILE_TYPE.IMAGE,
          createdAt: 1,
          modifiedAt: 1
        })
      )

      expect(result).toEqual({ kind: 'text', text: 'png text' })
      expect(Buffer.from(receivedImage as Uint8Array)).toEqual(bytes)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

async function runHandler(file: FileInfo) {
  const prepared = await systemImageToTextHandler.prepare(
    file,
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
  return prepared.execute({ signal: new AbortController().signal, reportProgress: () => {} })
}

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
