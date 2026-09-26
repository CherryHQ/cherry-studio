import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import Database from 'better-sqlite3'

import { application } from '@application'
import { bootConfigService } from '@data/bootConfig'
import { loggerService } from '@logger'
import { getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'
import { atomicWriteFile } from '@main/utils/file'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import {
  type CacheCleanupIssue,
  type CleanupStepResult,
  type CleanupTarget,
  collectOwnedTargets,
  inspectTarget,
  isNodeError,
  issue,
  measurePaths,
  removeCleanupTarget,
  resultFromSteps,
  toSizeSnapshot
} from './shared'

const logger = loggerService.withContext('CacheCleanup')

const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const

const LEGACY_AGENTS_TABLES = [
  'agents',
  'sessions',
  'skills',
  'agent_skills',
  'scheduled_tasks',
  'task_run_logs',
  'channels',
  'channel_task_subscriptions',
  'session_messages'
] as const

const LEGACY_HOME_CONFIG_LOCK_RETRIES = 50

const LEGACY_HOME_CONFIG_LOCK_RETRY_DELAY_MS = 50

const LEGACY_HOME_CONFIG_LOCK_STALE_MS = 30_000

interface JsonMutation {
  item: string
  path: string
  executablePath: string
  migratedPath: string
  estimatedBytes: number
}

type LegacyHomeConfigUpdate =
  | { state: 'ready'; nextValue: Record<string, unknown> | null }
  | { state: 'not_applicable' | 'unsafe' | 'invalid' }

interface LegacyCleanupPlan {
  targets: CleanupTarget[]
  mutations: JsonMutation[]
  issues: CacheCleanupIssue[]
}

function getCleanupPaths() {
  return {
    legacyCliInstall: application.getPath('v1.cli.install'),
    legacyDatabase: application.getPath('v1.database.file'),
    legacyClaude: application.getPath('v1.agents.claude'),
    knowledge: application.getPath('feature.knowledgebase.data'),
    homeConfig: application.getPath('cherry.config', 'config.json'),
    legacyConfig: application.getPath('app.userdata', 'config.json'),
    legacyWindowStates: [
      application.getPath('app.userdata', 'window-state.json'),
      application.getPath('app.userdata', 'miniWindow-state.json'),
      application.getPath('app.userdata', 'quickAssistant-state.json')
    ],
    migrationTemp: application.getPath('app.userdata', 'migration_temp'),
    legacyAgents: application.getPath('app.userdata.data', 'agents.db'),
    rootLegacyAgents: application.getPath('app.userdata', 'agents.db'),
    customMiniApps: application.getPath('feature.files.data', 'custom-minapps.json'),
    rootLegacyMemory: application.getPath('app.userdata', 'memories.db')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getLegacyHomeConfigUpdate(
  value: unknown,
  executablePath: string,
  migratedPath: string
): LegacyHomeConfigUpdate {
  if (!isRecord(value)) return { state: 'invalid' }

  const appDataPath = value.appDataPath
  if (typeof appDataPath === 'string') return { state: 'unsafe' }
  if (!Array.isArray(appDataPath)) return { state: 'invalid' }

  const matchingEntries = appDataPath.filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.executablePath === executablePath
  )
  if (
    matchingEntries.length === 0 ||
    matchingEntries.some(
      (entry) => typeof entry.dataPath !== 'string' || path.resolve(entry.dataPath) !== path.resolve(migratedPath)
    )
  ) {
    return { state: 'not_applicable' }
  }

  const remainingEntries = appDataPath.filter((entry) => !isRecord(entry) || entry.executablePath !== executablePath)
  const nextValue = { ...value, appDataPath: remainingEntries }
  return {
    state: 'ready',
    nextValue: remainingEntries.length === 0 && Object.keys(nextValue).length === 1 ? null : nextValue
  }
}

async function withSqliteProbe<T>(targetPath: string, inspect: (db: Database.Database) => T): Promise<T> {
  const tempRoot = application.getPath('app.temp')
  await fs.mkdir(tempRoot, { recursive: true })
  const probeDirectory = await fs.mkdtemp(path.join(tempRoot, 'cache-cleanup-sqlite-'))
  const probePath = path.join(probeDirectory, path.basename(targetPath))
  try {
    await fs.copyFile(targetPath, probePath)
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      const sourcePath = `${targetPath}${suffix}`
      try {
        const stats = await fs.lstat(sourcePath)
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new Error(`Unsafe SQLite sidecar: ${sourcePath}`)
        }
        await fs.copyFile(sourcePath, `${probePath}${suffix}`)
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
    }

    const db = new Database(probePath, { readonly: true, fileMustExist: true })
    try {
      return inspect(db)
    } finally {
      db.close()
    }
  } finally {
    await fs.rm(probeDirectory, { recursive: true, force: true })
  }
}

function sqliteHasTable(targetPath: string, tableName: string, requiredColumns: string[] = []): Promise<boolean> {
  return withSqliteProbe(targetPath, (db) => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
    if (table === undefined) return false
    if (requiredColumns.length === 0) return true

    const columns = new Set(
      (db.prepare(`PRAGMA table_info(\`${tableName}\`)`).all() as Array<{ name: unknown }>).map((row) =>
        String(row.name)
      )
    )
    return requiredColumns.every((column) => columns.has(column))
  })
}

