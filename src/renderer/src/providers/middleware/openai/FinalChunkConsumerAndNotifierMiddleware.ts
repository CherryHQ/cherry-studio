import type { Chunk, ChunkType } from '@renderer/types/chunk'

import type { CompletionsOpenAIResult } from '../../AiProvider'
import type { CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'FinalChunkConsumerAndNotifierMiddleware'

export const FinalChunkConsumerAndNotifierMiddleware: CompletionsMiddleware =
  () => (next) => async (context, params) => {
    // This middleware is intended to be at the end of a chain of "transforming" middlewares.
    // It calls `next` to get the final processed stream from them.
    const resultFromUpstream = await next(context, params)

    console.log(`[${MIDDLEWARE_NAME}] Received result from upstream. Stream available: ${!!resultFromUpstream.stream}`)

    if (resultFromUpstream.stream && resultFromUpstream.stream instanceof ReadableStream) {
      // Explicitly cast the inputStream to ReadableStream<Chunk> after the instanceof check
      // This assumes upstream middlewares correctly provide a ReadableStream<Chunk>
      const inputStream = resultFromUpstream.stream as ReadableStream<Chunk>
      const reader = inputStream.getReader()
      // let accumulatedText = '' // Commented out as it's unused for now

      console.log(`[${MIDDLEWARE_NAME}] Starting to consume and notify chunks.`)
      try {
        while (true) {
          const { done, value: chunk } = await reader.read()

          if (done) {
            console.log(`[${MIDDLEWARE_NAME}] Input stream finished.`)
            break
          }

          // Ensure chunk is not undefined before accessing its properties
          if (chunk) {
            const chunkType: ChunkType = chunk.type
            let chunkDetails = ''
            if ('text' in chunk && typeof chunk.text === 'string') {
              chunkDetails = `: ${chunk.text.substring(0, 50)}...`
            } else if (chunk.type === 'llm_response_complete' && chunk.response?.usage) {
              chunkDetails = `: Usage ${JSON.stringify(chunk.response.usage)}`
            }
            console.log(`[${MIDDLEWARE_NAME}] Dispatching chunk via onChunk - Type: ${chunkType}${chunkDetails}`)

            if (params.onChunk) {
              params.onChunk(chunk)
            }
          } else {
            // Should not happen if done is false, but good to be defensive
            console.warn(`[${MIDDLEWARE_NAME}] Received undefined chunk before stream was done.`)
          }

          // if (chunk && chunk.type === ChunkType.TEXT_DELTA && typeof chunk.text === 'string') { // Corrected ChunkType access
          //   accumulatedText += chunk.text;
          // }
        }
      } catch (error) {
        console.error(`[${MIDDLEWARE_NAME}] Error consuming stream:`, error)
        throw error
      } finally {
        console.log(`[${MIDDLEWARE_NAME}] Finished consuming stream.`)
      }

      const finalResult: CompletionsOpenAIResult = {
        ...resultFromUpstream,
        // Create an empty, already-closed stream explicitly typed as ReadableStream<Chunk>
        stream: new ReadableStream<Chunk>({
          // Explicitly type the new ReadableStream
          start(controller) {
            controller.close()
          }
        })
        // text: accumulatedText,
      }
      return finalResult
    } else {
      console.log(
        `[${MIDDLEWARE_NAME}] No stream to process or stream is not ReadableStream. Returning original result from upstream.`
      )
      return resultFromUpstream
    }
  }
