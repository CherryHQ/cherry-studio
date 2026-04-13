import type { LanguageModelV3FilePart } from '@ai-sdk/provider'
import { loggerService } from '@logger'
import store from '@renderer/store'
import type { FileMetadata, PreprocessProvider } from '@renderer/types'
import { extractPdfText } from '@shared/utils/pdf'
import i18n from 'i18next'

const logger = loggerService.withContext('chatDocumentReader')
const CHAT_FILE_METADATA_KEY = '__cherryStudioChatFile'

type PdfFilePart = LanguageModelV3FilePart & { mediaType: 'application/pdf' }
type PdfFilePartWithMetadata = PdfFilePart & { [CHAT_FILE_METADATA_KEY]?: FileMetadata }

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Unknown error'
}

export function attachChatFileMetadata<T extends object>(part: T, file: FileMetadata): T {
  Object.defineProperty(part, CHAT_FILE_METADATA_KEY, {
    value: file,
    enumerable: false,
    configurable: true
  })

  return part
}

function getAttachedChatFile(part: PdfFilePart): FileMetadata | undefined {
  return (part as PdfFilePartWithMetadata)[CHAT_FILE_METADATA_KEY]
}

function getDefaultPreprocessProvider(): PreprocessProvider | undefined {
  const state = store.getState()
  const preprocessState = state?.preprocess
  if (!preprocessState?.defaultProvider || !Array.isArray(preprocessState.providers)) {
    return undefined
  }

  return preprocessState.providers.find((provider) => provider.id === preprocessState.defaultProvider)
}

function isConfiguredPreprocessProvider(provider?: PreprocessProvider): provider is PreprocessProvider {
  if (!provider?.id) {
    return false
  }

  const apiHost = provider.apiHost?.trim()
  return provider.id === 'paddleocr' && Boolean(apiHost)
}

function getAvailablePreprocessProvider(file: Pick<FileMetadata, 'ext'>): PreprocessProvider | undefined {
  if (file.ext.toLowerCase() !== '.pdf') {
    return undefined
  }

  const provider = getDefaultPreprocessProvider()
  return isConfiguredPreprocessProvider(provider) ? provider : undefined
}

async function tryReadStoredPdfWithPreprocess(file: FileMetadata): Promise<string | null> {
  const preprocessProvider = getAvailablePreprocessProvider(file)
  if (!preprocessProvider) {
    return null
  }

  try {
    return await window.api.file.readForChat(file, preprocessProvider)
  } catch (error) {
    const message = getErrorMessage(error)
    logger.warn(`Failed to preprocess PDF ${file.origin_name} for chat, falling back to plain extraction: ${message}`)
    window.toast.warning(
      `${i18n.t('message.warning.file.pdf_text_extraction_failed', { name: file.origin_name })}: ${message}`
    )
    return null
  }
}

export async function readDocumentTextForChat(file: FileMetadata): Promise<string> {
  const preprocessedText = await tryReadStoredPdfWithPreprocess(file)
  if (preprocessedText !== null) {
    return preprocessedText
  }

  return window.api.file.read(file.id + file.ext, true)
}

export async function readPdfFilePartTextForChat(part: PdfFilePart): Promise<string> {
  const attachedFile = getAttachedChatFile(part)
  if (attachedFile) {
    const preprocessedText = await tryReadStoredPdfWithPreprocess(attachedFile)
    if (preprocessedText !== null) {
      return preprocessedText
    }
  }

  return part.data instanceof URL ? extractPdfText(part.data) : window.api.pdf.extractText(part.data)
}
