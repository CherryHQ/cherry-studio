import fs from 'node:fs/promises'

import { loggerService } from '@logger'
import { net } from 'electron'
import FormData from 'form-data'

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
const logger = loggerService.withContext('FileProcessing:PaddleProcessorUtils')

export async function createJob(context: PreparedPaddleStartContext): Promise<{
  jobId: string
}> {
  const endpoint = `${context.apiHost}/api/v2/ocr/jobs`
  const fileBuffer = await fs.readFile(context.file.path)

  const formData = new FormData()
  if (context.model) {
    formData.append('model', context.model)
  }
  formData.append('file', fileBuffer, {
    filename: context.file.origin_name
  })

  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.apiKey}`,
      ...formData.getHeaders()
    },
    body: new Uint8Array(formData.getBuffer()),
    signal: context.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`PaddleOCR job creation failed: ${response.status} ${response.statusText} ${message}`)
  }

  const payload = PaddleCreateJobResponseSchema.parse(await response.json())

  if (payload.code !== 0) {
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

  if (payload.data.state === 'done' || payload.data.state === 'failed') {
    logger.info('PaddleOCR job result received', {
      processorId: 'paddleocr',
      providerTaskId,
      state: payload.data.state,
      resultUrl: payload.data.resultUrl
    })
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

  logger.info('PaddleOCR result is using jsonUrl payload', {
    processorId: 'paddleocr',
    providerTaskId,
    jsonUrl
  })

  const jsonlContent = await downloadPaddleResult(jsonUrl, signal)
  return extractMarkdownTextFromJsonl(jsonlContent, providerTaskId)
}

export async function downloadPaddleResult(downloadUrl: string, signal?: AbortSignal): Promise<string> {
  const response = await net.fetch(downloadUrl, {
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
