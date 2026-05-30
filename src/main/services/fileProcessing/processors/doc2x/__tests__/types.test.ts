import { describe, expect, it } from 'vitest'

import { Doc2xExportStatusResponseSchema, Doc2xParseStatusResponseSchema, Doc2xPreuploadResponseSchema } from '../types'

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
})