function sqliteHasAnyTable(targetPath: string, tableNames: readonly string[]): Promise<boolean> {
  return withSqliteProbe(targetPath, (db) => {
    const statement = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    return tableNames.some((tableName) => statement.get(tableName) !== undefined)
  })
}

async function addSqliteTargetWithSidecars(plan: LegacyCleanupPlan, targetPath: string, item: string): Promise<void> {
  plan.targets.push({ item, path: targetPath, kind: 'file' })
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sidecarPath = `${targetPath}${suffix}`
    const status = await inspectTarget(sidecarPath, item, 'file')
    if (status === 'valid') {
      plan.targets.push({ item, path: sidecarPath, kind: 'file' })
    } else if (status === 'invalid') {
      plan.issues.push(issue(item, 'unsafe_target'))
    }
  }
}

async function hashFile(targetPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(targetPath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function filesAreIdentical(left: string, right: string): Promise<boolean> {
  const [leftStats, rightStats] = await Promise.all([fs.stat(left), fs.stat(right)])
  if (leftStats.size !== rightStats.size) return false
  const [leftHash, rightHash] = await Promise.all([hashFile(left), hashFile(right)])
  return leftHash === rightHash
}

async function sqliteFileSetsAreIdentical(left: string, right: string): Promise<boolean> {
  if (!(await filesAreIdentical(left, right))) return false

  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const [leftStatus, rightStatus] = await Promise.all([
      inspectTarget(`${left}${suffix}`, 'legacy_agents_database', 'file'),
      inspectTarget(`${right}${suffix}`, 'legacy_agents_root_duplicate', 'file')
    ])
    if (leftStatus === 'invalid' || rightStatus === 'invalid') {
      throw new Error(`Unsafe SQLite sidecar for duplicate agents database: ${suffix}`)
    }
    if (leftStatus !== rightStatus) return false
    if (leftStatus === 'valid' && !(await filesAreIdentical(`${left}${suffix}`, `${right}${suffix}`))) {
      return false
    }
  }

  return true
}

async function collectAgentsDatabases(
  plan: LegacyCleanupPlan,
  legacyAgentsPath: string,
  rootLegacyAgentsPath: string
): Promise<void> {
  const item = 'legacy_agents_database'
  const fileStatus = await inspectTarget(legacyAgentsPath, item, 'file')
  if (fileStatus === 'invalid') {
    plan.issues.push(issue(item, 'unsafe_target'))
    return
  }
  if (fileStatus === 'missing') return

  try {
    if (!(await sqliteHasAnyTable(legacyAgentsPath, LEGACY_AGENTS_TABLES))) {
      plan.issues.push(issue(item, 'invalid_data'))
      return
    }
  } catch (error) {
    logger.warn('Failed to validate legacy agents database', { path: legacyAgentsPath, error })
    plan.issues.push(issue(item, 'invalid_data'))
    return
  }

  await addSqliteTargetWithSidecars(plan, legacyAgentsPath, item)

  const rootStatus = await inspectTarget(rootLegacyAgentsPath, 'legacy_agents_root_duplicate', 'file')
  if (rootStatus === 'missing') return
  if (rootStatus === 'invalid') {
    plan.issues.push(issue('legacy_agents_root_duplicate', 'unsafe_target'))
    return
  }

  try {
    if (!(await sqliteFileSetsAreIdentical(legacyAgentsPath, rootLegacyAgentsPath))) {
      plan.issues.push(issue('legacy_agents_root_duplicate', 'unsafe_target'))
      return
    }
    await addSqliteTargetWithSidecars(plan, rootLegacyAgentsPath, 'legacy_agents_root_duplicate')
  } catch (error) {
    logger.warn('Failed to compare legacy agents database copies', { error })
    plan.issues.push(issue('legacy_agents_root_duplicate', 'inspection_failed'))
  }
}

async function collectMemoryDatabase(plan: LegacyCleanupPlan, targetPath: string, item: string): Promise<void> {
  const status = await inspectTarget(targetPath, item, 'file')
  if (status === 'missing') return
  if (status === 'invalid') {
    plan.issues.push(issue(item, 'unsafe_target'))
    return
  }

  try {
    if (!(await sqliteHasTable(targetPath, 'memories', ['id', 'memory']))) {
      plan.issues.push(issue(item, 'invalid_data'))
      return
    }
    await addSqliteTargetWithSidecars(plan, targetPath, item)
  } catch (error) {
    logger.warn('Failed to validate legacy memory database', { path: targetPath, error })
    plan.issues.push(issue(item, 'invalid_data'))
  }
}

async function collectKnowledgeDatabases(plan: LegacyCleanupPlan, knowledgeRoot: string): Promise<void> {
  const rootStatus = await inspectTarget(knowledgeRoot, 'legacy_knowledge_databases', 'directory')
  if (rootStatus === 'missing') return
  if (rootStatus === 'invalid') {
    plan.issues.push(issue('legacy_knowledge_databases', 'unsafe_target'))
    return
  }

  let entries
  try {
    entries = await fs.readdir(knowledgeRoot, { withFileTypes: true })
  } catch (error) {
    logger.warn('Failed to enumerate legacy knowledge databases', { path: knowledgeRoot, error })
    plan.issues.push(issue('legacy_knowledge_databases', 'inspection_failed'))
    return
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      plan.issues.push(issue('legacy_knowledge_databases', 'unsafe_target'))
      continue
    }
    if (!entry.isFile() || SQLITE_SIDECAR_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      continue
    }

    const targetPath = path.join(knowledgeRoot, entry.name)
    try {
      if (!(await sqliteHasTable(targetPath, 'vectors', ['id', 'pageContent', 'uniqueLoaderId', 'source', 'vector']))) {
        continue
      }
      await addSqliteTargetWithSidecars(plan, targetPath, 'legacy_knowledge_databases')
    } catch (error) {
      logger.debug('Skipped non-v1 knowledge file', { path: targetPath, error })
    }
  }
}

