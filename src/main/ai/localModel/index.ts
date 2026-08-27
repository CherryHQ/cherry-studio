/**
 * Local models: the catalog of what can be installed, the registry of what is, and the
 * acquisition layer that moves bytes from a mirror onto disk. Inference over those models
 * still lives in `@main/ai/inference` and joins this module in a later step.
 *
 * Public surface only — everything else under this directory is internal.
 */
export {
  ALL_MODEL_BUNDLE_IDS,
  bundleDtype,
  bundleFile,
  bundleForCapability,
  getModelBundle
} from './registry/catalog'
export { gcSharedArtifacts, installerFor, isLocalModelReady } from './registry/installers'
export { localModelRegistry } from './registry/LocalModelRegistry'
export type { ModelBundle } from './registry/types'
