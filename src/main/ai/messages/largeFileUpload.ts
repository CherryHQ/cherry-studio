/**
 * Provider-native large-file upload — PORT PENDING.
 *
 * Large files (typically ≥ 20 MB for Gemini / ≥ a few MB for OpenAI) should
 * be uploaded to the provider's File API (Gemini File / OpenAI Files) and
 * referenced by URI or file_id, rather than inlined as base64 data URLs
 * (which Main's `resolveFileUIPart` currently does). Without this, large PDFs
 * / media files either blow past provider payload limits or burn a huge
 * amount of tokens on base64 re-encoding.
 *
 * This file is a verbatim copy of the renderer origin/main implementation
 * kept as a reference checkpoint. It is NOT imported anywhere — the code
 * below sits inside a block comment so TS / the bundler ignore it. To wire
 * it up on Main:
 *
 *   1. Replace every `window.api.file.*` / `window.api.fileService.*` with
 *      the Main-process `fileStorage` / `FileStorage` service (see
 *      `src/main/services/FileStorage.ts` — `getFilePathById`,
 *      `base64File`, `base64Image`). For Gemini / OpenAI file-upload,
 *      implement a Main-side `fileService.upload(provider, file)` /
 *      `fileService.retrieve(provider, fileId)` layer that talks to the
 *      provider SDK's Files API directly (Gemini: `@google/genai`
 *      `files.upload`; OpenAI: `openai.files.create`).
 *   2. Replace `getProviderByModel(model)` with an async DataApi
 *      `providers.getByModelId` call, or have the caller pass `provider`.
 *   3. Replace `window.toast.*` / `i18next` with logger warnings —
 *      caller decides how to surface user-facing errors.
 *   4. Update the dispatch in `resolveFileUIPart` (see `./fileProcessor`)
 *      to call `handleLargeFileUpload` for files above `getFileSizeLimit`
 *      before falling back to base64 inlining.
 *   5. v2 `FileBlock` / `ImageBlock` only carry `fileId`; `FileMetadata`
 *      (with `size` / `ext` / `type` / `origin_name`) must be resolved
 *      from `fileStorage` first. `fileStorage.getFilePathById(file)` takes
 *      a FileMetadata — caller will need to synthesize one or extend
 *      FileStorage with a `getMetadataById(fileId)` helper.
 *
 * Related renderer files also not yet ported (internal helpers):
 *   - `prepareParams/modelCapabilities.ts` — `supportsImageInput` /
 *     `supportsLargeFileUpload` / `getFileSizeLimit`
 *   - `prepareParams/fileProcessor.ts::extractFileContent` /
 *     `convertFileBlockToTextPart` / `convertFileBlockToFilePart` — v1
 *     block→part conversion. v2 Main operates on `data.parts` directly, so
 *     these aren't the critical path; only the large-file-upload branch is.
 */

