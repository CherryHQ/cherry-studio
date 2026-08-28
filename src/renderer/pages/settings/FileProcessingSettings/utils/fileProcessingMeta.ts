import { TESSERACT_LANG_MAP } from '@renderer/pages/settings/FileProcessingSettings/ocr'
import { isWin } from '@renderer/utils/platform'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/fileProcessing'

export type FileProcessingMenuEntry = {
  key: string
  feature: FileProcessorFeature
  processor: FileProcessorMerged
  capability: FileProcessorFeatureCapability
}

export type FileProcessingFeatureSection = {
  feature: FileProcessorFeature
  entries: FileProcessingMenuEntry[]
}

const FILE_PROCESSING_FEATURE_SECTIONS: readonly {
  feature: FileProcessorFeature
  processors: readonly FileProcessorId[]
}[] = [
  {
    feature: 'image_to_text',
    processors: ['system', 'paddleocr', 'local-paddleocr', 'tesseract', 'mistral', 'ovocr']
  },
  {
    feature: 'document_to_markdown',
    processors: ['local-document', 'mineru', 'paddleocr', 'doc2x', 'mistral', 'open-mineru']
  }
] as const

type ProcessorDisplayMeta = {
  nameKey: string
  descriptionKey: string
  apiKeyWebsite: string | null
}

const PROCESSOR_DISPLAY_META: Record<FileProcessorId, ProcessorDisplayMeta> = {
  system: {
    nameKey: 'settings.tool.file_processing.processors.system.name',
    descriptionKey: 'settings.tool.file_processing.processors.system.description',
    apiKeyWebsite: null
  },
  tesseract: {
    nameKey: 'settings.tool.file_processing.processors.tesseract.name',
    descriptionKey: 'settings.tool.file_processing.processors.tesseract.description',
    apiKeyWebsite: null
  },
  paddleocr: {
    nameKey: 'settings.tool.file_processing.processors.paddleocr.name',
    descriptionKey: 'settings.tool.file_processing.processors.paddleocr.description',
    apiKeyWebsite: 'https://aistudio.baidu.com/paddleocr/'
  },
  'local-paddleocr': {
    nameKey: 'settings.tool.file_processing.processors.local_paddleocr.name',
    descriptionKey: 'settings.tool.file_processing.processors.local_paddleocr.description',
    apiKeyWebsite: null
  },
  'local-document': {
    nameKey: 'settings.tool.file_processing.processors.local_document.name',
    descriptionKey: 'settings.tool.file_processing.processors.local_document.description',
    apiKeyWebsite: null
  },
  ovocr: {
    nameKey: 'settings.tool.file_processing.processors.ovocr.name',
    descriptionKey: 'settings.tool.file_processing.processors.ovocr.description',
    apiKeyWebsite: null
  },
  mineru: {
    nameKey: 'settings.tool.file_processing.processors.mineru.name',
    descriptionKey: 'settings.tool.file_processing.processors.mineru.description',
    apiKeyWebsite: 'https://mineru.net/apiManage'
  },
  doc2x: {
    nameKey: 'settings.tool.file_processing.processors.doc2x.name',
    descriptionKey: 'settings.tool.file_processing.processors.doc2x.description',
    apiKeyWebsite: 'https://open.noedgeai.com/apiKeys'
  },
  mistral: {
    nameKey: 'settings.tool.file_processing.processors.mistral.name',
    descriptionKey: 'settings.tool.file_processing.processors.mistral.description',
    apiKeyWebsite: 'https://mistral.ai/api-keys'
  },
  'open-mineru': {
    nameKey: 'settings.tool.file_processing.processors.open_mineru.name',
    descriptionKey: 'settings.tool.file_processing.processors.open_mineru.description',
    apiKeyWebsite: 'https://github.com/opendatalab/MinerU/'
  }
} as const satisfies Record<FileProcessorId, ProcessorDisplayMeta>

export function createMenuEntry(
  processor: FileProcessorMerged,
  feature: FileProcessorFeature,
  availableProcessorIds: ReadonlySet<string>
): FileProcessingMenuEntry | null {
  const capability = processor.capabilities.find((item) => item.feature === feature)

  if (!capability) {
    return null
  }

  if (!availableProcessorIds.has(processor.id)) {
    return null
  }

  return {
    key: `${feature}:${processor.id}`,
    feature,
    processor,
    capability
  }
}

export function sortEntriesByFeatureOrder(entries: FileProcessingMenuEntry[]): FileProcessingMenuEntry[] {
  return [...entries].sort((a, b) => {
    const order = FILE_PROCESSING_FEATURE_SECTIONS.find((section) => section.feature === a.feature)?.processors ?? []
    const aIndex = order.indexOf(a.processor.id)
    const bIndex = order.indexOf(b.processor.id)

    if (aIndex === -1 && bIndex === -1) {
      return a.processor.id.localeCompare(b.processor.id)
    }

    if (aIndex === -1) {
      return 1
    }

    if (bIndex === -1) {
      return -1
    }

    return aIndex - bIndex
  })
}

export function getFeatureSections(
  processors: readonly FileProcessorMerged[],
  availableProcessorIds: ReadonlySet<string>
): FileProcessingFeatureSection[] {
  return FILE_PROCESSING_FEATURE_SECTIONS.map(({ feature }) => {
    const entries = processors
      .map((processor) => createMenuEntry(processor, feature, availableProcessorIds))
      .filter((entry): entry is FileProcessingMenuEntry => Boolean(entry))

    return {
      feature,
      entries: sortEntriesByFeatureOrder(entries)
    }
  }).filter((section) => section.entries.length > 0)
}

export function getProcessorNameKey(processorId: FileProcessorId): string {
  return PROCESSOR_DISPLAY_META[processorId].nameKey
}

export function getProcessorDescriptionKey(processorId: FileProcessorId): string {
  return PROCESSOR_DISPLAY_META[processorId].descriptionKey
}

export function getProcessorApiKeyWebsite(processorId: FileProcessorId): string | null {
  return PROCESSOR_DISPLAY_META[processorId].apiKeyWebsite
}

export function supportsApiSettings(processor: FileProcessorMerged): boolean {
  return processor.type === 'api'
}

export function supportsLanguageConfig(processorId: FileProcessorId): processorId is 'system' | 'tesseract' {
  return processorId === 'system' || processorId === 'tesseract'
}

export function canConfigureLanguageOptions(processorId: Extract<FileProcessorId, 'system' | 'tesseract'>): boolean {
  return processorId === 'tesseract' || isWin
}

export function shouldShowLanguageOptions(processorId: FileProcessorId): processorId is 'system' | 'tesseract' {
  return supportsLanguageConfig(processorId) && canConfigureLanguageOptions(processorId)
}

export function getTesseractLanguageCode(languageCode: string): string | undefined {
  return TESSERACT_LANG_MAP[languageCode]
}
