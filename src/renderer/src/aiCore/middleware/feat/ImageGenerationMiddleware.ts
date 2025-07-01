import { BaseApiClient } from '@renderer/aiCore/clients/BaseApiClient'
import { isDedicatedImageGenerationModel } from '@renderer/config/models'
import FileManager from '@renderer/services/FileManager'
import { ChunkType } from '@renderer/types/chunk'
import { findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { defaultTimeout } from '@shared/config/constant'
import OpenAI from 'openai'
import { toFile } from 'openai/uploads'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'ImageGenerationMiddleware'

export const ImageGenerationMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (context: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const { assistant, messages } = params
    const client = context.apiClientInstance as BaseApiClient<OpenAI>
    const signal = context._internal?.flowControl?.abortSignal
    if (!assistant.model || !isDedicatedImageGenerationModel(assistant.model) || typeof messages === 'string') {
      return next(context, params)
    }

    const stream = new ReadableStream<GenericChunk>({
      async start(controller) {
        const enqueue = (chunk: GenericChunk) => controller.enqueue(chunk)

        try {
          if (!assistant.model) {
            throw new Error('Assistant model is not defined.')
          }

          const sdk = await client.getSdkInstance()
          const lastUserMessage = messages.findLast((m) => m.role === 'user')
          const lastAssistantMessage = messages.findLast((m) => m.role === 'assistant')

          if (!lastUserMessage) {
            throw new Error('No user message found for image generation.')
          }

          const prompt = getMainTextContent(lastUserMessage)
          let imageFiles: Blob[] = []

          // Collect images from user message
          const userImageBlocks = findImageBlocks(lastUserMessage)
          const userImages = await Promise.all(
            userImageBlocks.map(async (block) => {
              if (!block.file) return null
              const binaryData: Uint8Array = await FileManager.readBinaryImage(block.file)
              const mimeType = `${block.file.type}/${block.file.ext.slice(1)}`
              return await toFile(new Blob([binaryData]), block.file.origin_name || 'image.png', { type: mimeType })
            })
          )
          imageFiles = imageFiles.concat(userImages.filter(Boolean) as Blob[])

          // Collect images from last assistant message
          if (lastAssistantMessage) {
            const assistantImageBlocks = findImageBlocks(lastAssistantMessage)
            const assistantImages = await Promise.all(
              assistantImageBlocks.map(async (block) => {
                const b64 = block.url?.replace(/^data:image\/\w+;base64,/, '')
                if (!b64) return null
                const binary = atob(b64)
                const bytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
                return await toFile(new Blob([bytes]), 'assistant_image.png', { type: 'image/png' })
              })
            )
            imageFiles = imageFiles.concat(assistantImages.filter(Boolean) as Blob[])
          }

          enqueue({ type: ChunkType.IMAGE_CREATED })

          const startTime = Date.now()
          let response: OpenAI.Images.ImagesResponse
          const options = { signal, timeout: defaultTimeout }

          if (imageFiles.length > 0) {
            response = await sdk.images.edit(
              {
                model: assistant.model.id,
                image: imageFiles,
                prompt: prompt || ''
              },
              options
            )
          } else {
            response = await sdk.images.generate(
              {
                model: assistant.model.id,
                prompt: prompt || '',
                response_format: assistant.model.id.includes('gpt-image-1') ? undefined : 'b64_json'
              },
              options
            )
          }

          let imageType: 'url' | 'base64' = 'base64'
          const imageList =
            response.data?.reduce((acc: string[], image) => {
              if (image.url) {
                acc.push(image.url)
                imageType = 'url'
              } else if (image.b64_json) {
                acc.push(`data:image/png;base64,${image.b64_json}`)
              }
              return acc
            }, []) || []

          enqueue({
            type: ChunkType.IMAGE_COMPLETE,
            image: { type: imageType, images: imageList }
          })

          const usage = (response as any).usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

          enqueue({
            type: ChunkType.LLM_RESPONSE_COMPLETE,
            response: {
              usage,
              metrics: {
                completion_tokens: usage.completion_tokens,
                time_first_token_millsec: 0,
                time_completion_millsec: Date.now() - startTime
              }
            }
          })
        } catch (error: any) {
          enqueue({ type: ChunkType.ERROR, error })
        } finally {
          controller.close()
        }
      }
    })

    return {
      stream,
      getText: () => ''
    }
  }
