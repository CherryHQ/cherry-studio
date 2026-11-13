import { describe, expect, it } from 'vitest'

import {
  Doc2xExportStatusResponseSchema,
  Doc2xLayoutBlockSchema,
  Doc2xParseStatusResponseSchema,
  Doc2xPreuploadResponseSchema
} from '../types'

describe('doc2x response schemas', () => {
  it('decodes escaped unicode in preupload URLs', () => {
    const payload = Doc2xPreuploadResponseSchema.parse({
      code: 'success',
      data: {
        uid: 'task-1',
        url: 'https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf\\u003fpart\\u003d1\\u0026signature\\u003dabc'
      }
    })

    expect(payload.data?.url).toBe('https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf?part=1&signature=abc')
  })

  it('decodes escaped unicode in export result URLs', () => {
    const payload = Doc2xExportStatusResponseSchema.parse({
      code: 'success',
      data: {
        status: 'success',
        url: 'https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/task-1/convert_md_none.zip\\u003fExpires\\u003d1\\u0026Signature\\u003dabc'
      }
    })

    expect(payload.data?.url).toBe(
      'https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/task-1/convert_md_none.zip?Expires=1&Signature=abc'
    )
  })

  it('decodes escaped unicode in parse page URLs', () => {
    const payload = Doc2xParseStatusResponseSchema.parse({
      code: 'success',
      data: {
        status: 'processing',
        result: {
          pages: [
            {
              page_idx: 0,
              url: 'https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/task-1/page-1.png\\u003fpage\\u003d1\\u0026token\\u003dabc'
            }
          ]
        }
      }
    })

    expect(payload.data?.result?.pages[0].url).toBe(
      'https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/task-1/page-1.png?page=1&token=abc'
    )
  })

  it('treats empty parse page URLs as missing', () => {
    const payload = Doc2xParseStatusResponseSchema.parse({
      code: 'success',
      data: {
        status: 'processing',
        result: {
          pages: [
            {
              page_idx: 0,
              url: ''
            }
          ]
        }
      }
    })

    expect(payload.data?.result?.pages[0].url).toBeUndefined()
  })

  it('treats empty export URLs as missing', () => {
    const payload = Doc2xExportStatusResponseSchema.parse({
      code: 'success',
      data: {
        status: 'processing',
        url: ''
      }
    })

    expect(payload.data?.url).toBeUndefined()
  })

  it('accepts v3 layout blocks and their structured table data', () => {
    const result = Doc2xParseStatusResponseSchema.parse({
      code: 'success',
      data: {
        status: 'success',
        result: {
          version: '',
          inplace_pages: null,
          pages: [
            {
              page_idx: 0,
              layout: {
                blocks: [
                  {
                    id: 'blk-1',
                    type: 'Table',
                    text: '',
                    bbox: [0, 1, 2, 3],
                    reading_order: 1,
                    parent_id: '',
                    src: '',
                    table_data: { html: '<table />' }
                  },
                  {
                    id: 'figure-1',
                    type: 'Figure',
                    text: '',
                    bbox: [0, 1, 2, 3],
                    reading_order: 2,
                    parent_id: 'group-1',
                    src: 'https://img.example.com/figure.png',
                    linking: { next_block_id: 'text-2' },
                    attributes: { rotation: 0 }
                  }
                ]
              }
            }
          ]
        }
      }
    })

    expect(result.data?.result?.pages[0].layout?.blocks[0].table_data?.html).toBe('<table />')
    expect(result.data?.result?.version).toBe('')
    expect(result.data?.result?.inplace_pages).toBeNull()
    expect(result.data?.result?.pages[0].layout?.blocks[1].src).toBe('https://img.example.com/figure.png')
    expect(() => Doc2xLayoutBlockSchema.parse({ id: 'bad', type: 'Text', bbox: [0, 1, 2] })).toThrow()
  })
})
