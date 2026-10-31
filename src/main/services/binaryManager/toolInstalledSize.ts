import fsp from 'node:fs/promises'
import path from 'node:path'

interface MeasurementOptions {
  isCurrent?: () => boolean
  maxNodes?: number
  budgetMs?: number
}

type Measurement = { sizeBytes: number; reason?: never } | { sizeBytes: null; reason: string }

/** Measure one proven installation root; options are private to main and its tests. */
export async function measureToolInstalledSize(
  root: string,
  kind: 'file' | 'directory',
  { isCurrent = () => true, maxNodes = 100_000, budgetMs = 3_000 }: MeasurementOptions = {}
): Promise<Measurement> {
  const startedAt = Date.now()
  let nodes = 1
  let sizeBytes = 0
  const check = () => {
    if (!isCurrent()) throw new Error('stale')
    if (nodes > maxNodes) throw new Error('node_budget')
    if (Date.now() - startedAt >= budgetMs) throw new Error('time_budget')
  }
  const add = (size: number) => {
    sizeBytes += size
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('invalid_size')
  }

  try {
    check()
    const stat = await fsp.lstat(root)
    check()
    if (kind === 'file') {
      if (!stat.isFile()) throw new Error('invalid_root')
      add(stat.size)
      return { sizeBytes }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid_root')
    const directories = [root]
    while (directories.length) {
      check()
      const directory = directories.pop()!
      const handle = await fsp.opendir(directory)
      try {
        check()
        while (true) {
          check()
          const entry = await handle.read()
          check()
          if (!entry) break
          nodes++
          check()
          const child = path.join(directory, entry.name)
          const childStat = await fsp.lstat(child)
          check()
          if (childStat.isSymbolicLink()) continue
          if (childStat.isDirectory()) directories.push(child)
          else if (childStat.isFile()) add(childStat.size)
        }
      } finally {
        await handle.close()
      }
      check()
    }
    return { sizeBytes }
  } catch (error) {
    const reason = error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.message) : 'io_failed'
    return { sizeBytes: null, reason }
  }
}
