import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { bootConfigService } from '@data/bootConfig'
import { loggerService } from '@logger'
import { getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'
import type {
  CacheCleanupGroup,
  CacheCleanupGroupInspection,
  CacheCleanupGroupResult,
  CacheCleanupInspection,
  CacheCleanupRunResult,
  CacheCleanupSizeAccuracy,
  CacheCleanupSizeSnapshot
} from '@shared/types/cacheCleanup'
import { HTML_ARTIFACT_PREVIEW_PARTITION } from '@shared/utils/htmlArtifact'
import { Mutex } from 'async-mutex'
import Database from 'better-sqlite3'
import { type Session, session } from 'electron'

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

const NORMAL_CACHE_RELATIVE_PATHS = [
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  path.join('Service Worker', 'CacheStorage'),
  'Shared Dictionary'
] as const

const COOKIE_RELATIVE_PATHS = [
  'Cookies',
  'Cookies-journal',
  path.join('Network', 'Cookies'),
  path.join('Network', 'Cookies-journal')
] as const

type CacheCleanupIssueCode = 'inspection_failed' | 'unsafe_target' | 'invalid_data'

interface CacheCleanupIssue {
  item: string
  code: CacheCleanupIssueCode
}

interface SizeMeasurement {
  bytes: number
  issues: CacheCleanupIssue[]
}

interface CleanupTarget {
  item: string
  path: string
  kind: 'file' | 'directory'
}

interface JsonMutation {
  item: string
  path: string
  expectedRaw: string
  nextValue: Record<string, unknown> | null
  estimatedBytes: number
}

interface LegacyCleanupPlan {
  targets: CleanupTarget[]
  mutations: JsonMutation[]
  issues: CacheCleanupIssue[]
}

interface CleanupStepResult {
  state: 'cleared' | 'not_found' | 'skipped' | 'failed'
}

function issue(item: string, code: CacheCleanupIssueCode): CacheCleanupIssue {
  return { item, code }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPathWithin(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return (
    relativePath === '' ||
    (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`))
  )
}

async function pathHasSymlinkedOwnedSegment(targetPath: string): Promise<boolean> {
  const trustedRoots = [application.getPath('app.userdata'), application.getPath('cherry.home')]
    .filter((rootPath) => isPathWithin(targetPath, rootPath))
    .sort((left, right) => right.length - left.length)
  const trustedRoot = trustedRoots[0]
  if (!trustedRoot) return true

  const relativePath = path.relative(path.resolve(trustedRoot), path.resolve(targetPath))
  let currentPath = trustedRoot
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment)
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) return true
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false
      throw error
    }
  }
  return false
}

function getCleanupPaths() {
  const data = application.getPath('app.userdata.data')

  return {
    defaultSession: application.getPath('app.session'),
    webviewSession: application.getPath('app.session.webview'),
    appTemp: application.getPath('app.temp'),
    trace: application.getPath('feature.trace'),
    legacyTrace: application.getPath('v1.trace'),
    legacyCliInstall: application.getPath('v1.cli.install'),
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
    legacyMemory: path.join(data, 'Memory', 'memories.db'),
    rootLegacyMemory: application.getPath('app.userdata', 'memories.db'),
    indexedDbRestore: application.getPath('app.userdata', 'IndexedDB.restore'),
    localStorageRestore: application.getPath('app.userdata', 'Local Storage.restore'),
    dataRestore: application.getPath('app.userdata', 'Data.restore')
  }
}

function mergeMeasurements(measurements: SizeMeasurement[]): SizeMeasurement {
  const result: SizeMeasurement = { bytes: 0, issues: [] }
  for (const measurement of measurements) {
    result.bytes += measurement.bytes
    result.issues.push(...measurement.issues)
  }
  return result
}

function toSizeSnapshot(measurement: SizeMeasurement, accuracy: CacheCleanupSizeAccuracy): CacheCleanupSizeSnapshot {
  const partial = measurement.issues.length > 0
  const allUnavailable = partial && measurement.bytes === 0
  return {
    bytes: allUnavailable ? null : measurement.bytes,
    accuracy: allUnavailable ? 'unavailable' : accuracy,
    completeness: partial ? 'partial' : 'complete'
  }
}

async function measurePath(
  targetPath: string,
  item: string,
  excludedPaths: ReadonlySet<string> = new Set(),
  nested = false
): Promise<SizeMeasurement> {
  const resolvedPath = path.resolve(targetPath)
  if (excludedPaths.has(resolvedPath)) {
    return { bytes: 0, issues: [] }
  }

  let stats
  try {
    stats = await fs.lstat(targetPath)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return { bytes: 0, issues: [] }
    }
    logger.warn('Failed to inspect cleanup target size', { item, path: targetPath, error })
    return { bytes: 0, issues: [issue(item, 'inspection_failed')] }
  }

  if (stats.isSymbolicLink()) {
    if (!nested) {
      logger.warn('Skipped symbolic-link cleanup target', { item, path: targetPath })
      return { bytes: 0, issues: [issue(item, 'unsafe_target')] }
    }
    return { bytes: stats.size, issues: [] }
  }

  if (!stats.isDirectory()) {
    return { bytes: stats.size, issues: [] }
  }

  let entries
  try {
    entries = await fs.readdir(targetPath)
  } catch (error) {
    logger.warn('Failed to read cleanup target directory', { item, path: targetPath, error })
    return { bytes: 0, issues: [issue(item, 'inspection_failed')] }
  }

  const result: SizeMeasurement = { bytes: 0, issues: [] }
  for (const entry of entries) {
    const child = await measurePath(path.join(targetPath, entry), item, excludedPaths, true)
    result.bytes += child.bytes
    result.issues.push(...child.issues)
  }
  return result
}

async function measurePaths(
  targets: ReadonlyArray<{ item: string; path: string; excludedPaths?: ReadonlySet<string> }>
): Promise<SizeMeasurement> {
  const uniqueTargets = new Map<string, (typeof targets)[number]>()
  for (const target of targets) {
    const resolvedPath = path.resolve(target.path)
    if (!uniqueTargets.has(resolvedPath)) {
      uniqueTargets.set(resolvedPath, target)
    }
  }

  return mergeMeasurements(
    await Promise.all(
      [...uniqueTargets.values()].map(({ item, path: targetPath, excludedPaths }) =>
        measurePath(targetPath, item, excludedPaths)
      )
    )
  )
}

async function measureSessionCache(ses: Session, item: string): Promise<SizeMeasurement> {
  try {
    const bytes = await ses.getCacheSize()
    return { bytes, issues: [] }
  } catch (error) {
    logger.warn('Failed to query Electron session cache size', { item, error })
    return { bytes: 0, issues: [issue(item, 'inspection_failed')] }
  }
}

async function inspectNormalCache(): Promise<CacheCleanupSizeSnapshot> {
  const paths = getCleanupPaths()
  const sessions = [
    { item: 'default_session', root: paths.defaultSession, value: session.defaultSession },
    { item: 'webview_session', root: paths.webviewSession, value: session.fromPartition('persist:webview') }
  ]
  const previewSession = {
    item: 'html_artifact_preview_session',
    value: session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION)
  }

  const electronMeasurements = await Promise.all(
    [...sessions, previewSession].map(({ item, value }) => measureSessionCache(value, item))
  )
  const diskTargets = sessions.flatMap(({ item, root }) =>
    NORMAL_CACHE_RELATIVE_PATHS.map((relativePath) => ({
      item,
      path: path.join(root, relativePath)
    }))
  )
  diskTargets.push(
    { item: 'app_temp', path: paths.appTemp },
    { item: 'trace', path: paths.trace },
    { item: 'legacy_trace', path: paths.legacyTrace }
  )

  const diskMeasurement = await measurePaths(diskTargets)
  return toSizeSnapshot(mergeMeasurements([...electronMeasurements, diskMeasurement]), 'estimated')
}

async function inspectSiteData(): Promise<CacheCleanupSizeSnapshot> {
  const paths = getCleanupPaths()
  const targets: Array<{ item: string; path: string; excludedPaths?: ReadonlySet<string> }> = COOKIE_RELATIVE_PATHS.map(
    (relativePath) => ({
      item: 'default_session_cookies',
      path: path.join(paths.defaultSession, relativePath)
    })
  )

  targets.push(
    ...COOKIE_RELATIVE_PATHS.map((relativePath) => ({
      item: 'webview_cookies',
      path: path.join(paths.webviewSession, relativePath)
    })),
    { item: 'webview_local_storage', path: path.join(paths.webviewSession, 'Local Storage') },
    { item: 'webview_indexeddb', path: path.join(paths.webviewSession, 'IndexedDB') },
    { item: 'webview_file_system', path: path.join(paths.webviewSession, 'File System') },
    {
      item: 'webview_service_workers',
      path: path.join(paths.webviewSession, 'Service Worker'),
      excludedPaths: new Set([path.resolve(paths.webviewSession, 'Service Worker', 'CacheStorage')])
    },
    { item: 'webview_websql', path: path.join(paths.webviewSession, 'databases') }
  )

  return toSizeSnapshot(await measurePaths(targets), 'estimated')
}

async function inspectTarget(
  targetPath: string,
  item: string,
  kind: CleanupTarget['kind']
): Promise<'missing' | 'valid' | 'invalid'> {
  try {
    if (await pathHasSymlinkedOwnedSegment(targetPath)) {
      logger.warn('Legacy cleanup target contains a symbolic-link path segment', { item, path: targetPath })
      return 'invalid'
    }
    const stats = await fs.lstat(targetPath)
    const hasExpectedType = kind === 'file' ? stats.isFile() : stats.isDirectory()
    if (stats.isSymbolicLink() || !hasExpectedType) {
      logger.warn('Legacy cleanup target has an unexpected type', { item, path: targetPath, kind })
      return 'invalid'
    }
    return 'valid'
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return 'missing'
    logger.warn('Failed to inspect legacy cleanup target', { item, path: targetPath, kind, error })
    return 'invalid'
  }
}

async function collectOwnedTargets(
  candidates: readonly CleanupTarget[]
): Promise<{ targets: CleanupTarget[]; issues: CacheCleanupIssue[] }> {
  const inspected = await Promise.all(
    candidates.map(async (target) => ({ target, status: await inspectTarget(target.path, target.item, target.kind) }))
  )
  return {
    targets: inspected.filter(({ status }) => status === 'valid').map(({ target }) => target),
    issues: inspected
      .filter(({ status }) => status === 'invalid')
      .map(({ target }) => issue(target.item, 'unsafe_target'))
  }
}

function sqliteHasTable(targetPath: string, tableName: string, requiredColumns: string[] = []): boolean {
  const db = new Database(targetPath, { readonly: true, fileMustExist: true })
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
    if (table === undefined) return false
    if (requiredColumns.length === 0) return true

    const columns = new Set(
      (db.prepare(`PRAGMA table_info(\`${tableName}\`)`).all() as Array<{ name: unknown }>).map((row) =>
        String(row.name)
      )
    )
    return requiredColumns.every((column) => columns.has(column))
  } finally {
    db.close()
  }
}

function sqliteHasAnyTable(targetPath: string, tableNames: readonly string[]): boolean {
  const db = new Database(targetPath, { readonly: true, fileMustExist: true })
  try {
    const statement = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    return tableNames.some((tableName) => statement.get(tableName) !== undefined)
  } finally {
    db.close()
  }
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
    if (!sqliteHasAnyTable(legacyAgentsPath, LEGACY_AGENTS_TABLES)) {
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
    if (!sqliteHasTable(targetPath, 'memories', ['id', 'memory'])) {
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
      if (!sqliteHasTable(targetPath, 'vectors', ['id', 'pageContent', 'uniqueLoaderId', 'source', 'vector'])) {
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

  const appDataPath = value.appDataPath
  if (typeof appDataPath === 'string') {
    // This historical shape applies to every installation sharing ~/.cherrystudio.
    plan.issues.push(issue(item, 'unsafe_target'))
    return
  }
  if (!Array.isArray(appDataPath)) {
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
  const matchingEntries = appDataPath.filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.executablePath === executablePath
  )
  if (
    matchingEntries.length === 0 ||
    typeof migratedPath !== 'string' ||
    matchingEntries.some(
      (entry) => typeof entry.dataPath !== 'string' || path.resolve(entry.dataPath) !== path.resolve(migratedPath)
    )
  ) {
    return
  }

  const remainingEntries = appDataPath.filter((entry) => !isRecord(entry) || entry.executablePath !== executablePath)
  const nextValue = { ...value, appDataPath: remainingEntries }
  const size = Buffer.byteLength(raw)

  if (remainingEntries.length === 0 && Object.keys(nextValue).length === 1) {
    plan.mutations.push({
      item,
      path: targetPath,
      expectedRaw: raw,
      nextValue: null,
      estimatedBytes: size
    })
    return
  }

  const nextText = `${JSON.stringify(nextValue, null, 2)}\n`
  plan.mutations.push({
    item,
    path: targetPath,
    expectedRaw: raw,
    nextValue,
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
    { item: 'legacy_cli_install', path: paths.legacyCliInstall, kind: 'directory' }
  ])

  await Promise.all([
    collectAgentsDatabases(plan, paths.legacyAgents, paths.rootLegacyAgents),
    collectMemoryDatabase(plan, paths.legacyMemory, 'legacy_memory_database'),
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

async function inspectLegacyV1(): Promise<CacheCleanupSizeSnapshot> {
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

function collectRestoreTargets(): Promise<{ targets: CleanupTarget[]; issues: CacheCleanupIssue[] }> {
  const paths = getCleanupPaths()
  return collectOwnedTargets([
    { item: 'restore_indexeddb', path: paths.indexedDbRestore, kind: 'directory' },
    { item: 'restore_local_storage', path: paths.localStorageRestore, kind: 'directory' },
    { item: 'restore_data', path: paths.dataRestore, kind: 'directory' }
  ])
}

async function inspectRestoreStaging(): Promise<CacheCleanupSizeSnapshot> {
  const { targets, issues } = await collectRestoreTargets()
  const measurement = await measurePaths(targets.map(({ item, path: targetPath }) => ({ item, path: targetPath })))
  return toSizeSnapshot(
    {
      bytes: measurement.bytes,
      issues: [...issues, ...measurement.issues]
    },
    'exact'
  )
}

async function inspectGroup(group: CacheCleanupGroup): Promise<CacheCleanupGroupInspection> {
  try {
    const size =
      group === 'normal_cache'
        ? await inspectNormalCache()
        : group === 'site_data'
          ? await inspectSiteData()
          : group === 'legacy_v1'
            ? await inspectLegacyV1()
            : await inspectRestoreStaging()
    return { group, size }
  } catch (error) {
    logger.error('Unexpected cache cleanup inspection failure', { group, error })
    return {
      group,
      size: toSizeSnapshot({ bytes: 0, issues: [issue(group, 'inspection_failed')] }, 'exact')
    }
  }
}

async function inspectCacheCleanup(groups: CacheCleanupGroup[]): Promise<CacheCleanupInspection> {
  return {
    results: await Promise.all(groups.map(inspectGroup))
  }
}

async function captureStep(item: string, operation: () => Promise<void>): Promise<CleanupStepResult> {
  try {
    await operation()
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Cache cleanup operation failed', { item, error })
    return { state: 'failed' }
  }
}

function clearSessionNormalCache(ses: Session, item: string): Promise<CleanupStepResult[]> {
  return Promise.all([
    captureStep(`${item}_http_cache`, () => ses.clearData({ dataTypes: ['cache'] })),
    captureStep(`${item}_code_cache`, () => ses.clearCodeCaches({})),
    captureStep(`${item}_shared_cache`, () => ses.clearStorageData({ storages: ['shadercache', 'cachestorage'] }))
  ])
}

async function resetTempDirectory(targetPath: string): Promise<void> {
  try {
    const stats = await fs.lstat(targetPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Application temp path is not a regular directory')
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error
  }
  await fs.rm(targetPath, { recursive: true, force: true })
  await fs.mkdir(targetPath, { recursive: true })
}

function resultFromSteps(group: CacheCleanupGroup, steps: CleanupStepResult[]): CacheCleanupGroupResult {
  const succeeded = steps.some(({ state }) => state === 'cleared' || state === 'not_found')
  const hasState = (state: CleanupStepResult['state']) => steps.some((step) => step.state === state)

  if (hasState('failed')) return { group, status: succeeded || hasState('skipped') ? 'partial' : 'failed' }
  if (hasState('skipped')) return { group, status: succeeded ? 'partial' : 'skipped' }
  return { group, status: hasState('cleared') ? 'cleared' : 'not_found' }
}

async function clearNormalCache(): Promise<CacheCleanupGroupResult> {
  const paths = getCleanupPaths()
  const [defaultSessionSteps, webviewSessionSteps, previewSessionSteps, tempStep, traceStep, legacyTraceStep] =
    await Promise.all([
      clearSessionNormalCache(session.defaultSession, 'default_session'),
      clearSessionNormalCache(session.fromPartition('persist:webview'), 'webview_session'),
      clearSessionNormalCache(session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION), 'html_artifact_preview_session'),
      captureStep('app_temp', () => resetTempDirectory(paths.appTemp)),
      captureStep('trace', () => application.get('TraceStorageService').cleanLocalData()),
      removeCleanupTarget({ item: 'legacy_trace', path: paths.legacyTrace, kind: 'directory' })
    ])
  return resultFromSteps('normal_cache', [
    ...defaultSessionSteps,
    ...webviewSessionSteps,
    ...previewSessionSteps,
    tempStep,
    traceStep,
    legacyTraceStep
  ])
}

async function clearSiteData(): Promise<CacheCleanupGroupResult> {
  const steps = await Promise.all([
    captureStep('default_session_cookies', () => session.defaultSession.clearData({ dataTypes: ['cookies'] })),
    captureStep('webview_site_data', () =>
      session.fromPartition('persist:webview').clearData({
        dataTypes: ['cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
      })
    ),
    captureStep('html_artifact_preview_site_data', () =>
      session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION).clearData({
        dataTypes: ['cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
      })
    )
  ])
  return resultFromSteps('site_data', steps)
}

async function removeCleanupTarget(target: CleanupTarget): Promise<CleanupStepResult> {
  const status = await inspectTarget(target.path, target.item, target.kind)
  if (status === 'missing') return { state: 'not_found' }
  if (status === 'invalid') return { state: 'skipped' }

  try {
    await fs.rm(target.path, { recursive: target.kind === 'directory', force: false })
    logger.info('Removed cleanup target', { item: target.item, path: target.path })
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Failed to remove cleanup target', { item: target.item, path: target.path, error })
    return { state: 'failed' }
  }
}

async function applyJsonMutation(mutation: JsonMutation): Promise<CleanupStepResult> {
  const fileStatus = await inspectTarget(mutation.path, mutation.item, 'file')
  if (fileStatus === 'missing') return { state: 'not_found' }
  if (fileStatus === 'invalid') {
    return { state: 'skipped' }
  }

  const tempPath = `${mutation.path}.cleanup.tmp`
  try {
    const currentRaw = await fs.readFile(mutation.path, 'utf8')
    if (currentRaw !== mutation.expectedRaw) {
      return { state: 'skipped' }
    }
    if (mutation.nextValue === null) {
      return removeCleanupTarget({ item: mutation.item, path: mutation.path, kind: 'file' })
    }
    await fs.writeFile(tempPath, `${JSON.stringify(mutation.nextValue, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.rename(tempPath, mutation.path)
    logger.info('Updated legacy shared config', { item: mutation.item, path: mutation.path })
    return { state: 'cleared' }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {})
    logger.error('Failed to update legacy shared config', { item: mutation.item, path: mutation.path, error })
    return { state: 'failed' }
  }
}

async function clearLegacyV1(): Promise<CacheCleanupGroupResult> {
  const plan = await collectLegacyCleanupPlan()
  const steps = await Promise.all([...plan.targets.map(removeCleanupTarget), ...plan.mutations.map(applyJsonMutation)])
  steps.push(...plan.issues.map(() => ({ state: 'skipped' as const })))
  return resultFromSteps('legacy_v1', steps)
}

async function clearRestoreStaging(): Promise<CacheCleanupGroupResult> {
  const { targets, issues } = await collectRestoreTargets()
  const steps = await Promise.all(targets.map(removeCleanupTarget))
  steps.push(...issues.map(() => ({ state: 'skipped' as const })))
  return resultFromSteps('restore_staging', steps)
}

async function runGroup(group: CacheCleanupGroup): Promise<CacheCleanupGroupResult> {
  try {
    if (group === 'normal_cache') return await clearNormalCache()
    if (group === 'site_data') return await clearSiteData()
    if (group === 'legacy_v1') return await clearLegacyV1()
    return await clearRestoreStaging()
  } catch (error) {
    logger.error('Unexpected cache cleanup group failure', { group, error })
    return resultFromSteps(group, [{ state: 'failed' }])
  }
}

async function runCacheCleanupNow(groups: CacheCleanupGroup[]): Promise<CacheCleanupRunResult> {
  const results: CacheCleanupGroupResult[] = []
  for (const group of groups) {
    results.push(await runGroup(group))
  }
  return { results }
}

class CacheCleanupService {
  private readonly cleanupMutex = new Mutex()

  public inspect(groups: CacheCleanupGroup[]): Promise<CacheCleanupInspection> {
    return inspectCacheCleanup(groups)
  }

  public run(groups: CacheCleanupGroup[]): Promise<CacheCleanupRunResult> {
    const requestedGroups = [...groups]
    return this.cleanupMutex.runExclusive(() => runCacheCleanupNow(requestedGroups))
  }
}

export const cacheCleanupService = new CacheCleanupService()
