import path from 'node:path'

/**
 * Serializes read-check-replace sequences for the same agent memory file inside
 * the main process. The runtime memory tool and the IPC editor both take this
 * lock, so two writers carrying the same revision cannot both pass the check
 * before either rename.
 *
 * Case-insensitive platforms collapse `FACT.md` and `fact.md` onto one key;
 * over-serializing two distinct files is harmless.
 */
const locks = new Map<string, Promise<void>>()

function lockKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved
}

export async function withAgentMemoryFileLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const key = lockKey(filePath)
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => gate)
  locks.set(key, queued)

  await previous
  try {
    return await task()
  } finally {
    release()
    if (locks.get(key) === queued) locks.delete(key)
  }
}
