import { SerializedError } from '@reduxjs/toolkit'

// 定义模块增强以扩展 @reduxjs/toolkit 的 SerializedError
declare module '@reduxjs/toolkit' {
  interface SerializedError {
    [key: string]: unknown
  }
}

export interface SerializedAiSdkError extends SerializedError {
  readonly cause?: unknown
}

export const isSerializedAiSdkError = (error: SerializedError): error is SerializedAiSdkError => {
  return 'cause' in error
}

export interface SerializedAiSdkAPICallError extends SerializedAiSdkError {
  readonly url: string
  readonly requestBodyValues: unknown
  readonly statusCode?: number
  readonly responseHeaders?: Record<string, string>
  readonly responseBody?: string
  readonly isRetryable: boolean
  readonly data?: unknown
}

export const isSerializedAiSdkAPICallError = (error: SerializedError): error is SerializedAiSdkAPICallError => {
  return isSerializedAiSdkError(error) && 'url' in error && 'requestBodyValues' in error && 'isRetryable' in error
}
