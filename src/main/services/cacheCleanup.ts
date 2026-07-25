import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { bootConfigService } from '@data/bootConfig'
import { appStateTable } from '@data/db/schemas/appState'
import { loggerService } from '@logger'
import { getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'
import type {
  CacheCleanupGroup,
  CacheCleanupGroupInspection,
  CacheCleanupGroupResult,
  CacheCleanupInspection,
  CacheCleanupIssue,
  CacheCleanupRunResult,
  CacheCleanupSizeAccuracy,
  CacheCleanupSizeSnapshot
} from '@shared/types/cacheCleanup'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { type Session, session } from 'electron'

const logger = loggerService.withContext('CacheCleanup')

const MIGRATION_V2_STATUS_KEY = 'migration_v2_status'
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const
const MAX_SIZE_SCAN_DEPTH = 64
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

const LEGACY_WINDOW_STATE_KEYS = new Set(['x', 'y', 'width', 'height', 'isMaximized', 'isFullScreen', 'displayBounds'])

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

interface SizeMeasurement {
  bytes: number
  failed: boolean
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
  issue?: CacheCleanupIssue
}

function issue(item: string, code: CacheCleanupIssue['code']): CacheCleanupIssue {
  return { item, code }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function childPath(root: string, ...segments: string[]): string {
  return path.join(root, ...segments)
}

function isPathWithin(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return (
    relativePath === '' ||
    (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`))
  )
}

async function pathHasSymlinkedOwnedSegment(targetPath: string): Promise<boolean> {
  const trustedRoots = [
    application.getPath('app.userdata'),
    application.getPath('cherry.config'),
    application.getPath('cherry.home')
  ]
    .filter((rootPath) => isPathWithin(targetPath, rootPath))
    .sort((left, right) => right.length - left.length)
  const trustedRoot = trustedRoots[0]
  if (!trustedRoot) return true

  const relativePath = path.relative(path.resolve(trustedRoot), path.resolve(targetPath))
  let currentPath = trustedRoot
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = childPath(currentPath, segment)
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
    legacyMemory: childPath(data, 'Memory', 'memories.db'),
    rootLegacyMemory: application.getPath('app.userdata', 'memories.db'),
    indexedDbRestore: application.getPath('app.userdata', 'IndexedDB.restore'),
    localStorageRestore: application.getPath('app.userdata', 'Local Storage.restore'),
    dataRestore: application.getPath('app.userdata', 'Data.restore')
  }
}

function mergeMeasurements(measurements: SizeMeasurement[]): SizeMeasurement {
  return measurements.reduce<SizeMeasurement>(
    (result, measurement) => ({
      bytes: result.bytes + measurement.bytes,
      failed: result.failed || measurement.failed,
      issues: [...result.issues, ...measurement.issues]
    }),
    { bytes: 0, failed: false, issues: [] }
  )
}

function toSizeSnapshot(measurement: SizeMeasurement, accuracy: CacheCleanupSizeAccuracy): CacheCleanupSizeSnapshot {
  const allUnavailable = measurement.failed && measurement.bytes === 0
  return {
    bytes: allUnavailable ? null : measurement.bytes,
    accuracy: allUnavailable ? 'unavailable' : accuracy,
    completeness: measurement.failed ? 'partial' : 'complete',
    issues: measurement.issues
  }
}

async function measurePath(
  targetPath: string,
  item: string,
  excludedPaths: ReadonlySet<string> = new Set(),
  depth = 0
): Promise<SizeMeasurement> {
  if (depth > MAX_SIZE_SCAN_DEPTH) {
    return { bytes: 0, failed: true, issues: [issue(item, 'inspection_failed')] }
  }

  const resolvedPath = path.resolve(targetPath)
  if (excludedPaths.has(resolvedPath)) {
    return { bytes: 0, failed: false, issues: [] }
  }

  let stats
  try {
    stats = await fs.lstat(targetPath)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return { bytes: 0, failed: false, issues: [] }
    }
    logger.warn('Failed to inspect cleanup target size', { item, path: targetPath, error })
    return { bytes: 0, failed: true, issues: [issue(item, 'inspection_failed')] }
  }

  if (stats.isSymbolicLink()) {
    logger.warn('Skipped symlink while inspecting cleanup target', { item, path: targetPath })
    return { bytes: 0, failed: true, issues: [issue(item, 'unsafe_target')] }
  }

  if (stats.isFile()) {
    return { bytes: stats.size, failed: false, issues: [] }
  }

  if (!stats.isDirectory()) {
    return { bytes: 0, failed: true, issues: [issue(item, 'unsafe_target')] }
  }

  let entries
  try {
    entries = await fs.readdir(targetPath)
  } catch (error) {
    logger.warn('Failed to read cleanup target directory', { item, path: targetPath, error })
    return { bytes: 0, failed: true, issues: [issue(item, 'inspection_failed')] }
  }

  const result: SizeMeasurement = { bytes: 0, failed: false, issues: [] }
  for (const entry of entries) {
    const child = await measurePath(childPath(targetPath, entry), item, excludedPaths, depth + 1)
    result.bytes += child.bytes
    result.failed ||= child.failed
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
        measurePath(targetPath, item, excludedPaths ?? new Set())
      )
    )
  )
}

async function measureSessionCache(ses: Session, item: string): Promise<SizeMeasurement> {
  try {
    const bytes = await ses.getCacheSize()
    return { bytes, failed: false, issues: [] }
  } catch (error) {
    logger.warn('Failed to query Electron session cache size', { item, error })
    return { bytes: 0, failed: true, issues: [issue(item, 'inspection_failed')] }
  }
}

async function inspectNormalCache(): Promise<CacheCleanupSizeSnapshot> {
  const paths = getCleanupPaths()
  const sessions = [
    { item: 'default_session', root: paths.defaultSession, value: session.defaultSession },
    { item: 'webview_session', root: paths.webviewSession, value: session.fromPartition('persist:webview') }
  ]

  const electronMeasurements = await Promise.all(sessions.map(({ item, value }) => measureSessionCache(value, item)))
  const diskTargets = sessions.flatMap(({ item, root }) =>
    NORMAL_CACHE_RELATIVE_PATHS.map((relativePath) => ({
      item,
      path: childPath(root, relativePath)
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
      path: childPath(paths.defaultSession, relativePath)
    })
  )

  targets.push(
    ...COOKIE_RELATIVE_PATHS.map((relativePath) => ({
      item: 'webview_cookies',
      path: childPath(paths.webviewSession, relativePath)
    })),
    { item: 'webview_local_storage', path: childPath(paths.webviewSession, 'Local Storage') },
    { item: 'webview_indexeddb', path: childPath(paths.webviewSession, 'IndexedDB') },
    { item: 'webview_file_system', path: childPath(paths.webviewSession, 'File System') },
    {
      item: 'webview_service_workers',
      path: childPath(paths.webviewSession, 'Service Worker'),
      excludedPaths: new Set([path.resolve(childPath(paths.webviewSession, 'Service Worker', 'CacheStorage'))])
    },
    { item: 'webview_websql', path: childPath(paths.webviewSession, 'databases') }
  )

  return toSizeSnapshot(await measurePaths(targets), 'estimated')
}

function isMigrationCompleted(): boolean {
  try {
    const db = application.get('DbService').getDb()
    const row = db
      .select({ value: appStateTable.value })
      .from(appStateTable)
      .where(eq(appStateTable.key, MIGRATION_V2_STATUS_KEY))
      .get()
    return isRecord(row?.value) && row.value.status === 'completed'
  } catch (error) {
    logger.warn('Failed to read v2 migration status', error as Error)
    return false
  }
}

async function inspectRegularFile(targetPath: string, item: string): Promise<'missing' | 'valid' | 'invalid'> {
  try {
    if (await pathHasSymlinkedOwnedSegment(targetPath)) {
      logger.warn('Legacy cleanup target contains a symbolic-link path segment', { item, path: targetPath })
      return 'invalid'
    }
    const stats = await fs.lstat(targetPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      logger.warn('Legacy cleanup target is not a regular file', { item, path: targetPath })
      return 'invalid'
    }
    return 'valid'
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return 'missing'
    logger.warn('Failed to inspect legacy cleanup file', { item, path: targetPath, error })
    return 'invalid'
  }
}

async function inspectDirectory(targetPath: string, item: string): Promise<'missing' | 'valid' | 'invalid'> {
  try {
    if (await pathHasSymlinkedOwnedSegment(targetPath)) {
      logger.warn('Legacy cleanup target contains a symbolic-link path segment', { item, path: targetPath })
      return 'invalid'
    }
    const stats = await fs.lstat(targetPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      logger.warn('Legacy cleanup target is not a regular directory', { item, path: targetPath })
      return 'invalid'
    }
    return 'valid'
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return 'missing'
    logger.warn('Failed to inspect legacy cleanup directory', { item, path: targetPath, error })
    return 'invalid'
  }
}

async function directoryTreeHasUnsafeEntry(targetPath: string, depth = 0): Promise<boolean> {
  if (depth > MAX_SIZE_SCAN_DEPTH) return true

  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) return true
    if (entry.isDirectory() && (await directoryTreeHasUnsafeEntry(childPath(targetPath, entry.name), depth + 1))) {
      return true
    }
  }
  return false
}

async function readJsonFile(
  targetPath: string,
  item: string
): Promise<
  { status: 'missing' } | { status: 'invalid' } | { status: 'valid'; raw: string; value: unknown; size: number }
> {
  const fileStatus = await inspectRegularFile(targetPath, item)
  if (fileStatus !== 'valid') {
    return { status: fileStatus }
  }

  try {
    const raw = await fs.readFile(targetPath, 'utf8')
    return {
      status: 'valid',
      raw,
      value: JSON.parse(raw),
      size: Buffer.byteLength(raw)
    }
  } catch (error) {
    logger.warn('Failed to parse legacy cleanup JSON', { item, path: targetPath, error })
    return { status: 'invalid' }
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
    const status = await inspectRegularFile(sidecarPath, item)
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
      inspectRegularFile(`${left}${suffix}`, 'legacy_agents_database'),
      inspectRegularFile(`${right}${suffix}`, 'legacy_agents_root_duplicate')
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

function validWindowState(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => !LEGACY_WINDOW_STATE_KEYS.has(key))) return false
  if (
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height)
  ) {
    return false
  }
  if (value.x !== undefined && (typeof value.x !== 'number' || !Number.isFinite(value.x))) return false
  if (value.y !== undefined && (typeof value.y !== 'number' || !Number.isFinite(value.y))) return false
  if (value.isMaximized !== undefined && typeof value.isMaximized !== 'boolean') return false
  if (value.isFullScreen !== undefined && typeof value.isFullScreen !== 'boolean') return false
  if (value.displayBounds !== undefined) {
    const bounds = value.displayBounds
    if (
      !isRecord(bounds) ||
      !['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]))
    ) {
      return false
    }
  }
  return true
}

async function collectLegacyConfig(plan: LegacyCleanupPlan, targetPath: string): Promise<void> {
  const item = 'legacy_config'
  const status = await inspectRegularFile(targetPath, item)
  if (status === 'missing') return
  if (status === 'invalid') {
    plan.issues.push(issue(item, 'unsafe_target'))
    return
  }
  plan.targets.push({ item, path: targetPath, kind: 'file' })
}

async function collectWindowState(plan: LegacyCleanupPlan, targetPath: string): Promise<void> {
  const item = `legacy_window_state:${path.basename(targetPath)}`
  const result = await readJsonFile(targetPath, item)
  if (result.status === 'missing') return
  if (result.status === 'invalid' || !validWindowState(result.value)) {
    plan.issues.push(issue(item, 'invalid_data'))
    return
  }
  plan.targets.push({ item, path: targetPath, kind: 'file' })
}

async function collectCustomMiniApps(plan: LegacyCleanupPlan, targetPath: string): Promise<void> {
  const item = 'legacy_custom_mini_apps'
  const result = await readJsonFile(targetPath, item)
  if (result.status === 'missing') return
  if (result.status === 'invalid' || !Array.isArray(result.value)) {
    plan.issues.push(issue(item, 'invalid_data'))
    return
  }
  plan.targets.push({ item, path: targetPath, kind: 'file' })
}

async function collectAgentsDatabases(
  plan: LegacyCleanupPlan,
  legacyAgentsPath: string,
  rootLegacyAgentsPath: string
): Promise<void> {
  const item = 'legacy_agents_database'
  const fileStatus = await inspectRegularFile(legacyAgentsPath, item)
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

  const rootStatus = await inspectRegularFile(rootLegacyAgentsPath, 'legacy_agents_root_duplicate')
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
  const status = await inspectRegularFile(targetPath, item)
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
  const rootStatus = await inspectDirectory(knowledgeRoot, 'legacy_knowledge_databases')
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

    const targetPath = childPath(knowledgeRoot, entry.name)
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

function comparablePath(value: string): string {
  return path.normalize(path.resolve(value))
}

async function collectLegacyHomeConfig(plan: LegacyCleanupPlan, targetPath: string): Promise<void> {
  const item = 'legacy_home_config'
  const result = await readJsonFile(targetPath, item)
  if (result.status === 'missing') return
  if (result.status === 'invalid' || !isRecord(result.value)) {
    plan.issues.push(issue(item, 'invalid_data'))
    return
  }

  const appDataPath = result.value.appDataPath
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
      (entry) => typeof entry.dataPath !== 'string' || comparablePath(entry.dataPath) !== comparablePath(migratedPath)
    )
  ) {
    return
  }

  const remainingEntries = appDataPath.filter((entry) => !isRecord(entry) || entry.executablePath !== executablePath)
  const nextValue = { ...result.value, appDataPath: remainingEntries }

  if (remainingEntries.length === 0 && Object.keys(nextValue).length === 1) {
    plan.mutations.push({
      item,
      path: targetPath,
      expectedRaw: result.raw,
      nextValue: null,
      estimatedBytes: result.size
    })
    return
  }

  const nextText = `${JSON.stringify(nextValue, null, 2)}\n`
  plan.mutations.push({
    item,
    path: targetPath,
    expectedRaw: result.raw,
    nextValue,
    estimatedBytes: Math.max(0, result.size - Buffer.byteLength(nextText))
  })
}

async function collectLegacyCleanupPlan(): Promise<LegacyCleanupPlan> {
  const paths = getCleanupPaths()
  const plan: LegacyCleanupPlan = { targets: [], mutations: [], issues: [] }

  await Promise.all([
    collectLegacyConfig(plan, paths.legacyConfig),
    ...paths.legacyWindowStates.map((targetPath) => collectWindowState(plan, targetPath)),
    collectCustomMiniApps(plan, paths.customMiniApps),
    collectAgentsDatabases(plan, paths.legacyAgents, paths.rootLegacyAgents),
    collectMemoryDatabase(plan, paths.legacyMemory, 'legacy_memory_database'),
    collectMemoryDatabase(plan, paths.rootLegacyMemory, 'legacy_root_memory_database'),
    collectKnowledgeDatabases(plan, paths.knowledge),
    collectLegacyHomeConfig(plan, paths.homeConfig)
  ])

  const legacyDirectories = [
    { item: 'legacy_migration_temp', path: paths.migrationTemp },
    { item: 'legacy_cli_install', path: paths.legacyCliInstall }
  ] as const
  for (const target of legacyDirectories) {
    const status = await inspectDirectory(target.path, target.item)
    if (status === 'valid') {
      try {
        if (await directoryTreeHasUnsafeEntry(target.path)) {
          plan.issues.push(issue(target.item, 'unsafe_target'))
        } else {
          plan.targets.push({ ...target, kind: 'directory' })
        }
      } catch (error) {
        logger.warn('Failed to validate legacy directory contents', { item: target.item, path: target.path, error })
        plan.issues.push(issue(target.item, 'inspection_failed'))
      }
    } else if (status === 'invalid') {
      plan.issues.push(issue(target.item, 'unsafe_target'))
    }
  }

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
      failed: targetMeasurement.failed || plan.issues.length > 0,
      issues: [...plan.issues, ...targetMeasurement.issues]
    },
    'estimated'
  )
}

async function collectRestoreTargets(): Promise<{ targets: CleanupTarget[]; issues: CacheCleanupIssue[] }> {
  const paths = getCleanupPaths()
  const candidates = [
    { item: 'restore_indexeddb', path: paths.indexedDbRestore },
    { item: 'restore_local_storage', path: paths.localStorageRestore },
    { item: 'restore_data', path: paths.dataRestore }
  ] as const
  const inspected = await Promise.all(
    candidates.map(async ({ item, path: targetPath }) => {
      const status = await inspectDirectory(targetPath, item)
      if (status === 'missing') return {}
      if (status === 'invalid') return { issue: issue(item, 'unsafe_target') }
      return { target: { item, path: targetPath, kind: 'directory' as const } }
    })
  )

  return {
    targets: inspected.flatMap(({ target }) => (target ? [target] : [])),
    issues: inspected.flatMap(({ issue: targetIssue }) => (targetIssue ? [targetIssue] : []))
  }
}

async function inspectRestoreStaging(): Promise<CacheCleanupSizeSnapshot> {
  const { targets, issues } = await collectRestoreTargets()
  const measurement = await measurePaths(targets.map(({ item, path: targetPath }) => ({ item, path: targetPath })))
  return toSizeSnapshot(
    {
      bytes: measurement.bytes,
      failed: measurement.failed || issues.length > 0,
      issues: [...issues, ...measurement.issues]
    },
    'exact'
  )
}

async function inspectGroup(
  group: CacheCleanupGroup,
  migrationCompleted: boolean
): Promise<CacheCleanupGroupInspection> {
  const requiresMigration = group === 'legacy_v1' || group === 'restore_staging'
  const allowed = !requiresMigration || migrationCompleted

  if (!allowed) {
    return {
      group,
      allowed: false,
      blockedReason: 'migration_incomplete',
      size: {
        bytes: null,
        accuracy: 'unavailable',
        completeness: 'partial',
        issues: [issue(group, 'migration_incomplete')]
      }
    }
  }

  try {
    const size =
      group === 'normal_cache'
        ? await inspectNormalCache()
        : group === 'site_data'
          ? await inspectSiteData()
          : group === 'legacy_v1'
            ? await inspectLegacyV1()
            : await inspectRestoreStaging()
    return { group, size, allowed: true }
  } catch (error) {
    logger.error('Unexpected cache cleanup inspection failure', { group, error })
    return {
      group,
      allowed: true,
      size: {
        bytes: null,
        accuracy: 'unavailable',
        completeness: 'partial',
        issues: [issue(group, 'inspection_failed')]
      }
    }
  }
}

export async function inspectCacheCleanup(groups: CacheCleanupGroup[]): Promise<CacheCleanupInspection> {
  const migrationCompleted = isMigrationCompleted()
  return {
    migrationStatus: migrationCompleted ? 'completed' : 'incomplete',
    results: await Promise.all(groups.map((group) => inspectGroup(group, migrationCompleted)))
  }
}

async function captureStep(item: string, operation: () => Promise<void>): Promise<CleanupStepResult> {
  try {
    await operation()
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Cache cleanup operation failed', { item, error })
    return { state: 'failed', issue: issue(item, 'operation_failed') }
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
  const issues = steps.flatMap(({ issue: stepIssue }) => (stepIssue ? [stepIssue] : []))
  const cleared = steps.filter(({ state }) => state === 'cleared').length
  const notFound = steps.filter(({ state }) => state === 'not_found').length
  const skipped = steps.filter(({ state }) => state === 'skipped').length
  const failed = steps.filter(({ state }) => state === 'failed').length

  let status: CacheCleanupGroupResult['status']
  if (failed > 0) {
    status = cleared > 0 || notFound > 0 || skipped > 0 ? 'partial' : 'failed'
  } else if (skipped > 0) {
    status = cleared > 0 || notFound > 0 ? 'partial' : 'skipped'
  } else if (cleared > 0) {
    status = 'cleared'
  } else {
    status = 'not_found'
  }

  return { group, status, issues }
}

async function clearNormalCache(): Promise<CacheCleanupGroupResult> {
  const paths = getCleanupPaths()
  const [defaultSessionSteps, webviewSessionSteps, tempStep, traceStep, legacyTraceStep] = await Promise.all([
    clearSessionNormalCache(session.defaultSession, 'default_session'),
    clearSessionNormalCache(session.fromPartition('persist:webview'), 'webview_session'),
    captureStep('app_temp', () => resetTempDirectory(paths.appTemp)),
    captureStep('trace', () => application.get('TraceStorageService').cleanLocalData()),
    removeCleanupTarget({ item: 'legacy_trace', path: paths.legacyTrace, kind: 'directory' })
  ])
  return resultFromSteps('normal_cache', [
    ...defaultSessionSteps,
    ...webviewSessionSteps,
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
    )
  ])
  return resultFromSteps('site_data', steps)
}

async function removeCleanupTarget(target: CleanupTarget): Promise<CleanupStepResult> {
  const status =
    target.kind === 'file'
      ? await inspectRegularFile(target.path, target.item)
      : await inspectDirectory(target.path, target.item)
  if (status === 'missing') return { state: 'not_found' }
  if (status === 'invalid') return { state: 'skipped', issue: issue(target.item, 'unsafe_target') }

  try {
    await fs.rm(target.path, { recursive: target.kind === 'directory', force: false })
    logger.info('Removed cleanup target', { item: target.item, path: target.path })
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Failed to remove cleanup target', { item: target.item, path: target.path, error })
    return { state: 'failed', issue: issue(target.item, 'operation_failed') }
  }
}

async function applyJsonMutation(mutation: JsonMutation): Promise<CleanupStepResult> {
  const fileStatus = await inspectRegularFile(mutation.path, mutation.item)
  if (fileStatus === 'missing') return { state: 'not_found' }
  if (fileStatus === 'invalid') {
    return { state: 'skipped', issue: issue(mutation.item, 'unsafe_target') }
  }

  const tempPath = `${mutation.path}.cleanup.tmp`
  try {
    const currentRaw = await fs.readFile(mutation.path, 'utf8')
    if (currentRaw !== mutation.expectedRaw) {
      return { state: 'skipped', issue: issue(mutation.item, 'unsafe_target') }
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
    return { state: 'failed', issue: issue(mutation.item, 'operation_failed') }
  }
}

async function clearLegacyV1(): Promise<CacheCleanupGroupResult> {
  if (!isMigrationCompleted()) {
    return {
      group: 'legacy_v1',
      status: 'skipped',
      issues: [issue('legacy_v1', 'migration_incomplete')]
    }
  }

  const plan = await collectLegacyCleanupPlan()
  const steps = await Promise.all([...plan.targets.map(removeCleanupTarget), ...plan.mutations.map(applyJsonMutation)])
  steps.push(...plan.issues.map((targetIssue) => ({ state: 'skipped' as const, issue: targetIssue })))
  return resultFromSteps('legacy_v1', steps)
}

async function clearRestoreStaging(): Promise<CacheCleanupGroupResult> {
  if (!isMigrationCompleted()) {
    return {
      group: 'restore_staging',
      status: 'skipped',
      issues: [issue('restore_staging', 'migration_incomplete')]
    }
  }

  const { targets, issues } = await collectRestoreTargets()
  const steps = await Promise.all(targets.map(removeCleanupTarget))
  steps.push(...issues.map((targetIssue) => ({ state: 'skipped' as const, issue: targetIssue })))
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
    return {
      group,
      status: 'failed',
      issues: [issue(group, 'operation_failed')]
    }
  }
}

async function runCacheCleanupNow(groups: CacheCleanupGroup[]): Promise<CacheCleanupRunResult> {
  const results: CacheCleanupGroupResult[] = []
  for (const group of groups) {
    results.push(await runGroup(group))
  }
  return { results }
}

let cleanupQueue: Promise<void> = Promise.resolve()

export function runCacheCleanup(groups: CacheCleanupGroup[]): Promise<CacheCleanupRunResult> {
  const requestedGroups = [...groups]
  const cleanup = cleanupQueue.then(() => runCacheCleanupNow(requestedGroups))
  cleanupQueue = cleanup.then(
    () => undefined,
    () => undefined
  )
  return cleanup
}
