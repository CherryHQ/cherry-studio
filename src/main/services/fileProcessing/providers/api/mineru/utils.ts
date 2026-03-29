import fs from 'node:fs/promises'

import type { FileMetadata } from '@types'
import { net } from 'electron'

import {
  MineruApiResponseSchema,
  MineruBatchUploadDataSchema,
  type MineruExtractFileResult,
  type MineruExtractResultsData,
  MineruExtractResultsDataSchema,
  type PreparedMineruQueryContext,
  type PreparedMineruStartContext
} from './types'

export async function createUploadTask(context: PreparedMineruStartContext): Promise<{
  batchId: string
  uploadUrl: string
  uploadHeaders?: Record<string, string>
}> {
  const endpoint = `${context.apiHost}/api/v4/file-urls/batch`

  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.apiKey}`,
      Accept: '*/*'
    },
    body: JSON.stringify({
      files: [
        {
          name: context.file.origin_name,
          data_id: context.file.id
        }
      ],
      model_version: context.modelVersion
    }),
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Mineru batch upload URL request failed: ${response.status} ${response.statusText} ${message}`)
  }

  const payload = MineruApiResponseSchema(MineruBatchUploadDataSchema).parse(await response.json())

  if (payload.code !== 0) {
    throw new Error(payload.msg || 'Mineru batch upload URL request failed')
  }

  return {
    batchId: payload.data.batch_id,
    uploadUrl: payload.data.file_urls[0],
    uploadHeaders: payload.data.headers?.[0]
  }
}

export async function uploadFile(
  file: FileMetadata,
  uploadUrl: string,
  uploadHeaders?: Record<string, string>,
  signal?: AbortSignal
): Promise<void> {
  const fileBuffer = await fs.readFile(file.path)

  const response = await net.fetch(uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: new Uint8Array(fileBuffer),
    signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Mineru file upload failed: ${response.status} ${response.statusText} ${message}`)
  }
}

export async function getBatchResult(
  providerTaskId: string,
  context: PreparedMineruQueryContext
): Promise<MineruExtractResultsData> {
  const endpoint = `${context.apiHost}/api/v4/extract-results/batch/${providerTaskId}`
  const response = await net.fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${context.apiKey}`,
      Accept: '*/*'
    },
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Mineru batch result request failed: ${response.status} ${response.statusText} ${message}`)
  }

  const payload = MineruApiResponseSchema(MineruExtractResultsDataSchema).parse(await response.json())

  if (payload.code !== 0) {
    throw new Error(payload.msg || 'Mineru batch result request failed')
  }

  return payload.data
}

export function mapProgress(fileResult: MineruExtractFileResult): number {
  if (fileResult.state === 'converting') {
    return 99
  }

  const extractedPages = fileResult.extract_progress?.extracted_pages
  const totalPages = fileResult.extract_progress?.total_pages

  if (!extractedPages || !totalPages) {
    return 0
  }

  return Math.min(99, Math.max(0, Math.round((extractedPages / totalPages) * 100)))
}
