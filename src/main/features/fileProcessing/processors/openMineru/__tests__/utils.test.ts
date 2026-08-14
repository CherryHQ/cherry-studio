import type * as NodeFs from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, openAsBlobMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), openAsBlobMock: vi.fn() }))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  openAsBlobMock.mockImplementation(actual.openAsBlob)

  return {
    ...actual,
    openAsBlob: openAsBlobMock
  }
})

import { executeTask } from '../utils'

describe('open-mineru utils', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mineru-test-'))
    await Promise.all([
      fs.writeFile(path.join(tempDir, 'file.pdf'), 'pdf-data'),
      fs.writeFile(path.join(tempDir, 'file.docx'), 'docx-data')
    ])
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it.each(['pdf', 'docx'])('submits %s files using standards-compliant multipart form data', async (ext) => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/zip'
        }
      })
    )

    await expect(
      executeTask({
        apiHost: 'http://127.0.0.1:8000',
        apiKey: 'secret',
        file: {
          path: path.join(tempDir, `file.${ext}`),
          name: 'file',
          ext
        }
      } as never)
    ).resolves.toBeInstanceOf(Response)

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: unknown }]
    expect(endpoint).toBe('http://127.0.0.1:8000/file_parse')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)

    const formData = init.body as FormData
    expect(formData.get('return_md')).toBe('true')
    expect(formData.get('response_format_zip')).toBe('true')
    expect(formData.get('files')).toBeInstanceOf(Blob)
    expect(formData.get('files')).toMatchObject({ name: `file.${ext}` })

    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer secret')
    expect(headers.has('Content-Type')).toBe(false)
    expect(init).not.toHaveProperty('duplex')
  })
})
