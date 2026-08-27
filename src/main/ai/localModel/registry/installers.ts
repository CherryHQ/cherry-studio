import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { loggerService } from '@logger'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { LocalModelBundleId, LocalModelCapability } from '@shared/data/presets/localModel'

import { BundleInstallManager } from './BundleInstallManager'
import { ALL_MODEL_BUNDLE_IDS, getModelBundle } from './catalog'
import { localModelRegistry } from './LocalModelRegistry'
import type { SharedArtifactId } from './types'

const logger = loggerService.withContext('localModelInstallers')

/**
 * The installed-model lifecycle, one manager per bundle. Each pairs a catalog entry with
 * the few decisions only its capability can make; everything else is shared.
 */
export const LOCAL_MODEL_INSTALLERS: Record<LocalModelBundleId, BundleInstallManager> = {
  'qwen3-embedding-0.6b': new BundleInstallManager(getModelBundle('qwen3-embedding-0.6b'), {
    // Knowledge bases embed with a specific model and cannot be searched without it, so
    // removal is refused while any base still references this one.
    acquireRemovalGuard: () => knowledgeBaseService.acquireEmbeddingModelRemovalGuard(LOCAL_EMBEDDING_UNIQUE_MODEL_ID),
    terminateRuntimeThen: (after) => application.get('EmbeddingInferenceService').terminateThen(after)
  }),
  'pp-ocrv6-medium': new BundleInstallManager(getModelBundle('pp-ocrv6-medium'), {
    terminateRuntimeThen: (after) => application.get('OcrInferenceService').terminateThen(after),
    afterRemove: demoteLocalPaddleocrDefault
  })
}

export function installerFor(id: LocalModelBundleId): BundleInstallManager {
  return LOCAL_MODEL_INSTALLERS[id]
}

/**
 * Whether the model a capability needs is usable right now. Features gate on this rather
 * than on their own probe so the settings card and the execution path can never disagree.
 */
export function isLocalModelReady(capability: LocalModelCapability): boolean {
  return ALL_MODEL_BUNDLE_IDS.some(
    (id) => getModelBundle(id).capability === capability && installerFor(id).getStatus() === 'ready'
  )
}

/**
 * Drop every shared artifact no installed or in-progress bundle still requires.
 *
 * Called after a removal *and* after an interrupted download — the same rule either way.
 * They used to disagree (removal ignored downloads in flight), which could delete the
 * runtime another model was at that moment waiting on.
 *
 * Best-effort: a locked file must not turn a cancellation into a failure or mask the
 * download error that triggered the cleanup.
 */
export async function gcSharedArtifacts(): Promise<void> {
  const known = new Set<SharedArtifactId>()
  const stillNeeded = new Set<SharedArtifactId>()
  for (const id of ALL_MODEL_BUNDLE_IDS) {
    const status = installerFor(id).getStatus()
    for (const artifact of getModelBundle(id).requires) {
      known.add(artifact)
      // 'downloading' counts as needed: that download may be awaiting this very artifact.
      if (status === 'ready' || status === 'downloading') stillNeeded.add(artifact)
    }
  }

  for (const artifact of known) {
    if (stillNeeded.has(artifact)) continue
    try {
      await localModelRegistry.removeArtifact(artifact)
    } catch (error) {
      logger.warn('failed to remove an unused shared runtime', { artifact, error: String(error) })
    }
  }
}

/**
 * Reset an explicitly selected local OCR default before its model is deleted. Leaving
 * `default_image_to_text` pinned to local-paddleocr makes resolveProcessorConfigByFeature
 * throw for every OCR consumer (translation / chat attachments / read_file), with no
 * self-heal; clearing it lets the platform default take over again.
 */
async function demoteLocalPaddleocrDefault(): Promise<void> {
  try {
    const preference = application.get('PreferenceService')
    if (preference.get('feature.file_processing.default_image_to_text') === 'local-paddleocr') {
      await preference.set('feature.file_processing.default_image_to_text', null)
    }
  } catch (error) {
    logger.warn('failed to reset default image-to-text processor on OCR model removal', { error: String(error) })
  }
}
