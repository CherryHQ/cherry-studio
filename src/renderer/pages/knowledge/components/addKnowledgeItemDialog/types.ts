import type { KnowledgeItemType } from '@shared/data/types/knowledge'

export interface NoteItem {
  /** Note title (no extension); becomes the knowledge item's `source`. */
  name: string
  /** Absolute note path — the dedupe key and where the content is read from. */
  externalPath: string
}

/**
 * `import` picks existing Notes files; `create` drafts a knowledge note inside the dialog
 * (the draft is indexed straight into the base and never written to the Notes module).
 */
export type NoteSourceMode = 'import' | 'create'

export interface NoteDraft {
  /** Becomes the knowledge item's `source`, which the schema requires to be non-empty. */
  title: string
  /** Markdown body indexed as the note's content. */
  content: string
}

export interface SourceTabDefinition {
  labelKey: string
  value: KnowledgeItemType
}