async function collectLegacyHomeConfig(plan: LegacyCleanupPlan, targetPath: string): Promise<void> {
  const item = 'legacy_home_config'
  const status = await inspectTarget(targetPath, item, 'file')
  if (status === 'missing') return
  if (status === 'invalid') {
    plan.issues.push(issue(item, 'unsafe_target'))
    return
  }

  let raw: string
  let value: unknown
  try {
    raw = await fs.readFile(targetPath, 'utf8')
    value = JSON.parse(raw)
  } catch (error) {
    logger.warn('Failed to parse legacy shared config', { path: targetPath, error })
    plan.issues.push(issue(item, 'invalid_data'))
    return
  }
  if (!isRecord(value)) {
    plan.issues.push(issue(item, 'invalid_data'))
    return
  }
  if (typeof value.appDataPath === 'string') {
    // This historical shape applies to every installation sharing ~/.cherrystudio.
    plan.issues.push(issue(item, 'unsafe_target'))
    return
  }
  if (!Array.isArray(value.appDataPath)) {
    plan.issues.push(issue(item, 'invalid_data'))
    return
  }

  let executablePath: string
  let migratedPath: string | undefined
  try {
    executablePath = getNormalizedExecutablePath()
    migratedPath = bootConfigService.get('app.user_data_path')?.[executablePath]
  } catch (error) {
    logger.warn('Failed to resolve current installation for legacy shared config cleanup', { path: targetPath, error })
    plan.issues.push(issue(item, 'inspection_failed'))
    return
  }
  if (typeof migratedPath !== 'string') return

  const update = getLegacyHomeConfigUpdate(value, executablePath, migratedPath)
  if (update.state !== 'ready') return

  const size = Buffer.byteLength(raw)
  const nextText = update.nextValue === null ? '' : `${JSON.stringify(update.nextValue, null, 2)}\n`
  plan.mutations.push({
    item,
    path: targetPath,
    executablePath,
    migratedPath,
    estimatedBytes: Math.max(0, size - Buffer.byteLength(nextText))
  })
}

