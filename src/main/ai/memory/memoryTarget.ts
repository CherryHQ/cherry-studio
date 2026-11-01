import path from 'node:path'

import { application } from '@application'
import { canonicalizePathForContainment, isPathInside } from '@main/utils/file'
import type { MemoryScope } from '@shared/types/memory'

import { assertMemoryTarget } from './memoryFiles'

export interface MemoryTarget {
  scope: MemoryScope
  path: string
  absolutePath: string
}

/** Classify both the requested location and its real destination before exposing memory content. */
export async function memoryTarget(absolutePath: string): Promise<MemoryTarget | undefined> {
  const shared = application.getPath('feature.memory.data')
  const agents = application.getPath('feature.agents.data')
  const backups = application.getPath('feature.memory.backups')
  const roots = [shared, agents, backups]
  const realRoots = await Promise.all(roots.map((root) => canonicalizePathForContainment(root, { allowMissing: true })))
  const realTarget = await canonicalizePathForContainment(absolutePath, { allowMissing: true })
  for (const candidate of [absolutePath, realTarget]) {
    if (!candidate) continue
    for (const [index, locations] of roots.map((root, index) => [root, realRoots[index]]).entries()) {
      for (const root of locations) {
        if (!root || (candidate !== root && !isPathInside(candidate, root))) continue
        if (index === 2) throw new Error('Memory recovery backups are not available to conversation tools')
        const parts = path.relative(root, candidate).split(path.sep)
        const agentId = index === 1 ? parts.shift() : undefined
        if (index === 1 && !/^(?:MEMORY\.md|\.memories|memory)$/i.test(parts[0] ?? '')) continue
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
    application.getPath('feature.memory.backups')
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
        if (index !== 1) return true
        const parts = path.relative(root, candidate).split(path.sep)
        if (parts.length === 1 || /^(?:MEMORY\.md|\.memories|memory)$/i.test(parts[1] ?? '')) return true
      }
    }
  }
  return false
}
