import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { adler32, FeishuAnonymousFormClient, resolveAttachmentFieldId } from '../FeishuAnonymousFormClient'

const MULTI_BLOCK_FILE_BYTES = 4 * 1024 * 1024 + 1
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const FORM_ORIGIN = 'https://mcnnox2fhjfq.feishu.cn'
const FORM_URL = `${FORM_ORIGIN}/share/base/form/shrcnufZiSDrvRPIzSKeqcbBbub`

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init
  })
}

function guestSessionResponse(authToken: string | null = 'guest-auth-token'): Response {
  const response = new Response('<html></html>', { status: 200 })
  const url = new URL(FORM_URL)
  if (authToken !== null) url.searchParams.set('auth_token', authToken)
  Object.defineProperty(response, 'url', { value: url.toString() })
  return response
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

type BeforeRequestListener = (
  details: { readonly url: string },
  callback: (response: { readonly cancel?: boolean }) => void
) => void
type BeforeRedirectListener = (details: { readonly redirectURL: string }) => void

function createSessionMock(responses: MockResponse[]) {
  let beforeRequestListener: BeforeRequestListener | null = null
  let beforeRedirectListener: BeforeRedirectListener | null = null
  const onBeforeRequest = vi.fn((filter: unknown, listener?: BeforeRequestListener) => {
    beforeRequestListener = filter === null ? null : (listener ?? null)
  })
  const onBeforeRedirect = vi.fn((filter: unknown, listener?: BeforeRedirectListener) => {
    beforeRedirectListener = filter === null ? null : (listener ?? null)
  })
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
    fetch,
    webRequest: { onBeforeRedirect, onBeforeRequest }
  } as unknown as Session
  return {
    browserSession,
    fetch,
    onBeforeRedirect,
    onBeforeRequest,
    triggerBeforeRedirect: (redirectURL: string) => {
      if (!beforeRedirectListener) throw new Error('No onBeforeRedirect listener')
      beforeRedirectListener({ redirectURL })
    },
    triggerBeforeRequest: (url: string) => {
      if (!beforeRequestListener) throw new Error('No onBeforeRequest listener')
      let canceled: boolean | undefined
      beforeRequestListener({ url }, (response) => {
        canceled = response.cancel === true
      })
      if (canceled === undefined) throw new Error('onBeforeRequest did not respond')
      return canceled
    }
  }
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

  function successfulPreparedResponses(
    finalResponse: MockResponse = jsonResponse({ code: 0, data: {} })
  ): MockResponse[] {
    return [
      guestSessionResponse(),
      jsonResponse({ code: 0, data: { snapshot: JSON.stringify(formSnapshot()) } }),
      jsonResponse({ code: 0, data: { uploadCode: 'upload-code' } }),
      jsonResponse({ code: 0, data: { block_size: 4 * 1024 * 1024, num_blocks: 1, upload_id: 'upload-id' } }),
      jsonResponse({ code: 0, data: { success_seq_list: [0] } }),
      jsonResponse({ code: 0, data: { file_token: 'attachment-token' } }),
      finalResponse
    ]
  }

  it('uses prepared upload for a small attachment and submits the live field exactly once', async () => {
    const { browserSession, fetch } = createSessionMock(successfulPreparedResponses())
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'uploaded'
    })

    expect(fetch).toHaveBeenCalledTimes(7)
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/uploadCode'))).toBe(true)
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/box/stream/upload/all/'))).toBe(false)
    const prepareCall = fetch.mock.calls.find(([url]) => String(url).includes('/box/upload/prepare/authcode/'))
    const finishCall = fetch.mock.calls.find(([url]) => String(url).includes('/box/upload/finish/'))
    expect(new URL(String(prepareCall?.[0])).origin).toBe(FORM_ORIGIN)
    expect(new URL(String(finishCall?.[0])).origin).toBe(FORM_ORIGIN)
    for (const [, init] of fetch.mock.calls.slice(1)) {
      expect(new Headers(init?.headers).get('x-auth-token')).toBe('guest-auth-token')
    }
    const blockCall = fetch.mock.calls.find(([url]) => String(url).includes('/merge_block/'))
    expect(new Headers(blockCall?.[1]?.headers).get('referer')).toBe(`${FORM_ORIGIN}/`)
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

  it('uploads every prepared block for a multi-block attachment', async () => {
    const file = Buffer.alloc(MULTI_BLOCK_FILE_BYTES, 1)
    const blockSize = 2 * 1024 * 1024
    await writeFile(filePath, file)
    const { browserSession, fetch } = createSessionMock([
      guestSessionResponse(),
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
    for (const [sequence, blockCall] of blockCalls.entries()) {
      const body = blockCall[1]?.body as Uint8Array
      const headers = new Headers(blockCall[1]?.headers)
      const expectedSize = sequence < 2 ? blockSize : 1
      expect(headers.get('x-command')).toBe('space.api.box.stream.upload.merge_block')
      expect(headers.get('x-seq-list')).toBe(String(sequence))
      expect(body).toHaveLength(expectedSize)
      expect(headers.get('x-block-origin-size')).toBe(String(body.byteLength))
      expect(headers.get('x-block-list-checksum')).toBe(adler32(body))
    }
    expect(blockCalls[2][1]?.body).toEqual(new Uint8Array([1]))
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/box/stream/upload/all/'))).toBe(false)
  })

  it('rejects an excessive prepared block count before uploading any blocks', async () => {
    const file = Buffer.alloc(65, 1)
    await writeFile(filePath, file)
    const { browserSession, fetch } = createSessionMock([
      guestSessionResponse(),
      jsonResponse({ code: 0, data: { snapshot: JSON.stringify(formSnapshot()) } }),
      jsonResponse({ code: 0, data: { uploadCode: 'upload-code' } }),
      jsonResponse({ code: 0, data: { block_size: 1, num_blocks: file.length, upload_id: 'upload-id' } })
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: file.length })).resolves.toEqual({
      reason: 'attachment_upload_failed',
      status: 'manual_upload_required'
    })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/merge_block/'))).toBe(false)
  })

  it('follows guarded guest-login redirects and removes the temporary listeners', async () => {
    const responses = successfulPreparedResponses()
    const { browserSession, fetch, onBeforeRedirect, onBeforeRequest, triggerBeforeRedirect, triggerBeforeRequest } =
      createSessionMock([
        (url, init) => {
          expect(url).toBe('https://mcnnox2fhjfq.feishu.cn/share/base/form/shrcnufZiSDrvRPIzSKeqcbBbub')
          expect(init?.redirect).toBe('follow')
          expect(triggerBeforeRequest(url)).toBe(false)
          triggerBeforeRedirect('https://accounts.feishu.cn/accounts/page/login')
          expect(triggerBeforeRequest('https://accounts.feishu.cn/accounts/page/login')).toBe(false)
          triggerBeforeRedirect('https://login.feishu.cn/accounts/v1/guest')
          expect(triggerBeforeRequest('https://login.feishu.cn/accounts/v1/guest')).toBe(false)
          expect(triggerBeforeRequest(`${FORM_URL}?auth_token=guest-auth-token`)).toBe(false)
          return new Response('<html></html>', { status: 200 })
        },
        ...responses.slice(1)
      ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'uploaded'
    })

    expect(fetch).toHaveBeenCalledTimes(7)
    expect(onBeforeRequest).toHaveBeenLastCalledWith(null)
    expect(onBeforeRedirect).toHaveBeenLastCalledWith(null)
  })

  it.each(['https://example.com/login', 'https://unexpected.feishu.cn/login'])(
    'rejects a guest redirect to %s and removes the temporary listeners',
    async (redirectUrl) => {
      const { browserSession, onBeforeRedirect, onBeforeRequest, triggerBeforeRedirect, triggerBeforeRequest } =
        createSessionMock([
          () => {
            triggerBeforeRedirect(redirectUrl)
            expect(triggerBeforeRequest(redirectUrl)).toBe(true)
            throw new Error('redirect blocked')
          }
        ])
      const client = new FeishuAnonymousFormClient(() => browserSession)

      await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
        reason: 'form_unavailable',
        status: 'manual_upload_required'
      })
      expect(onBeforeRequest).toHaveBeenLastCalledWith(null)
      expect(onBeforeRedirect).toHaveBeenLastCalledWith(null)
    }
  )

  it('rejects a guest-login chain after eight redirects', async () => {
    const redirectUrl = 'https://login.feishu.cn/accounts/v1/guest'
    const { browserSession, triggerBeforeRedirect, triggerBeforeRequest } = createSessionMock([
      () => {
        for (let redirectCount = 0; redirectCount < 8; redirectCount += 1) {
          triggerBeforeRedirect(redirectUrl)
          expect(triggerBeforeRequest(redirectUrl)).toBe(false)
        }
        triggerBeforeRedirect(redirectUrl)
        expect(triggerBeforeRequest(redirectUrl)).toBe(true)
        throw new Error('too many redirects')
      }
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'form_unavailable',
      status: 'manual_upload_required'
    })
  })

  it('reports a genuine guest-session fetch failure as a network error and removes the temporary listeners', async () => {
    const { browserSession, onBeforeRedirect, onBeforeRequest } = createSessionMock([new Error('offline')])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'network_failed',
      status: 'manual_upload_required'
    })
    expect(onBeforeRequest).toHaveBeenLastCalledWith(null)
    expect(onBeforeRedirect).toHaveBeenLastCalledWith(null)
  })

  it.each([
    ['missing', null],
    ['oversized', 'x'.repeat(4097)]
  ])('rejects a %s guest auth token', async (_label, authToken) => {
    const { browserSession, fetch, onBeforeRedirect, onBeforeRequest } = createSessionMock([
      guestSessionResponse(authToken)
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'form_unavailable',
      status: 'manual_upload_required'
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(onBeforeRequest).toHaveBeenLastCalledWith(null)
    expect(onBeforeRedirect).toHaveBeenLastCalledWith(null)
  })

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
      guestSessionResponse(),
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
    const responses = successfulPreparedResponses()
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
    const responses = successfulPreparedResponses()
    responses[6] = new Error('connection closed')
    const { browserSession, fetch } = createSessionMock(responses)
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'submission_unknown'
    })
    expect(fetch).toHaveBeenCalledTimes(7)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/bitable/share/content'))).toHaveLength(1)
  })

  it('treats a nonzero final response code as an explicit rejection', async () => {
    const { browserSession } = createSessionMock(successfulPreparedResponses(jsonResponse({ code: 4, data: {} })))
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
    const { browserSession, fetch } = createSessionMock([guestSessionResponse(), oversizedResponse])
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
    const { browserSession, fetch } = createSessionMock([guestSessionResponse(), stalledResponse])
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
