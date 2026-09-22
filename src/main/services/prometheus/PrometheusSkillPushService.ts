import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { toAsarUnpackedPath } from '@main/utils/asar'
import { copyDirectoryRecursive } from '@main/utils/fileOperations'
import type { PrometheusPushState } from '@shared/types/prometheus'

import { detectFullPack } from './fullPackDetection'

const logger = loggerService.withContext('PrometheusSkillPush')

/** The two skill roots other command-line tools read. Copies only — never symlinks. */
const SKILL_ROOTS = ['.agents', '.claude'] as const

/**
 * Copies the pack's skills into `~/.agents/skills/` and `~/.claude/skills/` so tools outside this
 * app can use them.
 *
 * Runs on every startup, not only the first: the bundled pack changes with each app update, and a
 * first-run-only push would leave those directories pinned to whatever shipped the day the app was
 * installed.
 *
 * **It refuses outright when the full Prometheus pack is installed.** The two must never shadow
 * each other's skills, and the full pack is authoritative where present. That refusal is surfaced
 * in Settings with the markers that caused it, and the UI offers no way around it (A-3).
 *
 * Background phase: a skill copy must never delay a window appearing.
 */
@Injectable('PrometheusSkillPushService')
@ServicePhase(Phase.Background)
export class PrometheusSkillPushService extends BaseService {
  private pushState: PrometheusPushState = { status: 'idle' }

  protected async onInit(): Promise<void> {
    // Fire-and-forget inside an already-backgrounded phase: the result is read from Settings,
    // and nothing downstream waits on it.
    void this.push().catch((error) => {
      logger.error('The startup skill push failed', error as Error)
    })
  }

  getState(): PrometheusPushState {
    return this.pushState
  }

  /**
   * Copy every bundled skill into both home skill roots.
   *
   * Returns the resulting state rather than throwing, because both callers — startup and the
   * Settings button — render the outcome rather than handling an exception.
   */
  async push(): Promise<PrometheusPushState> {
    const fullPack = await detectFullPack()
    if (fullPack.present) {
      // Not a failure. A deliberate refusal, reported as such.
      this.pushState = {
        status: 'refused',
        reason: 'The full Prometheus pack is installed on this computer.',
        markers: fullPack.markers
      }
      logger.info('Skill push refused: the full Prometheus pack is installed', {
        markers: fullPack.markers.length
      })
      return this.pushState
    }

    this.pushState = { status: 'running' }

    try {
      const source = toAsarUnpackedPath(application.getPath('feature.agents.skills.builtin'))
      const entries = await fs.readdir(source, { withFileTypes: true })
      const skills = entries.filter((entry) => entry.isDirectory())

      const home = application.getPath('sys.home')
      let copied = 0

      for (const root of SKILL_ROOTS) {
        const destinationRoot = path.join(home, root, 'skills')
        await fs.mkdir(destinationRoot, { recursive: true })

        for (const skill of skills) {
          const from = path.join(source, skill.name)
          const to = path.join(destinationRoot, skill.name)
          // Replace rather than merge: a file deleted upstream must not survive in the copy.
          await fs.rm(to, { recursive: true, force: true })
          await copyDirectoryRecursive(from, to)
        }
        copied = skills.length
      }

      this.pushState = { status: 'done', count: copied, lastRunAt: new Date().toISOString() }
      logger.info('Skills pushed to the home directory', { count: copied })
    } catch (error) {
      this.pushState = { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
      logger.error('Failed to push skills to the home directory', error as Error)
    }

    return this.pushState
  }
}