// prettier-ignore
/*

// ──────────────────────────────────────────────────────────────────────
// Verbatim copy from renderer origin/main — commented out to keep the file
// inert until the Main-side port is wired up.
// Source: src/renderer/src/aiCore/prepareParams/fileProcessor.ts
// ──────────────────────────────────────────────────────────────────────

import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { FileMetadata, Message, Model } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import type { FileMessageBlock } from '@renderer/types/newMessage'
import { findFileBlocks } from '@renderer/utils/messageUtils/find'
import type { FilePart, TextPart } from 'ai'
import i18n from 'i18next'

import { getAiSdkProviderId } from '../provider/factory'
import { getFileSizeLimit, supportsImageInput, supportsLargeFileUpload } from './modelCapabilities'

const logger = loggerService.withContext('fileProcessor')

// 提取文件内容
export async function extractFileContent(message: Message): Promise<string> {
  const fileBlocks = findFileBlocks(message)
  if (fileBlocks.length > 0) {
    const textFileBlocks = fileBlocks.filter(
      (fb) => fb.file && [FILE_TYPE.TEXT, FILE_TYPE.DOCUMENT].some((type) => fb.file.type === type)
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

// 将文件块转换为文本部分
export async function convertFileBlockToTextPart(fileBlock: FileMessageBlock): Promise<TextPart | null> {
  const file = fileBlock.file

  // 处理文本文件
  if (file.type === FILE_TYPE.TEXT) {
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
  if (file.type === FILE_TYPE.DOCUMENT) {
    try {
      const fileContent = await window.api.file.read(file.id + file.ext, true)
      return {
        type: 'text',
        text: `${file.origin_name}\n${fileContent.trim()}`
      }
    } catch (error) {
      logger.warn(`Failed to extract text from document ${file.origin_name}:`, error as Error)
      window.toast.error(i18n.t('message.error.file.text_extraction_failed', { name: file.origin_name }))
    }
  }

  return null
}

// 处理Gemini大文件上传
export async function handleGeminiFileUpload(file: FileMetadata, model: Model): Promise<FilePart | null> {
  try {
    const provider = getProviderByModel(model)

    // 检查文件是否已经上传过
    const fileMetadata = await window.api.fileService.retrieve(provider, file.id)

    if (fileMetadata.status === 'success' && fileMetadata.originalFile?.file) {
      const remoteFile = fileMetadata.originalFile.file as any
      logger.info(`File ${file.origin_name} already uploaded to Gemini with URI: ${remoteFile.uri || 'unknown'}`)
      return null
    }

    // 如果文件未上传，执行上传
    const uploadResult = await window.api.fileService.upload(provider, file)
    if (uploadResult.originalFile?.file) {
      const remoteFile = uploadResult.originalFile.file as any
      logger.info(`File ${file.origin_name} uploaded to Gemini with URI: ${remoteFile.uri || 'unknown'}`)
      return null
    }
  } catch (error) {
    logger.error(`Failed to upload file ${file.origin_name} to Gemini:`, error as Error)
  }

  return null
}

// 处理OpenAI兼容大文件上传
export async function handleOpenAILargeFileUpload(
  file: FileMetadata,
  model: Model
): Promise<(FilePart & { id?: string }) | null> {
  const provider = getProviderByModel(model)
  // qwen-long / qwen-doc 要求 purpose = 'file-extract'
  if (['qwen-long', 'qwen-doc'].some((modelName) => model.name.includes(modelName))) {
    file = {
      ...file,
      purpose: 'file-extract' as OpenAI.FilePurpose
    }
  }
  try {
    const fileMetadata = await window.api.fileService.retrieve(provider, file.id)
    if (fileMetadata.status === 'success' && fileMetadata.originalFile?.file) {
      const remoteFile = fileMetadata.originalFile.file as OpenAI.Files.FileObject
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
    const uploadResult = await window.api.fileService.upload(provider, file)
    if (uploadResult.originalFile?.file) {
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

// 大文件上传路由
export async function handleLargeFileUpload(
  file: FileMetadata,
  model: Model
): Promise<(FilePart & { id?: string }) | null> {
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  if (['google', 'google-vertex'].includes(aiSdkId)) {
    return await handleGeminiFileUpload(file, model)
  }

  if (aiSdkId === 'openai') {
    return await handleOpenAILargeFileUpload(file, model)
  }

  return null
}

// 将文件块转换为 FilePart（含大文件上传分支）
export async function convertFileBlockToFilePart(fileBlock: FileMessageBlock, model: Model): Promise<FilePart | null> {
  const file = fileBlock.file
  const fileSizeLimit = getFileSizeLimit(model, file.type)

  try {
    // PDF
    if (file.type === FILE_TYPE.DOCUMENT && file.ext === '.pdf') {
      if (file.size > fileSizeLimit) {
        if (supportsLargeFileUpload(model)) {
          logger.info(`Large PDF file ${file.origin_name} (${file.size} bytes) attempting File API upload`)
          const uploadResult = await handleLargeFileUpload(file, model)
          if (uploadResult) {
            return uploadResult
          }
          logger.warn(`Failed to upload large PDF ${file.origin_name}, falling back to text extraction`)
          window.toast.warning(i18n.t('message.warning.file.pdf_upload_failed', { name: file.origin_name }))
          return null
        } else {
          logger.warn(`PDF file ${file.origin_name} exceeds size limit (${file.size} > ${fileSizeLimit})`)
          window.toast.warning(
            i18n.t('message.warning.file.pdf_exceeds_limit', {
              name: file.origin_name,
              limit: `${Math.round(fileSizeLimit / 1024 / 1024)}MB`
            })
          )
          return null
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

    // 图片
    if (file.type === FILE_TYPE.IMAGE && supportsImageInput(model)) {
      if (file.size > fileSizeLimit) {
        logger.warn(`Image file ${file.origin_name} exceeds size limit (${file.size} > ${fileSizeLimit})`)
        return null
      }

      const base64Data = await window.api.file.base64Image(file.id + file.ext)
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

    // 其它文档类型 → 回退 text 提取
    if (file.type === FILE_TYPE.DOCUMENT && file.ext !== '.pdf') {
      logger.debug(`Document file ${file.origin_name} with extension ${file.ext} will use text extraction fallback`)
      return null
    }
  } catch (error) {
    logger.warn(`Failed to process file ${file.origin_name}:`, error as Error)
  }

  return null
}


// ──────────────────────────────────────────────────────────────────────
// Verbatim copy from renderer origin/main.
// Source: src/renderer/src/aiCore/prepareParams/modelCapabilities.ts
// ──────────────────────────────────────────────────────────────────────

import { isVisionModel } from '@renderer/config/models'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { FileType, Model } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { getAiSdkProviderId } from '../provider/factory'

function modelSupportValidator(
  model: Model,
  {
    supportedModels = [],
    unsupportedModels = [],
    supportedProviders = [],
    unsupportedProviders = []
  }: {
    supportedModels?: string[]
    unsupportedModels?: string[]
    supportedProviders?: string[]
    unsupportedProviders?: string[]
  }
): boolean {
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  if (unsupportedModels.some((name) => model.name.includes(name))) return false
  if (unsupportedProviders.includes(aiSdkId)) return false
  if (supportedModels.some((name) => model.name.includes(name))) return true
  return supportedProviders.includes(aiSdkId)
}

export function supportsImageInput(model: Model): boolean {
  return isVisionModel(model)
}

export function supportsLargeFileUpload(model: Model): boolean {
  return modelSupportValidator(model, {
    supportedModels: ['qwen-long', 'qwen-doc'],
    supportedProviders: ['google', 'google-generative-ai', 'google-vertex']
  })
}

export function getFileSizeLimit(model: Model, fileType: FileType): number {
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  // Anthropic PDF 32MB
  if (aiSdkId === 'anthropic' && fileType === FILE_TYPE.DOCUMENT) {
    return 32 * 1024 * 1024
  }

  // Gemini 20MB(超限走 File API)
  if (['google', 'google-generative-ai', 'google-vertex'].includes(aiSdkId)) {
    return 20 * 1024 * 1024
  }

  // Dashscope 支持大文件上传 → 0 触发 File API 路径
  if (aiSdkId === 'dashscope' && supportsLargeFileUpload(model)) {
    return 0
  }

  return Infinity
}

*/

export {}
