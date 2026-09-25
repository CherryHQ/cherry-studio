import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { copyDirectoryRecursive } from '@main/utils/fileOperations'
import { pathExists } from '@main/utils/legacyFile'

import { toAsarUnpackedPath } from './asar'

const logger = loggerService.withContext('prometheusPack')
const installations = new Map<string, Promise<void>>()

/** Complete runnable payload: skills load these adjacent scripts and references on demand. */
export const PACK_ENTRIES = [
  'scripts',
  'lib',
  'rules',
  'skills',
  'references',
  'agents',
  'templates',
  'hooks',
  'docker',
  'commands',
  'shared',
  'docs',
  'schemas',
  'assets',
  'config',
  'catalogs',
  '.agents',
  'node_modules'
] as const

/** Single files, copied alongside the directories above. */
const PACK_FILES = ['package.json', 'versions.toml', 'release-manifest.json'] as const

/**
 * Install the runnable pack into `{userData}/Data/PrometheusPack`.
 *
 * Why a copy exists at all, rather than spawning from the bundled resources: on Windows the
 * app directory is commonly under `Program Files`, where a non-elevated process cannot write.
 * The doctor's own checks are read-only, but its `--fix copy-skills` path and any future fix
 * resolve paths from the pack root, so the root has to live somewhere writable.
 *
 * The installed manifest identifies the complete payload. Matching launches reuse
 * it; an upgrade replaces app-owned runtime assets before installing its manifest.
 */
export function installPrometheusPack(): Promise<void> {
  const source = toAsarUnpackedPath(application.getPath('feature.prometheus.pack.builtin'))
  const destination = application.getPath('feature.prometheus.pack.runtime')
  const active = installations.get(destination)
  if (active) return active
  const installation = performPrometheusPackInstall(source, destination).finally(() =>
    installations.delete(destination)
  )
  installations.set(destination, installation)
  return installation
}

async function performPrometheusPackInstall(source: string, destination: string): Promise<void> {
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
    const manifest = await fs.readFile(path.join(source, 'release-manifest.json'))
    try {
      if (manifest.equals(await fs.readFile(path.join(destination, 'release-manifest.json')))) return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    for (const entry of PACK_ENTRIES) {
      // Packaged builds ship node_modules as pack_modules; a dev source tree keeps node_modules.
      const bundled =
        entry === 'node_modules' && (await pathExists(path.join(source, 'pack_modules'))) ? 'pack_modules' : entry
      const from = path.join(source, bundled)
      const to = path.join(destination, entry)
      try {
        await fs.access(from)
      } catch {
        logger[entry === 'node_modules' ? 'error' : 'warn']('Prometheus pack entry is missing from the bundle', {
          entry
        })
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
