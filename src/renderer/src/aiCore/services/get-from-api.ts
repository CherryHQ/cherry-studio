/**
 * Unified HTTP GET utility for API calls
 * Inspired by AI SDK's postToApi pattern
 */
import type * as z from 'zod'

// === Types ===

export type FetchFunction = typeof globalThis.fetch

export type ResponseHandler<T> = (options: { url: string; response: Response }) => PromiseLike<{
  value: T
  responseHeaders?: Record<string, string>
}>

export interface APICallErrorOptions {
  message: string
  url: string
  statusCode?: number
  responseHeaders?: Record<string, string>
  responseBody?: string
  cause?: unknown
  isRetryable?: boolean
}

// === Error Classes ===

export class APICallError extends Error {
  readonly url: string
  readonly statusCode?: number
  readonly responseHeaders?: Record<string, string>
  readonly responseBody?: string
  readonly cause?: unknown
  readonly isRetryable: boolean

  constructor(options: APICallErrorOptions) {
    super(options.message)
    this.name = 'APICallError'
    this.url = options.url
    this.statusCode = options.statusCode
    this.responseHeaders = options.responseHeaders
    this.responseBody = options.responseBody
    this.cause = options.cause
    this.isRetryable = options.isRetryable ?? false
  }

  static isInstance(error: unknown): error is APICallError {
    return error instanceof APICallError
  }
}

export class JSONParseError extends Error {
  readonly text: string
  readonly cause?: unknown

  constructor(options: { text: string; cause?: unknown }) {
    super('Failed to parse JSON')
    this.name = 'JSONParseError'
    this.text = options.text
    this.cause = options.cause
  }

  static isInstance(error: unknown): error is JSONParseError {
    return error instanceof JSONParseError
  }
}

export class TypeValidationError extends Error {
  readonly value: unknown
  readonly cause?: unknown

  constructor(options: { value: unknown; cause?: unknown }) {
    super('Type validation failed')
    this.name = 'TypeValidationError'
    this.value = options.value
    this.cause = options.cause
  }

  static isInstance(error: unknown): error is TypeValidationError {
    return error instanceof TypeValidationError
  }
}

// === Utility Functions ===

function extractResponseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries([...response.headers])
}

function isAbortError(error: unknown): error is Error {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    (error.name === 'AbortError' || error.name === 'ResponseAborted' || error.name === 'TimeoutError')
  )
}

const FETCH_FAILED_ERROR_MESSAGES = ['fetch failed', 'failed to fetch']

function handleFetchError({ error, url }: { error: unknown; url: string }) {
  if (isAbortError(error)) {
    return error
  }

  // Unwrap original error when fetch failed (for easier debugging)
  if (error instanceof TypeError && FETCH_FAILED_ERROR_MESSAGES.includes(error.message.toLowerCase())) {
    const cause = (error as any).cause

    if (cause != null) {
      return new APICallError({
        message: `Cannot connect to API: ${cause.message}`,
        cause,
        url,
        isRetryable: true
      })
    }
  }

  return error
}

// === JSON Parsing ===

export type ParseResult<T> =
  | { success: true; value: T; rawValue: unknown }
  | { success: false; error: JSONParseError | TypeValidationError; rawValue?: unknown }

export async function safeParseJSON<T>(options: { text: string; schema: z.ZodType<T> }): Promise<ParseResult<T>>
export async function safeParseJSON(options: { text: string; schema?: undefined }): Promise<ParseResult<unknown>>
export async function safeParseJSON<T>({
  text,
  schema
}: {
  text: string
  schema?: z.ZodType<T>
}): Promise<ParseResult<T>> {
  try {
    const value = JSON.parse(text)

    if (schema == null) {
      return { success: true, value: value as T, rawValue: value }
    }

    const result = schema.safeParse(value)
    if (result.success) {
      return { success: true, value: result.data, rawValue: value }
    } else {
      return {
        success: false,
        error: new TypeValidationError({ value, cause: result.error }),
        rawValue: value
      }
    }
  } catch (error) {
    return {
      success: false,
      error: JSONParseError.isInstance(error) ? error : new JSONParseError({ text, cause: error }),
      rawValue: undefined
    }
  }
}

// === Response Handlers ===

export const createJsonResponseHandler =
  <T>(responseSchema: z.ZodType<T>): ResponseHandler<T> =>
  async ({ response, url }) => {
    const responseBody = await response.text()
    const parsedResult = await safeParseJSON({ text: responseBody, schema: responseSchema })
    const responseHeaders = extractResponseHeaders(response)

    if (!parsedResult.success) {
      throw new APICallError({
        message: 'Invalid JSON response',
        cause: parsedResult.error,
        statusCode: response.status,
        responseHeaders,
        responseBody,
        url
      })
    }

    return {
      responseHeaders,
      value: parsedResult.value
    }
  }

