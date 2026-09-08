import { createHash } from 'node:crypto'
import { appendFile, mkdtemp, rename, rm, truncate, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type * as FileUtils from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signerMocks = vi.hoisted(() => ({ generateDiagnosticUploadHeaders: vi.fn() }))
const snapshotHooks = vi.hoisted(() => ({ onFirstRead: undefined as undefined | (() => Promise<void>) }))

vi.mock('@main/ai/provider/cherryai', () => signerMocks)

vi.mock('@main/utils/file', async (importOriginal) => {
  const actual = await importOriginal<typeof FileUtils>()
  const { Readable } = await import('node:stream')

  return {
    ...actual,
    openReadableFileSnapshot: async (...args: Parameters<typeof actual.openReadableFileSnapshot>) => {
      const snapshot = await actual.openReadableFileSnapshot(...args)
      return {
        ...snapshot,
        createReadStream: (bytes?: number) => {
          const source = snapshot.createReadStream(bytes)
          const onFirstRead = snapshotHooks.onFirstRead
          if (!onFirstRead) return source
          snapshotHooks.onFirstRead = undefined
          return Readable.from(
            (async function* () {
              let first = true
              for await (const chunk of source) {
                if (first) {
                  first = false
                  await onFirstRead()
                }
                yield chunk
              }
            })()
          )
        }
      }
    }
  }
})

import {
  CherryDiagnosticUploadClient,
  cherryDiagnosticUploadClient,
  type CherryDiagnosticUploadFailureReason,
  type CherryDiagnosticUploadResult
} from '../CherryDiagnosticUploadClient'

const ENDPOINT = 'https://api.cherry-ai.com/diagnostics'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const REPORT_ID = '123e4567-e89b-42d3-a456-426614174000'
const CREATED_AT = '2026-08-26T01:02:03.000Z'
const ZIP_BYTES = Buffer.from('504b0506000000000000000000000000000000000000', 'hex')
const SIGNATURE_HEADERS = {
  'X-Signature-Version': '2',
  'X-Client-ID': 'test-client',
  'X-Timestamp': '1787706000',
  'X-Request-ID': '223e4567-e89b-42d3-a456-426614174000',
  'X-File-Size': String(ZIP_BYTES.length),
  'X-File-SHA256': createHash('sha256').update(ZIP_BYTES).digest('hex'),
  'X-Description-SHA256': 'd'.repeat(64),
  'X-Signature': 'signature-secret'
} as const

function reportPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REPORT_ID,
    status: 'pending',
    status_url: `${ENDPOINT}/${REPORT_ID}`,
    created_at: CREATED_AT,
    ...overrides
  }
}

function reportResponse(
  payload: unknown = reportPayload(),
  options: { body?: string; location?: string; status?: number } = {}
): Response {
  return new Response(options.body ?? JSON.stringify(payload), {
    status: options.status ?? 201,
    headers: { Location: options.location ?? `${ENDPOINT}/${REPORT_ID}` }
  })
}

function rejectedResult(reason: CherryDiagnosticUploadFailureReason): CherryDiagnosticUploadResult {
  return { fileSha256: SIGNATURE_HEADERS['X-File-SHA256'], reason, status: 'rejected' }
}

function submissionUnknownResult(): CherryDiagnosticUploadResult {
  return { fileSha256: SIGNATURE_HEADERS['X-File-SHA256'], status: 'submission_unknown' }
}

