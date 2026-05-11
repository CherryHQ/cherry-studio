import type { KnowledgeBase, PreprocessProvider, PreprocessProviderId } from '@renderer/types/knowledge'
import { isPreprocessProviderId } from '@renderer/types/knowledge'
import type { FileProcessorOverrides } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/file-processing'
import { mergeFileProcessorPresets } from '@shared/data/utils/fileProcessorMerger'

type DocumentToMarkdownCapability = Extract<FileProcessorFeatureCapability, { feature: 'document_to_markdown' }>
type Translate = (key: string) => string

const PREPROCESS_PROVIDER_NAME_KEYS: Record<PreprocessProviderId, string> = {
  doc2x: 'settings.tool.file_processing.processors.doc2x.name',
  mineru: 'settings.tool.file_processing.processors.mineru.name',
  mistral: 'settings.tool.file_processing.processors.mistral.name',
  'open-mineru': 'settings.tool.file_processing.processors.open_mineru.name',
  paddleocr: 'settings.tool.file_processing.processors.paddleocr.name'
}

const PREPROCESS_PROVIDER_FALLBACK_NAMES: Record<PreprocessProviderId, string> = {
  doc2x: 'Doc2x',
  mineru: 'MinerU',
  mistral: 'Mistral',
  'open-mineru': 'Open MinerU',
  paddleocr: 'PaddleOCR'
}

const API_KEY_OPTIONAL_PREPROCESS_PROVIDER_IDS = new Set<PreprocessProviderId>(['mineru', 'open-mineru', 'paddleocr'])

const DOCUMENT_PREPROCESS_PROVIDER_ORDER: readonly PreprocessProviderId[] = [
  'mistral',
  'mineru',
  'doc2x',
  'open-mineru',
  'paddleocr'
]

function getDocumentToMarkdownCapability(processor: FileProcessorMerged): DocumentToMarkdownCapability | undefined {
  return processor.capabilities.find(
    (capability): capability is DocumentToMarkdownCapability => capability.feature === 'document_to_markdown'
  )
}

function getFirstApiKey(apiKeys: string[] | undefined): string {
  return apiKeys?.map((apiKey) => apiKey.trim()).find(Boolean) ?? ''
}

function getProviderName(providerId: PreprocessProviderId, translate?: Translate): string {
  return translate?.(PREPROCESS_PROVIDER_NAME_KEYS[providerId]) ?? PREPROCESS_PROVIDER_FALLBACK_NAMES[providerId]
}

export function getKnowledgePreprocessProviders(
  overrides: FileProcessorOverrides | null | undefined,
  translate?: Translate
): PreprocessProvider[] {
  const providers = mergeFileProcessorPresets(overrides ?? {}).flatMap((processor) => {
    const capability = getDocumentToMarkdownCapability(processor)

    if (!capability || !isPreprocessProviderId(processor.id)) {
      return []
    }

    return {
      id: processor.id,
      name: getProviderName(processor.id, translate),
      apiKey: getFirstApiKey(processor.apiKeys),
      apiHost: capability.apiHost ?? '',
      model: capability.modelId,
      options: processor.options
    }
  })

  return providers.sort(
    (left, right) =>
      DOCUMENT_PREPROCESS_PROVIDER_ORDER.indexOf(left.id) - DOCUMENT_PREPROCESS_PROVIDER_ORDER.indexOf(right.id)
  )
}

export function isSelectableKnowledgePreprocessProvider(provider: PreprocessProvider): boolean {
  return Boolean(provider.apiKey?.trim()) || API_KEY_OPTIONAL_PREPROCESS_PROVIDER_IDS.has(provider.id)
}

export function refreshKnowledgePreprocessProvider(
  preprocessProvider: KnowledgeBase['preprocessProvider'],
  overrides: FileProcessorOverrides | null | undefined
): KnowledgeBase['preprocessProvider'] {
  if (!preprocessProvider || overrides === undefined || overrides === null) {
    return preprocessProvider
  }

  const provider = getKnowledgePreprocessProviders(overrides).find((item) => item.id === preprocessProvider.provider.id)

  return provider
    ? {
        type: 'preprocess',
        provider
      }
    : preprocessProvider
}