async function collectLegacyCleanupPlan(): Promise<LegacyCleanupPlan> {
  const paths = getCleanupPaths()
  const plan: LegacyCleanupPlan = { targets: [], mutations: [], issues: [] }
  const ownedTargets = collectOwnedTargets([
    { item: 'legacy_config', path: paths.legacyConfig, kind: 'file' },
    ...paths.legacyWindowStates.map(
      (targetPath): CleanupTarget => ({
        item: `legacy_window_state:${path.basename(targetPath)}`,
        path: targetPath,
        kind: 'file'
      })
    ),
    { item: 'legacy_custom_mini_apps', path: paths.customMiniApps, kind: 'file' },
    { item: 'legacy_migration_temp', path: paths.migrationTemp, kind: 'directory' },
    { item: 'legacy_cli_install', path: paths.legacyCliInstall, kind: 'directory' },
    { item: 'legacy_database', path: paths.legacyDatabase, kind: 'file' },
    ...SQLITE_SIDECAR_SUFFIXES.map(
      (suffix): CleanupTarget => ({
        item: 'legacy_database',
        path: `${paths.legacyDatabase}${suffix}`,
        kind: 'file'
      })
    ),
    { item: 'legacy_claude_config', path: paths.legacyClaude, kind: 'directory' }
  ])

  await Promise.all([
    collectAgentsDatabases(plan, paths.legacyAgents, paths.rootLegacyAgents),
    collectMemoryDatabase(plan, paths.rootLegacyMemory, 'legacy_root_memory_database'),
    collectKnowledgeDatabases(plan, paths.knowledge),
    collectLegacyHomeConfig(plan, paths.homeConfig)
  ])

  const owned = await ownedTargets
  plan.targets.push(...owned.targets)
  plan.issues.push(...owned.issues)

  const deduplicatedTargets = new Map<string, CleanupTarget>()
  for (const target of plan.targets) {
    deduplicatedTargets.set(path.resolve(target.path), target)
  }
  plan.targets = [...deduplicatedTargets.values()]
  return plan
}

