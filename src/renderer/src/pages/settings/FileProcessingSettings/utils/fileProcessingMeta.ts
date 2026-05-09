import type { CompoundIcon } from '@cherrystudio/ui'
import { Application, Doc2x, Intel, Mineru, Mistral, Paddleocr, TesseractJs } from '@cherrystudio/ui/icons'
import { isMac, isWin } from '@renderer/config/constant'
import { TESSERACT_LANG_MAP } from '@renderer/config/ocr'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/file-processing'

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
    processors: ['system', 'tesseract', 'paddleocr', 'mistral', 'ovocr']
  },
  {
    feature: 'document_to_markdown',
    processors: ['mistral', 'mineru', 'doc2x', 'open-mineru', 'paddleocr']
  }
] as const

type ProcessorDisplayMeta = {
  nameKey: string
  descriptionKey: string
  logo: CompoundIcon
  apiKeyWebsite: string | null
}

const PROCESSOR_DISPLAY_META: Record<FileProcessorId, ProcessorDisplayMeta> = {
  system: {
    nameKey: 'settings.tool.file_processing.processors.system',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.system',
    logo: Application,
    apiKeyWebsite: null
  },
  tesseract: {
    nameKey: 'settings.tool.file_processing.processors.tesseract',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.tesseract',
    logo: TesseractJs,
    apiKeyWebsite: null
  },
  paddleocr: {
    nameKey: 'settings.tool.file_processing.processors.paddleocr',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.paddleocr',
    logo: Paddleocr,
    apiKeyWebsite: 'https://aistudio.baidu.com/paddleocr/'
  },
  ovocr: {
    nameKey: 'settings.tool.file_processing.processors.ovocr',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.ovocr',
    logo: Intel,
    apiKeyWebsite: null
  },
  mineru: {
    nameKey: 'settings.tool.file_processing.processors.mineru',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.mineru',
    logo: Mineru,
    apiKeyWebsite: 'https://mineru.net/apiManage'
  },
  doc2x: {
    nameKey: 'settings.tool.file_processing.processors.doc2x',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.doc2x',
    logo: Doc2x,
    apiKeyWebsite: 'https://open.noedgeai.com/apiKeys'
  },
  mistral: {
    nameKey: 'settings.tool.file_processing.processors.mistral',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.mistral',
    logo: Mistral,
    apiKeyWebsite: 'https://mistral.ai/api-keys'
  },
  'open-mineru': {
    nameKey: 'settings.tool.file_processing.processors.open_mineru',
    descriptionKey: 'settings.tool.file_processing.provider_descriptions.mineru',
    logo: Mineru,
    apiKeyWebsite: 'https://github.com/opendatalab/MinerU/'
  }
} as const satisfies Record<FileProcessorId, ProcessorDisplayMeta>

export function createMenuEntry(
  processor: FileProcessorMerged,
  feature: FileProcessorFeature
): FileProcessingMenuEntry | null {
  const capability = processor.capabilities.find((item) => item.feature === feature)

  if (!capability) {
    return null
  }

  if (processor.id === 'ovocr') {
    return null
  }

  if (processor.id === 'system' && !isMac && !isWin) {
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

export function getFeatureSections(processors: readonly FileProcessorMerged[]): FileProcessingFeatureSection[] {
  return FILE_PROCESSING_FEATURE_SECTIONS.map(({ feature }) => {
    const entries = processors
      .map((processor) => createMenuEntry(processor, feature))
      .filter((entry): entry is FileProcessingMenuEntry => Boolean(entry))

    return {
      feature,
      entries: sortEntriesByFeatureOrder(entries)
    }
  }).filter((section) => section.entries.length > 0)
}

export function flattenFeatureSections(featureSections: FileProcessingFeatureSection[]): FileProcessingMenuEntry[] {
  return featureSections.flatMap((section) => section.entries)
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

export function getProcessorLogo(processorId: FileProcessorId) {
  return PROCESSOR_DISPLAY_META[processorId].logo
}

export function supportsApiSettings(processor: FileProcessorMerged): boolean {
  return processor.type === 'api'
}

export function supportsLanguageOptions(processorId: FileProcessorId): processorId is 'system' | 'tesseract' {
  return processorId === 'system' || processorId === 'tesseract'
}

export function getTesseractLanguageCode(languageCode: string): string | undefined {
  return TESSERACT_LANG_MAP[languageCode]
}
