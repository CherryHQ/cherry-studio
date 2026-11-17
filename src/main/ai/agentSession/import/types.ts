import type { ContentMessageRole, MessageData, ModelSnapshot } from '@shared/data/types/message'

export interface ImportMessageNode {
  sourceId: string
  parentSourceId: string | null
  role: ContentMessageRole
  status: 'success' | 'error'
  data: MessageData
  model?: ModelSnapshot
  createdAt: number
}

export interface ImportConversation {
  name: string
  createdAt: number
  updatedAt: number
  activeSourceId: string | null
  /** Parents precede children; source IDs and the selected head are validated by the importer. */
  messages: ImportMessageNode[]
}

export interface ImportContext {
  signal: AbortSignal
  files: Record<string, string>
  saveFile(sourceId: string, entryId: string): void
}

export interface ImportArchive {
  sourceIds: readonly string[]
  /** Validate every conversation without creating managed files or publishing sessions. */
  preview(): Promise<{ messages: number; missingFiles: string[] }>
  load(sourceId: string, context: ImportContext): Promise<ImportConversation>
  close(): Promise<void>
}

export interface ConversationImporter {
  readonly id: string
  readonly name: string
  readonly emoji: string
  digest(file: string): Promise<string>
  open(file: string): Promise<ImportArchive>
}
