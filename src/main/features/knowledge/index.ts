// Runtime service API.
export { isKnowledgeCaptureExcluded, knowledgeBaseIdFromManagedPath } from './capturePolicy'
export { KnowledgeService } from './KnowledgeService'
export {
  type KnowledgeIndexSnapshotFailure,
  type KnowledgeIndexSnapshotResult,
  KnowledgeVectorStoreService
} from './pipeline/vectorstore/KnowledgeVectorStoreService'
export { capturePortableKnowledgeIndex } from './portableIndexSnapshot'
export {
  collectKnowledgeIndexRequirements,
  collectKnowledgeRequiredMaterial,
  type KnowledgeIndexedMaterialRow,
  type KnowledgeIndexRequirement,
  type KnowledgeMaterialRow,
  type KnowledgeRequiredMaterialByBase
} from './portableProfilePolicy'
export {
  createKnowledgeRestoreOwnerSummary,
  knowledgeBaseIdsRequiringRebuild,
  type KnowledgeRestoreOwnerProgress,
  type KnowledgeRestoreOwnerSummary,
  type KnowledgeRestoreProgress,
  type KnowledgeRestoreProgressRead,
  type KnowledgeRestoreSummary,
  type KnowledgeRestoreSummaryRead,
  readKnowledgeRestoreProgress,
  readKnowledgeRestoreSummary,
  withKnowledgeRestoreProgress
} from './restorePolicy'

// Index & material rebuild surface — the knowledge-owned primitives the indexing runtime and the
// v1→v2 migrators (data/migration/v2) build a base's materials + vector index from. The index
// engine internals (driver / schema / meta / vector index) stay private behind
// createKnowledgeIndexStoreAtPath; the snapshot derivation stays private behind build*SnapshotFile.
export { type MaterialFieldSource, toMaterialRelativePath } from './items'
export {
  assertSafeKnowledgeRelativePath,
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
