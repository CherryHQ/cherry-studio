import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { listRetiredAgentSessionMigrations } from '@data/services/retiredAgentRuntimeMigration'
import { loggerService } from '@logger'
import {
  assertAgentStorageDirectory,
  assertAgentStoragePath,
  ensureAgentStorageDirectory,
  removeAgentStorageSubdirectory
} from '@main/ai/agents/agentDataDirectory'
import { blockWorkspaceRelocation } from '@main/ai/runtime/agentSessionWorkspace'
import { runForkWorker } from '@main/ai/runtime/fork'
import { resolveResumeTokenSessionFile } from '@main/ai/runtime/pi/piSessionFile'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import type { RelocationWorkerInput } from './relocationWorker'

const logger = loggerService.withContext('SystemWorkspaceRelocation')
const OperationSchema = z.strictObject({
  source: z.string(),
  target: z.string(),
  before: z.string().regex(/^[a-f0-9]{64}$/),
  after: z.string().regex(/^[a-f0-9]{64}$/)
})
const JournalSchema = z.strictObject({
  version: z.literal(1),
  workspaceId: z.uuid(),
  oldPath: z.string(),
  newPath: z.string(),
  operations: z.array(OperationSchema)
})
type Journal = z.infer<typeof JournalSchema>

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function workspaceLayout(cwd: string) {
  if (!path.isAbsolute(cwd) || path.normalize(cwd) !== cwd) throw new Error('Invalid system workspace path')
  const id = path.basename(cwd)
  const date = path.basename(path.dirname(cwd))
  const system = path.dirname(path.dirname(cwd))
  const agents = path.dirname(system)
  if (
    !z.uuid().safeParse(id).success ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    path.basename(system) !== 'system' ||
    path.basename(agents) !== 'Agents' ||
    path.basename(path.dirname(agents)) !== 'Data'
  )
    throw new Error('Unrecognized system workspace layout')
  return { agents, suffix: path.join(date, id) }
}

/** Also validates every descendant before native readers or recursive copies see it. */
async function digest(root: string, file: string): Promise<string> {
  await assertAgentStoragePath(root, file)
  const hash = createHash('sha256')
  async function visit(current: string) {
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`Linked runtime history: ${current}`)
    hash.update(JSON.stringify(path.relative(file, current)))
    if (stat.isFile()) {
      hash.update('file')
      for await (const chunk of createReadStream(current)) hash.update(chunk)
    } else if (stat.isDirectory()) {
      hash.update('directory')
      for (const name of (await readdir(current)).sort()) await visit(path.join(current, name))
    } else throw new Error(`Unsupported runtime history: ${current}`)
  }
  await visit(file)
  return hash.digest('hex')
}

function artifactPath(root: string, relative: string): string {
  const segments = relative.split(/[\\/]/)
  if (segments.some((part) => !part || part === '.' || part === '..') || path.isAbsolute(relative)) {
    throw new Error('Invalid relocation artifact path')
  }
  const claude =
    segments[0] === '.claude' &&
    ((segments.length === 2 && segments[1] === '.claude.json') || (segments.length === 3 && segments[1] === 'projects'))
  // Older journals may still need to restore retired DSH artifacts.
  const dsh = segments.length === 4 && segments[0] === '.dsh' && segments[1] === 'sessions'
  if (!claude && !dsh) throw new Error('Artifact is outside managed runtime history')
  return path.join(root, ...segments)
}

async function recover(root: string, directory: string, journal: Journal): Promise<void> {
  workspaceLayout(journal.oldPath)
  workspaceLayout(journal.newPath)
  if (path.basename(directory) !== journal.workspaceId) throw new Error('Invalid relocation journal owner')
  const workspace = agentWorkspaceService.getById(journal.workspaceId, { includeSystem: true })
  if (workspace.type !== 'system') throw new Error('Relocation workspace is no longer managed')
  const committed = workspace.path === journal.newPath
  if (!committed && workspace.path !== journal.oldPath) throw new Error('Relocation workspace changed')
  for (const [index, operation] of [...journal.operations.entries()].reverse()) {
    const source = artifactPath(root, operation.source)
    const target = artifactPath(root, operation.target)
    const backup = path.join(directory, 'backup', String(index))
    const staged = path.join(directory, 'staged', String(index))
    for (const file of [source, target, backup, staged]) await assertAgentStoragePath(root, file)
    if (committed) {
      if ((await digest(root, target)) !== operation.after) throw new Error('Published history changed during recovery')
      if ((await exists(backup)) && (await digest(root, backup)) !== operation.before)
        throw new Error('History backup changed')
    } else if (await exists(backup)) {
      if ((await digest(root, backup)) !== operation.before) throw new Error('History backup changed')
      if (await exists(target)) {
        if ((await exists(staged)) || (await digest(root, target)) !== operation.after)
          throw new Error('Relocation target conflict')
        await rename(target, staged)
      }
      if (await exists(source)) throw new Error('Relocation source conflict')
      await rename(backup, source)
    } else if ((await digest(root, source)) !== operation.before) throw new Error('Relocation source changed')
  }
  // Once restoration/publication is verified, interrupted cleanup is safe to repeat.
  await atomicWriteFile(
    AbsoluteFilePathSchema.parse(path.join(directory, 'journal.json')),
    JSON.stringify({ ...journal, operations: [] }),
    { mode: 0o600 }
  )
  await removeAgentStorageSubdirectory(root, directory)
}

