import { deepseekFiles } from './deepseek'
import { openDeepseekArchive } from './deepseekArchive'
import { deepseekContent } from './deepseekContent'
import type { ConversationImporter, ImportArchive, ImportMessageNode } from './types'

export class DeepSeekImporter implements ConversationImporter {
  readonly id = 'deepseek'
  readonly name = 'DeepSeek'
  readonly emoji = '🐋'

  async open(file: string): Promise<ImportArchive> {
    const archive = await openDeepseekArchive(file)
    return {
      digest: archive.digest,
      sourceIds: archive.index.map((item) => item.id),
      preview: async () => {
        let messages = 0
        const missingFiles: string[] = []
        for (const item of archive.index) {
          const source = await archive.load(item.id)
          messages += source.messages.length
          if (messages > 100_000) throw new Error('DeepSeek archive has too many messages')
          for (const attachment of deepseekFiles(source))
            if (attachment.export_path === null) missingFiles.push(attachment.file_name)
        }
        return { messages, missingFiles }
      },
      load: async (sourceId, context) => {
        const source = await archive.load(sourceId)
        const messages: ImportMessageNode[] = []
        for (const message of source.messages) {
          context.signal.throwIfAborted()
          const content = await deepseekContent(message, archive.read, context.files, context.saveFile)
          messages.push({
            sourceId: String(message.id),
            parentSourceId: message.parent_id === null ? null : String(message.parent_id),
            role: message.role === 'USER' ? 'user' : 'assistant',
            status: message.status === 'FINISHED' ? 'success' : 'error',
            data: {
              parts: content.parts,
              importedHistory: {
                source: 'deepseek',
                messageId: String(message.id),
                insertedAt: message.inserted_at,
                status: message.status,
                missingFiles: message.fragments.flatMap((part) =>
                  part.type === 'FILE'
                    ? part.files
                        .filter((attachment) => attachment.export_path === null)
                        .map((attachment) => ({
                          id: attachment.id,
                          name: attachment.file_name,
                          size: attachment.file_size,
                          isImage: attachment.is_image
                        }))
                    : []
                )
              }
            },
            model:
              message.role === 'ASSISTANT' ? { id: 'imported-history', name: this.name, provider: this.id } : undefined,
            createdAt: Date.parse(message.inserted_at)
          })
        }
        return {
          name: source.title || this.name,
          createdAt: Date.parse(source.inserted_at),
          updatedAt: Date.parse(source.updated_at),
          activeSourceId: source.current_message_id === null ? null : String(source.current_message_id),
          messages
        }
      },
      close: archive.close
    }
  }
}
