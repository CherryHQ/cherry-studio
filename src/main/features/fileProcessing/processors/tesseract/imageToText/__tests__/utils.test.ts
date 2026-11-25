import { describe, expect, it } from 'vitest'

import { FILE_TYPE, FileInfoSchema } from '@shared/types/file'

import { prepareContext } from '../prepare'

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

describe('Tesseract prepareContext', () => {
  it('preserves custom traineddata names in migrated language options', () => {
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
          langs: ['eng', 'chi_sim', 'eng', '', ' my_custom ']
        }
      },
      undefined
    )

    expect(context.langs).toEqual(['chi_sim', 'eng', 'eng', 'my_custom'])
  })
})
