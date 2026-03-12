export type TabKey = 'files' | 'notes' | 'directories' | 'urls' | 'sitemaps'

interface KnowledgeTabDefinition {
  key: TabKey
  titleKey: string
  addButtonLabelKey: string
}

export const KNOWLEDGE_TAB_DEFINITIONS: KnowledgeTabDefinition[] = [
  {
    key: 'files',
    titleKey: 'files.title',
    addButtonLabelKey: 'knowledge.add_file'
  },
  {
    key: 'notes',
    titleKey: 'knowledge.notes',
    addButtonLabelKey: 'knowledge.add_note'
  },
  {
    key: 'directories',
    titleKey: 'knowledge.directories',
    addButtonLabelKey: 'knowledge.add_directory'
  },
  {
    key: 'urls',
    titleKey: 'knowledge.urls',
    addButtonLabelKey: 'knowledge.add_url'
  },
  {
    key: 'sitemaps',
    titleKey: 'knowledge.sitemaps',
    addButtonLabelKey: 'knowledge.add_sitemap'
  }
]
