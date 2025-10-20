import { PersonGeneration } from '@google/genai'
import { isDedicatedGeminiImageGenerationModel, isDedicatedImageGenerationModel } from '@renderer/config/models'
import FileManager from '@renderer/services/FileManager'
import { GenerateImageParams } from '@renderer/types'
import { ChunkType, ImageContent } from '@renderer/types/chunk'
import { extractImageContent } from '@renderer/utils'
import { findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { defaultTimeout } from '@shared/config/constant'
import OpenAI from 'openai'
import { toFile } from 'openai/uploads'

import { BaseApiClient } from '../../clients/BaseApiClient'
import { GeminiAPIClient } from '../../clients/gemini/GeminiAPIClient'
import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'ImageGenerationMiddleware'

export const ImageGenerationMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (context: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const { assistant, messages } = params
    const client = context.apiClientInstance
    const signal = context._internal?.flowControl?.abortSignal
    if (!assistant.model || !isDedicatedImageGenerationModel(assistant.model) || typeof messages === 'string') {
      return next(context, params)
    }

    const openAIGenerateImage = async (
      params: GenerateImageParams,
      imageFiles?: Blob[]
    ): Promise<{ content: ImageContent; usage?: OpenAI.ImagesResponse.Usage }> => {
      const sdk = await (client as BaseApiClient<OpenAI>).getSdkInstance()
      if (imageFiles && imageFiles.length > 0) {
        const resp = await sdk.images.edit(
          {
            model: params.model,
            image: imageFiles,
            prompt: params.prompt
          },
          {
            signal,
            timeout: defaultTimeout
          }
        )
        return { content: extractImageContent(resp), usage: resp.usage }
      } else {
        return { content: await client.generateImage(params) }
      }
    }

    const stream = new ReadableStream<GenericChunk>({
      async start(controller) {
        const enqueue = (chunk: GenericChunk) => controller.enqueue(chunk)

        try {
          if (!assistant.model) {
            throw new Error('Assistant model is not defined.')
          }

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
          const isGemini = context.apiClientInstance.provider.type === 'gemini'
          const imageResult: ImageContent = {
            type: 'url',
            images: []
          }
          let usage: OpenAI.ImagesResponse.Usage | undefined = undefined

          if (isGemini && isDedicatedGeminiImageGenerationModel(assistant.model)) {
            const sdk = client as GeminiAPIClient
            const images = await sdk.generateImage({
              model: assistant.model.id,
              prompt,
              imageSize: '1:1',
              batchSize: 1,
              personGeneration: PersonGeneration.ALLOW_ALL,
              signal
            })
            imageResult.type = 'base64'
            imageResult.images.push(...images.images)
          } else {
            const data = await openAIGenerateImage(
              {
                model: assistant.model.id,
                prompt,
                imageSize: '1024x1024',
                batchSize: 1,
                responseFormat: 'b64_json'
              },
              imageFiles.length > 0 ? imageFiles : undefined
            )
            imageResult.type = data.content.type
            imageResult.images.push(...data.content.images)
            usage = data.usage
          }

          enqueue({
            type: ChunkType.IMAGE_COMPLETE,
            image: imageResult
          })

          usage = usage ?? {
            input_tokens: 0,
            input_tokens_details: { image_tokens: 0, text_tokens: 0 },
            output_tokens: 0,
            total_tokens: 0
          }

          enqueue({
            type: ChunkType.LLM_RESPONSE_COMPLETE,
            response: {
              usage,
              metrics: {
                completion_tokens: usage.output_tokens,
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
