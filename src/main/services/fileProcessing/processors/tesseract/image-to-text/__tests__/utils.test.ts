import { FILE_TYPE } from '@shared/data/types/file'
import type { FileInfo } from '@shared/file/types'
import { describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../../tests/__mocks__/MainLoggerService'
import { prepareContext } from '../handler'

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

describe('Tesseract prepareContext', () => {
  it('parses migrated langs arrays from processor options', () => {
    const context = prepareContext(
      imageFile,
      {
        id: 'tesseract',
        type: 'builtin',
        capabilities: [
          {
            feature: 'image_to_text',
            inputs: [FILE_TYPE.IMAGE],
            output: FILE_TYPE.TEXT
          }
        ],
        options: {
          langs: ['eng', 'chi_sim', 'eng', '']
        }
      },
      undefined
    )

    expect(context.langs).toEqual(['chi_sim', 'eng', 'eng'])
  })

  it('falls back to default langs when migrated options are missing', () => {
    const context = prepareContext(
      imageFile,
      {
        id: 'tesseract',
        type: 'builtin',
        capabilities: [
          {
            feature: 'image_to_text',
            inputs: [FILE_TYPE.IMAGE],
            output: FILE_TYPE.TEXT
          }
        ]
      },
      undefined
    )

    expect(context.langs).toEqual(['chi_sim', 'chi_tra', 'eng'])
  })

  it('logs invalid migrated options before falling back to default langs', () => {
    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})

    const context = prepareContext(
      imageFile,
      {
        id: 'tesseract',
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

    expect(context.langs).toEqual(['chi_sim', 'chi_tra', 'eng'])
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid Tesseract OCR options; falling back to default languages',
      expect.any(Error),
      {
        processorId: 'tesseract'
      }
    )

    warnSpy.mockRestore()
  })
})
