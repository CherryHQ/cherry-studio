import { openAsBlob } from 'node:fs'
import fs from 'node:fs/promises'

import { MB } from '@shared/utils/constants'
import { net } from 'electron'

import type { PreparedOpenMineruContext } from './types'

const OPEN_MINERU_MAX_FILE_SIZE = 200 * MB

export async function executeTask(context: PreparedOpenMineruContext): Promise<Response> {
  const endpoint = `${context.apiHost}/file_parse`
  const stat = await fs.stat(context.file.path)

  if (stat.size >= OPEN_MINERU_MAX_FILE_SIZE) {
    throw new Error('Open MinerU file is too large (must be smaller than 200MB)')
  }

  const file = await openAsBlob(context.file.path)

  const formData = new FormData()
  formData.append('return_md', 'true')
  formData.append('response_format_zip', 'true')
  formData.append('files', file, context.file.ext ? `${context.file.name}.${context.file.ext}` : context.file.name)

  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : undefined,
    body: formData,
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Open MinerU request failed: ${response.status} ${response.statusText} ${message}`)
  }

  const contentType = response.headers.get('content-type')

  // Intentional contract check:
  // when `response_format_zip=true`, this adapter only accepts an exact
  // `application/zip` response. We fail fast on any other content-type
  // instead of broadening compatibility implicitly, so provider contract
  // changes stay explicit and visible.
  if (contentType !== 'application/zip') {
    throw new Error(`Open MinerU returned unexpected content-type: ${contentType}`)
  }

  return response
}
