/**
 * 文件处理模块
 * 处理文件内容提取、文件格式转换、文件上传等逻辑
 */

import { loggerService } from '@logger'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { FileMetadata, Message, Model } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { FileMessageBlock } from '@renderer/types/newMessage'
import { findFileBlocks } from '@renderer/utils/messageUtils/find'
import type { FilePart, TextPart } from 'ai'
import type OpenAI from 'openai'

import { getAiSdkProviderId } from '../provider/factory'
import { getFileSizeLimit, supportsImageInput, supportsLargeFileUpload, supportsPdfInput } from './modelCapabilities'

const logger = loggerService.withContext('fileProcessor')

/**
 * 提取文件内容
 */
export async function extractFileContent(message: Message): Promise<string> {
  const fileBlocks = findFileBlocks(message)
  if (fileBlocks.length > 0) {
    const textFileBlocks = fileBlocks.filter(
      (fb) => fb.file && [FileTypes.TEXT, FileTypes.DOCUMENT].includes(fb.file.type)
    )

    if (textFileBlocks.length > 0) {
      let text = ''
      const divider = '\n\n---\n\n'

      for (const fileBlock of textFileBlocks) {
        const file = fileBlock.file
        const fileContent = (await window.api.file.read(file.id + file.ext)).trim()
        const fileNameRow = 'file: ' + file.origin_name + '\n\n'
        text = text + fileNameRow + fileContent + divider
      }

      return text
    }
  }

  return ''
}

/**
 * 将文件块转换为文本部分
 */
export async function convertFileBlockToTextPart(fileBlock: FileMessageBlock): Promise<TextPart | null> {
  const file = fileBlock.file

  // 处理文本文件
  if (file.type === FileTypes.TEXT) {
    try {
      const fileContent = await window.api.file.read(file.id + file.ext)
      return {
        type: 'text',
        text: `${file.origin_name}\n${fileContent.trim()}`
      }
    } catch (error) {
      logger.warn('Failed to read text file:', error as Error)
    }
  }

  // 处理文档文件（PDF、Word、Excel等）- 提取为文本内容
  if (file.type === FileTypes.DOCUMENT) {
    try {
      const fileContent = await window.api.file.read(file.id + file.ext, true) // true表示强制文本提取
      return {
        type: 'text',
        text: `${file.origin_name}\n${fileContent.trim()}`
      }
    } catch (error) {
      logger.warn(`Failed to extract text from document ${file.origin_name}:`, error as Error)
    }
  }

  return null
}

/**
 * 处理Gemini大文件上传
 */
export async function handleGeminiFileUpload(file: FileMetadata, model: Model): Promise<FilePart | null> {
  try {
    const provider = getProviderByModel(model)

    // 检查文件是否已经上传过
    const fileMetadata = await window.api.fileService.retrieve(provider, file.id)

    if (fileMetadata.status === 'success' && fileMetadata.originalFile?.file) {
      const remoteFile = fileMetadata.originalFile.file as any // 临时类型断言，因为File类型定义可能不完整
      // 注意：AI SDK的FilePart格式和Gemini原生格式不同，这里需要适配
      // 暂时返回null让它回退到文本处理，或者需要扩展FilePart支持uri
      logger.info(`File ${file.origin_name} already uploaded to Gemini with URI: ${remoteFile.uri || 'unknown'}`)
      return null
    }

    // 如果文件未上传，执行上传
    const uploadResult = await window.api.fileService.upload(provider, file)
    if (uploadResult.originalFile?.file) {
      const remoteFile = uploadResult.originalFile.file as any // 临时类型断言
      logger.info(`File ${file.origin_name} uploaded to Gemini with URI: ${remoteFile.uri || 'unknown'}`)
      // 同样，这里需要处理URI格式的文件引用
      return null
    }
  } catch (error) {
    logger.error(`Failed to upload file ${file.origin_name} to Gemini:`, error as Error)
  }

  return null
}

/**
 * 处理OpenAI大文件上传
 */
