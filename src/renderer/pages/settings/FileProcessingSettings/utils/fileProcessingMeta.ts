import type { CompoundIcon } from '@cherrystudio/ui'
import { Application, Doc2x, Intel, Mineru, Mistral, Paddleocr, TesseractJs } from '@cherrystudio/ui/icons'
import { isWin } from '@renderer/config/constant'
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
    nameKey: 'settings.tool.file_processing.processors.system.name',
    descriptionKey: 'settings.tool.file_processing.processors.system.description',
    logo: Application,
    apiKeyWebsite: null
  },
  tesseract: {
    nameKey: 'settings.tool.file_processing.processors.tesseract.name',
    descriptionKey: 'settings.tool.file_processing.processors.tesseract.description',
    logo: TesseractJs,
    apiKeyWebsite: null
  },
  paddleocr: {
    nameKey: 'settings.tool.file_processing.processors.paddleocr.name',
    descriptionKey: 'settings.tool.file_processing.processors.paddleocr.description',
    logo: Paddleocr,
    apiKeyWebsite: 'https://aistudio.baidu.com/paddleocr/'
  },
  ovocr: {
    nameKey: 'settings.tool.file_processing.processors.ovocr.name',
    descriptionKey: 'settings.tool.file_processing.processors.ovocr.description',
    logo: Intel,
    apiKeyWebsite: null
  },
  mineru: {
    nameKey: 'settings.tool.file_processing.processors.mineru.name',
    descriptionKey: 'settings.tool.file_processing.processors.mineru.description',
    logo: Mineru,
    apiKeyWebsite: 'https://mineru.net/apiManage'
  },
  doc2x: {
    nameKey: 'settings.tool.file_processing.processors.doc2x.name',
    descriptionKey: 'settings.tool.file_processing.processors.doc2x.description',
    logo: Doc2x,
    apiKeyWebsite: 'https://open.noedgeai.com/apiKeys'
  },
  mistral: {
    nameKey: 'settings.tool.file_processing.processors.mistral.name',
    descriptionKey: 'settings.tool.file_processing.processors.mistral.description',
    logo: Mistral,
    apiKeyWebsite: 'https://mistral.ai/api-keys'
  },
  'open-mineru': {
    nameKey: 'settings.tool.file_processing.processors.open_mineru.name',
    descriptionKey: 'settings.tool.file_processing.processors.open_mineru.description',
    logo: Mineru,
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

export function flattenFeatureSections(featureSections: FileProcessingFeatureSection[]): FileProcessingMenuEntry[] {
  return featureSections.flatMap((section) => section.entries)
}

export function getFileProcessingFeatureTitleKey(feature: FileProcessorFeature): string {
  return `settings.tool.file_processing.features.${feature}.title`
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
