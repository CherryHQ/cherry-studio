import { getOpenAIWebSearchParams, isVisionModel } from '@renderer/config/models'
import { getAssistantSettings, getDefaultModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import { filterContextMessages } from '@renderer/services/MessagesService'
import { FileTypes, Message, Model, Provider } from '@renderer/types'
import { takeRight } from 'lodash'
import OpenAI from 'openai'
import { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources'

import { CompletionsParams } from '.'
import OpenAIProvider from './OpenAIProvider'

class QwenLMProvider extends OpenAIProvider {
  constructor(provider: Provider) {
    super(provider)
  }

  private async getMessageParams(
    message: Message,
    model: Model
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)

    if (!message.files) {
      return {
        role: message.role,
        content
      }
    }

    const parts: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: content
      }
    ]

    const qwenlm_image_url: { type: string; image: string }[] = []

    for (const file of message.files || []) {
      if (file.type === FileTypes.IMAGE && isVision) {
        const image = await window.api.file.binaryFile(file.id + file.ext)

        const imageId = await this.uploadImageToQwenLM(image.data, file.origin_name, image.mime)
        qwenlm_image_url.push({
          type: 'image',
          image: imageId
        })
      }
      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
        parts.push({
          type: 'text',
          text: file.origin_name + '\n' + fileContent
        })
      }
    }

    return {
      role: message.role,
      content: [...parts, ...qwenlm_image_url]
    } as ChatCompletionMessageParam
  }

  private async uploadImageToQwenLM(image_file: Buffer, file_name: string, mime: string): Promise<string> {
    try {
      // 创建 FormData
      const formData = new FormData()
      formData.append('file', new Blob([image_file], { type: mime }), file_name)

      // 发送上传请求
      const response = await fetch(`${this.provider.apiHost}v1/files/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        body: formData
      })

      if (!response.ok) {
        throw new Error('Failed to upload image to QwenLM')
      }

      const data = await response.json()
      return data.id
    } catch (error) {
      console.error('Error uploading image to QwenLM:', error)
      throw error
    }
  }

  async completions({ messages, assistant, onChunk, onFilterMessages }: CompletionsParams): Promise<void> {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens } = getAssistantSettings(assistant)

    const systemMessage = assistant.prompt ? { role: 'system', content: assistant.prompt } : undefined
    const userMessages: ChatCompletionMessageParam[] = []

    const _messages = filterContextMessages(takeRight(messages, contextCount + 1))
    onFilterMessages(_messages)

    if (_messages[0]?.role !== 'user') {
      userMessages.push({ role: 'user', content: '' })
    }

    for (const message of _messages) {
      userMessages.push(await this.getMessageParams(message, model))
    }

    let time_first_token_millsec = 0
    const start_time_millsec = new Date().getTime()

    // @ts-ignore key is not typed
    const stream = await this.sdk.chat.completions.create({
      model: model.id,
      messages: [systemMessage, ...userMessages].filter(Boolean) as ChatCompletionMessageParam[],
      temperature: assistant?.settings?.temperature,
      top_p: assistant?.settings?.topP,
      max_tokens: maxTokens,
      stream: true,
      ...(assistant.enableWebSearch ? getOpenAIWebSearchParams(model) : {}),
      ...this.getCustomParameters(assistant)
    })

    let accumulatedText = ''

    for await (const chunk of stream) {
      if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
        break
      }
      if (time_first_token_millsec == 0) {
        time_first_token_millsec = new Date().getTime() - start_time_millsec
      }

      // 获取当前块的完整内容
      const currentContent = chunk.choices[0]?.delta?.content || ''

      // 如果内容与累积的内容不同，则只发送增量部分
      if (currentContent !== accumulatedText) {
        const deltaText = currentContent.slice(accumulatedText.length)
        accumulatedText = currentContent // 更新累积的文本

        const time_completion_millsec = new Date().getTime() - start_time_millsec
        onChunk({
          text: deltaText,
          usage: chunk.usage,
          metrics: {
            completion_tokens: chunk.usage?.completion_tokens,
            time_completion_millsec,
            time_first_token_millsec
          }
        })
      }
    }
  }
}

export default QwenLMProvider
