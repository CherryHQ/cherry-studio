import * as os from 'node:os'

import { getWorkspaceInfo } from '@main/services/workspaceContext/WorkspaceContext'

import type { SectionContributor } from './types'

type WorkspaceInfo = Awaited<ReturnType<typeof getWorkspaceInfo>>

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

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function gitBlock(info: WorkspaceInfo): string {
  if (!info.isGitRepo || !info.git) {
    return '  <git initialized="false"/>'
  }
  const { branch, isClean, ahead, behind } = info.git
  const branchAttr = branch ? ` branch="${escapeAttr(branch)}"` : ' detached="true"'
  const cleanAttr = ` clean="${isClean}"`
  const aheadAttr = ahead > 0 ? ` ahead="${ahead}"` : ''
  const behindAttr = behind > 0 ? ` behind="${behind}"` : ''
  return `  <git initialized="true"${branchAttr}${cleanAttr}${aheadAttr}${behindAttr}/>`
}

/**
 * Runtime context: workspace root, hour-rounded date, platform, model,
 * git state. XML-wrapped because every field is structured key-value
 * data the model needs to address by attribute (not free-form prose).
 * Mirrors the `<deferred-tools>` / `<available-skills>` convention
 * used elsewhere in the registry.
 *
 * Non-cacheable — date and git state shift over the lifetime of a
 * session, so we keep them past the cache boundary to avoid
 * invalidating identity / system_rules / actions / etc.
 */
export const envSection: SectionContributor = async (ctx) => {
  const info = await getWorkspaceInfo(ctx.workspaceRoot)
  const workspaceLine = info.workspaceRoot
    ? `  <workspace path="${escapeAttr(info.workspaceRoot)}"/>`
    : `  <workspace bound="false"/>`

  const text = `<environment>
  <date>${hourRoundedDate()}</date>
  <platform>${escapeText(formatPlatform())}</platform>
  <arch>${escapeText(os.arch())}</arch>
  <model>${escapeText(ctx.model.name)}</model>
${workspaceLine}
${gitBlock(info)}
</environment>`

  return {
    id: 'env',
    text,
    cacheable: false
  }
}
