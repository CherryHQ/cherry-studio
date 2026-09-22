import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('prometheusFullPack')

/**
 * Detects a native full-pack Prometheus install.
 *
 * The mini pack is never installed natively on a machine that already has the full pack — the two
 * would shadow each other's skills. This mirrors `lib/platform/full-pack.mjs`, deliberately keeping
 * only the filesystem markers and dropping the `PATH` probe: spawning a process to decide whether we
 * may copy files would make every startup pay for a subprocess, and the filesystem markers are
 * sufficient on their own. A machine with the CLI on `PATH` but none of these markers is not one the
 * full pack has actually written to.
 *
 * **Fails closed.** An unreadable home throws rather than reporting "absent", because reporting a
 * full-pack machine as clean is the direction that does damage — it would let the push write into a
 * home the full pack owns.
 */

const SKILL_ROOTS = ['.claude', '.agents'] as const
const FULL_PACK_SKILL = 'kbd-process-orchestrator'

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

export interface FullPackDetection {
  present: boolean
  markers: string[]
}

export async function detectFullPack(): Promise<FullPackDetection> {
  const home = application.getPath('sys.home')

  if (!isDirectory(home)) {
    throw new Error(`detectFullPack: home ${JSON.stringify(home)} is not a readable directory`)
  }

  const markers: string[] = []

  const setupState = path.join(home, '.prometheus', 'setup-state.json')
  if (existsSync(setupState)) {
    markers.push(`the full pack's setup-state.json exists (${setupState})`)
  }

  for (const root of SKILL_ROOTS) {
    const skill = path.join(home, root, 'skills', FULL_PACK_SKILL)
    if (isDirectory(skill)) {
      markers.push(`the full pack's ${FULL_PACK_SKILL} skill is installed (${skill})`)
    }
  }

  if (markers.length > 0) {
    logger.info('Full Prometheus pack detected', { markers: markers.length })
  }

  return { present: markers.length > 0, markers }
}
