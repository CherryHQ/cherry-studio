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
