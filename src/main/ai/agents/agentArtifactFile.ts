import { lstat } from 'node:fs/promises'
import path from 'node:path'

import type { ReportedAgentArtifact } from '@data/services/ArtifactService'
import { canonicalizePathForContainment, isOutsidePath } from '@main/utils/file'

export async function prepareAgentArtifact(
  workspacePath: string,
  filePath: string,
  title?: string
): Promise<ReportedAgentArtifact | undefined> {
  const requested = path.resolve(workspacePath, filePath)
  const relativePath = path.relative(workspacePath, requested)
  if (!relativePath || isOutsidePath(relativePath)) return undefined

  const [root, target] = await Promise.all([
    canonicalizePathForContainment(workspacePath, { allowMissing: true }),
    canonicalizePathForContainment(requested, { allowMissing: true })
  ])
  if (!root || !target) return undefined
  const canonicalRelative = path.relative(root, target)
  if (!canonicalRelative || isOutsidePath(canonicalRelative)) return undefined

  const stats = await lstat(target).catch(() => undefined)
  return {
    path: relativePath,
    title: title ?? path.basename(requested),
    size: stats?.isFile() ? stats.size : null
  }
}
