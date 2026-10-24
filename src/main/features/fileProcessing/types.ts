import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileEntryId, FileHandle } from '@shared/data/types/file'
import type { FileProcessingOutputTarget } from '@shared/data/types/fileProcessing'
export type {
  FileProcessingArtifact,
  FileProcessingJobOutput,
  ListAvailableFileProcessorsResult
} from '@shared/data/types/fileProcessing'

export interface StartFileProcessingJobInput {
  feature: FileProcessorFeature
  file: FileHandle
  output?: FileProcessingOutputTarget
  context?: {
    dataId?: string
  }
  processorId?: FileProcessorId
}

export interface DocumentSource {
  entryId: FileEntryId
  mtime: number
  size: number
}
export type DocumentPart = { kind: 'text'; start: number; end: number } | { kind: 'image'; occurrenceIndex: number }
export type ExtractionOmission =
  | 'duplicate'
  | 'too-small'
  | 'broken-relationship'
  | 'missing-image'
  | 'unsupported-image'
  | 'unreadable-image'
  | 'image-byte-limit'
  | 'source-changed'
export interface DocumentImageOccurrence {
  index: number
  target?: string
  sha256?: string
  width?: number
  height?: number
  duplicateOf?: number
  omission?: ExtractionOmission
}
export interface DocumentParts {
  source: DocumentSource
  text: string | null
  order: 'interleaved' | 'text-first'
  parts: DocumentPart[]
  images: DocumentImageOccurrence[]
  imageCount: { total: number | null; known: number }
  discoveryFailure?: 'unreadable-container' | 'unreadable-document-xml'
}
export type NormalizedDocumentImage =
  | { kind: 'image'; bytes: Uint8Array; mediaType: 'image/png'; width: number; height: number }
  | { kind: 'omitted'; reason: ExtractionOmission }
export type MaterializedDocumentImage = NormalizedDocumentImage & { occurrenceIndex: number }
