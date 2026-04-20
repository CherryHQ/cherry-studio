import fs from 'node:fs/promises'

import { loggerService } from '@logger'
import { MB } from '@shared/config/constant'
import { net } from 'electron'
import FormData from 'form-data'

import { sanitizeFileProcessingRemoteUrl } from '../../../utils/url'
import {
  PaddleCreateJobResponseSchema,
  type PaddleJobResultData,
  PaddleJobResultResponseSchema,
  type PaddleJsonlLine,
  PaddleJsonlLineSchema,
  type PreparedPaddleQueryContext,
  type PreparedPaddleStartContext
} from './types'

const POLL_INTERVAL_MS = 1000
const MAX_POLL_DURATION_MS = 5 * 60 * 1000
const PADDLE_MAX_FILE_SIZE = 50 * MB
const logger = loggerService.withContext('FileProcessing:PaddleProviderUtils')

export async function createJob(context: PreparedPaddleStartContext): Promise<{
  jobId: string
}> {
  const endpoint = `${context.apiHost}/api/v2/ocr/jobs`
  const stat = await fs.stat(context.file.path)

  if (stat.size >= PADDLE_MAX_FILE_SIZE) {
    throw new Error('PaddleOCR file is too large (must be smaller than 50MB)')
  }

  // Keep Paddle uploads non-streaming. In practice this API was sensitive to
  // streamed multipart bodies from Electron and returned misleading model
  // parameter errors; sending a buffered multipart payload matches the working
  // shape of the official example more closely.
  const fileBuffer = await fs.readFile(context.file.path)

  const formData = new FormData()
  if (context.model) {
    formData.append('model', context.model)
  }
  formData.append('file', fileBuffer, {
    filename: context.file.origin_name
  })
  const requestBody = formData.getBuffer()
  const requestHeaders = {
    Authorization: `Bearer ${context.apiKey}`,
    ...formData.getHeaders()
  }

  let response: Response

  try {
    response = await net.fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody as any,
      signal: context.signal
    } as any)
  } catch (error) {
    logger.warn('PaddleOCR job creation fetch threw before receiving a response', error as Error, {
      processorId: 'paddleocr',
      feature: context.feature,
      fileId: context.file.id,
      fileName: context.file.origin_name,
      apiHost: context.apiHost,
      model: context.model
    })
    throw error
  }

  if (!response.ok) {
    const message = await response.text()
    logger.warn('PaddleOCR job creation request failed', {
      processorId: 'paddleocr',
      feature: context.feature,
      fileId: context.file.id,
      fileName: context.file.origin_name,
      apiHost: context.apiHost,
      model: context.model,
      status: response.status,
      statusText: response.statusText,
      responseBody: message
    })
    throw new Error(`PaddleOCR job creation failed: ${response.status} ${response.statusText} ${message}`)
  }

  const payload = PaddleCreateJobResponseSchema.parse(await response.json())

  if (payload.code !== 0) {
    logger.warn('PaddleOCR job creation returned business error', {
      processorId: 'paddleocr',
      feature: context.feature,
      fileId: context.file.id,
      fileName: context.file.origin_name,
      apiHost: context.apiHost,
      model: context.model,
      code: payload.code,
      msg: payload.msg
    })
    throw new Error(payload.msg || 'PaddleOCR job creation failed')
  }

  if (!payload.data) {
    throw new Error('PaddleOCR job creation response is missing data')
  }

  return payload.data
}

export async function getJobResult(
  providerTaskId: string,
  context: PreparedPaddleQueryContext
): Promise<PaddleJobResultData> {
  const endpoint = `${context.apiHost}/api/v2/ocr/jobs/${providerTaskId}`

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
    throw new Error(`PaddleOCR job result request failed: ${response.status} ${response.statusText} ${message}`)
  }

  const payload = PaddleJobResultResponseSchema.parse(await response.json())

  if (payload.code !== 0) {
    throw new Error(payload.msg || 'PaddleOCR job result request failed')
  }

  if (!payload.data) {
    throw new Error(`PaddleOCR job result response is missing data for task ${providerTaskId}`)
  }

  return payload.data
}

