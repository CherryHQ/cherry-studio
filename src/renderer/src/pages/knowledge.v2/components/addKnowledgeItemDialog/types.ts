import type { Dropzone } from '@cherrystudio/ui'
import type { KnowledgeDataSourceType } from '@renderer/pages/knowledge.v2/types'
import type { ComponentProps } from 'react'

export type DropzoneOnDrop = NonNullable<ComponentProps<typeof Dropzone>['onDrop']>

export interface DirectoryItem {
  name: string
  path: string
}

export interface SourceTabDefinition {
  labelKey: string
  value: KnowledgeDataSourceType
}
