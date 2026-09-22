import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { copyDirectoryRecursive } from '@main/utils/fileOperations'

import { toAsarUnpackedPath } from './asar'

const logger = loggerService.withContext('prometheusPack')

/**
 * The parts of the Prometheus submodule that are *runnable*, as opposed to the parts that
 * document it. `scripts/` holds the entry points, `lib/` the implementation they import,
 * `rules/` the text the checks read. `openspec/`, `docs/`, `agents/` and `references/` are
 * excluded deliberately — several hundred files nothing at runtime opens.
 *
 * `skills/` is excluded too: those already travel through `resources/skills/` and are installed
 * per-skill by `installBuiltinSkills`. Copying them again here would give the same skill two
 * homes on disk.
 */
export const PACK_ENTRIES = ['scripts', 'lib', 'rules'] as const

/** Single files, copied alongside the directories above. */
const PACK_FILES = ['package.json'] as const

/**
 * Install the runnable pack into `{userData}/Data/PrometheusPack`.
 *
 * Why a copy exists at all, rather than spawning from the bundled resources: on Windows the
 * app directory is commonly under `Program Files`, where a non-elevated process cannot write.
 * The doctor's own checks are read-only, but its `--fix copy-skills` path and any future fix
 * resolve paths from the pack root, so the root has to live somewhere writable.
 *
 * Runs on every launch and overwrites unconditionally: the bundled copy is replaced whenever
 * the app updates, and comparing content would cost more than the copy of a few hundred small
 * files. Failure is logged and swallowed — a pack that did not install degrades the Prometheus
 * settings section, and must never prevent the app from starting.
 */
export async function installPrometheusPack(): Promise<void> {
  const source = toAsarUnpackedPath(application.getPath('feature.prometheus.pack.builtin'))
  const destination = application.getPath('feature.prometheus.pack.runtime')

  try {
    await fs.access(source)
  } catch {
    // The submodule is not checked out. Expected in a source tree that skipped
    // `git submodule update --init`; not expected in a packaged build.
    logger.warn('Prometheus pack is absent from resources; skipping install', { source })
    return
  }

  try {
    await fs.mkdir(destination, { recursive: true })

    for (const entry of PACK_ENTRIES) {
      const from = path.join(source, entry)
      const to = path.join(destination, entry)
      try {
        await fs.access(from)
      } catch {
        logger.warn('Prometheus pack entry is missing from the bundle', { entry })
        continue
      }
      // Removed first so a file deleted upstream does not linger and keep being executed.
      await fs.rm(to, { recursive: true, force: true })
      await copyDirectoryRecursive(from, to)
    }

    for (const file of PACK_FILES) {
      try {
        await fs.copyFile(path.join(source, file), path.join(destination, file))
      } catch (error) {
        logger.warn('Failed to copy a Prometheus pack file', {
          file,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    logger.info('Prometheus pack installed', { destination })
  } catch (error) {
    logger.error('Failed to install the Prometheus pack', error as Error)
  }
}
