// Runtime service API.
export { KnowledgeService } from './KnowledgeService'
export { KnowledgeVectorStoreService } from './pipeline/vectorstore/KnowledgeVectorStoreService'

// Knowledge-owned index and material primitives; store internals remain private.
export { type MaterialFieldSource, toMaterialRelativePath } from './items'
export {
  assertSafeKnowledgeRelativePath,
  CHERRY_META_DIR,
  collectKnowledgeReservedRelativePaths,
  needsProcessedArtifactReservation,
  reserveImportedFileRelativePath
} from './pathStorage'
export { DOCUMENT_SEPARATOR } from './pipeline/indexing/chunk'
export { buildNoteSnapshotFile } from './pipeline/sources/noteSnapshot'
export { buildUrlSnapshotFile } from './pipeline/sources/urlSnapshot'
export { createKnowledgeIndexStoreAtPath } from './pipeline/vectorstore/indexStore/createIndexStore'
export { hashEmbeddingText } from './pipeline/vectorstore/indexStore/hashing'
export type { RebuildMaterialEmbeddingInput, RebuildMaterialInput } from './pipeline/vectorstore/indexStore/model'
export type { KnowledgeBaseDiscoveryOptions, KnowledgeBaseDiscoveryPage, KnowledgeBaseDiscoveryScope } from './types'
