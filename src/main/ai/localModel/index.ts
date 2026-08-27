/**
 * Local models, end to end: the catalog of what can be installed, the registry of what is,
 * the acquisition layer that moves bytes from a mirror onto disk, and the worker runtime
 * that infers over them.
 *
 * Public surface only — everything else under this directory is internal.
 */
export { EmbeddingInferenceService } from './EmbeddingInferenceService'
export { LOCAL_EMBEDDING_MAX_INPUT_TOKENS, LOCAL_EMBEDDING_MAX_OVERLAP_TOKENS } from './localEmbeddingLimits'
export { OcrInferenceService } from './OcrInferenceService'
export {
  ALL_MODEL_BUNDLE_IDS,
  bundleDtype,
  bundleFile,
  bundleForCapability,
  getModelBundle
} from './registry/catalog'
export { gcSharedArtifacts, installerFor, isLocalModelReady } from './registry/installers'
export { localModelRegistry } from './registry/LocalModelRegistry'
export { ocrModelPaths } from './registry/ocrModelPaths'
export type { ModelBundle } from './registry/types'
export { isLocalInferenceHardwareAccelerationSupported } from './runtime/inferenceAcceleration'
export type { EmbeddingModelDir } from './runtime/protocol/embedding'
export type { OcrLine, OcrModelPaths } from './runtime/protocol/ocr'
