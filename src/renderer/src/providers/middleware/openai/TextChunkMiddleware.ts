import { MCPTool, MCPToolResponse, ToolCallResponse } from '@renderer/types'
import { Chunk, ChunkType, TextCompleteChunk } from '@renderer/types/chunk'
import { asyncGeneratorToReadableStream } from '@renderer/utils/stream'
import { isEmpty } from 'lodash'
import OpenAI from 'openai'

import type { CompletionsOpenAIResult, CompletionsParams } from '../../AiProvider'
import { AiProviderMiddlewareCompletionsContext, CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'OpenAISDKChunkToStandardChunkMiddleware'

// This function contains the logic previously in StreamAdapterMiddleware's openAIStreamToChunkAdapter
// It converts raw OpenAI SDK chunks to our application-specific standard Chunk format.
async function* openAISdkToStandardChunkConverter(
  // Input is a ReadableStream containing raw OpenAI SDK chunks
  sdkReadableStream: ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk>,
  // 这个拿的是传参中的mcpTools
  mcpTools: MCPTool[] | undefined
): AsyncGenerator<Chunk> {
  const reader = sdkReadableStream.getReader()
  let accumulatedText = ''
  //   let finalUsage: Usage | undefined = undefined

  try {
    while (true) {
      const { done, value: sdkChunk } = await reader.read()
      if (done) {
        break
      }
      // Ensure sdkChunk is not undefined (though with done=false, it should always be present)
      if (!sdkChunk) continue

      const choice = sdkChunk.choices?.[0]
      if (!choice) continue

      const delta = choice.delta

      if (delta?.content) {
        accumulatedText += delta.content
        yield { type: ChunkType.TEXT_DELTA, text: delta.content }
      }

      if (delta?.tool_calls && delta.tool_calls.length > 0) {
        const toolCallResponses: ToolCallResponse[] = []
        for (const tc of delta.tool_calls) {
          if (!tc.function || !tc.id) continue

          const mcpTool = mcpTools?.find((m) => m.id === tc.function!.name || m.name === tc.function!.name)
          if (!mcpTool) {
            console.warn(`[${MIDDLEWARE_NAME}] MCPTool not found for function: ${tc.function.name}`)
            continue
          }

          let parsedArgs: Record<string, unknown> | undefined = undefined
          try {
            if (tc.function.arguments) {
              parsedArgs = JSON.parse(tc.function.arguments)
            }
          } catch (e) {
            console.warn(
              `[${MIDDLEWARE_NAME}] Failed to parse arguments for tool ${tc.function.name}: ${tc.function.arguments}`,
              e
            )
            // Decide if you want to proceed with unparsed args, or skip this tool call
          }

          // Constructing ToolCallResponse. Status is 'invoking' as a placeholder.
          // This might need semantic review: is it truly 'invoking' at this stage?
          const toolCallResponse: ToolCallResponse = {
            id: tc.id, // Unique ID for this specific call instance
            toolCallId: tc.id, // OpenAI's tool_call.id
            tool: mcpTool,
            arguments: parsedArgs,
            status: 'invoking' // Placeholder status
            // response field would be populated by the actual tool execution result later
          }
          toolCallResponses.push(toolCallResponse)
        }

        if (toolCallResponses.length > 0) {
          yield {
            type: ChunkType.MCP_TOOL_IN_PROGRESS,
            responses: toolCallResponses as MCPToolResponse[] // Casting because ToolCallResponse is part of MCPToolResponse union
          }
        }
      }

      if (!isEmpty(choice.finish_reason)) {
        // if (sdkChunk.usage) {
        //   finalUsage = {
        //     completion_tokens: sdkChunk.usage.completion_tokens || 0,
        //     prompt_tokens: sdkChunk.usage.prompt_tokens || 0,
        //     total_tokens: sdkChunk.usage.total_tokens || 0
        //   }
        // }

        if (accumulatedText) {
          const textCompleteChunk: TextCompleteChunk = {
            type: ChunkType.TEXT_COMPLETE,
            text: accumulatedText
          }
          yield textCompleteChunk
        }

        // const llmCompleteChunk: LLMResponseCompleteChunk = {
        //   type: ChunkType.LLM_RESPONSE_COMPLETE,
        //   response: {
        //     usage: finalUsage
        //   }
        // }
        // yield llmCompleteChunk
        break
      }
    }
  } finally {
    reader.releaseLock() // Ensure the lock is released
  }
}

export const TextChunkMiddleware: CompletionsMiddleware =
  () => (next) => async (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => {
    const resultFromUpstream = await next(context, params)

    console.log(
      `[${MIDDLEWARE_NAME}] Received result from upstream. Stream is: ${resultFromUpstream.stream ? 'present' : 'absent'}`
    )

    // We expect resultFromUpstream.stream to be ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk>
    // as produced by the StreamAdapterMiddleware.
    if (resultFromUpstream.stream && resultFromUpstream.stream instanceof ReadableStream) {
      // Cast to the specific ReadableStream type we expect from the previous middleware.
      const rawSdkChunkStream = resultFromUpstream.stream as ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk>

      const standardChunkStream: ReadableStream<Chunk> = asyncGeneratorToReadableStream(
        openAISdkToStandardChunkConverter(rawSdkChunkStream, context.mcpTools)
      )

      const adaptedResult: CompletionsOpenAIResult = {
        ...resultFromUpstream,
        stream: standardChunkStream
      }
      console.log(`[${MIDDLEWARE_NAME}] Converted SDK chunks to standard Chunks.`, adaptedResult)
      return adaptedResult
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream. Returning original result.`)
      return resultFromUpstream
    }
  }
