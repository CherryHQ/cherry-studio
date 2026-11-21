import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { redactUrlParams } from '@shared/utils/redaction'

function annotateRequestError(error: unknown, url: string, seen = new Set<object>()): void {
  if (typeof error !== 'object' || error === null || seen.has(error) || seen.size >= 16) return
  seen.add(error)
  const source = error as Record<string, unknown>
  try {
    source.url = url
  } catch {
    // Frozen third-party errors must not replace the original failure.
  }
  try {
    annotateRequestError(source.cause, url, seen)
    annotateRequestError(source.lastError, url, seen)
    if (Array.isArray(source.errors)) {
      for (const nested of source.errors) annotateRequestError(nested, url, seen)
    }
  } catch {
    // Untrusted error accessors must not replace the original failure either.
  }
}

export function createExactPathDiagnosticsMiddleware(exactUrl: string): LanguageModelMiddleware {
  const parsed = new URL(exactUrl)
  parsed.hash = ''
  const url = redactUrlParams(parsed.toString())
  const annotate = (error: unknown) => annotateRequestError(error, url)

  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      try {
        return await doGenerate()
      } catch (error) {
        annotate(error)
        throw error
      }
    },
    wrapStream: async ({ doStream }) => {
      try {
        const result = await doStream()
        const reader = result.stream.getReader()
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          async pull(controller) {
            try {
              const next = await reader.read()
              if (next.done) {
                reader.releaseLock()
                controller.close()
              } else {
                if (next.value.type === 'error') annotate(next.value.error)
                controller.enqueue(next.value)
              }
            } catch (error) {
              annotate(error)
              reader.releaseLock()
              controller.error(error)
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason)
            } finally {
              reader.releaseLock()
            }
          }
        })
        return { ...result, stream }
      } catch (error) {
        annotate(error)
        throw error
      }
    }
  }
}

export async function withExactPathDiagnostics<T>(exactUrl: string | undefined, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (exactUrl) {
      const url = new URL(exactUrl)
      url.hash = ''
      annotateRequestError(error, redactUrlParams(url.toString()))
    }
    throw error
  }
}
