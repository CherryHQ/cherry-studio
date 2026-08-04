import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetchMock } = vi.hoisted(() => {
  return { netFetchMock: vi.fn() }
})

vi.mock('electron', () => ({
  net: { fetch: netFetchMock }
}))

vi.mock('@main/utils/remoteUrlSafety', () => ({
  sanitizeRemoteUrl: (url: string) => url
}))

import { createPaddleClient } from '../client'

const API_HOST = 'https://paddleocr.aistudio-app.com'
const API_KEY = 'secret-key'
const MODEL = 'PaddleOCR-VL-1.6'

describe('paddleocr client upload', () => {
  let tempFile: string

  beforeAll(async () => {
    tempFile = path.join(os.tmpdir(), `paddle-upload-test-${Date.now()}.pdf`)
    await fs.writeFile(tempFile, '%PDF-1.4 fake pdf content')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    netFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { jobId: 'job-1' } }),
      text: async () => ''
    } as never)
  })

  afterAll(async () => {
    await fs.rm(tempFile, { force: true })
  })

  it('submits documents as multipart/form-data with a file part and the required headers', async () => {
    const client = await createPaddleClient(API_HOST, API_KEY)

    const result = await client.submitDocumentParsing({ filePath: tempFile, model: MODEL })

    expect(result.jobId).toBe('job-1')

    expect(netFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v2/ocr/jobs'),
      expect.objectContaining({ method: 'POST' })
    )

    const [, init] = netFetchMock.mock.calls[0] as [string, { body?: unknown; headers?: Record<string, string> }]
    expect(init.body).toBeInstanceOf(FormData)

    const form = init.body as FormData
    expect(form.get('file')).toBeTruthy()
    expect(form.get('model')).toBe(MODEL)

    expect(init.headers?.['Authorization']).toBe(`Bearer ${API_KEY}`)
    expect(init.headers?.['Client-Platform']).toBe('cherrystudio')
  })

  it('submits OCR images as multipart/form-data with a file part', async () => {
    const client = await createPaddleClient(API_HOST, API_KEY)

    const result = await client.submitOcr({ filePath: tempFile, model: 'PP-OCRv6' })

    expect(result.jobId).toBe('job-1')
    expect(netFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v2/ocr/jobs'),
      expect.objectContaining({ method: 'POST' })
    )

    const [, init] = netFetchMock.mock.calls[0] as [string, { body?: unknown }]
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeTruthy()
  })
})
