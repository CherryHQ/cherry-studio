import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import type { SourceTabDefinition } from './types'

export const DEFAULT_SOURCE_TYPE: KnowledgeItemType = 'file'

export const KNOWLEDGE_DATA_SOURCE_TYPES: ReadonlyArray<SourceTabDefinition> = [
  { value: 'file', labelKey: 'knowledge_v2.data_source.add_dialog.sources.file' },
  { value: 'note', labelKey: 'knowledge_v2.data_source.add_dialog.sources.note' },
  { value: 'directory', labelKey: 'knowledge_v2.data_source.add_dialog.sources.directory' },
  { value: 'url', labelKey: 'knowledge_v2.data_source.add_dialog.sources.url' },
  { value: 'sitemap', labelKey: 'knowledge_v2.data_source.add_dialog.sources.sitemap' }
]
