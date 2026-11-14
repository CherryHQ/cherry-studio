import { openAsBlob } from 'node:fs'

import { net } from 'electron'
import type * as z from 'zod'

import { application } from '@application'
import { t } from '@main/i18n'
import { createPinnedDispatcher } from '@main/services/proxy/pinnedDispatcher'
import { resolveRemoteFetchUrl, sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { FileInfo } from '@shared/types/file'

import { readMarkdownFromResponseZip } from '../../persistence/resultPersistence'
import { TasksCreateResponseSchema, TasksTaskDetailSchema } from './schemas'
import type { OpenMineruConnection } from './types'

export async function startTasksParse(connection: OpenMineruConnection, file: FileInfo, signal?: AbortSignal) {
  const task = await requestJson(connection, '/v1/tasks', TasksCreateResponseSchema, signal, {
    files: [
      {
        file_name: file.ext ? `${file.name}.${file.ext}` : file.name,
        bytes: file.size,
        ...(file.ext?.toLowerCase() === 'pdf' ? { page_range: 'all' } : {})
      }
    ],
    output_formats: ['default']
  })
  const item = task.files[0]
  if (item.status === 'waiting-file' && item.upload) {
    const url = resolveTransferUrl(item.upload.url, `${connection.apiHost}/`, connection.apiHost)
    const headers = new Headers(item.upload.headers ?? {})
    if (connection.apiKey && new URL(url).origin === new URL(connection.apiHost).origin) {
      headers.set('Authorization', `Bearer ${connection.apiKey}`)
    }
    await withTransferResponse(
      connection,
      url,
      { method: 'PUT', headers, body: await openAsBlob(file.path), signal },
      async (response) => assertSuccessful(response)
    )
  }
  return { taskId: task.task_id, fileId: item.file_id }
}

export async function getTasksParseTask(
  connection: OpenMineruConnection,
  taskId: string,
  fileId: string,
  signal?: AbortSignal
) {
  const task = await requestJson(connection, `/v1/tasks/${encodeURIComponent(taskId)}`, TasksTaskDetailSchema, signal)
  if (task.task_id !== taskId || task.files[0].file_id !== fileId)
    throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  return task
}

export async function downloadTasksMarkdown(
  connection: OpenMineruConnection,
  resultUrl: string,
  signal?: AbortSignal
): Promise<string> {
  let url = resolveTransferUrl(resultUrl, `${connection.apiHost}/`, connection.apiHost)
  let maySendKey = new URL(url).origin === new URL(connection.apiHost).origin
  for (let redirects = 0; redirects <= 5; redirects++) {
    const result = await withTransferResponse(
      connection,
      url,
      {
        headers: new Headers(maySendKey && connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
        signal
      },
      async (response) => {
        if ([301, 302, 303, 307, 308].includes(response.status)) return { location: response.headers.get('location') }
        assertSuccessful(response)
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
        if (!contentType || !['application/zip', 'application/octet-stream'].includes(contentType))
          throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
        const bytes = await readMarkdownFromResponseZip({
          response,
          tempDir: application.getPath('feature.file_processing.temp'),
          signal
        })
        return { markdown: new TextDecoder().decode(bytes) }
      }
    )
    if (result.markdown !== undefined) return result.markdown
    if (!result.location || redirects === 5) break
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
    response = await fetch(target.url, { ...init, credentials: 'omit', redirect: 'manual', ...{ dispatcher } })
    return await consume(response)
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await dispatcher.destroy()
  }
}
