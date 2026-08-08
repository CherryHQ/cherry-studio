import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { adler32, FeishuAnonymousFormClient, resolveAttachmentFieldId } from '../FeishuAnonymousFormClient'

const DIRECT_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init
  })
}

function formSnapshot(extra: Record<string, unknown> = {}) {
  return {
    banned: false,
    fieldMap: {
      attachment: { fieldUIType: 'Attachment', type: 17 },
      optional: { fieldUIType: 'Text', type: 1 }
    },
    forbiddenSubmit: false,
    formExtraEntity: { enableAnonymousSubmit: true, publishStatus: 1 },
    isExceedBaseLimitMaxRows: false,
    isExceedMaxRecord: false,
    viewProperty: {
      fieldInfos: {
        attachment: { required: false, visible: true },
        optional: { required: false, visible: true }
      },
      fields: ['attachment', 'optional']
    },
    ...extra
  }
}

type MockResponse = Error | Response | ((url: string, init?: RequestInit) => Promise<Response> | Response)

function createSessionMock(responses: MockResponse[]) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    const response = responses.shift()
    if (!response) throw new Error('Unexpected request')
    if (response instanceof Error) throw response
    if (typeof response === 'function') return response(url, init)
    return response
  })
  const browserSession = {
    clearCache: vi.fn(async () => undefined),
    clearStorageData: vi.fn(async () => undefined),
    cookies: { get: vi.fn(async () => [{ value: 'csrf-value' }]) },
    fetch
  } as unknown as Session
  return { browserSession, fetch }
}