export function mapProgress(jobResult: PaddleJobResultData): number {
  if (jobResult.state === 'done') {
    return 99
  }

  const totalPages = jobResult.extractProgress?.totalPages
  const extractedPages = jobResult.extractProgress?.extractedPages

  if (!totalPages || extractedPages === undefined) {
    return 0
  }

  return Math.min(99, Math.max(0, Math.round((extractedPages / totalPages) * 100)))
}

export async function waitForJobCompletion(
  providerTaskId: string,
  context: PreparedPaddleQueryContext
): Promise<PaddleJobResultData> {
  const deadline = Date.now() + MAX_POLL_DURATION_MS

  while (true) {
    const jobResult = await getJobResult(providerTaskId, context)

    if (jobResult.state === 'done' || jobResult.state === 'failed') {
      return jobResult
    }

    if (Date.now() >= deadline) {
      throw new Error(`PaddleOCR task ${providerTaskId} did not complete within 5 minutes`)
    }

    await delay(POLL_INTERVAL_MS, context.signal)
  }
}

export async function resolveJsonlResult(
  providerTaskId: string,
  jobResult: PaddleJobResultData,
  signal?: AbortSignal
): Promise<string> {
  const jsonUrl = jobResult.resultUrl?.jsonUrl

  if (!jsonUrl) {
    throw new Error(`PaddleOCR task ${providerTaskId} completed without jsonUrl`)
  }

  const jsonlContent = await downloadPaddleResult(jsonUrl, signal)
  return extractMarkdownTextFromJsonl(jsonlContent, providerTaskId)
}

export async function downloadPaddleResult(downloadUrl: string, signal?: AbortSignal): Promise<string> {
  const safeDownloadUrl = sanitizeFileProcessingRemoteUrl(downloadUrl)
  const response = await net.fetch(safeDownloadUrl, {
    method: 'GET',
    signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`PaddleOCR result download failed: ${response.status} ${response.statusText} ${message}`)
  }

  return response.text()
}

function extractMarkdownTextFromJsonl(jsonlContent: string, providerTaskId: string): string {
  const extractedSegments = jsonlContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => extractMarkdownTextFromJsonlLine(line, providerTaskId, index + 1))

  const markdownContent = extractedSegments.join('\n\n').trim()

  if (!markdownContent) {
    throw new Error(`PaddleOCR task ${providerTaskId} completed with jsonUrl but returned empty text content`)
  }

  return markdownContent
}

function extractMarkdownTextFromJsonlLine(rawLine: string, providerTaskId: string, lineNumber: number): string[] {
  let parsedLine: unknown

  try {
    parsedLine = JSON.parse(rawLine)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`PaddleOCR JSONL parse failed for task ${providerTaskId} on line ${lineNumber}: ${reason}`)
  }

  const validationResult = PaddleJsonlLineSchema.safeParse(parsedLine)

  if (!validationResult.success) {
    throw new Error(
      `PaddleOCR JSONL result has unsupported structure for task ${providerTaskId} on line ${lineNumber}: ${validationResult.error.message}`
    )
  }

  return collectTextSegments(validationResult.data)
}

function collectTextSegments(jsonlLine: PaddleJsonlLine): string[] {
  const layoutTexts =
    jsonlLine.result?.layoutParsingResults
      ?.map((item) => item.markdown?.text?.trim())
      .filter((text): text is string => Boolean(text)) ?? []

  const ocrTexts =
    jsonlLine.result?.ocrResults
      ?.map((item) =>
        item.prunedResult?.rec_texts
          ?.map((text) => text.trim())
          .filter(Boolean)
          .join('\n')
      )
      .filter((text): text is string => Boolean(text)) ?? []

  return [...layoutTexts, ...ocrTexts]
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return
  }

  if (signal.aborted) {
    signal.throwIfAborted()
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new Error('The operation was aborted'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}
