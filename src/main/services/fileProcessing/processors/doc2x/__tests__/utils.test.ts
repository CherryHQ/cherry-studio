import type * as NodeFs from 'node:fs'
import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createReadStreamMock, destroyMock, fetchMock } = vi.hoisted(() => ({
  createReadStreamMock: vi.fn(() => ({
    destroy: vi.fn()
  })),
  destroyMock: vi.fn(),
  fetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')

  return {
    ...actual,
    createReadStream: createReadStreamMock
  }
})

import { uploadFile } from '../utils'

describe('doc2x utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    createReadStreamMock.mockReturnValue({
      destroy: destroyMock
    })
  })

  it('rejects files that are 1GB or larger before uploading', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 * 1024 * 1024 } as never)

    await expect(
      uploadFile(
        '/tmp/large.pdf',
        'https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf?X-Amz-Signature=abc',
        'https://v2.doc2x.noedgeai.com'
      )
    ).rejects.toThrow('Doc2x file is too large (must be smaller than 1GB)')
  })

  it('uploads files to public object-storage urls returned by the provider', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as never)
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        statusText: 'OK'
      })
    )

    await expect(
      uploadFile(
        '/tmp/file.pdf',
        'https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf?X-Amz-Signature=abc',
        'https://v2.doc2x.noedgeai.com'
      )
    ).resolves.toBeUndefined()

    expect(createReadStreamMock).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf?X-Amz-Signature=abc',
      expect.objectContaining({
        method: 'PUT',
        body: expect.any(Object),
        duplex: 'half',
        signal: undefined
      })
    )
    expect(destroyMock).toHaveBeenCalled()
  })

  it('rejects unsafe upload urls before dispatching the request', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as never)

    await expect(
      uploadFile('/tmp/file.pdf', 'http://127.0.0.1:9000/upload', 'https://v2.doc2x.noedgeai.com')
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (127.0.0.1)')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
