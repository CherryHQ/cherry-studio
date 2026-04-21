import fs, { createReadStream } from 'node:fs'

import { GB } from '@shared/config/constant'
import { net } from 'electron'

import { sanitizeFileProcessingRemoteUrl } from '../../../utils/url'
import {
  type Doc2xExportStatusResponse,
  Doc2xExportStatusResponseSchema,
  type Doc2xParseStatusResponse,
  Doc2xParseStatusResponseSchema,
  Doc2xPreuploadResponseSchema,
  type PreparedDoc2xQueryContext,
  type PreparedDoc2xStartContext
} from './types'

const DOC2X_MAX_FILE_SIZE = GB

export async function createUploadTask(context: PreparedDoc2xStartContext): Promise<{
  uid: string
  uploadUrl: string
}> {
  const endpoint = `${context.apiHost}/api/v2/parse/preupload`
  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.apiKey}`,
      Accept: 'application/json'
    },
    body: JSON.stringify(context.modelVersion ? { model: context.modelVersion } : {}),
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Doc2x preupload request failed: ${response.status} ${response.statusText} ${message}`)
  }

  const payload = Doc2xPreuploadResponseSchema.parse(await response.json())

  if (payload.code !== 'success' || !payload.data) {
    throw new Error(payload.msg || payload.message || `Doc2x preupload request failed: ${payload.code}`)
  }

  return {
    uid: payload.data.uid,
    uploadUrl: payload.data.url
  }
}

export async function uploadFile(
  filePath: string,
  uploadUrl: string,
  configuredApiHost: string,
  signal?: AbortSignal
): Promise<void> {
  const stat = await fs.promises.stat(filePath)

  if (stat.size >= DOC2X_MAX_FILE_SIZE) {
    throw new Error('Doc2x file is too large (must be smaller than 1GB)')
  }

  const safeUploadUrl = sanitizeFileProcessingRemoteUrl(uploadUrl, configuredApiHost)
  const fileStream = createReadStream(filePath)

  try {
    const response = await net.fetch(safeUploadUrl, {
      method: 'PUT',
      body: fileStream as any,
      duplex: 'half',
      signal
    } as any)

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Doc2x file upload failed: ${response.status} ${response.statusText} ${message}`)
    }
  } finally {
    fileStream.destroy()
  }
}

export async function getParseStatus(
  providerTaskId: string,
  context: PreparedDoc2xQueryContext
): Promise<Doc2xParseStatusResponse> {
  const endpoint = `${context.apiHost}/api/v2/parse/status?uid=${providerTaskId}`
  const response = await net.fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${context.apiKey}`,
      Accept: 'application/json'
    },
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Doc2x parse status request failed: ${response.status} ${response.statusText} ${message}`)
  }

  return Doc2xParseStatusResponseSchema.parse(await response.json())
}

export async function triggerExportTask(
  providerTaskId: string,
  context: PreparedDoc2xQueryContext
): Promise<Doc2xExportStatusResponse> {
  const endpoint = `${context.apiHost}/api/v2/convert/parse`
  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.apiKey}`,
      Accept: 'application/json'
    },
    body: JSON.stringify({
      uid: providerTaskId,
      to: 'md',
      formula_mode: 'normal',
      formula_level: 0
    }),
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Doc2x export trigger request failed: ${response.status} ${response.statusText} ${message}`)
  }

  return Doc2xExportStatusResponseSchema.parse(await response.json())
}

export async function getExportResult(
  providerTaskId: string,
  context: PreparedDoc2xQueryContext
): Promise<Doc2xExportStatusResponse> {
  const endpoint = `${context.apiHost}/api/v2/convert/parse/result?uid=${providerTaskId}`
  const response = await net.fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${context.apiKey}`,
      Accept: 'application/json'
    },
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Doc2x export result request failed: ${response.status} ${response.statusText} ${message}`)
  }

  return Doc2xExportStatusResponseSchema.parse(await response.json())
}