async function relocate(root: string, workspace: { id: string; path: string }, newPath: string) {
  const oldConfig = path.join(workspaceLayout(workspace.path).agents, '.claude')
  const newConfig = application.getPath('feature.agents.claude.root')
  const history = agentSessionMessageService.readWorkspaceRelocationHistory(workspace.id).map((row) => ({
    ...row,
    checkpoint: row.checkpoint ? (JSON.parse(row.checkpoint) as Record<string, unknown>) : undefined
  }))
  if (history.some((row) => row.messageId)) await assertAgentStorageDirectory(root, newPath)
  else await assertAgentStoragePath(root, newPath)
  const directory = path.join(root, '.relocation', workspace.id)
  if (await exists(directory)) throw new Error('Unresolved workspace relocation')
  await ensureAgentStorageDirectory(root, directory)
  const journal: Journal = { version: 1, workspaceId: workspace.id, oldPath: workspace.path, newPath, operations: [] }
  const journalPath = path.join(directory, 'journal.json')
  try {
    const { default: createWorker } = await import('./relocationWorker?nodeWorker')
    const workerData: RelocationWorkerInput = {
      oldCwd: workspace.path,
      newCwd: newPath
    }
    const result = z
      .strictObject({
        oldKey: z.string(),
        newKey: z.string()
      })
      .parse(await runForkWorker(createWorker({ workerData, env: { ...process.env } }), new AbortController().signal))
    await mkdir(path.join(directory, 'staged'))
    await mkdir(path.join(directory, 'backup'))
    async function assertNoPendingRelocation(...files: string[]) {
      for (const id of await readdir(path.dirname(directory))) {
        if (id === workspace.id) continue
        const pendingFile = path.join(path.dirname(directory), id, 'journal.json')
        await assertAgentStoragePath(root, pendingFile)
        if (!(await exists(pendingFile))) continue
        const pending = JournalSchema.parse(JSON.parse(await readFile(pendingFile, 'utf8')))
        if (
          pending.operations.some((operation) =>
            [operation.source, operation.target].some((file) => files.includes(file))
          )
        ) {
          throw new Error('Runtime history belongs to an unfinished relocation')
        }
      }
    }
    async function stage(source: string, target: string, prepared?: string) {
      const sourceRelative = path.relative(root, source)
      const targetRelative = path.relative(root, target)
      artifactPath(root, sourceRelative)
      artifactPath(root, targetRelative)
      await assertNoPendingRelocation(sourceRelative, targetRelative)
      await assertAgentStoragePath(root, target)
      if (source !== target && (await exists(target))) throw new Error(`Relocation target already exists: ${target}`)
      const before = await digest(root, source)
      const staged = path.join(directory, 'staged', String(journal.operations.length))
      if (prepared) {
        await digest(root, prepared)
        await rename(prepared, staged)
      } else await cp(source, staged, { recursive: true, force: false, errorOnExist: true })
      const after = await digest(root, staged)
      if (!prepared && after !== before) throw new Error('Copied history changed')
      journal.operations.push({ source: sourceRelative, target: targetRelative, before, after })
    }
    let oldProject = artifactPath(root, path.join('.claude', 'projects', result.oldKey))
    const newProject = artifactPath(root, path.join('.claude', 'projects', result.newKey))
    const entriesByFile = new Map<string, Array<Record<string, unknown>>>()
    async function readEntries(file: string) {
      const cached = entriesByFile.get(file)
      if (cached) return cached
      await digest(root, file)
      const entries = z.array(z.record(z.string(), z.unknown())).parse(
        (await readFile(file, 'utf8'))
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line))
      )
      entriesByFile.set(file, entries)
      return entries
    }
    if (await exists(oldProject)) {
      await digest(root, oldProject)
      if (oldProject !== newProject) await stage(oldProject, newProject)
    }
    const retiredSessions = new Set(
      listRetiredAgentSessionMigrations(application.get('DbService').getDb()).map((migration) => migration.sessionId)
    )
    const unflushedPiSessions = new Set<string>()
    for (const [sessionId, rows] of Map.groupBy(history, (row) => row.sessionId)) {
      // Manual /compact bypasses Pi's prompt persistence; an empty failure never creates history.
      if (
        rows.some((row) => row.role === 'user') &&
        rows.every(
          (row) =>
            row.runtime === 'pi' &&
            !row.checkpoint &&
            !row.nativeSessionId &&
            (!row.resumeToken || row.resumeToken === sessionId) &&
            (row.role === 'user'
              ? /^\/compact(?:\s|$)/.test(row.userText?.trim() ?? '')
              : row.role === 'assistant' && (row.status === 'error' || row.status === 'paused'))
        )
      ) {
        unflushedPiSessions.add(sessionId)
      }
    }
    const claudeConfigDirs = new Map<string, string>()
    for (const { sessionId, checkpoint } of history) {
      if (
        checkpoint?.runtime === 'claude-code' &&
        typeof checkpoint.runtimeSessionId === 'string' &&
        typeof checkpoint.configDir === 'string'
      ) {
        claudeConfigDirs.set(`${sessionId}:${checkpoint.runtimeSessionId}`, checkpoint.configDir)
      }
    }
    for (const row of history) {
      // Pi recovery rebuilds these histories from SQLite after workspace relocation.
      if (retiredSessions.has(row.sessionId)) continue
      const checkpoint = row.checkpoint
      const runtime = checkpoint?.runtime ?? row.runtime
      // nativeSessionId only initializes a new history; it need not have materialized on disk.
      const id = checkpoint?.runtimeSessionId ?? row.resumeToken
      if (typeof id !== 'string') continue
      if (runtime !== 'pi' && !z.uuid().safeParse(id).success) throw new Error('Invalid native session identity')
      if (runtime === 'pi') {
        const file = resolveResumeTokenSessionFile(id, application.getPath('feature.agents.pi.sessions'))
        if (!file && unflushedPiSessions.has(row.sessionId)) continue
        if (!file) throw new Error('Pi history missing')
        const entries = await readEntries(file)
        if (entries[0]?.type !== 'session' || entries[0]?.id !== id) throw new Error('Pi history corrupt')
      }
      const configDir = checkpoint?.configDir ?? claudeConfigDirs.get(`${row.sessionId}:${id}`)
      if (runtime === 'claude-code' && (!configDir || configDir === oldConfig)) {
        if (!(await exists(oldProject))) {
          // A removed symlinked ancestor can change the SDK key; persisted IDs still identify copied history.
          const projectsRoot = path.dirname(oldProject)
          await assertAgentStorageDirectory(root, projectsRoot)
          const candidates: string[] = []
          for (const project of await readdir(projectsRoot, { withFileTypes: true })) {
            if (!project.isDirectory() || project.isSymbolicLink()) continue
            const candidate = artifactPath(root, path.join('.claude', 'projects', project.name))
            await assertAgentStoragePath(root, candidate)
            if (await exists(path.join(candidate, id + '.jsonl'))) candidates.push(candidate)
            if (candidates.length > 1) throw new Error('Ambiguous Claude project history')
          }
          if (candidates[0] === newProject) throw new Error('Relocation target already exists')
          if (candidates.length) {
            oldProject = candidates[0]
            await stage(oldProject, newProject)
          }
        }
        const file = path.join(oldProject, id + '.jsonl')
        await assertAgentStoragePath(root, file)
        if (!(await exists(file))) throw new Error('Claude history missing')
        const entries = await readEntries(file)
        if (
          !entries.some(
            (entry) => entry.sessionId === id && entry.uuid && (entry.type === 'user' || entry.type === 'assistant')
          )
        )
          throw new Error('Claude history corrupt')
        if (checkpoint?.messageUuid && !entries.some((entry) => entry.uuid === checkpoint.messageUuid))
          throw new Error('Claude checkpoint history missing')
      }
    }
    const configFile = path.join(newConfig, '.claude.json')
    await assertNoPendingRelocation(path.relative(root, configFile))
    if (await exists(configFile)) {
      await digest(root, configFile)
      const config = JSON.parse(await readFile(configFile, 'utf8'))
      const projects = config.projects
      if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
        const keys = Object.keys(projects).filter(
          (key) => path.isAbsolute(key) && path.relative(key, workspace.path) === ''
        )
        if (keys.length > 1) throw new Error('Ambiguous Claude project configuration')
        if (keys.length) {
          if (Object.keys(projects).some((key) => path.isAbsolute(key) && path.relative(key, newPath) === ''))
            throw new Error('Claude project configuration conflict')
          projects[newPath] = projects[keys[0]]
          delete projects[keys[0]]
          const prepared = path.join(directory, 'config.json')
          await atomicWriteFile(AbsoluteFilePathSchema.parse(prepared), JSON.stringify(config), { mode: 0o600 })
          await stage(configFile, configFile, prepared)
        }
      }
    }
    await atomicWriteFile(AbsoluteFilePathSchema.parse(journalPath), JSON.stringify(journal), { mode: 0o600 })
    for (const [index, operation] of journal.operations.entries()) {
      const source = artifactPath(root, operation.source)
      const target = artifactPath(root, operation.target)
      if ((await digest(root, source)) !== operation.before)
        throw new Error('Runtime history changed during relocation')
      await ensureAgentStorageDirectory(root, path.dirname(target))
      if (source !== target && (await exists(target))) throw new Error('Runtime history target conflict')
      await rename(source, path.join(directory, 'backup', String(index)))
      if (await exists(target)) throw new Error('Runtime history target conflict')
      await rename(path.join(directory, 'staged', String(index)), target)
    }
    application.get('DbService').withWriteTx((tx) => {
      agentWorkspaceService.relocateSystemWorkspaceTx(tx, workspace.id, workspace.path, newPath)
      agentSessionMessageService.relocateClaudeConfigTx(tx, workspace.id, oldConfig, newConfig)
    })
    await recover(root, directory, journal)
  } catch (error) {
    if (await exists(journalPath)) await recover(root, directory, journal)
    else await removeAgentStorageSubdirectory(root, directory)
    throw error
  }
}

