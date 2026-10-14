import type { UIMessageChunk } from 'ai'

import { application } from '@application'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import { Base64StringSchema } from '@shared/types/file'

export type GeneratedFileChunk = Extract<UIMessageChunk, { type: 'file' }>
export type StoreGeneratedFile = (chunk: GeneratedFileChunk) => Promise<GeneratedFileChunk>

export const storeGeneratedFile: StoreGeneratedFile = async (chunk) => {
  const manager = application.get('FileManager')
  const entry = await manager.createInternalEntry({
    source: 'base64',
    data: Base64StringSchema.parse(chunk.url),
    name: 'Generated file',
    cleanupPolicy: 'delete_when_unreferenced'
  })
  return withCherryMeta({ ...chunk, url: manager.getUrl(entry.id) }, { fileEntryId: entry.id })
}

/** Resolve attachments before broadcast and accumulation so both consumers share the same file. */
export function withGeneratedFiles(
  stream: ReadableStream<UIMessageChunk>,
  storeFile: StoreGeneratedFile = storeGeneratedFile
): ReadableStream<UIMessageChunk> {
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
        controller.enqueue(await storeFile(chunk))
      }
    })
  )
}