export async function handleOpenAILargeFileUpload(
  file: FileMetadata,
  model: Model
): Promise<(FilePart & { id?: string }) | null> {
  const provider = getProviderByModel(model)
  // 如果模型为qwen-long系列，文档中要求purpose需要为'file-extract'
  if (['qwen-long', 'qwen-doc'].some((modelName) => model.name.includes(modelName))) {
    file = {
      ...file,
      // 该类型并不在OpenAI定义中，但符合sdk规范，强制断言
      purpose: 'file-extract' as OpenAI.FilePurpose
    }
  }
  try {
    // 检查文件是否已经上传过
    const fileMetadata = await window.api.fileService.retrieve(provider, file.id)
    if (fileMetadata.status === 'success' && fileMetadata.originalFile?.file) {
      // 断言OpenAIFile对象
      const remoteFile = fileMetadata.originalFile.file as OpenAI.Files.FileObject
      // 判断用途是否一致
      if (remoteFile.purpose !== file.purpose) {
        logger.warn(`File ${file.origin_name} purpose mismatch: ${remoteFile.purpose} vs ${file.purpose}`)
        throw new Error('File purpose mismatch')
      }
      return {
        type: 'file',
        filename: file.origin_name,
        mediaType: '',
        data: `fileid://${remoteFile.id}`
      }
    }
  } catch (error) {
    logger.error(`Failed to retrieve file ${file.origin_name}:`, error as Error)
    return null
  }
  try {
    // 如果文件未上传，执行上传
    const uploadResult = await window.api.fileService.upload(provider, file)
    if (uploadResult.originalFile?.file) {
      // 断言OpenAIFile对象
      const remoteFile = uploadResult.originalFile.file as OpenAI.Files.FileObject
      logger.info(`File ${file.origin_name} uploaded.`)
      return {
        type: 'file',
        filename: remoteFile.filename,
        mediaType: '',
        data: `fileid://${remoteFile.id}`
      }
    }
  } catch (error) {
    logger.error(`Failed to upload file ${file.origin_name}:`, error as Error)
  }

  return null
}

/**
 * 大文件上传路由函数
 */
export async function handleLargeFileUpload(
  file: FileMetadata,
  model: Model
): Promise<(FilePart & { id?: string }) | null> {
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  if (['google', 'google-generative-ai', 'google-vertex'].includes(aiSdkId)) {
    return await handleGeminiFileUpload(file, model)
  }

  if (provider.type === 'openai') {
    return await handleOpenAILargeFileUpload(file, model)
  }

  return null
}

/**
 * 将文件块转换为FilePart（用于原生文件支持）
 */
export async function convertFileBlockToFilePart(fileBlock: FileMessageBlock, model: Model): Promise<FilePart | null> {
  const file = fileBlock.file
  const fileSizeLimit = getFileSizeLimit(model, file.type)

  try {
    // 处理PDF文档
    if (file.type === FileTypes.DOCUMENT && file.ext === '.pdf' && supportsPdfInput(model)) {
      // 检查文件大小限制
      if (file.size > fileSizeLimit) {
        // 如果支持大文件上传（如Gemini File API），尝试上传
        if (supportsLargeFileUpload(model)) {
          logger.info(`Large PDF file ${file.origin_name} (${file.size} bytes) attempting File API upload`)
          const uploadResult = await handleLargeFileUpload(file, model)
          if (uploadResult) {
            return uploadResult
          }
          // 如果上传失败，回退到文本处理
          logger.warn(`Failed to upload large PDF ${file.origin_name}, falling back to text extraction`)
          return null
        } else {
          logger.warn(`PDF file ${file.origin_name} exceeds size limit (${file.size} > ${fileSizeLimit})`)
          return null // 文件过大，回退到文本处理
        }
      }

      const base64Data = await window.api.file.base64File(file.id + file.ext)
      return {
        type: 'file',
        data: base64Data.data,
        mediaType: base64Data.mime,
        filename: file.origin_name
      }
    }

    // 处理图片文件
    if (file.type === FileTypes.IMAGE && supportsImageInput(model)) {
      // 检查文件大小
      if (file.size > fileSizeLimit) {
        logger.warn(`Image file ${file.origin_name} exceeds size limit (${file.size} > ${fileSizeLimit})`)
        return null
      }

      const base64Data = await window.api.file.base64Image(file.id + file.ext)

      // 处理MIME类型，特别是jpg->jpeg的转换（Anthropic要求）
      let mediaType = base64Data.mime
      const provider = getProviderByModel(model)
      const aiSdkId = getAiSdkProviderId(provider)

      if (aiSdkId === 'anthropic' && mediaType === 'image/jpg') {
        mediaType = 'image/jpeg'
      }

      return {
        type: 'file',
        data: base64Data.base64,
        mediaType: mediaType,
        filename: file.origin_name
      }
    }

    // 处理其他文档类型（Word、Excel等）
    if (file.type === FileTypes.DOCUMENT && file.ext !== '.pdf') {
      // 目前大多数提供商不支持Word等格式的原生处理
      // 返回null会触发上层调用convertFileBlockToTextPart进行文本提取
      // 这与Legacy架构中的处理方式一致
      logger.debug(`Document file ${file.origin_name} with extension ${file.ext} will use text extraction fallback`)
      return null
    }
  } catch (error) {
    logger.warn(`Failed to process file ${file.origin_name}:`, error as Error)
  }

  return null
}
