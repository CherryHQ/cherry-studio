import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { adler32, FeishuAnonymousFormClient, resolveAttachmentFieldId } from '../FeishuAnonymousFormClient'

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

function createSessionMock(responses: Array<Response | Error>) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const response = responses.shift()
    if (!response) throw new Error('Unexpected request')
    if (response instanceof Error) throw response
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
    await rm(workDir, { force: true, recursive: true })
  })

  function successfulResponses(finalResponse: Response = jsonResponse({ code: 0, data: {} })): Array<Response | Error> {
    return [
      new Response('<html></html>', { status: 200 }),
      jsonResponse({ code: 0, data: { snapshot: JSON.stringify(formSnapshot()) } }),
      jsonResponse({ code: 0, data: { uploadCode: 'upload-code' } }),
      jsonResponse({ code: 0, data: { block_size: 4, num_blocks: 2, upload_id: 'upload-id' } }),
      jsonResponse({ code: 0, data: { success_seq_list: [0] } }),
      jsonResponse({ code: 0, data: { success_seq_list: [1] } }),
      jsonResponse({ code: 0, data: { file_token: 'attachment-token' } }),
      finalResponse
    ]
  }

  it('uploads every block and submits the live attachment field exactly once', async () => {
    const { browserSession, fetch } = createSessionMock(successfulResponses())
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'uploaded'
    })

    expect(fetch).toHaveBeenCalledTimes(8)
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

  it('uses a single upload block for a small attachment', async () => {
    const { browserSession, fetch } = createSessionMock([
      new Response('<html></html>', { status: 200 }),
      jsonResponse({ code: 0, data: { snapshot: JSON.stringify(formSnapshot()) } }),
      jsonResponse({ code: 0, data: { uploadCode: 'upload-code' } }),
      jsonResponse({ code: 0, data: { block_size: 16, num_blocks: 1, upload_id: 'upload-id' } }),
      jsonResponse({ code: 0, data: { success_seq_list: [0] } }),
      jsonResponse({ code: 0, data: { file_token: 'attachment-token' } }),
      jsonResponse({ code: 0, data: {} })
    ])
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'uploaded'
    })
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/merge_block/'))).toHaveLength(1)
  })

  it('follows and validates the guest-login redirect chain', async () => {
    const redirect = new Response(null, {
      headers: { location: 'https://login.feishu.cn/accounts/v1/guest' },
      status: 302
    })
    const responses = successfulResponses()
    responses.unshift(redirect)
    const { browserSession, fetch } = createSessionMock(responses)
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'uploaded'
    })
    expect(fetch.mock.calls[1][0]).toBe('https://login.feishu.cn/accounts/v1/guest')
  })

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
    const responses = successfulResponses()
    responses[4] = jsonResponse({ code: 1, data: {} })
    const { browserSession, fetch } = createSessionMock(responses)
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'attachment_upload_failed',
      status: 'manual_upload_required'
    })
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('reports an uncertain result without retrying an interrupted final submission', async () => {
    const responses = successfulResponses()
    responses[7] = new Error('connection closed')
    const { browserSession, fetch } = createSessionMock(responses)
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      status: 'submission_unknown'
    })
    expect(fetch).toHaveBeenCalledTimes(8)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/bitable/share/content'))).toHaveLength(1)
  })

  it('treats a nonzero final response code as an explicit rejection', async () => {
    const { browserSession } = createSessionMock(successfulResponses(jsonResponse({ code: 4, data: {} })))
    const client = new FeishuAnonymousFormClient(() => browserSession)

    await expect(client.upload({ fileName: 'diagnostics.zip', filePath, fileSize: 8 })).resolves.toEqual({
      reason: 'submission_rejected',
      status: 'manual_upload_required'
    })
  })
})

describe('Feishu upload helpers', () => {
  it('uses the checksum format expected by the Drive upload endpoint', () => {
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe('300286872')
  })

  it('accepts one visible attachment field and optional sibling fields', () => {
    expect(resolveAttachmentFieldId(formSnapshot())).toBe('attachment')
  })
})
