// Runtime service API.
export { KnowledgeService } from './KnowledgeService'
export { KnowledgeVectorStoreService } from './pipeline/vectorstore/KnowledgeVectorStoreService'

// Index & material rebuild surface — the knowledge-owned primitives the indexing runtime and the
// v1→v2 migrators (data/migration/v2) build a base's materials + vector index from. The index
// engine internals (driver / schema / meta / vector index) stay private behind
// createKnowledgeIndexStoreAtPath; the snapshot derivation stays private behind build*SnapshotFile.
export { DOCUMENT_SEPARATOR } from './pipeline/indexing/chunk'
export { type MaterialFieldSource, toMaterialRelativePath } from './items'
export { buildNoteSnapshotFile } from './pipeline/sources/noteSnapshot'
export { buildUrlSnapshotFile } from './pipeline/sources/urlSnapshot'
export {
  assertSafeKnowledgeRelativePath,
  collectKnowledgeReservedRelativePaths,
  needsProcessedArtifactReservation,
  reserveImportedFileRelativePath
} from './pathStorage'
export { createKnowledgeIndexStoreAtPath } from './pipeline/vectorstore/indexStore/createIndexStore'
export { hashEmbeddingText } from './pipeline/vectorstore/indexStore/hashing'
export type { RebuildMaterialInput } from './pipeline/vectorstore/indexStore/model'
