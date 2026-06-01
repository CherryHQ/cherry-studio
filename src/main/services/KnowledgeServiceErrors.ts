/**
 * Structured error types and utilities for KnowledgeService.
 * Provides error codes, retry logic, and progress reporting.
 */

import { loggerService } from '@logger'

const logger = loggerService.withContext('KnowledgeServiceErrors')

/**
 * Error codes for knowledge service operations
 */
export enum KnowledgeErrorCode {
  // Database errors
  DB_CONNECTION_FAILED = 'KNOWLEDGE_DB_CONNECTION_FAILED',
  DB_QUERY_FAILED = 'KNOWLEDGE_DB_QUERY_FAILED',
  DB_CREATION_FAILED = 'KNOWLEDGE_DB_CREATION_FAILED',
  DB_DELETION_FAILED = 'KNOWLEDGE_DB_DELETION_FAILED',

  // Embedding errors
  EMBEDDING_FAILED = 'KNOWLEDGE_EMBEDDING_FAILED',
  EMBEDDING_TIMEOUT = 'KNOWLEDGE_EMBEDDING_TIMEOUT',
  EMBEDDING_RATE_LIMITED = 'KNOWLEDGE_EMBEDDING_RATE_LIMITED',

  // Document processing errors
  DOCUMENT_LOAD_FAILED = 'KNOWLEDGE_DOCUMENT_LOAD_FAILED',
  DOCUMENT_CHUNK_FAILED = 'KNOWLEDGE_DOCUMENT_CHUNK_FAILED',
  DOCUMENT_TOO_LARGE = 'KNOWLEDGE_DOCUMENT_TOO_LARGE',

  // Search errors
  SEARCH_FAILED = 'KNOWLEDGE_SEARCH_FAILED',
  SEARCH_TIMEOUT = 'KNOWLEDGE_SEARCH_TIMEOUT',

  // General errors
  INVALID_PARAMS = 'KNOWLEDGE_INVALID_PARAMS',
  OPERATION_ABORTED = 'KNOWLEDGE_OPERATION_ABORTED',
  UNKNOWN_ERROR = 'KNOWLEDGE_UNKNOWN_ERROR'
}

/**
 * Structured error class for knowledge operations
 */
export class KnowledgeError extends Error {
  constructor(
    message: string,
    public readonly code: KnowledgeErrorCode,
    public readonly details?: Record<string, unknown>,
    cause?: Error
  ) {
    super(message)
    this.name = 'KnowledgeError'
    if (cause) {
      this.cause = cause
    }
  }

  /**
   * Convert to a plain object for logging/serialization
   */
  toObject(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack
    }
  }
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffFactor: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2
}

/**
 * Execute a function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: string
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay, backoffFactor } = { ...DEFAULT_RETRY_CONFIG, ...config }

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === maxRetries) {
        logger.error(`Max retries (${maxRetries}) reached${context ? ` for ${context}` : ''}`, lastError)
        throw lastError
      }

      // Don't retry on certain errors
      if (error instanceof KnowledgeError) {
        if (
          error.code === KnowledgeErrorCode.INVALID_PARAMS ||
          error.code === KnowledgeErrorCode.OPERATION_ABORTED ||
          error.code === KnowledgeErrorCode.DOCUMENT_TOO_LARGE
        ) {
          throw error
        }
      }

      const delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt), maxDelay)
      logger.warn(
        `Attempt ${attempt + 1}/${maxRetries + 1} failed${context ? ` for ${context}` : ''}, retrying in ${delay}ms`,
        lastError
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Progress reporting for knowledge operations
 */
export interface KnowledgeProgress {
  stage: 'loading' | 'chunking' | 'embedding' | 'indexing' | 'complete' | 'error'
  progress: number // 0-100
  message: string
  details?: Record<string, unknown>
}

export type ProgressCallback = (progress: KnowledgeProgress) => void

/**
 * Create a progress reporter
 */
export function createProgressReporter(callback?: ProgressCallback) {
  return {
    report: (progress: KnowledgeProgress) => {
      logger.debug(
        `Knowledge progress: ${progress.stage} ${progress.progress}% - ${progress.message}`,
        progress.details
      )
      callback?.(progress)
    },
    loading: (message: string, details?: Record<string, unknown>) => {
      callback?.({ stage: 'loading', progress: 0, message, details })
    },
    chunking: (progress: number, message: string, details?: Record<string, unknown>) => {
      callback?.({ stage: 'chunking', progress, message, details })
    },
    embedding: (progress: number, message: string, details?: Record<string, unknown>) => {
      callback?.({ stage: 'embedding', progress, message, details })
    },
    indexing: (progress: number, message: string, details?: Record<string, unknown>) => {
      callback?.({ stage: 'indexing', progress, message, details })
    },
    complete: (message: string, details?: Record<string, unknown>) => {
      callback?.({ stage: 'complete', progress: 100, message, details })
    },
    error: (message: string, details?: Record<string, unknown>) => {
      callback?.({ stage: 'error', progress: 0, message, details })
    }
  }
}
