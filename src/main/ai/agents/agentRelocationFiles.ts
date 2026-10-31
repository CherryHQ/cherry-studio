import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
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