async function withLegacyHomeConfigLock<T>(targetPath: string, callback: () => Promise<T>): Promise<T> {
  const lockPath = `${targetPath}.cleanup.lock`
  const takeoverPath = `${lockPath}.takeover`

  for (let attempt = 0; ; attempt += 1) {
    let lockHandle: Awaited<ReturnType<typeof fs.open>>
    try {
      lockHandle = await fs.open(lockPath, 'wx', 0o600)
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error
      if (attempt >= LEGACY_HOME_CONFIG_LOCK_RETRIES) {
        throw new Error(`Failed to acquire legacy home config lock: ${lockPath}`, { cause: error })
      }

      let takeoverHandle: Awaited<ReturnType<typeof fs.open>> | undefined
      try {
        takeoverHandle = await fs.open(takeoverPath, 'wx', 0o600)
      } catch (takeoverError) {
        if (!isNodeError(takeoverError, 'EEXIST')) throw takeoverError
      }

      if (takeoverHandle) {
        try {
          const lockStats = await fs.lstat(lockPath)
          if (
            lockStats.isFile() &&
            !lockStats.isSymbolicLink() &&
            Date.now() - lockStats.mtimeMs > LEGACY_HOME_CONFIG_LOCK_STALE_MS
          ) {
            await fs.unlink(lockPath)
            continue
          }
        } catch (lockError) {
          if (isNodeError(lockError, 'ENOENT')) continue
          throw lockError
        } finally {
          await takeoverHandle.close()
          await fs.unlink(takeoverPath).catch(() => undefined)
        }
      }

      try {
        await fs.lstat(lockPath)
      } catch (lockError) {
        if (isNodeError(lockError, 'ENOENT')) continue
        throw lockError
      }

      await new Promise((resolve) => setTimeout(resolve, LEGACY_HOME_CONFIG_LOCK_RETRY_DELAY_MS))
      continue
    }

    await lockHandle.close()
    try {
      return await callback()
    } finally {
      await fs.unlink(lockPath).catch(() => undefined)
    }
  }
}

async function replaceLegacyHomeConfig(targetPath: string, nextValue: Record<string, unknown>): Promise<void> {
  await atomicWriteFile(AbsoluteFilePathSchema.parse(targetPath), `${JSON.stringify(nextValue, null, 2)}\n`, {
    mode: 0o600
  })
}

async function applyJsonMutation(mutation: JsonMutation): Promise<CleanupStepResult> {
  const fileStatus = await inspectTarget(mutation.path, mutation.item, 'file')
  if (fileStatus === 'missing') return { state: 'not_found' }
  if (fileStatus === 'invalid') {
    return { state: 'skipped' }
  }

  try {
    return await withLegacyHomeConfigLock(mutation.path, async () => {
      const lockedFileStatus = await inspectTarget(mutation.path, mutation.item, 'file')
      if (lockedFileStatus === 'missing') return { state: 'not_found' }
      if (lockedFileStatus === 'invalid') return { state: 'skipped' }

      let value: unknown
      try {
        value = JSON.parse(await fs.readFile(mutation.path, 'utf8'))
      } catch (error) {
        logger.warn('Failed to parse legacy shared config while applying cleanup', {
          item: mutation.item,
          path: mutation.path,
          error
        })
        return { state: 'skipped' }
      }

      const update = getLegacyHomeConfigUpdate(value, mutation.executablePath, mutation.migratedPath)
      if (update.state !== 'ready') return { state: update.state === 'not_applicable' ? 'not_found' : 'skipped' }

      if (update.nextValue === null) {
        await fs.rm(mutation.path, { force: false })
        logger.info('Removed empty legacy shared config', { item: mutation.item, path: mutation.path })
        return { state: 'cleared' }
      }

      await replaceLegacyHomeConfig(mutation.path, update.nextValue)
      logger.info('Updated legacy shared config', { item: mutation.item, path: mutation.path })
      return { state: 'cleared' }
    })
  } catch (error) {
    logger.error('Failed to update legacy shared config', { item: mutation.item, path: mutation.path, error })
    return { state: 'failed' }
  }
}

export async function inspectLegacyV1(): Promise<CacheCleanupSizeSnapshot> {
  const plan = await collectLegacyCleanupPlan()
  const targetMeasurement = await measurePaths(
    plan.targets.map(({ item, path: targetPath }) => ({ item, path: targetPath }))
  )
  const mutationBytes = plan.mutations.reduce((total, mutation) => total + mutation.estimatedBytes, 0)
  return toSizeSnapshot(
    {
      bytes: targetMeasurement.bytes + mutationBytes,
      issues: [...plan.issues, ...targetMeasurement.issues]
    },
    'estimated'
  )
}

export async function clearLegacyV1(): Promise<CacheCleanupGroupResult> {
  const plan = await collectLegacyCleanupPlan()
  const steps = await Promise.all([...plan.targets.map(removeCleanupTarget), ...plan.mutations.map(applyJsonMutation)])
  steps.push(...plan.issues.map(() => ({ state: 'skipped' as const })))
  return resultFromSteps('legacy_v1', steps)
}
