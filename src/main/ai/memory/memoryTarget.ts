import type { BigIntStats } from 'node:fs'
import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { canonicalizePathForContainment, isPathInside } from '@main/utils/file'
import type { MemoryScope } from '@shared/types/memory'

import { assertMemoryTarget } from './memoryFiles'

const privateMemoryName = /^(?:MEMORY\.md|\.memories|memory)$/i
const scratchName = /^cherry-memory-native-[a-z\d]+$/i

export interface MemoryTarget {
  scope: MemoryScope
  path: string
  absolutePath: string
}

/** Classify both the requested location and its real destination before exposing memory content. */
export async function memoryTarget(absolutePath: string, canonicalPath?: string): Promise<MemoryTarget | undefined> {
  const shared = application.getPath('feature.memory.data')
  const agents = application.getPath('feature.agents.data')
  const backups = application.getPath('feature.memory.backups')
  const roots = [shared, agents, backups, application.getPath('app.temp')]
  const realRoots = await Promise.all(roots.map((root) => canonicalizePathForContainment(root, { allowMissing: true })))
  const realTarget = canonicalPath ?? (await canonicalizePathForContainment(absolutePath, { allowMissing: true }))
  for (const candidate of [absolutePath, realTarget]) {
    if (!candidate) continue
    for (const [index, locations] of roots.map((root, index) => [root, realRoots[index]]).entries()) {
      for (const root of locations) {
        if (!root || (candidate !== root && !isPathInside(candidate, root))) continue
        if (index === 2) throw new Error('Memory recovery backups are not available to conversation tools')
        const parts = path.relative(root, candidate).split(path.sep)
        if (index === 3) {
          if (scratchName.test(parts[0] ?? ''))
            throw new Error('Memory working copies are internal; use the original memory path')
          continue
        }
        const agentId = index === 1 ? parts.shift() : undefined
        if (index === 1 && !privateMemoryName.test(parts[0] ?? '')) continue
        const target = parts.join('/')
        assertMemoryTarget(target)
        const scope: MemoryScope = agentId ? { kind: 'private', agentId } : { kind: 'shared' }
        return { scope, path: target, absolutePath: path.join(roots[index], ...(agentId ? [agentId] : []), target) }
      }
    }
  }
  return undefined
}

/** Search APIs must not reveal protected filenames through an ancestor directory. */
export async function memorySearchTarget(directory: string): Promise<boolean> {
  const roots = [
    application.getPath('feature.memory.data'),
    application.getPath('feature.agents.data'),
    application.getPath('feature.memory.backups'),
    application.getPath('app.temp')
  ]
  const realRoots = await Promise.all(roots.map((root) => canonicalizePathForContainment(root, { allowMissing: true })))
  const realDirectory = await canonicalizePathForContainment(directory, { allowMissing: true })
  for (const candidate of [directory, realDirectory]) {
    if (!candidate) continue
    for (const [index, locations] of roots.map((root, index) => [root, realRoots[index]]).entries()) {
      for (const root of locations) {
        if (!root) continue
        if (path.relative(candidate, root) === '' || isPathInside(root, candidate)) return true
        if (!isPathInside(candidate, root)) continue
        const parts = path.relative(root, candidate).split(path.sep)
        if (index === 3) {
          if (scratchName.test(parts[0] ?? '')) return true
          continue
        }
        if (index !== 1) return true
        if (parts.length === 1 || privateMemoryName.test(parts[1] ?? '')) return true
      }
    }
  }
  return false
}

/** A second name is only sensitive when its open file identity occurs under a managed root. */
export async function assertNotMemoryHardLink(opened: BigIntStats): Promise<void> {
  if (opened.nlink < 2n) return
  const missing = (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  }
  async function scan(directory: string, scope: 'managed' | 'agents' | 'agent' | 'temp'): Promise<void> {
    // Managed storage rejects nested symlinks. Walk only its actual files and directories.
    const entries = await opendir(directory).catch(missing)
    if (!entries) return
    for await (const entry of entries) {
      if (scope === 'temp' && !scratchName.test(entry.name)) continue
      if (scope === 'agent' && !privateMemoryName.test(entry.name)) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await scan(target, scope === 'agents' ? 'agent' : 'managed')
      else if (scope !== 'agents' && entry.isFile()) {
        const file = await stat(target, { bigint: true }).catch(missing)
        if (file?.dev === opened.dev && file.ino === opened.ino)
          throw new Error('Use the memory editor for managed memory files')
      }
    }
  }
  await scan(application.getPath('feature.memory.data'), 'managed')
  await scan(application.getPath('feature.memory.backups'), 'managed')
  await scan(application.getPath('feature.agents.data'), 'agents')
  await scan(application.getPath('app.temp'), 'temp')
}
