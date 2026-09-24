import { openAsBlob } from 'node:fs'

import { net } from 'electron'
import type * as z from 'zod'

import { t } from '@main/i18n'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
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
    const response = await net.fetch(uploadUrl, {
      method: upload.upload_method,
      headers,
      body,
      redirect: 'manual',
      credentials: 'omit',
      signal
    })
    await response.body?.cancel()
    assertSuccessful(response)

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
    const response = await net.fetch(url, {
      headers: maySendKey && connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : undefined,
      redirect: 'manual',
      credentials: 'omit',
      signal
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) break
      url = resolveTransferUrl(location, url, connection.apiHost)
      maySendKey = maySendKey && new URL(url).origin === new URL(connection.apiHost).origin
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      assertSuccessful(response)
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (!contentType || !['text/plain', 'text/markdown', 'application/octet-stream'].includes(contentType)) {
      await response.body?.cancel()
      throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
    }
    return response.text()
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
