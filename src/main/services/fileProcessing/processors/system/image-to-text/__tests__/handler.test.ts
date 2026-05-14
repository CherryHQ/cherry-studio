import { FILE_TYPE } from '@shared/data/types/file'
import type { FileInfo } from '@shared/file/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../../tests/__mocks__/MainLoggerService'

vi.mock('@main/constant', () => ({
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

const imageFile: FileInfo = {
  path: '/tmp/scan.png' as FileInfo['path'],
  name: 'scan',
  ext: 'png',
  size: 1024,
  mime: 'image/png',
  type: FILE_TYPE.IMAGE,
  createdAt: Date.parse('2026-03-31T00:00:00.000Z'),
  modifiedAt: Date.parse('2026-03-31T00:00:00.000Z')
} as FileInfo

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
            inputs: [FILE_TYPE.IMAGE],
            output: FILE_TYPE.TEXT
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
