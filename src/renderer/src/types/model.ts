import { z } from 'zod'

export const InputType = z.enum(['text', 'image', 'audio', 'video', 'document'])
export type InputType = z.infer<typeof InputType>

export const OutputType = z.enum(['text', 'image', 'audio', 'video', 'vector'])
export type OutputType = z.infer<typeof OutputType>

export const OutputMode = z.enum(['sync', 'streaming'])
export type OutputMode = z.infer<typeof OutputMode>

export const ModelCapability = z.enum([
  'audioGeneration',
  'cache',
  'codeExecution',
  'embedding',
  'fineTuning',
  'imageGeneration',
  'OCR',
  'realTime',
  'rerank',
  'reasoning',
  'streaming',
  'structuredOutput',
  'textGeneration',
  'translation',
  'transcription',
  'toolUse',
  'videoGeneration',
  'webSearch'
])
export type ModelCapability = z.infer<typeof ModelCapability>

export const ModelSchema = z
  .object({
    id: z.string(),
    modelId: z.string(),
    providerId: z.string(),
    name: z.string(),
    group: z.string(),
    description: z.string().optional(),
    owned_by: z.string().optional(),

    supportedInputs: z.array(InputType),
    supportedOutputs: z.array(OutputType),
    supportedOutputModes: z.array(OutputMode),

    limits: z
      .object({
        inputTokenLimit: z.number().optional(),
        outputTokenLimit: z.number().optional(),
        contextWindow: z.number().optional()
      })
      .optional(),

    price: z
      .object({
        inputTokenPrice: z.number().optional(),
        outputTokenPrice: z.number().optional()
      })
      .optional(),

    capabilities: z.array(ModelCapability)
  })
  .refine(
    (data) => {
      // 如果模型支持streaming，则必须支持streamingOutputMode
      if (data.capabilities.includes('streaming') && !data.supportedOutputModes.includes('streaming')) {
        return false
      }

      // 如果模型有OCR能力，则必须支持图像输入类型或者文件输入类型
      if (
        data.capabilities.includes('OCR') &&
        !data.supportedInputs.includes('image') &&
        !data.supportedInputs.includes('document')
      ) {
        return false
      }

      // 如果模型有图像生成能力，则必须支持图像输出
      if (data.capabilities.includes('imageGeneration') && !data.supportedOutputs.includes('image')) {
        return false
      }

      // 如果有音频生成能力，则必须支持音频输出类型
      if (data.capabilities.includes('audioGeneration') && !data.supportedOutputs.includes('audio')) {
        return false
      }

      // 如果有音频识别能力，则必须支持音频输入类型
      if (
        (data.capabilities.includes('transcription') || data.capabilities.includes('translation')) &&
        !data.supportedInputs.includes('audio')
      ) {
        return false
      }

      // 如果有视频生成能力，则必须支持视频输出类型
      if (data.capabilities.includes('videoGeneration') && !data.supportedOutputs.includes('video')) {
        return false
      }

      // 如果模型有embedding能力，则必须支持向量输出类型
      if (data.capabilities.includes('embedding') && !data.supportedOutputs.includes('vector')) {
        return false
      }

      // 如果模型有toolUse, Reasoning, streaming, cache, codeExecution, imageGeneration, audioGeneration, videoGeneration， webSearch能力，则必须支持文字的输入
      if (
        (data.capabilities.includes('toolUse') ||
          data.capabilities.includes('reasoning') ||
          data.capabilities.includes('streaming') ||
          data.capabilities.includes('cache') ||
          data.capabilities.includes('codeExecution') ||
          data.capabilities.includes('imageGeneration') ||
          data.capabilities.includes('audioGeneration') ||
          data.capabilities.includes('videoGeneration') ||
          data.capabilities.includes('webSearch')) &&
        !data.supportedInputs.includes('text')
      ) {
        return false
      }

      // 如果模型有toolUse, Reasoning, streaming, cache, codeExecution, OCR, textGeneration, translation, transcription, webSearch, structuredOutput能力，则必须支持文字的输出
      if (
        (data.capabilities.includes('toolUse') ||
          data.capabilities.includes('reasoning') ||
          data.capabilities.includes('streaming') ||
          data.capabilities.includes('cache') ||
          data.capabilities.includes('codeExecution') ||
          data.capabilities.includes('OCR') ||
          data.capabilities.includes('textGeneration') ||
          data.capabilities.includes('translation') ||
          data.capabilities.includes('transcription') ||
          data.capabilities.includes('webSearch') ||
          data.capabilities.includes('structuredOutput')) &&
        !data.supportedOutputs.includes('text')
      ) {
        return false
      }

      return true
    },
    {
      message: 'ModelCard has inconsistent capabilities and supported input/output type'
    }
  )

export type ModelCard = z.infer<typeof ModelSchema>

export function createModelCard(model: ModelCard): ModelCard {
  return ModelSchema.parse(model)
}

export function supportesInputType(model: ModelCard, inputType: InputType) {
  return model.supportedInputs.includes(inputType)
}

export function supportesOutputType(model: ModelCard, outputType: OutputType) {
  return model.supportedOutputs.includes(outputType)
}

export function supportesOutputMode(model: ModelCard, outputMode: OutputMode) {
  return model.supportedOutputModes.includes(outputMode)
}

export function supportesCapability(model: ModelCard, capability: ModelCapability) {
  return model.capabilities.includes(capability)
}

export function isVisionModel(model: ModelCard) {
  return supportesInputType(model, 'image')
}

export function isImageGenerationModel(model: ModelCard) {
  return isVisionModel(model) && supportesCapability(model, 'imageGeneration')
}

export function isAudioModel(model: ModelCard) {
  return supportesInputType(model, 'audio')
}

export function isAudioGenerationModel(model: ModelCard) {
  return supportesCapability(model, 'audioGeneration')
}

export function isVideoModel(model: ModelCard) {
  return supportesInputType(model, 'video')
}

export function isEmbedModel(model: ModelCard) {
  return supportesOutputType(model, 'vector') && supportesCapability(model, 'embedding')
}

export function isTextEmbeddingModel(model: ModelCard) {
  return isEmbedModel(model) && supportesInputType(model, 'text') && model.supportedInputs.length === 1
}

export function isMultiModalEmbeddingModel(model: ModelCard) {
  return isEmbedModel(model) && model.supportedInputs.length > 1
}

export function isRerankModel(model: ModelCard) {
  return supportesCapability(model, 'rerank')
}

export function isReasoningModel(model: ModelCard) {
  return supportesCapability(model, 'reasoning')
}

export function isToolUseModel(model: ModelCard) {
  return supportesCapability(model, 'toolUse')
}

export function isOnlyStreamingModel(model: ModelCard) {
  return (
    supportesCapability(model, 'streaming') &&
    supportesOutputMode(model, 'streaming') &&
    model.supportedOutputModes.length === 1
  )
}
