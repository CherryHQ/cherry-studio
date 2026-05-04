import * as os from 'node:os'

import { getWorkspaceInfo } from '@main/services/workspaceContext/WorkspaceContext'

import type { SectionContributor } from './types'

/**
 * Hour-rounded ISO timestamp — granular enough that the model knows
 * the rough current time, stable enough that the cache for everything
 * downstream of this section flips at most once per hour.
 */
function hourRoundedDate(): string {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  return now.toISOString().slice(0, 16) + 'Z'
}

function formatPlatform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return process.platform
  }
}

function formatGit(info: Awaited<ReturnType<typeof getWorkspaceInfo>>): string {
  if (!info.isGitRepo || !info.git) return 'no'
  const { branch, isClean, ahead, behind } = info.git
  const parts = [branch ?? '(detached HEAD)', isClean ? 'clean' : 'dirty']
  if (ahead > 0 || behind > 0) parts.push(`ahead ${ahead}, behind ${behind}`)
  return `yes — ${parts.join(', ')}`
}

/**
 * Runtime context: workspace root, hour-rounded date, platform, model,
 * git state. Non-cacheable — date and git state both shift over the
 * lifetime of a session, so we keep them past the cache boundary to
 * avoid invalidating identity / system_rules / actions / etc.
 */
export const envSection: SectionContributor = async (ctx) => {
  const info = await getWorkspaceInfo(ctx.workspaceRoot)

  const lines = [
    '# Environment',
    '',
    `- Date: ${hourRoundedDate()}`,
    `- Platform: ${formatPlatform()} (${os.arch()})`,
    `- Model: ${ctx.model.name}`,
    `- Workspace: ${info.workspaceRoot ?? '(none — chat is not bound to a folder)'}`,
    `- Git repository: ${formatGit(info)}`
  ]

  return {
    id: 'env',
    text: lines.join('\n'),
    cacheable: false
  }
}
