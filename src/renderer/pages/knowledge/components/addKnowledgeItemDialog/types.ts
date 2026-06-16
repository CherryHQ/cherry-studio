import type { Dropzone } from '@cherrystudio/ui'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'
import type { ComponentProps } from 'react'

export type DropzoneOnDrop = NonNullable<ComponentProps<typeof Dropzone>['onDrop']>

export interface DirectoryItem {
  name: string
  path: string
}

export interface NoteItem {
  /** Note title (no extension); becomes the knowledge item's `source`. */
  name: string
  /** Absolute note path — the dedupe key and where the content is read from. */
  externalPath: string
}

export interface SourceTabDefinition {
  labelKey: string
  value: KnowledgeItemType
}
