import { FILE_TYPE } from '@shared/data/types/file'
import type { FileMetadata } from '@types'
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

const imageFile: FileMetadata = {
  id: 'file-1',
  name: 'scan.png',
  origin_name: 'scan.png',
  path: '/tmp/scan.png',
  size: 1024,
  ext: '.png',
  type: FILE_TYPE.IMAGE,
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
}

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
