import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'

import { BundleInstallManager } from './BundleInstallManager'
import { bundleForCapability } from './catalog'

/**
 * The installed-model lifecycle, one manager per bundle. Each pairs a catalog entry with
 * the few decisions only its capability can make; everything else is shared.
 */

export const localEmbeddingInstaller = new BundleInstallManager(bundleForCapability('embedding'), {
  // Knowledge bases embed with a specific model and cannot be searched without it, so
  // removal is refused while any base still references this one.
  acquireRemovalGuard: () => knowledgeBaseService.acquireEmbeddingModelRemovalGuard(LOCAL_EMBEDDING_UNIQUE_MODEL_ID),
  terminateRuntimeThen: (after) => application.get('EmbeddingInferenceService').terminateThen(after)
})
