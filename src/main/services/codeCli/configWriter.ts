import { readlink } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { mergeEnvironment } from '@main/utils/env'
import { atomicWriteFile, ensureDir, read, realpath, remove } from '@main/utils/file'
import { getRawShellEnv } from '@main/utils/shellEnv'
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
  const env = mergeEnvironment(await getRawShellEnv())
  const directories: Partial<Record<CliConfigTarget, string | undefined>> = {
    'claude-settings': env.CLAUDE_CONFIG_DIR,
    'codex-config': env.CODEX_HOME,
    'codex-auth': env.CODEX_HOME,
    'pi-settings': env.PI_CODING_AGENT_DIR,
    'pi-models': env.PI_CODING_AGENT_DIR,
    'kimi-config': env.KIMI_CODE_HOME,
    'copilot-settings': env.COPILOT_HOME,
    'copilot-mcp': env.COPILOT_HOME,
    'copilot-providers': env.COPILOT_HOME,
    'kiro-settings': env.KIRO_HOME && path.join(env.KIRO_HOME, 'settings'),
    'kiro-mcp': env.KIRO_HOME && path.join(env.KIRO_HOME, 'settings'),
    'vibe-config': env.VIBE_HOME,
    'vibe-env': env.VIBE_HOME,
    'grok-config': env.GROK_HOME,
    'cortex-settings': env.SNOWFLAKE_HOME && path.join(env.SNOWFLAKE_HOME, 'cortex'),
    'cortex-mcp': env.SNOWFLAKE_HOME && path.join(env.SNOWFLAKE_HOME, 'cortex'),
    'cortex-permissions': env.SNOWFLAKE_HOME && path.join(env.SNOWFLAKE_HOME, 'cortex'),
    'fast-agent-config': env.FAST_AGENT_HOME
  }
  let filename = directories[target]
    ? path.join(directories[target], path.basename(specPath))
    : path.join(application.getPath('sys.home'), specPath.replace(/^~[/\\]/, ''))
  const home = application.getPath('sys.home')
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config')
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming')
  if (target === 'copilot-settings' && (await readOrNull(AbsoluteFilePathSchema.parse(filename))) === null) {
    const legacy = AbsoluteFilePathSchema.parse(path.join(path.dirname(filename), 'config.json'))
    if ((await readOrNull(legacy)) !== null) filename = legacy
  }
  if (target === 'copilot-providers' && env.COPILOT_PROVIDERS_CONFIG) filename = env.COPILOT_PROVIDERS_CONFIG
  if (target.startsWith('cline-')) {
    filename = path.join(
      env.CLINE_DATA_DIR || path.join(env.CLINE_DIR || path.join(home, '.cline'), 'data'),
      'settings',
      path.basename(specPath)
    )
  }
  if (target === 'kilo-config') {
    const directory = path.join(configHome, 'kilo')
    filename = env.KILO_CONFIG || path.join(directory, 'kilo.jsonc')
    if (
      !env.KILO_CONFIG &&
      (await readOrNull(AbsoluteFilePathSchema.parse(filename))) === null &&
      (await readOrNull(AbsoluteFilePathSchema.parse(path.join(directory, 'kilo.json')))) !== null
    ) {
      filename = path.join(directory, 'kilo.json')
    }
  }
  if (target === 'goose-config') {
    filename = path.join(
      env.GOOSE_PATH_ROOT
        ? path.join(env.GOOSE_PATH_ROOT, 'config')
        : process.platform === 'win32'
          ? path.join(roaming, 'Block', 'goose', 'config')
          : path.join(configHome, 'goose'),
      'config.yaml'
    )
  }
  if (target.startsWith('devin-')) {
    filename = path.join(process.platform === 'win32' ? roaming : configHome, 'devin', path.basename(specPath))
  }
  if (target === 'trae-config') {
    const root =
      process.platform === 'win32'
        ? roaming
        : process.platform === 'darwin'
          ? path.join(home, 'Library', 'Application Support')
          : configHome
    filename = path.join(root, 'trae_cli', 'trae_cli.yaml')
  }
  if (target === 'vtcode-config') {
    const directory =
      env.VTCODE_CONFIG ||
      (process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'com.vinhnx.vtcode')
        : process.platform === 'win32'
          ? path.join(roaming, 'vinhnx', 'vtcode', 'config')
          : path.join(configHome, 'vtcode'))
    filename = path.join(directory, 'vtcode.toml')
  }
  if (target === 'amp-settings' && (await readOrNull(AbsoluteFilePathSchema.parse(`${filename}c`))) !== null)
    filename += 'c'
  if (target === 'opencode-config') {
    filename =
      env.OPENCODE_CONFIG ||
      path.join(env.XDG_CONFIG_HOME || application.getPath('sys.home', '.config'), 'opencode', 'opencode.json')
    if (!env.OPENCODE_CONFIG && (await readOrNull(AbsoluteFilePathSchema.parse(`${filename}c`))) !== null)
      filename += 'c'
  }
  return AbsoluteFilePathSchema.parse(filename)
}

async function readOrNull(absPath: AbsoluteFilePath): Promise<string | null> {
  try {
    return await read(absPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
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
      const path = await resolveTargetPath(target)
      return { target, path, content: await readOrNull(path) }
    })
  )
}

async function resolveWritePath(filename: AbsoluteFilePath): Promise<AbsoluteFilePath> {
  try {
    return await realpath(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      const target = await readlink(filename)
      return resolveWritePath(AbsoluteFilePathSchema.parse(path.resolve(path.dirname(filename), target)))
    } catch (linkError) {
      if ((linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError
      return filename
    }
  }
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
export async function writeCliConfigFiles<T = void>(
  cliTool: FileConfiguredCli,
  files: CliConfigWriteFile[],
  commit?: () => T
): Promise<T | undefined> {
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
      const absPath = await resolveWritePath(await resolveTargetPath(file.target))
      const previousContent = await readOrNull(absPath)
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
    return commit?.()
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
