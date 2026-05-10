import type { Dropzone } from '@cherrystudio/ui'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'
import type { ComponentProps } from 'react'

export type DropzoneOnDrop = NonNullable<ComponentProps<typeof Dropzone>['onDrop']>

export interface DirectoryItem {
  name: string
  path: string
}

export interface SourceTabDefinition {
  labelKey: string
  value: KnowledgeItemType
}
