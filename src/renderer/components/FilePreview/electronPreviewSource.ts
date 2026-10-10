import { assertPreviewRange, PreviewError, type PreviewSource } from '@cherrystudio/file-preview/core'
import { ipcApi } from '@renderer/ipc'
import type { AbsoluteFilePath, FileVersion } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import type { FilePreviewFileMetadata } from './types'

const RANGE_CHUNK_SIZE_BYTES = 1024 * 1024

export function createElectronPreviewSource(
  filePath: AbsoluteFilePath,
  name: string,
  metadata: FilePreviewFileMetadata
): PreviewSource {
  const size = metadata.size
  // file.read reports a floored mtime; the metadata type does not promise one.
  const mtime = Math.floor(metadata.modifiedAt)
  const handle = createFilePathHandle(filePath)
  return {
    id: filePath,
    name,
    async open(signal) {
      signal?.throwIfAborted()
      let closed = false
      const accept = (content: Uint8Array, version: FileVersion, expectedLength: number, offset: number) => {
        if (closed) throw new PreviewError('closed', 'Preview source is closed')
        if (version.size !== size || version.mtime !== mtime) {
          throw new PreviewError('source_changed', 'File changed since preview metadata was read')
        }
        if (content.byteLength !== expectedLength) {
          throw new PreviewError('short_read', `Short preview read at ${offset}`)
        }
        return content
      }
      return {
        size,
        revision: `${size}:${mtime}`,
        async readRange(offset, length, readSignal) {
          if (closed) throw new PreviewError('closed', 'Preview source is closed')
          assertPreviewRange(size, offset, length)
          readSignal?.throwIfAborted()
          if (length === 0) return new Uint8Array()
          if (offset === 0 && length === size) {
            const { content, version } = await ipcApi.request('file.read', {
              handle,
              options: { mode: 'full', encoding: 'binary' }
            })
            readSignal?.throwIfAborted()
            return accept(content, version, length, offset)
          }
          const bytes = new Uint8Array(length)
          for (let cursor = 0; cursor < length; cursor += RANGE_CHUNK_SIZE_BYTES) {
            readSignal?.throwIfAborted()
            const count = Math.min(RANGE_CHUNK_SIZE_BYTES, length - cursor)
            const { content, version } = await ipcApi.request('file.read', {
              handle,
              options: { mode: 'range', offset: offset + cursor, length: count }
            })
            readSignal?.throwIfAborted()
            bytes.set(accept(content, version, count, offset + cursor), cursor)
          }
          return bytes
        },
        async close() {
          closed = true
        }
      }
    }
  }
}
