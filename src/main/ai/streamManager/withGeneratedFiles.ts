import type { UIMessageChunk } from 'ai'

import { application } from '@application'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import { Base64StringSchema } from '@shared/types/file'

/** Give generated attachments a durable handle before UI broadcast and message accumulation. */
export function withGeneratedFiles(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      async transform(chunk, controller) {
        if (
          chunk.type !== 'file' ||
          chunk.mediaType.startsWith('image/') ||
          readCherryMeta(chunk)?.fileEntryId ||
          !chunk.url.startsWith('data:')
        ) {
          controller.enqueue(chunk)
          return
        }

        const manager = application.get('FileManager')
        const entry = await manager.createInternalEntry({
          source: 'base64',
          data: Base64StringSchema.parse(chunk.url),
          name: 'Generated file',
          cleanupPolicy: 'delete_when_unreferenced'
        })
        controller.enqueue(withCherryMeta({ ...chunk, url: manager.getUrl(entry.id) }, { fileEntryId: entry.id }))
      }
    })
  )
}