describe('CherryDiagnosticUploadClient', () => {
  let workDir: string
  let filePath: string
  let client: CherryDiagnosticUploadClient
  const fetchMock = vi.mocked(net.fetch)

  beforeEach(async () => {
    vi.clearAllMocks()
    snapshotHooks.onFirstRead = undefined
    workDir = await mkdtemp(path.join(tmpdir(), 'cherry-diagnostic-upload-'))
    filePath = path.join(workDir, 'diagnostics.ZIP')
    await writeFile(filePath, ZIP_BYTES)
    signerMocks.generateDiagnosticUploadHeaders.mockReturnValue(SIGNATURE_HEADERS)
    fetchMock.mockResolvedValue(reportResponse())
    client = new CherryDiagnosticUploadClient()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(workDir, { force: true, recursive: true })
  })

  it('exports a named direct-import singleton', () => {
    expect(cherryDiagnosticUploadClient).toBeInstanceOf(CherryDiagnosticUploadClient)
  })

  it('posts one signed ZIP multipart body with one normalized description', async () => {
    const description = 'first\rsecond\nthird\r\nfourth'

    await expect(
      client.upload({
        description,
        fileName: 'Diagnostics.ZIP',
        filePath: AbsoluteFilePathSchema.parse(filePath)
      })
    ).resolves.toEqual({ reportId: REPORT_ID, status: 'uploaded' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ENDPOINT)
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.body).toBeInstanceOf(FormData)
    const headers = new Headers(init?.headers)
    expect(headers.get('x-signature')).toBe('signature-secret')
    expect(headers.has('content-type')).toBe(false)

    const form = init?.body as FormData
    expect(Array.from(form.keys())).toEqual(['description', 'file'])
    const normalizedDescription = 'first\r\nsecond\r\nthird\r\nfourth'
    expect(form.get('description')).toBe(normalizedDescription)
    expect(signerMocks.generateDiagnosticUploadHeaders).toHaveBeenCalledWith({
      description: normalizedDescription,
      fileSha256: createHash('sha256').update(ZIP_BYTES).digest('hex'),
      fileSize: ZIP_BYTES.length
    })
    const file = form.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect(file).toMatchObject({ name: 'Diagnostics.ZIP', size: ZIP_BYTES.length })
    await expect((file as Blob).arrayBuffer()).resolves.toEqual(
      ZIP_BYTES.buffer.slice(ZIP_BYTES.byteOffset, ZIP_BYTES.byteOffset + ZIP_BYTES.byteLength)
    )
  })

  it('uploads ZIP bytes from an extensionless physical path with the logical ZIP file name', async () => {
    const extensionlessPath = path.join(workDir, 'saved-diagnostics')
    await writeFile(extensionlessPath, ZIP_BYTES)

    await expect(
      client.upload({
        description: '',
        fileName: 'diagnostics.zip',
        filePath: AbsoluteFilePathSchema.parse(extensionlessPath)
      })
    ).resolves.toEqual({ reportId: REPORT_ID, status: 'uploaded' })

    const form = fetchMock.mock.calls[0][1]?.body as FormData
    expect(form.get('file')).toMatchObject({ name: 'diagnostics.zip', size: ZIP_BYTES.length })
  })

  it('returns authentication_failed when signing fails before the request starts', async () => {
    signerMocks.generateDiagnosticUploadHeaders.mockImplementationOnce(() => {
      throw new Error('signing unavailable')
    })

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({
      fileSha256: SIGNATURE_HEADERS['X-File-SHA256'],
      reason: 'authentication_failed',
      status: 'rejected'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-ZIP logical file name before signing or fetching', async () => {
    await expect(
      client.upload({
        description: '',
        fileName: 'diagnostics.txt',
        filePath: AbsoluteFilePathSchema.parse(filePath)
      })
    ).resolves.toEqual({ reason: 'invalid_archive', status: 'rejected' })

    expect(signerMocks.generateDiagnosticUploadHeaders).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty ZIP before signing or fetching', async () => {
    await writeFile(filePath, Buffer.alloc(0))

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({ reason: 'invalid_archive', status: 'rejected' })
    expect(signerMocks.generateDiagnosticUploadHeaders).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a ZIP over 100 MiB before hashing, signing, or fetching', async () => {
    await truncate(filePath, MAX_ARCHIVE_BYTES + 1)

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({ reason: 'archive_too_large', status: 'rejected' })
    expect(signerMocks.generateDiagnosticUploadHeaders).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a ZIP exactly at the 100 MiB limit', async () => {
    await truncate(filePath, MAX_ARCHIVE_BYTES)

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({ reportId: REPORT_ID, status: 'uploaded' })
    expect(signerMocks.generateDiagnosticUploadHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ fileSize: MAX_ARCHIVE_BYTES })
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a ZIP whose digest differs from the approved digest before signing or fetching', async () => {
    await expect(
      client.upload({
        description: '',
        expectedFileSha256: '0'.repeat(64),
        fileName: 'diagnostics.zip',
        filePath: AbsoluteFilePathSchema.parse(filePath)
      })
    ).resolves.toEqual({ reason: 'invalid_archive', status: 'rejected' })
    expect(signerMocks.generateDiagnosticUploadHeaders).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [
      'size',
      async (target: string) => {
        await appendFile(target, Buffer.from([0]))
      }
    ],
    [
      'mtime',
      async (target: string) => {
        const changed = new Date('2030-01-01T00:00:00.000Z')
        await utimes(target, changed, changed)
      }
    ],
    [
      'identity',
      async (target: string) => {
        await rename(target, path.join(path.dirname(target), 'original.zip'))
        await writeFile(target, ZIP_BYTES)
      }
    ]
  ])('rejects a ZIP whose %s changes while it is being hashed', async (_label, mutate) => {
    snapshotHooks.onFirstRead = () => mutate(filePath)

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({ reason: 'invalid_archive', status: 'rejected' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a valid response whose body is exactly 64 KiB', async () => {
    const json = JSON.stringify(reportPayload())
    fetchMock.mockResolvedValueOnce(
      reportResponse(undefined, { body: json + ' '.repeat(MAX_RESPONSE_BYTES - json.length) })
    )

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({ reportId: REPORT_ID, status: 'uploaded' })
  })

  it.each([
    [
      'an oversized Content-Length',
      () =>
        new Response('{}', {
          status: 201,
          headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1), Location: `${ENDPOINT}/${REPORT_ID}` }
        })
    ],
    ['an oversized streamed body', () => reportResponse(undefined, { body: ' '.repeat(MAX_RESPONSE_BYTES + 1) })],
    [
      'a body read failure',
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('response stream failed'))
            }
          }),
          { status: 201, headers: { Location: `${ENDPOINT}/${REPORT_ID}` } }
        )
    ]
  ])('returns submission_unknown for %s', async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response())

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual(submissionUnknownResult())
  })

  it.each([
    [200, 'opaque-report-200'],
    [201, REPORT_ID.toUpperCase()],
    [202, '123e4567-e89b-52d3-a456-426614174000'],
    [299, '  report/with spaces  ']
  ])('accepts HTTP %s with a nonblank opaque ID and returns it unchanged', async (status, reportId) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: reportId }), { status }))

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({ reportId, status: 'uploaded' })
  })

  it('accepts a 201 response with Go RFC3339Nano metadata and ignores other response metadata', async () => {
    fetchMock.mockResolvedValueOnce(
      reportResponse(
        reportPayload({
          created_at: '2026-08-26T01:02:03.123456789Z',
          status: 'complete',
          status_url: `${ENDPOINT}/other`
        }),
        { location: `${ENDPOINT}/other` }
      )
    )

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({ reportId: REPORT_ID, status: 'uploaded' })
  })

  it.each([
    ['invalid JSON', 200, '{'],
    ['a missing ID', 201, '{}'],
    ['a non-string ID', 202, JSON.stringify({ id: 123 })],
    ['a blank ID', 299, JSON.stringify({ id: ' \t\n' })]
  ])('returns submission_unknown for a 2xx response with %s (HTTP %s)', async (_label, status, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status }))

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual(submissionUnknownResult())
  })

  it.each([
    [400, { code: 'invalid_diagnostic_archive' }, 'invalid_archive'],
    [401, {}, 'authentication_failed'],
    [409, {}, 'authentication_failed'],
    [413, {}, 'archive_too_large'],
    [429, {}, 'rate_limited'],
    [502, {}, 'service_unavailable'],
    [400, { code: 'other' }, 'submission_rejected'],
    [500, {}, 'submission_rejected']
  ])('maps HTTP %s to %s', async (status, body, reason) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual(rejectedResult(reason as CherryDiagnosticUploadFailureReason))
  })

  it('maps a non-400 rejection without reading its body and releases the response', async () => {
    let canceled = false
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true
          },
          start(controller) {
            controller.enqueue(new Uint8Array([0]))
          },
          pull() {
            throw new Error('body must not be read')
          }
        }),
        { status: 429 }
      )
    )

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({
      fileSha256: SIGNATURE_HEADERS['X-File-SHA256'],
      reason: 'rate_limited',
      status: 'rejected'
    })
    expect(canceled).toBe(true)
  })

  it('returns submission_rejected when a 400 response body cannot be read', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull() {
            throw new Error('response stream failed')
          }
        }),
        { status: 400 }
      )
    )

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual({
      fileSha256: SIGNATURE_HEADERS['X-File-SHA256'],
      reason: 'submission_rejected',
      status: 'rejected'
    })
  })

  it.each([307, 308])('does not follow HTTP %s redirects or resend credentials', async (status) => {
    fetchMock.mockResolvedValueOnce(
      new Response('{}', { status, headers: { Location: 'https://attacker.example/diagnostics' } })
    )

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual(rejectedResult('submission_rejected'))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINT)
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual')
  })

  it('returns submission_unknown for a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await expect(
      client.upload({ description: '', fileName: 'diagnostics.zip', filePath: AbsoluteFilePathSchema.parse(filePath) })
    ).resolves.toEqual(submissionUnknownResult())
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('aborts after 15 minutes and clears the timeout', async () => {
    vi.useFakeTimers()
    let requestStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve
    })
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url, init) => {
      requestSignal = init?.signal ?? undefined
      requestStarted()
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
    })

    const upload = client.upload({
      description: '',
      fileName: 'diagnostics.zip',
      filePath: AbsoluteFilePathSchema.parse(filePath)
    })
    await started

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1)
    expect(requestSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(upload).resolves.toEqual(submissionUnknownResult())
    expect(requestSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
