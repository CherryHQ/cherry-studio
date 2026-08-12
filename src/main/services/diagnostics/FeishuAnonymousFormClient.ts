import { readFile, stat } from 'node:fs/promises'

import type { DiagnosticUploadFallbackReason } from '@shared/ipc/schemas/diagnostics'
import { DIAGNOSTIC_FEEDBACK_FORM_URL } from '@shared/utils/diagnostics'
import { type Session, session } from 'electron'

const SHARE_TOKEN = 'shrcnufZiSDrvRPIzSKeqcbBbub'
const FORM_ORIGIN = 'https://mcnnox2fhjfq.feishu.cn'
const DRIVE_API_ORIGIN = 'https://internal-api-drive-stream.feishu.cn'
const UPLOAD_MOUNT_POINT = 'bitable_tmp_point'
const MAX_REDIRECTS = 8
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024
const MAX_UPLOAD_BLOCKS = 64
const REQUEST_TIMEOUT_MS = 30_000
const CHUNK_UPLOAD_TIMEOUT_MS = 60_000
const ALLOWED_FEISHU_HOSTNAMES = new Set([
  'accounts.feishu.cn',
  'internal-api-drive-stream.feishu.cn',
  'login.feishu.cn',
  'mcnnox2fhjfq.feishu.cn'
])

interface JsonResponse {
  readonly code: number
  readonly data?: unknown
}

interface UploadInput {
  readonly fileName: string
  readonly filePath: string
  readonly fileSize: number
}

interface GuestCredentials {
  readonly authToken: string
  readonly csrfToken: string
}

export type FeishuAnonymousFormUploadResult =
  | { readonly status: 'uploaded' }
  | { readonly reason: DiagnosticUploadFallbackReason; readonly status: 'manual_upload_required' }
  | { readonly status: 'submission_unknown' }

class FeishuUploadFailure extends Error {
  constructor(readonly reason: DiagnosticUploadFallbackReason) {
    super('Anonymous diagnostic upload failed')
  }
}

function isAllowedFeishuUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      ALLOWED_FEISHU_HOSTNAMES.has(url.hostname)
    )
  } catch {
    return false
  }
}

function assertAllowedUrl(value: string): void {
  if (!isAllowedFeishuUrl(value)) throw new FeishuUploadFailure('form_unavailable')
}

function getGuestAuthToken(value: string): string | null {
  assertAllowedUrl(value)
  const authTokens = new URL(value).searchParams.getAll('auth_token')
  if (authTokens.length === 0) return null
  if (authTokens.length !== 1 || authTokens[0].length === 0 || authTokens[0].length > 4096) {
    throw new FeishuUploadFailure('form_unavailable')
  }
  return authTokens[0]
}

async function fetchWithTimeout<T>(
  browserSession: Session,
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T> | T,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T> {
  assertAllowedUrl(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await browserSession.fetch(url, { redirect: 'manual', ...init, signal: controller.signal })
    return await consume(response)
  } finally {
    clearTimeout(timeout)
  }
}

async function readJsonResponse(response: Response): Promise<JsonResponse> {
  const contentLengthHeader = response.headers.get('content-length')
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Invalid response')
  }
  if (contentLengthHeader !== null) {
    const normalizedContentLength = contentLengthHeader.trim()
    const contentLength = Number(normalizedContentLength)
    if (
      !/^\d+$/.test(normalizedContentLength) ||
      !Number.isSafeInteger(contentLength) ||
      contentLength > MAX_RESPONSE_BYTES
    ) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Invalid response length')
    }
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('Invalid response body')
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Response too large')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  const text = Buffer.concat(chunks, totalBytes).toString('utf8')
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== 'object' || typeof (value as JsonResponse).code !== 'number') {
    throw new Error('Invalid response body')
  }
  return value as JsonResponse
}

async function getCsrfToken(browserSession: Session): Promise<string> {
  const cookies = await browserSession.cookies.get({ name: '_csrf_token', url: FORM_ORIGIN })
  return cookies[0]?.value ?? ''
}

function requestHeaders(
  credentials: GuestCredentials,
  command: string,
  referer = DIAGNOSTIC_FEEDBACK_FORM_URL
): HeadersInit {
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: FORM_ORIGIN,
    Referer: referer,
    'X-Auth-Token': credentials.authToken,
    'X-Command': command,
    'X-CSRFToken': credentials.csrfToken
  }
}

function jsonRequestHeaders(credentials: GuestCredentials, command: string, referer?: string): HeadersInit {
  return { ...requestHeaders(credentials, command, referer), 'Content-Type': 'application/json' }
}

