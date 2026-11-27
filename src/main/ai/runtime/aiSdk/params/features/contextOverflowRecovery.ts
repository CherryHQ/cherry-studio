import { isDeepStrictEqual } from 'node:util'

import type { LanguageModelV3Prompt, LanguageModelV3StreamPart, LanguageModelV3StreamResult } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { isContextOverflowError } from '@cherrystudio/ai-core'

async function inspectStream(result: LanguageModelV3StreamResult): Promise<LanguageModelV3StreamResult> {
  const reader = result.stream.getReader()
  const buffered: LanguageModelV3StreamPart[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (next.value.type === 'error' && isContextOverflowError(next.value.error)) {
        await reader.cancel().catch(() => {})
        throw next.value.error
      }
      buffered.push(next.value)
      if (next.value.type !== 'stream-start' && next.value.type !== 'response-metadata') break
    }
  } catch (error) {
    reader.releaseLock()
    throw error
  }
  return {
    ...result,
    stream: new ReadableStream({
      async pull(controller) {
        if (buffered.length) {
          controller.enqueue(buffered.shift()!)
          return
        }
        try {
          const next = await reader.read()
          if (next.done) {
            reader.releaseLock()
            controller.close()
          } else {
            controller.enqueue(next.value)
          }
        } catch (error) {
          reader.releaseLock()
          controller.error(error)
        }
      },
      async cancel(reason) {
        await reader.cancel(reason)
        reader.releaseLock()
      }
    })
  }
}

export function createOverflowRecoveryMiddleware(
  compact: (prompt: LanguageModelV3Prompt, signal?: AbortSignal) => Promise<LanguageModelV3Prompt | undefined>
): LanguageModelMiddleware {
  let cache: { original: LanguageModelV3Prompt; compacted: LanguageModelV3Prompt } | undefined
  const applyCache = (prompt: LanguageModelV3Prompt): LanguageModelV3Prompt => {
    if (!cache || prompt.length < cache.original.length) return prompt
    if (!cache.original.every((message, index) => isDeepStrictEqual(message, prompt[index]))) return prompt
    return [...cache.compacted, ...prompt.slice(cache.original.length)]
  }
  return {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream, model, params }) => {
      const prompt = applyCache(params.prompt)
      try {
        return await inspectStream(
          await (prompt === params.prompt ? doStream() : model.doStream({ ...params, prompt }))
        )
      } catch (error) {
        if (!isContextOverflowError(error)) throw error
        params.abortSignal?.throwIfAborted()
        let compacted: LanguageModelV3Prompt | undefined
        try {
          compacted = await compact(prompt, params.abortSignal)
        } catch {
          params.abortSignal?.throwIfAborted()
          throw error
        }
        if (!compacted) throw error
        params.abortSignal?.throwIfAborted()
        const result = await inspectStream(await model.doStream({ ...params, prompt: compacted }))
        cache = { original: params.prompt, compacted }
        return result
      }
    },
    wrapGenerate: async ({ doGenerate, model, params }) => {
      const prompt = applyCache(params.prompt)
      try {
        return await (prompt === params.prompt ? doGenerate() : model.doGenerate({ ...params, prompt }))
      } catch (error) {
        if (!isContextOverflowError(error)) throw error
        params.abortSignal?.throwIfAborted()
        let compacted: LanguageModelV3Prompt | undefined
        try {
          compacted = await compact(prompt, params.abortSignal)
        } catch {
          params.abortSignal?.throwIfAborted()
          throw error
        }
        if (!compacted) throw error
        params.abortSignal?.throwIfAborted()
        const result = await model.doGenerate({ ...params, prompt: compacted })
        cache = { original: params.prompt, compacted }
        return result
      }
    }
  }
}