describe('FeishuAnonymousFormClient', () => {
  let workDir: string
  let filePath: string

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'feishu-form-client-'))
    filePath = path.join(workDir, 'diagnostics.zip')
    await writeFile(filePath, '12345678')
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(workDir, { force: true, recursive: true })
  })

  function successfulDirectResponses(
    finalResponse: MockResponse = jsonResponse({ code: 0, data: {} })
  ): MockResponse[] {
    return [
      new Response('<html></html>', { status: 200 }),
      jsonResponse({ code: 0, data: { snapshot: JSON.stringify(formSnapshot()) } }),
      jsonResponse({ code: 0, data: { file_token: 'attachment-token' } }),
      finalResponse
    ]
  }

  it('uses direct upload for a small attachment and submits the live field exactly once', async () => {
    const { browserSession, fetch } = createSessionMock(successfulDirectResponses())
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'uploaded'
    })

    expect(fetch).toHaveBeenCalledTimes(4)
    const directUploadCall = fetch.mock.calls.find(([url]) => String(url).includes('/box/stream/upload/all/'))
    expect(directUploadCall).toBeDefined()
    expect(directUploadCall?.[1]?.body).toBeInstanceOf(FormData)
    expect(new Headers(directUploadCall?.[1]?.headers).get('content-type')).toBeNull()
    expect(new Headers(directUploadCall?.[1]?.headers).get('x-command')).toBe('space.api.box.stream.upload.all')
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/uploadCode'))).toBe(false)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/bitable/share/content'))).toHaveLength(1)
    const submitCall = fetch.mock.calls.at(-1)
    if (!submitCall) throw new Error('Expected a final form submission')
    const submitBody = JSON.parse(String((submitCall[1] as RequestInit).body))
    const submittedData = JSON.parse(submitBody.data)
    expect(submittedData).toEqual({
      attachment: {
        type: 17,
        value: [
          expect.objectContaining({
            attachmentToken: 'attachment-token',
            mimeType: 'application/zip',
            name: 'diagnostics.zip',
            size: 8
          })
        ]
      }
    })
    expect(submitBody.preUploadEnable).toBe(true)
    expect(browserSession.clearStorageData).toHaveBeenCalledTimes(2)
    expect(browserSession.clearCache).toHaveBeenCalledOnce()
  })

  it('uploads every prepared block for an attachment above the direct-upload limit', async () => {
    const file = Buffer.alloc(DIRECT_UPLOAD_LIMIT_BYTES + 1, 1)
    const blockSize = 2 * 1024 * 1024
    await writeFile(filePath, file)
    const { browserSession, fetch } = createSessionMock([
      new Response('<html></html>', { status: 200 }),
      jsonResponse({ code: 0, data: { snapshot: JSON.stringify(formSnapshot()) } }),
      jsonResponse({ code: 0, data: { uploadCode: 'upload-code' } }),
      jsonResponse({ code: 0, data: { block_size: blockSize, num_blocks: 3, upload_id: 'upload-id' } }),
      jsonResponse({ code: 0, data: { success_seq_list: [0] } }),
      jsonResponse({ code: 0, data: { success_seq_list: [1] } }),
      jsonResponse({ code: 0, data: { success_seq_list: [2] } }),
      jsonResponse({ code: 0, data: { file_token: 'attachment-token' } }),
      jsonResponse({ code: 0, data: {} })
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: file.length })).resolves.toEqual({
      status: 'uploaded'
    })
    const blockCalls = fetch.mock.calls.filter(([url]) => String(url).includes('/merge_block/'))
    expect(blockCalls).toHaveLength(3)
    expect(new Headers(blockCalls[0][1]?.headers).get('x-command')).toBe('space.api.box.stream.upload.merge_block')
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/box/stream/upload/all/'))).toBe(false)
  })

  it.each(['https://accounts.feishu.cn/accounts/page/login', 'https://login.feishu.cn/accounts/v1/guest'])(
    'follows and validates a guest-login redirect through %s',
    async (redirectUrl) => {
      const redirect = new Response(null, {
        headers: { location: redirectUrl },
        status: 302
      })
      const responses = successfulDirectResponses()
      responses.unshift(redirect)
      const { browserSession, fetch } = createSessionMock(responses)
      const client = new FeishuAnonymousFormClient(() => browserSession)

      await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
        status: 'uploaded'
      })
      expect(fetch.mock.calls[1][0]).toBe(redirectUrl)
    }
  )

  it.each(['https://example.com/login', 'https://unexpected.feishu.cn/login'])(
    'rejects a guest redirect to %s',
    async (redirectUrl) => {
      const redirect = new Response(null, { headers: { location: redirectUrl }, status: 302 })
      const { browserSession, fetch } = createSessionMock([redirect])
      const client = new FeishuAnonymousFormClient(() => browserSession)

      await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
        reason: 'form_unavailable',
        status: 'manual_upload_required'
      })
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it('falls back when an in-memory guest session cannot be created', async () => {
    const client = new FeishuAnonymousFormClient(() => {
      throw new Error('session unavailable')
    })

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'network_failed',
      status: 'manual_upload_required'
    })
  })

  it('stops before uploading when another visible field becomes required', async () => {
    const changedSnapshot = formSnapshot({
      viewProperty: {
        fieldInfos: {
          attachment: { required: false, visible: true },
          optional: { required: true, visible: true }
        },
        fields: ['attachment', 'optional']
      }
    })
    const { browserSession, fetch } = createSessionMock([
      new Response('<html></html>', { status: 200 }),
      jsonResponse({ code: 0, data: { snapshot: JSON.stringify(changedSnapshot) } })
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'form_changed',
      status: 'manual_upload_required'
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not submit when attachment upload fails', async () => {
    const responses = successfulDirectResponses()
    responses[2] = jsonResponse({ code: 1, data: {} })
    const { browserSession, fetch } = createSessionMock(responses)
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'attachment_upload_failed',
      status: 'manual_upload_required'
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('reports an uncertain result without retrying an interrupted final submission', async () => {
    const responses = successfulDirectResponses()
    responses[3] = new Error('connection closed')
    const { browserSession, fetch } = createSessionMock(responses)
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'submission_unknown'
    })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/bitable/share/content'))).toHaveLength(1)
  })

  it('treats a nonzero final response code as an explicit rejection', async () => {
    const { browserSession } = createSessionMock(successfulDirectResponses(jsonResponse({ code: 4, data: {} })))
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'submission_rejected',
      status: 'manual_upload_required'
    })
  })

  it('stops reading a response whose body exceeds the limit despite a smaller declared length', async () => {
    let canceled = false
    const oversizedResponse = new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => {
          canceled = true
        },
        start: (controller) => controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1))
      }),
      { headers: { 'content-length': '1' }, status: 200 }
    )
    const { browserSession, fetch } = createSessionMock([
      new Response('<html></html>', { status: 200 }),
      oversizedResponse
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'form_unavailable',
      status: 'manual_upload_required'
    })
    expect(canceled).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps the request timeout active while reading a stalled response body', async () => {
    vi.useFakeTimers()
    let aborted = false
    const stalledResponse: MockResponse = (_url, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted = true
                controller.error(new Error('aborted'))
              },
              { once: true }
            )
          }
        }),
        { status: 200 }
      )
    const { browserSession, fetch } = createSessionMock([
      new Response('<html></html>', { status: 200 }),
      stalledResponse
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    const upload = client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(upload).resolves.toEqual({ reason: 'form_unavailable', status: 'manual_upload_required' })
    expect(aborted).toBe(true)
  })
})

describe('Feishu upload helpers', () => {
  it('uses the checksum format expected by the Drive upload endpoint', () => {
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe('300286872')
  })

  it('accepts one visible attachment field and optional sibling fields', () => {
    expect(resolveAttachmentFieldId(formSnapshot())).toBe('attachment')
  })

  it('rejects a live-view field whose visibility and requirement metadata is missing', () => {
    const incompleteSnapshot = formSnapshot({
      viewProperty: {
        fieldInfos: {
          attachment: { required: false, visible: true }
        },
        fields: ['attachment', 'optional']
      }
    })

    expect(() => resolveAttachmentFieldId(incompleteSnapshot)).toThrow('Anonymous diagnostic upload failed')
  })
})
