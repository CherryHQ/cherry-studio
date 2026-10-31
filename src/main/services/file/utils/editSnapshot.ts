import { open, stat } from 'node:fs/promises'

import { hashContent } from '@main/utils/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { FILE_EDIT_MAX_SIZE_BYTES, type FileEditRead } from '@shared/ipc/schemas/fileEdit'
import type { AbsoluteFilePath } from '@shared/types/file'

export async function readEditSnapshot(path: AbsoluteFilePath): Promise<FileEditRead> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await open(path, 'r')
    try {
      const before = await file.stat()
      if (!before.isFile() || before.size > FILE_EDIT_MAX_SIZE_BYTES) {
        throw new IpcError(fileErrorCodes.EDIT_UNSUPPORTED, 'File cannot be edited', { reason: 'size' })
      }
      const data = Buffer.alloc(before.size + 1)
      let length = 0
      while (length < data.length) {
        const chunk = await file.read(data, length, data.length - length, length)
        if (chunk.bytesRead === 0) break
        length += chunk.bytesRead
      }
      const after = await file.stat()
      const current = await stat(path)
      if (
        length === before.size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        after.ino === current.ino &&
        after.dev === current.dev &&
        after.size === current.size &&
        after.mtimeMs === current.mtimeMs &&
        after.ctimeMs === current.ctimeMs
      ) {
        const bytes = new Uint8Array(data.subarray(0, length))
        return {
          data: bytes,
          baseline: {
            version: { mtime: Math.floor(after.mtimeMs), size: length },
            contentHash: hashContent(bytes)
          }
        }
      }
    } finally {
      await file.close()
    }
  }
  throw new IpcError(fileErrorCodes.EDIT_READ_UNSTABLE, 'File changed during read')
}
