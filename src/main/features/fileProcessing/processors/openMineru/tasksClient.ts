import { openAsBlob } from 'node:fs'

import type * as z from 'zod'

import { application } from '@application'
import { t } from '@main/i18n'
import type { FileInfo } from '@shared/types/file'

import { readMarkdownFromResponseZip } from '../../persistence/resultPersistence'
import { assertSuccessful, requestJson, resolveTransferUrl, withTransferResponse } from './http'
import { TasksResponseSchema } from './schemas'
import type { OpenMineruConnection } from './types'

export async function createParseTask(connection: OpenMineruConnection, file: FileInfo, signal?: AbortSignal) {
  const input = { file_name: file.ext ? `${file.name}.${file.ext}` : file.name, bytes: file.size }

  if (file.ext?.toLowerCase() === 'pdf') Object.assign(input, { page_range: 'all' })

  const task = await requestJson(connection, '/v1/tasks', TasksResponseSchema, signal, {
    files: [input],
    output_formats: ['default']
  })

  return task.task_id
}

export async function getParseTask(connection: OpenMineruConnection, taskId: string, signal?: AbortSignal) {
  const task = await requestJson(connection, `/v1/tasks/${encodeURIComponent(taskId)}`, TasksResponseSchema, signal)

  if (task.task_id !== taskId) throw new Error(t('file_processing.errors.open_mineru_invalid_response'))

  return task
}

export async function uploadTaskFile(
  connection: OpenMineruConnection,
  file: FileInfo,
  upload: NonNullable<z.infer<typeof TasksResponseSchema>['files'][number]['upload']>,
  signal?: AbortSignal
) {
  const url = resolveTransferUrl(upload.url, `${connection.apiHost}/`, connection.apiHost)
  const headers = new Headers(upload.headers)

  if (connection.apiKey && new URL(url).origin === new URL(connection.apiHost).origin) {
    headers.set('Authorization', `Bearer ${connection.apiKey}`)
  }

  await withTransferResponse(
    connection,
    url,
    { method: 'PUT', headers, body: await openAsBlob(file.path), signal },
    async (response) => {
      assertSuccessful(response)
    }
  )
}

export async function downloadTaskMarkdown(connection: OpenMineruConnection, resultUrl: string, signal?: AbortSignal) {
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

        if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/zip') {
          throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
        }

        const bytes = await readMarkdownFromResponseZip({
          response,
          tempDir: application.getPath('feature.file_processing.temp'),
          signal
        })

        return { markdown: new TextDecoder().decode(bytes) }
      }
    )

    if (result.markdown !== undefined) return result.markdown

    if (!result.location) break
    url = resolveTransferUrl(result.location, url, connection.apiHost)
    maySendKey = maySendKey && new URL(url).origin === new URL(connection.apiHost).origin
  }

  throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
}
