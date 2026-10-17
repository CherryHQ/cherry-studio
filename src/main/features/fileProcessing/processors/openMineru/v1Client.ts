import { openAsBlob } from 'node:fs'

import { net } from 'electron'
import type * as z from 'zod'

import { t } from '@main/i18n'
import { createPinnedDispatcher } from '@main/services/proxy/pinnedDispatcher'
import { resolveRemoteFetchUrl, sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { FileInfo } from '@shared/types/file'

import { V1CompletedUploadSchema, V1JobSchema, V1UploadSchema } from './schemas'
import type { OpenMineruConnection } from './types'

export async function startV1Parse(
  connection: OpenMineruConnection,
  file: FileInfo,
  signal?: AbortSignal
): Promise<string> {
  const upload = await requestJson(connection, '/v1/uploads', V1UploadSchema, signal, {
    filename: file.ext ? `${file.name}.${file.ext}` : file.name,
    bytes: file.size,
    mime_type: file.mime,
    purpose: 'parse'
  })

  let fileId: string
  if (upload.status === 'completed') {
    fileId = upload.file.id
  } else {
    const uploadUrl = resolveTransferUrl(upload.upload_url, `${connection.apiHost}/`, connection.apiHost)
    const headers = new Headers(upload.upload_headers ?? {})
    if (connection.apiKey && new URL(uploadUrl).origin === new URL(connection.apiHost).origin) {
      headers.set('Authorization', `Bearer ${connection.apiKey}`)
    }
    const body = await openAsBlob(file.path)
    await withTransferResponse(
      connection,
      uploadUrl,
      {
        method: upload.upload_method,
        headers,
        body,
        signal
      },
      async (response) => assertSuccessful(response)
    )

    const completed = await requestJson(
      connection,
      `/v1/uploads/${encodeURIComponent(upload.id)}/complete`,
      V1CompletedUploadSchema,
      signal,
      {}
    )
    fileId = completed.file.id
  }

  const job = await requestJson(connection, '/v1/parse/jobs', V1JobSchema, signal, {
    files: [
      {
        source: { type: 'file_id', file_id: fileId },
        ...(file.ext?.toLowerCase() === 'pdf' ? { page_range: 'all' } : {})
      }
    ],
    output_formats: ['markdown']
  })
  return job.job_id
}

export async function getV1ParseJob(connection: OpenMineruConnection, jobId: string, signal?: AbortSignal) {
  const job = await requestJson(connection, `/v1/parse/jobs/${encodeURIComponent(jobId)}`, V1JobSchema, signal)
  if (job.job_id !== jobId) throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  return job
}

export async function downloadV1Markdown(
  connection: OpenMineruConnection,
  fileId: string,
  signal?: AbortSignal
): Promise<string> {
  let url = `${connection.apiHost}/v1/files/${encodeURIComponent(fileId)}/content`
  let maySendKey = true
  for (let redirects = 0; redirects <= 5; redirects++) {
    const result = await withTransferResponse(
      connection,
      url,
      {
        headers: new Headers(maySendKey && connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
        signal
      },
      async (response) => {
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          return { location: response.headers.get('location') }
        }
        assertSuccessful(response)
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
        if (!contentType || !['text/plain', 'text/markdown', 'application/octet-stream'].includes(contentType)) {
          throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
        }
        return { markdown: await response.text() }
      }
    )
    if (result.markdown !== undefined) return result.markdown
    if (!result.location) break
    url = resolveTransferUrl(result.location, url, connection.apiHost)
    maySendKey = maySendKey && new URL(url).origin === new URL(connection.apiHost).origin
  }
  throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
}

async function requestJson<T>(
  connection: OpenMineruConnection,
  endpoint: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  body?: object
): Promise<T> {
  const response = await net.fetch(`${connection.apiHost}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    credentials: 'omit',
    signal
  })
  if (!response.ok) {
    await response.body?.cancel()
    assertSuccessful(response)
  }
  const payload: unknown = await response.json().catch(() => undefined)
  signal?.throwIfAborted()
  const result = schema.safeParse(payload)
  if (!result.success) throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  return result.data
}

function assertSuccessful(response: Response): void {
  if (!response.ok) throw new Error(t('file_processing.errors.open_mineru_request_failed', { status: response.status }))
}

function resolveTransferUrl(value: string, base: string, apiHost: string): string {
  try {
    return sanitizeRemoteUrl(new URL(value, base).href, apiHost)
  } catch {
    throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  }
}

async function withTransferResponse<T>(
  connection: OpenMineruConnection,
  url: string,
  init: { method?: 'PUT'; headers: Headers; body?: Blob; signal?: AbortSignal },
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const target = await resolveRemoteFetchUrl(url, {
    signal: init.signal,
    configuredApiHost: connection.apiHost
  })
  const dispatcher = createPinnedDispatcher(target)
  let response: Response | undefined
  try {
    response = await fetch(target.url, { ...init, redirect: 'manual', ...{ dispatcher } })
    return await consume(response)
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await dispatcher.destroy()
  }
}
