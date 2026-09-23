import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { toAsarUnpackedPath } from '@main/utils/asar'
import type { PrometheusPushState } from '@shared/types/prometheus'

import { detectFullPack } from './fullPackDetection'
import { copyOwnedSkill } from './ownedSkillCopy'
import { renderMiniSkill } from './miniCommands'

const logger = loggerService.withContext('prometheusPushSkills')

/** The two skill roots other command-line tools read. Copies only — never symlinks. */
const SKILL_ROOTS = ['.agents', '.claude'] as const

/**
 * Copy every bundled skill into both home skill roots.
 *
 * A free function rather than a method: this is a pure function of the paths it reads, and
 * `BaseService` permits only one instance per class, which would make the behaviour awkward to
 * test through the service.
 *
 * **Refuses outright when the full Prometheus pack is installed.** The two must never shadow each
 * other's skills, and the full pack is authoritative where present. The refusal carries the
 * markers that caused it so it is auditable, and the UI offers no path around it (A-3).
 *
 * Returns the resulting state rather than throwing for an ordinary copy failure, because both
 * callers render the outcome. An unreadable home is the exception: `detectFullPack` throws there,
 * and that throw is deliberately not caught — failing closed is the only safe direction when we
 * cannot tell whether the full pack is present.
 */
export async function pushSkillsToHome(): Promise<PrometheusPushState> {
  const fullPack = await detectFullPack()
  if (fullPack.present) {
    // Not a failure. A deliberate refusal, reported as such.
    logger.info('Skill push refused: the full Prometheus pack is installed', {
      markers: fullPack.markers.length
    })
    return {
      status: 'refused',
      reason: 'The full Prometheus pack is installed on this computer.',
      markers: fullPack.markers
    }
  }

  try {
    const source = toAsarUnpackedPath(application.getPath('feature.agents.skills.builtin'))
    const entries = await fs.readdir(source, { withFileTypes: true })
    const skills = entries.filter((entry) => entry.isDirectory())

    const home = application.getPath('sys.home')

    for (const root of SKILL_ROOTS) {
      const destinationRoot = path.join(home, root, 'skills')
      await fs.mkdir(destinationRoot, { recursive: true })

      for (const skill of skills) {
        const from = path.join(source, skill.name)
        const to = path.join(destinationRoot, skill.name)
        await copyOwnedSkill(from, to, renderMiniSkill)
      }
    }

    logger.info('Skills pushed to the home directory', { count: skills.length })
    return { status: 'done', count: skills.length, lastRunAt: new Date().toISOString() }
  } catch (error) {
    logger.error('Failed to push skills to the home directory', error as Error)
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}
