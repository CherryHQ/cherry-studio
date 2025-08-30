import { ChunkType, ErrorChunk } from '@renderer/types/chunk'

/**
 * Creates an ErrorChunk object with a standardized structure.
 * @param error The error object or message.
 * @param chunkType The type of chunk, defaults to ChunkType.ERROR.
 * @returns An ErrorChunk object.
 */
export function createErrorChunk(error: any, chunkType: ChunkType = ChunkType.ERROR): ErrorChunk {
  let errorDetails: Record<string, any> = {}

  if (error instanceof Error) {
    errorDetails = {
      message: error.message,
      name: error.name,
      stack: error.stack
    }
  } else if (typeof error === 'string') {
    errorDetails = { message: error }
  } else if (typeof error === 'object' && error !== null) {
    errorDetails = Object.getOwnPropertyNames(error).reduce(
      (acc, key) => {
        acc[key] = error[key]
        return acc
      },
      {} as Record<string, any>
    )
    if (!errorDetails.message && error.toString && typeof error.toString === 'function') {
      const errMsg = error.toString()
      if (errMsg !== '[object Object]') {
        errorDetails.message = errMsg
      }
    }
  }

  return {
    type: chunkType,
    error: errorDetails
  } as ErrorChunk
}

// Helper to capitalize method names for hook construction
export function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * 检查对象是否实现了AsyncIterable接口
 */
export function isAsyncIterable<T = unknown>(obj: unknown): obj is AsyncIterable<T> {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof (obj as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
  )
}
