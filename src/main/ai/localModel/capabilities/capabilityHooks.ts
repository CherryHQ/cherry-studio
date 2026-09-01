import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { loggerService } from '@logger'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { LocalModelCapability } from '@shared/data/presets/localModel'

import type { CapabilityHooks } from '../installation/BundleInstaller'

const logger = loggerService.withContext('localModelCapabilityHooks')

const CAPABILITY_HOOKS: Record<LocalModelCapability, CapabilityHooks> = {
  embedding: {
    acquireRemovalGuard: () => knowledgeBaseService.acquireEmbeddingModelRemovalGuard(LOCAL_EMBEDDING_UNIQUE_MODEL_ID),
    terminateRuntimeThen: (after) => application.get('EmbeddingInferenceService').terminateThen(after)
  },
  ocr: {
    terminateRuntimeThen: (after) => application.get('OcrInferenceService').terminateThen(after),
    afterRemove: demoteOcrDefaults
  }
}

export function capabilityHooksFor(capability: LocalModelCapability): CapabilityHooks {
  return CAPABILITY_HOOKS[capability]
}

async function demoteOcrDefaults(): Promise<void> {
  try {
    const preference = application.get('PreferenceService')
    const updates: Promise<void>[] = []
    if (preference.get('feature.file_processing.default_image_to_text') === 'local-paddleocr') {
      updates.push(preference.set('feature.file_processing.default_image_to_text', null))
    }
    if (preference.get('feature.file_processing.default_document_to_markdown') === 'local-document') {
      updates.push(preference.set('feature.file_processing.default_document_to_markdown', null))
    }
    await Promise.all(updates)
  } catch (error) {
    logger.warn('failed to reset default processors on OCR model removal', { error: String(error) })
  }
}
