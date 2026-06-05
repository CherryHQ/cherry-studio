import {
  APIError,
  AuthError,
  InvalidRequestError,
  JobFailedError,
  Model,
  NetworkError,
  PaddleOCRClient,
  PollTimeoutError,
  RateLimitError,
  RequestTimeoutError,
  ServiceUnavailableError,
  type ClientOptions,
  type DocParsingOptions,
  type DocParsingResult,
  type JobStatus,
  type OCROptions,
  type OCRResult,
  type PaddleOCRVLOptions,
  type PPStructureV3Options
} from '@paddleocr/api-sdk'
import { loggerService } from '@logger'
import {
  OcrAsyncTaskResultSchema,
  OcrAsyncTaskStartResultSchema,
  OcrAsyncTaskStatusSchema,
  type OcrAsyncPage,
  type OcrAsyncTaskResult,
  type OcrAsyncTaskStartResult,
  type OcrAsyncTaskStatus
} from '@shared/ocr/async'
import * as z from 'zod'

const logger = loggerService.withContext('PaddleOcrSdkService')

const OcrPagePrunedResultSchema = z.looseObject({
  rec_texts: z.array(z.string()).optional()
})

const OcrPageSchema = z.looseObject({
  prunedResult: OcrPagePrunedResultSchema.optional()
})

const DocumentParsingPageSchema = z.looseObject({
  markdownText: z.string()
})

const ProviderTaskStateSchema = z.enum(['pending', 'running', 'done', 'failed'])

type PaddleClientFactory = (options: ClientOptions) => PaddleOCRClientLike

type PaddleOCRClientLike = Pick<
  PaddleOCRClient,
  | 'submitOcr'
  | 'submitDocumentParsing'
  | 'getStatus'
  | 'waitOcrResult'
  | 'waitDocumentParsingResult'
>

export type PaddleDocumentTaskStartResult = Omit<OcrAsyncTaskStartResult, 'status'> & {
  status: 'pending' | 'processing'
}

export type PaddleDocumentTaskStatus = OcrAsyncTaskStatus

export type PaddleDocumentTaskResult = {
  taskId: string
  providerTaskId: string
  status: 'completed'
  progress: 100
  result: {
    markdown: string
    pages: Array<{
      markdown: string
    }>
  }
}

export type StartImageOcrInput = {
  taskId: string
  token?: string
  baseUrl?: string
  filePath: string
  model?: Model | string
  options?: OCROptions
  signal?: AbortSignal
}

export type StartDocumentParsingInput = {
  taskId: string
  token?: string
  baseUrl?: string
  filePath: string
  model?: Model | string
  options?: DocParsingOptions
  signal?: AbortSignal
}

export type GetTaskInput = {
  taskId: string
  providerTaskId: string
  token?: string
  baseUrl?: string
  signal?: AbortSignal
}

export class PaddleOcrSdkService {
  constructor(private readonly clientFactory: PaddleClientFactory = createPaddleClient) {}

