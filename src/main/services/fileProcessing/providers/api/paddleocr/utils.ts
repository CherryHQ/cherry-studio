import fs from 'node:fs/promises'

import { net } from 'electron'
import FormData from 'form-data'

import {
  PaddleCreateJobResponseSchema,
  type PaddleJobResultData,
  PaddleJobResultResponseSchema,
  type PreparedPaddleQueryContext,
  type PreparedPaddleStartContext
} from './types'

const POLL_INTERVAL_MS = 1000
const MAX_POLL_DURATION_MS = 5 * 60 * 1000

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
