import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

import { AgentSessionForkError } from './checkpoint'

export async function readNativeForkHistory<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new AgentSessionForkError('history_missing')
    if (error instanceof SyntaxError) throw new AgentSessionForkError('history_corrupt')
    throw error
  }
}

/** Read only a committed prefix. Later appends are allowed; truncation/replacement is not. */
export async function readForkPrefix(file: string, bytes?: number): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    const length = bytes ?? before.size
    if (!before.isFile() || length > before.size || length > 512 * 1024 * 1024) {
      throw new AgentSessionForkError('history_corrupt')
    }
    const result = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = await handle.read(result, offset, length - offset, offset)
      if (!read.bytesRead) throw new AgentSessionForkError('history_changed')
      offset += read.bytesRead
    }
    const after = await lstat(file)
    if (after.isSymbolicLink() || before.ino !== after.ino || before.dev !== after.dev || after.size < length) {
      throw new AgentSessionForkError('history_changed')
    }
    return bytes === undefined ? result.subarray(0, result.lastIndexOf(10) + 1) : result
  } finally {
    await handle.close()
  }
}
