import { knowledgeFileDropzoneAccept, knowledgeSupportedFileExts } from '@shared/config/constant'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import type { SourceTabDefinition } from './types'

export const DEFAULT_SOURCE_TYPE: KnowledgeItemType = 'file'

export const KNOWLEDGE_SUPPORTED_FILE_TYPES = knowledgeSupportedFileExts
  .map((ext) => ext.slice(1).toUpperCase())
  .join(', ')

export const KNOWLEDGE_FILE_DROPZONE_ACCEPT = knowledgeFileDropzoneAccept

export const KNOWLEDGE_DATA_SOURCE_TYPES: ReadonlyArray<SourceTabDefinition> = [
  { value: 'file', labelKey: 'knowledge.data_source.add_dialog.sources.file' },
  { value: 'note', labelKey: 'knowledge.data_source.add_dialog.sources.note' },
  { value: 'directory', labelKey: 'knowledge.data_source.add_dialog.sources.directory' },
  { value: 'url', labelKey: 'knowledge.data_source.add_dialog.sources.url' }
]
