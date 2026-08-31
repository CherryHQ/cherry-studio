import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SignatureClient } from '../cherryai'

const requestId = '123e4567-e89b-42d3-a456-426614174000'
const fileSha256 = 'A'.repeat(64)

function diagnosticOptions() {
  return {
    description: '故障\nline 2',
    fileSha256,
    fileSize: 8,
    requestId
  }
}

describe('SignatureClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T15:06:40.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('keeps the v1 chat completion signature stable', () => {
    const client = new SignatureClient('test-client', 'test-secret')

    expect(
      client.generateSignature({
        method: 'POST',
        path: '/chat/completions',
        body: { model: 'test' }
      })
    ).toEqual({
      'X-Client-ID': 'test-client',
      'X-Timestamp': '1750000000',
      'X-Signature': '89fdf838e8f1504e1af28c33f8b64c0699e61d14405d9f946c9cdb89138a2992'
    })
  })

  it('generates the v2 diagnostic upload golden headers', () => {
    const client = new SignatureClient('test-client', 'test-secret')

    expect(client.generateDiagnosticUploadHeaders(diagnosticOptions())).toEqual({
      'X-Signature-Version': '2',
      'X-Client-ID': 'test-client',
      'X-Timestamp': '1750000000',
      'X-Request-ID': requestId,
      'X-File-Size': '8',
      'X-File-SHA256': 'a'.repeat(64),
      'X-Description-SHA256': '369b063f99d94fa64a157b2f2f4ca5881641f37843b42117f66f343509368bec',
      'X-Signature': '37ae6c91d8bae1b507496188f233ca760c74212f5e0cb45a443e790e4037f077'
    })
  })

  it('hashes an empty diagnostic description', () => {
    const client = new SignatureClient('test-client', 'test-secret')

    expect(client.generateDiagnosticUploadHeaders({ ...diagnosticOptions(), description: '' })).toMatchObject({
      'X-Description-SHA256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    })
  })

  it('generates a fresh lowercase UUID v4 for each diagnostic upload', () => {
    const client = new SignatureClient('test-client', 'test-secret')
    const options = { ...diagnosticOptions(), requestId: undefined }

    const first = client.generateDiagnosticUploadHeaders(options)['X-Request-ID']
    const second = client.generateDiagnosticUploadHeaders(options)['X-Request-ID']

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid diagnostic file size %s', (fileSize) => {
    const client = new SignatureClient('test-client', 'test-secret')

    expect(() => client.generateDiagnosticUploadHeaders({ ...diagnosticOptions(), fileSize })).toThrow(
      'fileSize must be a positive safe integer'
    )
  })

  it.each(['a'.repeat(63), 'g'.repeat(64), ` ${'a'.repeat(64)}`])(
    'rejects invalid diagnostic file hash %s',
    (invalidFileSha256) => {
      const client = new SignatureClient('test-client', 'test-secret')

      expect(() =>
        client.generateDiagnosticUploadHeaders({ ...diagnosticOptions(), fileSha256: invalidFileSha256 })
      ).toThrow('fileSha256 must be a 64-character hexadecimal digest')
    }
  )

  it.each([
    '123e4567-e89b-52d3-a456-426614174000',
    '123e4567-e89b-42d3-7456-426614174000',
    '123E4567-E89B-42D3-A456-426614174000',
    'not-a-uuid'
  ])('rejects invalid diagnostic request ID %s', (invalidRequestId) => {
    const client = new SignatureClient('test-client', 'test-secret')

    expect(() =>
      client.generateDiagnosticUploadHeaders({ ...diagnosticOptions(), requestId: invalidRequestId })
    ).toThrow('requestId must be a lowercase UUID v4')
  })

  it('rejects an explicitly empty client secret without exposing it', () => {
    expect(() => new SignatureClient('test-client', '')).toThrow('CherryAI client secret is not configured')
  })

  it('fails closed when the build client secret is missing', async () => {
    vi.stubEnv('MAIN_VITE_CHERRYAI_CLIENT_SECRET', '')
    vi.resetModules()
    const { generateDiagnosticUploadHeaders } = await import('../cherryai')

    expect(() => generateDiagnosticUploadHeaders(diagnosticOptions())).toThrow(
      'CherryAI client secret is not configured'
    )
  })
})
