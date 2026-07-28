// Runtime service API.
export { KnowledgeService } from './KnowledgeService'
export { KnowledgeVectorStoreService } from './vectorstore/KnowledgeVectorStoreService'

// Index & material rebuild surface — the knowledge-owned primitives the indexing runtime and the
// v1→v2 migrators (data/migration/v2) build a base's materials + vector index from. The index
// engine internals (driver / schema / meta / vector index) stay private behind
// createKnowledgeIndexStoreAtPath; the snapshot derivation stays private behind build*SnapshotFile.
export { DOCUMENT_SEPARATOR } from './utils/indexing/chunk'
export { type MaterialFieldSource, toMaterialRelativePath } from './utils/indexing/materialFields'
export { buildNoteSnapshotFile } from './utils/sources/noteSnapshot'
export { buildUrlSnapshotFile } from './utils/sources/urlSnapshot'
export {
  assertSafeKnowledgeRelativePath,
  collectKnowledgeReservedRelativePaths,
  needsProcessedArtifactReservation,
  reserveImportedFileRelativePath
} from './utils/storage/pathStorage'
export { createKnowledgeIndexStoreAtPath } from './vectorstore/indexStore/createIndexStore'
export { hashEmbeddingText } from './vectorstore/indexStore/hashing'
export type { RebuildMaterialInput } from './vectorstore/indexStore/model'
