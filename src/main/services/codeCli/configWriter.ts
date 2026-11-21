import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { atomicWriteFile, ensureDir, read, remove } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import type { CliConfigTarget, CliConfigWriteFile, FileConfiguredCli } from '@shared/utils/cliConfig'
import { CLI_CONFIG_FILE_SPECS, getCliConfigTargets } from '@shared/utils/cliConfig'

import { getHermesHome } from './hermesHome'

const logger = loggerService.withContext('CodeCliConfigWriter')

/** CLI config files carry credentials — owner-only from birth. */
const CLI_CONFIG_FILE_MODE = 0o600

interface FileSnapshot {
  absPath: AbsoluteFilePath
  existed: boolean
  previousContent: string
}

/** Resolve a declarative target path against its base: the pinned Hermes home, or sys.home for `~/…` spec paths. */
async function resolveTargetPath(target: CliConfigTarget): Promise<AbsoluteFilePath> {
  const { pathBase, path: specPath } = CLI_CONFIG_FILE_SPECS[target]
  if (pathBase === 'hermes-home') {
    return AbsoluteFilePathSchema.parse(path.join(await getHermesHome(), specPath))
  }
  return AbsoluteFilePathSchema.parse(path.join(application.getPath('sys.home'), specPath.replace(/^~[/\\]/, '')))
}

/**
 * OMP accepts `config.yaml` alongside `config.yml` (tried in order
 * `["config.yml", "config.yaml"]`; see OMP 18.18.1 `OE` array and its
 * `for (let t of OE)` loader). Its generic `ConfigFile` class derives the same
 * `.yaml` fallback for every `.yml` path — including `models.yml` — and
 * resolves `.yml` first, then `.yaml`. If only the `.yaml` variant exists,
 * preserve it instead of creating a higher-priority `.yml` that would shadow
 * the user's active configuration. When `.yml` exists (or neither exists), keep
 * the declared `.yml` path.
 *
 * The fallback path is derived from the resolved primary path (same base dir,
 * `.yml` → `.yaml`) so `hermes-home` vs `sys.home` resolution stays in one
 * place (`resolveTargetPath`).
 */
const OMP_YAML_FALLBACK_TARGETS: ReadonlySet<CliConfigTarget> = new Set(['omp-config', 'omp-models'])

async function readOrNull(absPath: AbsoluteFilePath): Promise<string | null> {
  try {
    return await read(absPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function resolveFallbackPath(primaryPath: AbsoluteFilePath): AbsoluteFilePath | null {
  if (!primaryPath.endsWith('.yml')) return null
  return AbsoluteFilePathSchema.parse(`${primaryPath.slice(0, -4)}.yaml`)
}

async function readActiveFile(
  target: CliConfigTarget,
  primaryPath: AbsoluteFilePath
): Promise<{ path: AbsoluteFilePath; content: string | null }> {
  if (!OMP_YAML_FALLBACK_TARGETS.has(target)) return { path: primaryPath, content: await readOrNull(primaryPath) }
  const primaryContent = await readOrNull(primaryPath)
  if (primaryContent !== null) return { path: primaryPath, content: primaryContent }
  const fallbackPath = resolveFallbackPath(primaryPath)
  if (!fallbackPath) return { path: primaryPath, content: null }
  const fallbackContent = await readOrNull(fallbackPath)
  if (fallbackContent !== null) return { path: fallbackPath, content: fallbackContent }
  return { path: primaryPath, content: null }
}

/** One config file's read result for `code_cli.read_config`: `content === null` ⇔ the file does not exist. */
export interface CliConfigReadFile {
  target: CliConfigTarget
  path: AbsoluteFilePath
  content: string | null
}

/**
 * Batch read of CLI config files — the read counterpart of `writeCliConfigFiles`
 * (same `resolveTargetPath` resolution, so reads and writes address identical paths).
 * ENOENT maps to `content: null`; any other read error aborts and rethrows.
 * Duplicate targets are deduplicated by the route schema, not here.
 */
export async function readCliConfigFiles(targets: readonly CliConfigTarget[]): Promise<CliConfigReadFile[]> {
  return Promise.all(
    targets.map(async (target) => {
      const primaryPath = await resolveTargetPath(target)
      const { path: activePath, content } = await readActiveFile(target, primaryPath)
      return { target, path: activePath, content }
    })
  )
}

/**
 * Transactional batch write of a file-configured CLI's config files — the only
 * disk-write path for `code_cli.write_config`. The target enum is the write
 * allow-list (the renderer never sends a path); this only re-checks that each
 * target belongs to `cliTool` and appears once.
 *
 * Per file, in batch order: snapshot → atomic 0600 write or hard delete.
 * The first failure rolls back in reverse order (restore previous content, hard
 * unlink files that did not exist — never the trash, they may hold secrets) and
 * rethrows the ORIGINAL error; rollback failures are logged, never thrown.
 */
export async function writeCliConfigFiles(cliTool: FileConfiguredCli, files: CliConfigWriteFile[]): Promise<void> {
  const allowed = new Set(getCliConfigTargets(cliTool))
  const seen = new Set<CliConfigTarget>()
  for (const file of files) {
    if (!allowed.has(file.target)) {
      throw new Error(`${file.target} is not a config file of ${cliTool}`)
    }
    if (seen.has(file.target)) {
      throw new Error(`Duplicate config target: ${file.target}`)
    }
    seen.add(file.target)
  }

  const snapshots: FileSnapshot[] = []
  try {
    for (const file of files) {
      const primaryPath = await resolveTargetPath(file.target)
      // Single read decides both the active path and the snapshot content, so
      // the path decision cannot go stale before the snapshot.
      const { path: absPath, content: previousContent } = await readActiveFile(file.target, primaryPath)
      snapshots.push({ absPath, existed: previousContent !== null, previousContent: previousContent ?? '' })
      if ('delete' in file) {
        await remove(absPath)
        logger.info(`Deleted ${cliTool} config at ${absPath}`)
      } else {
        await ensureDir(AbsoluteFilePathSchema.parse(path.dirname(absPath)))
        await atomicWriteFile(absPath, file.content, { mode: CLI_CONFIG_FILE_MODE })
        logger.info(`Applied ${cliTool} config to ${absPath}`)
      }
    }
  } catch (error) {
    for (const snapshot of snapshots.slice().reverse()) {
      if (snapshot.existed) {
        await atomicWriteFile(snapshot.absPath, snapshot.previousContent, { mode: CLI_CONFIG_FILE_MODE }).catch(
          (rollbackError) =>
            logger.error(`Failed to roll back ${snapshot.absPath} after write failure`, rollbackError as Error)
        )
      } else {
        await remove(snapshot.absPath).catch((rollbackError) =>
          logger.error(`Failed to delete ${snapshot.absPath} during rollback`, rollbackError as Error)
        )
      }
    }
    throw error
  }
}