  async startImageOcr(input: StartImageOcrInput): Promise<OcrAsyncTaskStartResult> {
    try {
      const client = this.createClient(input.token, input.baseUrl)
      const job = await client.submitOcr(
        {
          filePath: input.filePath,
          model: input.model ?? Model.PPOCRv5,
          options: input.options
        },
        { signal: input.signal }
      )

      return OcrAsyncTaskStartResultSchema.parse({
        taskId: input.taskId,
        providerTaskId: job.jobId,
        status: 'pending'
      })
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async getImageOcrStatus(input: GetTaskInput): Promise<OcrAsyncTaskStatus> {
    try {
      const status = await this.getStatus(input)
      return OcrAsyncTaskStatusSchema.parse(this.mapTaskStatus(input.taskId, input.providerTaskId, status))
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async getImageOcrResult(input: GetTaskInput): Promise<OcrAsyncTaskResult> {
    try {
      const client = this.createClient(input.token, input.baseUrl)
      const sdkResult = await client.waitOcrResult(input.providerTaskId, { signal: input.signal })
      const pages = this.mapOcrPages(sdkResult)

      return OcrAsyncTaskResultSchema.parse({
        taskId: input.taskId,
        providerTaskId: input.providerTaskId,
        status: 'completed',
        progress: 100,
        result: {
          text: joinNonEmpty(pages.map((page) => page.text), '\n\n'),
          pages
        }
      })
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async startDocumentParsing(input: StartDocumentParsingInput): Promise<PaddleDocumentTaskStartResult> {
    try {
      const client = this.createClient(input.token, input.baseUrl)
      const job = await client.submitDocumentParsing(
        {
          filePath: input.filePath,
          model: input.model ?? Model.PPStructureV3,
          options: input.options
        },
        { signal: input.signal }
      )

      return OcrAsyncTaskStartResultSchema.parse({
        taskId: input.taskId,
        providerTaskId: job.jobId,
        status: 'pending'
      })
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async getDocumentParsingStatus(input: GetTaskInput): Promise<PaddleDocumentTaskStatus> {
    try {
      const status = await this.getStatus(input)
      return OcrAsyncTaskStatusSchema.parse(this.mapTaskStatus(input.taskId, input.providerTaskId, status))
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async getDocumentParsingResult(input: GetTaskInput): Promise<PaddleDocumentTaskResult> {
    try {
      const client = this.createClient(input.token, input.baseUrl)
      const sdkResult = await client.waitDocumentParsingResult(input.providerTaskId, { signal: input.signal })
      const pages = this.mapDocumentPages(sdkResult)

      return {
        taskId: input.taskId,
        providerTaskId: input.providerTaskId,
        status: 'completed',
        progress: 100,
        result: {
          markdown: joinNonEmpty(pages.map((page) => page.markdown), '\n\n'),
          pages
        }
      }
    } catch (error) {
      throw this.mapError(error)
    }
  }

  private createClient(token?: string, baseUrl?: string): PaddleOCRClientLike {
    return this.clientFactory({
      token,
      baseUrl,
      clientPlatform: 'cherry-studio'
    })
  }

  private async getStatus(input: GetTaskInput): Promise<JobStatus> {
    const client = this.createClient(input.token, input.baseUrl)
    return await client.getStatus(input.providerTaskId, { signal: input.signal })
  }

  private mapTaskStatus(taskId: string, providerTaskId: string, status: JobStatus): OcrAsyncTaskStatus {
    return {
      taskId,
      providerTaskId,
      status: mapProviderState(status.state),
      progress: mapProgress(status)
    }
  }

  private mapOcrPages(result: OCRResult): OcrAsyncPage[] {
    return result.pages.map((page) => {
      const parsed = OcrPageSchema.parse(page)
      return {
        text: joinNonEmpty(parsed.prunedResult?.rec_texts ?? [], '\n')
      }
    })
  }

  private mapDocumentPages(result: DocParsingResult): Array<{ markdown: string }> {
    return result.pages.map((page) => {
      const parsed = DocumentParsingPageSchema.parse(page)
      return {
        markdown: parsed.markdownText.trim()
      }
    })
  }

  private mapError(error: unknown): Error {
    if (error instanceof AuthError) {
      return new Error(`PaddleOCR authentication failed: ${error.message}`)
    }
    if (error instanceof InvalidRequestError) {
      return new Error(`PaddleOCR request is invalid: ${error.message}`)
    }
    if (error instanceof RateLimitError) {
      return new Error(`PaddleOCR rate limited the request: ${error.message}`)
    }
    if (error instanceof PollTimeoutError || error instanceof RequestTimeoutError) {
      return new Error(`PaddleOCR request timed out: ${error.message}`)
    }
    if (error instanceof JobFailedError) {
      return new Error(`PaddleOCR job ${error.jobId} failed: ${error.errorMsg}`)
    }
    if (error instanceof NetworkError) {
      return new Error(`PaddleOCR network request failed: ${error.message}`)
    }
    if (error instanceof ServiceUnavailableError) {
      return new Error(`PaddleOCR service is unavailable: ${error.message}`)
    }
    if (error instanceof APIError) {
      return new Error(`PaddleOCR API error (${error.statusCode}): ${error.message}`)
    }
    if (error instanceof Error) {
      logger.error('Unexpected PaddleOCR SDK error', error)
      return error
    }
    return new Error('Unknown PaddleOCR SDK error')
  }
}

function createPaddleClient(options: ClientOptions): PaddleOCRClient {
  return new PaddleOCRClient(options)
}

function mapProviderState(state: z.infer<typeof ProviderTaskStateSchema>): OcrAsyncTaskStatus['status'] {
  switch (state) {
    case 'pending':
      return 'pending'
    case 'running':
      return 'processing'
    case 'done':
      return 'completed'
    case 'failed':
      return 'failed'
  }
}

function mapProgress(status: JobStatus): number {
  if (status.state === 'done') {
    return 100
  }

  if (status.state === 'failed') {
    return 0
  }

  const totalPages = status.progress?.totalPages ?? 0
  const extractedPages = status.progress?.extractedPages ?? 0

  if (totalPages <= 0) {
    return status.state === 'pending' ? 0 : 1
  }

  const ratio = Math.max(0, Math.min(1, extractedPages / totalPages))
  const progress = Math.round(ratio * 100)

  if (status.state === 'pending') {
    return Math.min(progress, 99)
  }

  return Math.max(1, Math.min(progress, 99))
}

function joinNonEmpty(parts: string[], separator: string): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(separator)
}

export const paddleOcrSdkService = new PaddleOcrSdkService()
export type PaddleDocumentParsingOptions = PPStructureV3Options | PaddleOCRVLOptions
