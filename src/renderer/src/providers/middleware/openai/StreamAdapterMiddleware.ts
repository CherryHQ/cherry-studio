// Keep this for the overall return type
// This will NOT be the output type of THIS middleware anymore
import { asyncGeneratorToReadableStream } from '@renderer/utils/stream'
import OpenAI from 'openai'

import type { CompletionsOpenAIResult } from '../../AiProvider'
// import type { Stream } from 'openai/streaming'; // This is the raw stream type from next()
// Assuming CompletionsResult, RawSdkStream, AdaptedChunkStream are defined and exported appropriately
// (e.g., from AiProvider/index.ts or AiProviderMiddlewareTypes.ts)
// Adjusted import path
import {
  CompletionsMiddleware
  // AiProviderMiddlewareCompletionsContext // Not directly needed if we just pass context through
} from '../middlewareTypes'

// This adapter takes an AsyncIterable of raw SDK chunks and yields them as an AsyncGenerator.
// This is a common pattern to adapt various async iterable sources to an AsyncGenerator expected by asyncGeneratorToReadableStream.
async function* rawSdkChunkAdapter(
  sdkChunkIterable: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  for await (const sdkChunk of sdkChunkIterable) {
    yield sdkChunk
  }
}

export const StreamAdapterMiddleware: CompletionsMiddleware = () => (next) => async (context, args) => {
  const originalResult = await next(context, args)

  console.log('🚀 StreamAdapterMiddleware (Raw): Original result received:', originalResult)

  // We expect originalResult.stream to be the raw OpenAI SDK stream,
  // which is an AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>.
  if (
    originalResult.stream &&
    !(originalResult.stream instanceof ReadableStream) && // It's not yet a WHATWG ReadableStream
    typeof (originalResult.stream as any)[Symbol.asyncIterator] === 'function' // But it is an AsyncIterable
  ) {
    // Type assertion for clarity, assuming next() returns the raw OpenAI stream object
    const rawSdkAsyncIterable = originalResult.stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

    // Adapt the AsyncIterable to an AsyncGenerator, then to a WHATWG ReadableStream.
    // The content will be raw OpenAI.Chat.Completions.ChatCompletionChunk objects.
    const whatwgReadableStream: ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk> =
      asyncGeneratorToReadableStream(rawSdkChunkAdapter(rawSdkAsyncIterable))

    const adaptedResult: CompletionsOpenAIResult = {
      ...originalResult,
      // IMPORTANT: The stream now contains RAW OpenAI.Chat.Completions.ChatCompletionChunk objects.
      // The type of `stream` in `CompletionsResult` might need adjustment if it strictly expects `ReadableStream<Chunk>`
      // or the original SDK stream type. We are outputting a new type here.
      stream: whatwgReadableStream
      // The next middleware will consume this and produce ReadableStream<Chunk>.
    }
    console.log(
      '🚀 StreamAdapterMiddleware (Raw): Adapted to WHATWG ReadableStream, content is raw SDK chunks.',
      adaptedResult
    )
    return adaptedResult
  } else if (originalResult.stream instanceof ReadableStream) {
    // If it's already a ReadableStream, perhaps it was already processed or is from a different source.
    // Or, it might be our own ReadableStream<Chunk> if middleware order is unexpected.
    // For now, pass it through. This case needs careful consideration based on actual pipeline.
    console.warn(
      '🚀 StreamAdapterMiddleware (Raw): Received an unexpected ReadableStream. Passing through.',
      originalResult
    )
    return originalResult
  } else {
    console.log(
      '🚀 StreamAdapterMiddleware (Raw): No stream to adapt or not an AsyncIterable. Returning original.',
      originalResult
    )
    return originalResult
  }
}
