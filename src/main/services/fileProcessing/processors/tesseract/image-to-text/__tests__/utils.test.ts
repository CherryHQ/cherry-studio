import { FILE_TYPE } from '@shared/data/types/file'
import type { FileMetadata } from '@types'
import { describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../../tests/__mocks__/MainLoggerService'
import { prepareContext } from '../prepare'

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
            inputs: ['image'],
            output: 'text'
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
            inputs: ['image'],
            output: 'text'
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
