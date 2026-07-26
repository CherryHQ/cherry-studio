import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { atomicWriteFile, ensureDir, read, remove } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import type { CliConfigTarget, CliConfigWriteFile, FileConfiguredCli } from '@shared/utils/cliConfig'
import { CLI_CONFIG_FILE_SPECS, getCliConfigTargets } from '@shared/utils/cliConfig'

const logger = loggerService.withContext('CodeCliConfigWriter')

/** CLI config files carry credentials — owner-only from birth. */
const CLI_CONFIG_FILE_MODE = 0o600

interface FileSnapshot {
  absPath: AbsoluteFilePath
  existed: boolean
  previousContent: string
}

/** Spec paths are all `~/…`; resolve against the OS home dir (matches the renderer's App_ResolvePath view). */
function resolveTargetPath(target: CliConfigTarget): AbsoluteFilePath {
  const specPath = CLI_CONFIG_FILE_SPECS[target].path
  return AbsoluteFilePathSchema.parse(path.join(application.getPath('sys.home'), specPath.replace(/^~[/\\]/, '')))
}

async function readOrNull(absPath: AbsoluteFilePath): Promise<string | null> {
  try {
    return await read(absPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Transactional batch write of a file-configured CLI's config files — the only
 * disk-write path for `code_cli.write_config`. The target enum is the write
 * allow-list (the renderer never sends a path); this only re-checks that each
 * target belongs to `cliTool` and appears once.
 *
 * Per file, in batch order: snapshot → ensure parent dir → atomic 0600 write.
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
      const absPath = resolveTargetPath(file.target)
      const previousContent = await readOrNull(absPath)
      snapshots.push({ absPath, existed: previousContent !== null, previousContent: previousContent ?? '' })
      await ensureDir(AbsoluteFilePathSchema.parse(path.dirname(absPath)))
      await atomicWriteFile(absPath, file.content, { mode: CLI_CONFIG_FILE_MODE })
      logger.info(`Applied ${cliTool} config to ${absPath}`)
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
