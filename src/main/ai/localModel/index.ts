/**
 * Local models: the catalog of what can be installed, the registry of what is, and the
 * acquisition layer that moves bytes from a mirror onto disk. Inference over those models
 * still lives in `@main/ai/inference` and joins this module in a later step.
 *
 * Public surface only — everything else under this directory is internal.
 */
export { dictTextFromInferenceYml } from './acquisition/derivations'
export type { ModelSourceId } from './acquisition/modelSource'
export {
  defaultModelSourceId,
  modelSourceOrder,
  resolveModelFileUrl
} from './acquisition/modelSource'
export type { CapabilityHooks } from './registry/BundleInstallManager'
export {
  ALL_MODEL_BUNDLE_IDS,
  bundleDtype,
  bundleFile,
  bundleForCapability,
  getModelBundle,
  getSharedArtifact,
  LOCAL_MODEL_BUNDLES,
  SHARED_ARTIFACTS
} from './registry/catalog'
export { localEmbeddingInstaller } from './registry/installers'
export { localModelRegistry } from './registry/LocalModelRegistry'
export type {
  BundleFile,
  InstallState,
  LocalModelCapability,
  ModelBundle,
  ModelBundleId,
  SharedArtifact,
  SharedArtifactId
} from './registry/types'
