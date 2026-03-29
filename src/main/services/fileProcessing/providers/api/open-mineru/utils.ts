import fs from 'node:fs/promises'

import { net } from 'electron'
import FormData from 'form-data'

import type { PreparedOpenMineruContext } from './types'

export async function executeTask(context: PreparedOpenMineruContext): Promise<Buffer> {
  const endpoint = `${context.apiHost}/file_parse`
  const fileBuffer = await fs.readFile(context.file.path)

  const formData = new FormData()
  formData.append('return_md', 'true')
  formData.append('response_format_zip', 'true')
  formData.append('files', fileBuffer, {
    filename: context.file.name
  })

  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {}),
      ...formData.getHeaders()
    },
    body: new Uint8Array(formData.getBuffer()),
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Open MinerU request failed: ${response.status} ${response.statusText} ${message}`)
  }

  const contentType = response.headers.get('content-type')

  if (contentType !== 'application/zip') {
    throw new Error(`Open MinerU returned unexpected content-type: ${contentType}`)
  }

  return Buffer.from(await response.arrayBuffer())
}