/** Runs before any runtime can resume or reuse a system workspace placeholder. */
export async function relocateSystemWorkspaces(): Promise<Set<string>> {
  const root = application.getPath('feature.agents.data')
  const systemRoot = application.getPath('feature.agents.system_workspaces')
  const recoveryRoot = path.join(root, '.relocation')
  const protectedSessions = new Set<string>()
  const workspaces = agentWorkspaceService.list({ includeSystem: true })
  function failed(workspaceId: string, error: unknown) {
    logger.error('Failed to relocate system workspace; original history retained', { workspaceId, error })
    const workspace = agentWorkspaceService.getById(workspaceId, { includeSystem: true })
    blockWorkspaceRelocation(workspace.path, error)
    for (const row of agentSessionMessageService.readWorkspaceRelocationHistory(workspaceId))
      protectedSessions.add(row.sessionId)
  }
  try {
    await assertAgentStorageDirectory(root, root)
    if (await exists(recoveryRoot)) {
      await assertAgentStorageDirectory(root, recoveryRoot)
      for (const id of await readdir(recoveryRoot)) {
        try {
          if (!z.uuid().safeParse(id).success) throw new Error('Invalid relocation directory')
          const directory = path.join(recoveryRoot, id)
          const file = path.join(directory, 'journal.json')
          await assertAgentStoragePath(root, file)
          if (await exists(file))
            await recover(root, directory, JournalSchema.parse(JSON.parse(await readFile(file, 'utf8'))))
          else await removeAgentStorageSubdirectory(root, directory)
        } catch (error) {
          try {
            failed(id, error)
          } catch {
            logger.error('Invalid workspace relocation journal', { workspaceId: id, error })
          }
        }
      }
    }
  } catch (error) {
    for (const workspace of workspaces) {
      if (workspace.type === 'system') failed(workspace.id, error)
    }
    return protectedSessions
  }
  for (const workspace of workspaces) {
    if (workspace.type !== 'system') continue
    const relative = path.relative(systemRoot, workspace.path)
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) continue
    try {
      const { suffix } = workspaceLayout(workspace.path)
      await relocate(root, workspace, path.join(systemRoot, suffix))
      logger.info('Relocated system workspace', { workspaceId: workspace.id })
    } catch (error) {
      failed(workspace.id, error)
    }
  }
  return protectedSessions
}