export const createJsonErrorResponseHandler =
  <T>({
    errorSchema,
    errorToMessage,
    isRetryable
  }: {
    errorSchema: z.ZodType<T>
    errorToMessage: (error: T) => string
    isRetryable?: (response: Response, error?: T) => boolean
  }): ResponseHandler<APICallError> =>
  async ({ response, url }) => {
    const responseBody = await response.text()
    const responseHeaders = extractResponseHeaders(response)

    // Some providers return an empty response body for some errors
    if (responseBody.trim() === '') {
      return {
        responseHeaders,
        value: new APICallError({
          message: response.statusText,
          url,
          statusCode: response.status,
          responseHeaders,
          responseBody,
          isRetryable: isRetryable?.(response)
        })
      }
    }

    // Resilient parsing in case the response is not JSON or does not match the schema
    try {
      const parsedResult = await safeParseJSON({ text: responseBody, schema: errorSchema })

      if (parsedResult.success) {
        return {
          responseHeaders,
          value: new APICallError({
            message: errorToMessage(parsedResult.value),
            url,
            statusCode: response.status,
            responseHeaders,
            responseBody,
            isRetryable: isRetryable?.(response, parsedResult.value)
          })
        }
      }
    } catch {
      // Fall through to default error
    }

    return {
      responseHeaders,
      value: new APICallError({
        message: response.statusText,
        url,
        statusCode: response.status,
        responseHeaders,
        responseBody,
        isRetryable: isRetryable?.(response)
      })
    }
  }

export const createStatusCodeErrorResponseHandler =
  (): ResponseHandler<APICallError> =>
  async ({ response, url }) => {
    const responseHeaders = extractResponseHeaders(response)
    const responseBody = await response.text()

    return {
      responseHeaders,
      value: new APICallError({
        message: response.statusText,
        url,
        statusCode: response.status,
        responseHeaders,
        responseBody
      })
    }
  }

// === Main GET Function ===

export interface GetFromApiOptions<T> {
  url: string
  headers?: Record<string, string | undefined>
  successfulResponseHandler: ResponseHandler<T>
  failedResponseHandler: ResponseHandler<Error>
  abortSignal?: AbortSignal
  fetch?: FetchFunction
}

export const getFromApi = async <T>({
  url,
  headers = {},
  successfulResponseHandler,
  failedResponseHandler,
  abortSignal,
  fetch = globalThis.fetch
}: GetFromApiOptions<T>): Promise<{ value: T; responseHeaders?: Record<string, string> }> => {
  try {
    // Filter out undefined headers
    const cleanHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        cleanHeaders[key] = value
      }
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: cleanHeaders,
      signal: abortSignal
    })

    const responseHeaders = extractResponseHeaders(response)

    if (!response.ok) {
      let errorInformation: {
        value: Error
        responseHeaders?: Record<string, string> | undefined
      }

      try {
        errorInformation = await failedResponseHandler({
          response,
          url
        })
      } catch (error) {
        if (isAbortError(error) || APICallError.isInstance(error)) {
          throw error
        }

        throw new APICallError({
          message: 'Failed to process error response',
          cause: error,
          statusCode: response.status,
          url,
          responseHeaders
        })
      }

      throw errorInformation.value
    }

    try {
      return await successfulResponseHandler({
        response,
        url
      })
    } catch (error) {
      if (error instanceof Error) {
        if (isAbortError(error) || APICallError.isInstance(error)) {
          throw error
        }
      }

      throw new APICallError({
        message: 'Failed to process successful response',
        cause: error,
        statusCode: response.status,
        url,
        responseHeaders
      })
    }
  } catch (error) {
    throw handleFetchError({ error, url })
  }
}

// === Convenience Functions ===

/**
 * Fetch JSON from an API endpoint with schema validation
 */
export async function getJsonFromApi<T>({
  url,
  headers,
  responseSchema,
  errorSchema,
  errorToMessage,
  abortSignal,
  fetch
}: {
  url: string
  headers?: Record<string, string | undefined>
  responseSchema: z.ZodType<T>
  errorSchema?: z.ZodType<any>
  errorToMessage?: (error: any) => string
  abortSignal?: AbortSignal
  fetch?: FetchFunction
}): Promise<T> {
  const result = await getFromApi({
    url,
    headers,
    successfulResponseHandler: createJsonResponseHandler(responseSchema),
    failedResponseHandler:
      errorSchema && errorToMessage
        ? createJsonErrorResponseHandler({ errorSchema, errorToMessage })
        : createStatusCodeErrorResponseHandler(),
    abortSignal,
    fetch
  })

  return result.value
}
