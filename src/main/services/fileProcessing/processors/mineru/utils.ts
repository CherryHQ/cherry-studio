import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'

import { MB } from '@shared/config/constant'
import type { FileMetadata } from '@types'
import { net } from 'electron'

import { sanitizeFileProcessingRemoteUrl } from '../../utils/url'
import {
  MineruApiResponseSchema,
  MineruBatchUploadDataSchema,
  type MineruExtractFileResult,
  type MineruExtractResultsData,
  MineruExtractResultsDataSchema,
  type PreparedMineruQueryContext,
  type PreparedMineruStartContext
} from './types'

const MINERU_MAX_FILE_SIZE = 200 * MB

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
  configuredApiHost: string,
  uploadHeaders?: Record<string, string>,
  signal?: AbortSignal
): Promise<void> {
  const stat = await fs.stat(file.path)

  if (stat.size >= MINERU_MAX_FILE_SIZE) {
    throw new Error('Mineru file is too large (must be smaller than 200MB)')
  }

  const safeUploadUrl = sanitizeFileProcessingRemoteUrl(uploadUrl, configuredApiHost)
  const fileStream = createReadStream(file.path)

  try {
    const response = await net.fetch(safeUploadUrl, {
      method: 'PUT',
      headers: uploadHeaders,
      body: fileStream as any,
      duplex: 'half',
      redirect: 'error',
      signal
    } as any)

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Mineru file upload failed: ${response.status} ${response.statusText} ${message}`)
    }
  } finally {
    fileStream.destroy()
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