async function fetchJsonWithTimeout(
  browserSession: Session,
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<JsonResponse> {
  return fetchWithTimeout(browserSession, url, init, readJsonResponse, timeoutMs)
}

async function bootstrapGuestSession(browserSession: Session): Promise<string> {
  let redirectCount = 0
  let guardRejected = false
  let authToken: string | null = null
  const filter = { urls: ['<all_urls>'] }
  const observeAuthToken = (value: string) => {
    try {
      const observedAuthToken = getGuestAuthToken(value)
      if (observedAuthToken && authToken && observedAuthToken !== authToken) {
        guardRejected = true
      } else if (observedAuthToken) {
        authToken = observedAuthToken
      }
    } catch {
      guardRejected = true
    }
  }

  try {
    browserSession.webRequest.onBeforeRequest(filter, (details, callback) => {
      if (!isAllowedFeishuUrl(details.url)) {
        guardRejected = true
      } else {
        observeAuthToken(details.url)
      }
      callback({ cancel: guardRejected })
    })
    browserSession.webRequest.onBeforeRedirect(filter, (details) => {
      redirectCount += 1
      if (redirectCount > MAX_REDIRECTS || !isAllowedFeishuUrl(details.redirectURL)) {
        guardRejected = true
      } else {
        observeAuthToken(details.redirectURL)
      }
    })

    try {
      return await fetchWithTimeout(
        browserSession,
        DIAGNOSTIC_FEEDBACK_FORM_URL,
        { redirect: 'follow' },
        async (value) => {
          const responseUrl = value.url
          const ok = value.ok
          await value.body?.cancel().catch(() => undefined)
          if (responseUrl) observeAuthToken(responseUrl)
          if (!ok || guardRejected || !authToken) throw new FeishuUploadFailure('form_unavailable')
          return authToken
        }
      )
    } catch (error) {
      if (error instanceof FeishuUploadFailure) throw error
      throw new FeishuUploadFailure(guardRejected ? 'form_unavailable' : 'network_failed')
    }
  } finally {
    browserSession.webRequest.onBeforeRequest(null)
    browserSession.webRequest.onBeforeRedirect(null)
  }
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function resolveAttachmentFieldId(snapshot: unknown): string {
  const root = recordFrom(snapshot)
  const fieldMap = recordFrom(root?.fieldMap)
  const viewProperty = recordFrom(root?.viewProperty)
  const fieldInfos = recordFrom(viewProperty?.fieldInfos)
  const fields = viewProperty?.fields
  const formExtraEntity = recordFrom(root?.formExtraEntity)
  if (
    !fieldMap ||
    !fieldInfos ||
    !Array.isArray(fields) ||
    formExtraEntity?.enableAnonymousSubmit !== true ||
    formExtraEntity.publishStatus !== 1 ||
    root?.forbiddenSubmit === true ||
    root?.banned === true ||
    root?.isExceedMaxRecord === true ||
    root?.isExceedBaseLimitMaxRows === true
  ) {
    throw new FeishuUploadFailure('form_changed')
  }

  const fieldMetadata = fields.map((fieldId) => {
    if (typeof fieldId !== 'string') throw new FeishuUploadFailure('form_changed')
    const fieldInfo = recordFrom(fieldInfos[fieldId])
    const field = recordFrom(fieldMap[fieldId])
    if (!fieldInfo || !field || typeof fieldInfo.visible !== 'boolean' || typeof fieldInfo.required !== 'boolean') {
      throw new FeishuUploadFailure('form_changed')
    }
    return { field, fieldId, fieldInfo }
  })
  const visibleFields = fieldMetadata.filter(({ fieldInfo }) => fieldInfo.visible)
  const attachmentFields = visibleFields.filter(({ field }) => field.type === 17 && field.fieldUIType === 'Attachment')
  const hasOtherRequiredField = visibleFields.some(({ fieldId, fieldInfo }) => {
    if (attachmentFields.some((attachment) => attachment.fieldId === fieldId)) return false
    return fieldInfo.required
  })
  if (attachmentFields.length !== 1 || hasOtherRequiredField) {
    throw new FeishuUploadFailure('form_changed')
  }
  return attachmentFields[0].fieldId
}

function requireObjectData(response: JsonResponse): Record<string, unknown> {
  const data = recordFrom(response.data)
  if (response.code !== 0 || !data) throw new Error('Invalid API response')
  return data
}

async function getAttachmentFieldId(browserSession: Session, credentials: GuestCredentials): Promise<string> {
  const url = `${FORM_ORIGIN}/space/api/bitable/external/share/content_meta?shareToken=${SHARE_TOKEN}`
  try {
    const json = await fetchJsonWithTimeout(browserSession, url, {
      headers: requestHeaders(credentials, 'api.bitable.external.share.content_meta')
    })
    const snapshotText = requireObjectData(json).snapshot
    if (typeof snapshotText !== 'string' || Buffer.byteLength(snapshotText) > MAX_RESPONSE_BYTES) {
      throw new Error('Invalid form snapshot')
    }
    return resolveAttachmentFieldId(JSON.parse(snapshotText) as unknown)
  } catch (error) {
    if (error instanceof FeishuUploadFailure) throw error
    throw new FeishuUploadFailure('form_unavailable')
  }
}

async function requestUploadCode(
  browserSession: Session,
  credentials: GuestCredentials,
  input: UploadInput
): Promise<string> {
  const query = new URLSearchParams({
    fileName: input.fileName,
    mountPoint: UPLOAD_MOUNT_POINT,
    shareToken: SHARE_TOKEN,
    size: String(input.fileSize)
  })
  const url = `${FORM_ORIGIN}/space/api/bitable/external/share/uploadCode?${query.toString()}`
  const response = await fetchJsonWithTimeout(browserSession, url, {
    headers: requestHeaders(credentials, 'api.bitable.external.share.uploadCode')
  })
  const uploadCode = requireObjectData(response).uploadCode
  if (typeof uploadCode !== 'string' || uploadCode.length === 0 || uploadCode.length > 4096) {
    throw new Error('Invalid upload authorization')
  }
  return uploadCode
}

interface PreparedUpload {
  readonly blockSize: number
  readonly totalBlocks: number
  readonly uploadId: string
}

async function prepareUpload(
  browserSession: Session,
  credentials: GuestCredentials,
  uploadCode: string
): Promise<PreparedUpload> {
  const url = `${FORM_ORIGIN}/space/api/box/upload/prepare/authcode/`
  const response = await fetchJsonWithTimeout(browserSession, url, {
    body: JSON.stringify({
      code: uploadCode,
      mount_node_token: SHARE_TOKEN,
      mount_point: UPLOAD_MOUNT_POINT
    }),
    headers: jsonRequestHeaders(credentials, 'space.api.box.upload.prepare.authcode', `${FORM_ORIGIN}/`),
    method: 'POST'
  })
  const data = requireObjectData(response)
  const blockSize = data.block_size
  const totalBlocks = data.num_blocks
  const uploadId = data.upload_id
  if (
    !Number.isInteger(blockSize) ||
    (blockSize as number) <= 0 ||
    (blockSize as number) > MAX_UPLOAD_BYTES ||
    !Number.isInteger(totalBlocks) ||
    (totalBlocks as number) <= 0 ||
    (totalBlocks as number) > MAX_UPLOAD_BLOCKS ||
    typeof uploadId !== 'string' ||
    uploadId.length === 0 ||
    uploadId.length > 4096
  ) {
    throw new Error('Invalid upload preparation')
  }
  return { blockSize: blockSize as number, totalBlocks: totalBlocks as number, uploadId }
}

export function adler32(data: Uint8Array): string {
  const modulo = 65_521
  const maxChunk = 5_552
  let a = 1
  let b = 0
  for (let offset = 0; offset < data.length; offset += maxChunk) {
    const end = Math.min(offset + maxChunk, data.length)
    for (let index = offset; index < end; index += 1) {
      a += data[index]
      b += a
    }
    a %= modulo
    b %= modulo
  }
  return String(((b << 16) | a) >>> 0)
}

async function uploadBlocks(
  browserSession: Session,
  credentials: GuestCredentials,
  file: Buffer,
  prepared: PreparedUpload
): Promise<void> {
  if (Math.ceil(file.length / prepared.blockSize) !== prepared.totalBlocks) {
    throw new Error('Upload block count mismatch')
  }
  for (let sequence = 0; sequence < prepared.totalBlocks; sequence += 1) {
    const start = sequence * prepared.blockSize
    const block = new Uint8Array(file.subarray(start, Math.min(start + prepared.blockSize, file.length)))
    const query = new URLSearchParams({ upload_id: prepared.uploadId })
    const url = `${DRIVE_API_ORIGIN}/space/api/box/stream/upload/merge_block/?${query.toString()}`
    const response = await fetchWithTimeout(
      browserSession,
      url,
      {
        body: block,
        headers: {
          ...requestHeaders(credentials, 'space.api.box.stream.upload.merge_block', `${FORM_ORIGIN}/`),
          'Content-Type': 'application/octet-stream',
          'x-block-list-checksum': adler32(block),
          'x-block-origin-size': String(block.byteLength),
          'x-seq-list': String(sequence)
        },
        method: 'POST'
      },
      readJsonResponse,
      CHUNK_UPLOAD_TIMEOUT_MS
    )
    const successSequences = requireObjectData(response).success_seq_list
    if (!Array.isArray(successSequences) || !successSequences.includes(sequence)) {
      throw new Error('Upload block was not accepted')
    }
  }
}

async function finishUpload(
  browserSession: Session,
  credentials: GuestCredentials,
  prepared: PreparedUpload
): Promise<string> {
  const url = `${FORM_ORIGIN}/space/api/box/upload/finish/`
  const response = await fetchJsonWithTimeout(browserSession, url, {
    body: JSON.stringify({
      num_blocks: prepared.totalBlocks,
      push_open_history_record: 0,
      upload_id: prepared.uploadId
    }),
    headers: jsonRequestHeaders(credentials, 'space.api.box.upload.finish', `${FORM_ORIGIN}/`),
    method: 'POST'
  })
  const fileToken = requireObjectData(response).file_token
  if (typeof fileToken !== 'string' || fileToken.length === 0 || fileToken.length > 4096) {
    throw new Error('Invalid uploaded attachment token')
  }
  return fileToken
}

async function submitForm(
  browserSession: Session,
  credentials: GuestCredentials,
  attachmentFieldId: string,
  attachmentToken: string,
  input: UploadInput
): Promise<FeishuAnonymousFormUploadResult> {
  const url = `${FORM_ORIGIN}/space/api/bitable/share/content`
  const attachment = {
    attachmentToken,
    id: attachmentToken,
    mimeType: 'application/zip',
    name: input.fileName,
    size: input.fileSize,
    timeStamp: Date.now()
  }
  let response: FeishuAnonymousFormUploadResult
  try {
    response = await fetchWithTimeout(
      browserSession,
      url,
      {
        body: JSON.stringify({
          data: JSON.stringify({ [attachmentFieldId]: { type: 17, value: [attachment] } }),
          preUploadEnable: true,
          shareToken: SHARE_TOKEN
        }),
        headers: jsonRequestHeaders(credentials, 'api.bitable.share.content'),
        method: 'POST'
      },
      async (value) => {
        if (value.status >= 400 && value.status < 500) {
          await value.body?.cancel().catch(() => undefined)
          return { reason: 'submission_rejected', status: 'manual_upload_required' } as const
        }
        const json = await readJsonResponse(value)
        return json.code === 0
          ? ({ status: 'uploaded' } as const)
          : ({ reason: 'submission_rejected', status: 'manual_upload_required' } as const)
      }
    )
  } catch {
    return { status: 'submission_unknown' }
  }
  return response
}

export class FeishuAnonymousFormClient {
  constructor(
    private readonly createSession: () => Session = () =>
      session.fromPartition('cherry-diagnostics-upload', { cache: false })
  ) {}

  async upload(input: UploadInput): Promise<FeishuAnonymousFormUploadResult> {
    let browserSession: Session | null = null
    try {
      browserSession = this.createSession()
      await browserSession.clearStorageData()
      const fileStats = await stat(input.filePath)
      if (
        !fileStats.isFile() ||
        fileStats.size !== input.fileSize ||
        input.fileSize <= 0 ||
        input.fileSize > MAX_UPLOAD_BYTES
      ) {
        return { reason: 'attachment_upload_failed', status: 'manual_upload_required' }
      }

      const authToken = await bootstrapGuestSession(browserSession)
      const credentials = { authToken, csrfToken: await getCsrfToken(browserSession) }
      const attachmentFieldId = await getAttachmentFieldId(browserSession, credentials)

      let attachmentToken: string
      try {
        const file = await readFile(input.filePath)
        const uploadCode = await requestUploadCode(browserSession, credentials, input)
        const prepared = await prepareUpload(browserSession, credentials, uploadCode)
        await uploadBlocks(browserSession, credentials, file, prepared)
        attachmentToken = await finishUpload(browserSession, credentials, prepared)
      } catch {
        return { reason: 'attachment_upload_failed', status: 'manual_upload_required' }
      }

      return await submitForm(browserSession, credentials, attachmentFieldId, attachmentToken, input)
    } catch (error) {
      return {
        reason: error instanceof FeishuUploadFailure ? error.reason : 'network_failed',
        status: 'manual_upload_required'
      }
    } finally {
      if (browserSession) {
        await Promise.allSettled([browserSession.clearCache(), browserSession.clearStorageData()])
      }
    }
  }
}

export const feishuAnonymousFormClient = new FeishuAnonymousFormClient()
