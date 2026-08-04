import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import type { SourceTabDefinition } from './types'

export const DEFAULT_SOURCE_TYPE: KnowledgeItemType = 'file'

// An interactive add maps each picked file (or selected note) to one source item, and the OS
// picker imposes no cap. Guard the batch size here so an oversized selection surfaces a friendly
// hint instead of the generic IPC "Invalid input" rejection. Kept stricter than the schema's
// KNOWLEDGE_RUNTIME_ITEMS_MAX backstop, which other callers (e.g. save-to-knowledge) still use.
export const KNOWLEDGE_ADD_ITEMS_MAX = 20

// Curated, user-facing format list for the upload hint. Deliberately not derived from
// `knowledgeSupportedFileExts`: that list carries the internal `.draftsexport` identifier and
// redundant synonyms (markdown/md/mdx, html/htm) that read as noise in the UI.
export const KNOWLEDGE_SUPPORTED_FILE_TYPES = 'PDF, DOCX, DOC, PPTX, XLSX, XLS, MD, TXT, CSV, HTML, EPUB'

export const KNOWLEDGE_DATA_SOURCE_TYPES: ReadonlyArray<SourceTabDefinition> = [
  { value: 'file', labelKey: 'knowledge.data_source.add_dialog.sources.file' },
  { value: 'note', labelKey: 'knowledge.data_source.add_dialog.sources.note' },
  { value: 'directory', labelKey: 'knowledge.data_source.add_dialog.sources.directory' },
  { value: 'url', labelKey: 'knowledge.data_source.add_dialog.sources.url' }
]
