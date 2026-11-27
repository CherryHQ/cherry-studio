import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { assertAgentStoragePath } from './agentDataDirectory'

export async function relocationArtifactExists(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * True when two paths address the same filesystem entry (for example, case-only spelling
 * differences on a case-insensitive volume), without collapsing distinct hardlinks or symlinks.
 */
export async function isSameRelocationArtifact(source: string, target: string): Promise<boolean> {
  if (source === target) return true
  try {
    const [sourceStat, targetStat] = await Promise.all([
      lstat(source, { bigint: true }),
      lstat(target, { bigint: true })
    ])
    if (sourceStat.isSymbolicLink() || targetStat.isSymbolicLink()) return false
    if (sourceStat.ino === 0n || sourceStat.dev !== targetStat.dev || sourceStat.ino !== targetStat.ino) return false
    const [sourceReal, targetReal] = await Promise.all([realpath(source), realpath(target)])
    return sourceReal === targetReal
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Also validates every descendant before native readers or recursive copies see it. */
export async function digestRelocationArtifact(root: string, file: string): Promise<string> {
  await assertAgentStoragePath(root, file)
  const hash = createHash('sha256')
  async function visit(current: string) {
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`Linked runtime history: ${current}`)
    hash.update(JSON.stringify(path.relative(file, current)))
    if (stat.isFile()) {
      hash.update('file')
      for await (const chunk of createReadStream(current)) hash.update(chunk)
    } else if (stat.isDirectory()) {
      hash.update('directory')
      for (const name of (await readdir(current)).sort()) await visit(path.join(current, name))
    } else throw new Error(`Unsupported runtime history: ${current}`)
  }
  await visit(file)
  return hash.digest('hex')
}
