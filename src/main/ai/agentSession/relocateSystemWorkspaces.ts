import { cp, lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import { RuntimeForkAnchorSchema } from '@data/services/agentSessionForkContract'
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
import {
  digestRelocationArtifact as digest,
  relocationArtifactExists as exists
} from '@main/ai/agents/agentRelocationFiles'
import {
  assertWorkspaceDirectoryIdentity,
  inspectWorkspaceStorage,
  validateWorkspaceArchive,
  validateWorkspaceContents,
  workspaceDirectoryIdentity,
  type WorkspaceStorageRecord
} from '@main/ai/agents/agentWorkspaceStorage'
import { agentWorkspaceStorageService } from '@main/ai/agents/AgentWorkspaceStorageService'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { RelocatedCheckpoint } from '@main/ai/runtime/workspaceRelocation'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('SystemWorkspaceRelocation')
const OperationSchema = z.union([
  z.strictObject({
    source: z.string(),
    target: z.string(),
    before: z.string().regex(/^[a-f0-9]{64}$/),
    after: z.string().regex(/^[a-f0-9]{64}$/)
  }),
  z.strictObject({ source: z.string(), before: z.string().regex(/^[a-f0-9]{64}$/) })
])
const JournalSchema = z.strictObject({
  version: z.literal(1),
  workspaceId: z.uuid(),
  oldPath: z.string(),
  newPath: z.string(),
  operations: z.array(OperationSchema)
})
type Journal = z.infer<typeof JournalSchema>

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

function artifactPath(root: string, relative: string, workspacePath: string): string {
  const segments = relative.split(/[\\/]/)
  if (segments.some((part) => !part || part === '.' || part === '..') || path.isAbsolute(relative)) {
    throw new Error('Invalid relocation artifact path')
  }
  const runtimeOwned = runtimeDriverRegistry
    .getAgentSessionDrivers()
    .some((driver) => driver.workspaceRelocation?.ownsArtifact(segments))
  // Older journals may still need to restore retired DSH artifacts.
  const dsh = segments.length === 4 && segments[0] === '.dsh' && segments[1] === 'sessions'
  const storage =
    path.join(...segments) === path.join('system', `${workspaceLayout(workspacePath).suffix}.storage.json`)
  if (!runtimeOwned && !dsh && !storage) throw new Error('Artifact is outside managed relocation storage')
  return path.join(root, ...segments)
}

async function reconcileCopiedStorage(root: string, oldPath: string, newPath: string, record: WorkspaceStorageRecord) {
  if (record.operation === 'purge' || !record.directory) return undefined
  let suffixes = ['']
  if (record.operation === 'archive') suffixes = record.phase === 'staging' ? ['', '.archiving'] : ['.archiving']
  else if (record.phase === 'preparing' && record.source === 'pending') suffixes = ['.archiving']
  else if (record.phase === 'prepared') {
    suffixes = [path.join('.restoring', record.operationId), '']
    if (record.source === 'pending') suffixes.push('.archiving')
  }
  for (const suffix of ['', '.archiving']) {
    if (!suffixes.includes(suffix) && (await exists(`${newPath}${suffix}`)))
      throw new Error('Workspace storage has unverified copies')
  }
  const candidates: string[] = []
  for (const suffix of suffixes) if (await exists(`${newPath}${suffix}`)) candidates.push(suffix)
  if (!candidates.length) return undefined
  if (candidates.length !== 1) throw new Error('Workspace storage has unverified copies')
  const suffix = candidates[0]
  const target = `${newPath}${suffix}`
  const identity = await workspaceDirectoryIdentity(root, target)
  if (JSON.stringify(identity) === JSON.stringify(record.directory)) return undefined

  // A copied inode is trusted only against the journal-owned source and identical contents.
  const oldRoot = workspaceLayout(oldPath).agents
  const source = `${oldPath}${suffix}`
  const original = await inspectWorkspaceStorage(oldRoot, oldPath)
  if (JSON.stringify(original?.record) !== JSON.stringify(record)) throw new Error('Workspace storage journal changed')
  await assertWorkspaceDirectoryIdentity(oldRoot, source, record.directory)
  await validateWorkspaceContents(source)
  await validateWorkspaceContents(target)
  if ((await digest(oldRoot, source)) !== (await digest(root, target)))
    throw new Error('Copied workspace contents changed')
  await assertWorkspaceDirectoryIdentity(oldRoot, source, record.directory)
  await assertWorkspaceDirectoryIdentity(root, target, identity)
  return { ...record, directory: identity }
}

async function recover(root: string, directory: string, journal: Journal): Promise<void> {
  if (workspaceLayout(journal.oldPath).suffix !== workspaceLayout(journal.newPath).suffix)
    throw new Error('Relocation workspace identity changed')
  if (path.basename(directory) !== journal.workspaceId) throw new Error('Invalid relocation journal owner')
  const workspace = agentWorkspaceService.getById(journal.workspaceId, { includeSystem: true })
  if (workspace.type !== 'system') throw new Error('Relocation workspace is no longer managed')
  const committed = workspace.path === journal.newPath
  if (!committed && workspace.path !== journal.oldPath) throw new Error('Relocation workspace changed')
  for (const [index, operation] of [...journal.operations.entries()].reverse()) {
    const source = artifactPath(root, operation.source, journal.newPath)
    const backup = path.join(directory, 'backup', String(index))
    const staged = path.join(directory, 'staged', String(index))
    if (!('target' in operation)) {
      for (const file of [source, backup]) await assertAgentStoragePath(root, file)
      if (await exists(backup)) {
        if ((await digest(root, backup)) !== operation.before) throw new Error('History backup changed')
        if (await exists(source)) throw new Error('Relocation source conflict')
        if (!committed) await rename(backup, source)
      } else if (committed ? await exists(source) : (await digest(root, source)) !== operation.before) {
        throw new Error('Relocation source changed')
      }
      continue
    }
    const target = artifactPath(root, operation.target, journal.newPath)
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
  agentWorkspaceStorageService.completeRelocation(journal.oldPath, journal.newPath)
}

async function relocate(root: string, workspace: { id: string; path: string }, newPath: string) {
  const oldDataRoot = workspaceLayout(workspace.path).agents
  const history = agentSessionMessageService.readWorkspaceRelocationHistory(workspace.id).map((row) => ({
    ...row,
    checkpoint: row.checkpoint ? RuntimeForkAnchorSchema.shape.checkpoint.parse(JSON.parse(row.checkpoint)) : undefined
  }))
  let relocatedStorage: WorkspaceStorageRecord | undefined
  const storage = await inspectWorkspaceStorage(root, newPath)
  if (storage?.record) {
    const record = storage.record
    if (!history.some((row) => row.sessionId === record.sessionId))
      throw new Error('Workspace operation belongs to another session')
    relocatedStorage = await reconcileCopiedStorage(root, workspace.path, newPath, record)
    if (relocatedStorage) storage.record = relocatedStorage
  }
  if (history.some((row) => row.messageId)) {
    if (!storage?.directory && !storage?.pending) {
      const record = storage?.record
      if (storage?.archive) await validateWorkspaceArchive(`${newPath}.tar.gz`)
      else if (
        record?.operation === 'restore' &&
        record.phase === 'prepared' &&
        record.source === 'pending' &&
        record.directory
      ) {
        await assertWorkspaceDirectoryIdentity(
          root,
          path.join(`${newPath}.restoring`, record.operationId),
          record.directory
        )
      } else throw new Error('Workspace storage missing')
    }
  } else await assertAgentStoragePath(root, newPath)
  const directory = path.join(root, '.relocation', workspace.id)
  if (await exists(directory)) throw new Error('Unresolved workspace relocation')
  await ensureAgentStorageDirectory(root, directory)
  const journal: Journal = { version: 1, workspaceId: workspace.id, oldPath: workspace.path, newPath, operations: [] }
  const journalPath = path.join(directory, 'journal.json')
  try {
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
            [operation.source, ...('target' in operation ? [operation.target] : [])].some((file) =>
              files.includes(file)
            )
          )
        ) {
          throw new Error('Runtime history belongs to an unfinished relocation')
        }
      }
    }
    async function stage(sources: readonly [string, ...string[]], target: string, prepared?: string) {
      const [source, ...additionalSources] = sources
      const sourceRelative = path.relative(root, source)
      const targetRelative = path.relative(root, target)
      artifactPath(root, sourceRelative, newPath)
      artifactPath(root, targetRelative, newPath)
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
      const operation = { source: sourceRelative, target: targetRelative, before, after }
      journal.operations.push(operation)
      for (const additional of additionalSources) {
        const relative = path.relative(root, additional)
        artifactPath(root, relative, newPath)
        await assertNoPendingRelocation(relative)
        const before = await digest(root, additional)
        const snapshot = path.join(directory, `source-${journal.operations.length}`)
        await cp(additional, snapshot, { recursive: true, force: false, errorOnExist: true })
        if ((await digest(root, snapshot)) !== before) throw new Error('Copied history changed')
        await mergeArtifacts(snapshot, staged)
        journal.operations.push({ source: relative, before })
      }
      operation.after = await digest(root, staged)
      return staged
    }
    async function mergeArtifacts(source: string, target: string): Promise<void> {
      for (const entry of await readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name)
        const to = path.join(target, entry.name)
        if (entry.isDirectory() && (await exists(to)) && (await lstat(to)).isDirectory()) {
          await mergeArtifacts(from, to)
        } else await cp(from, to, { recursive: true, force: false, errorOnExist: true })
      }
    }
    const retiredSessions = new Set(
      listRetiredAgentSessionMigrations(application.get('DbService').getDb()).map((migration) => migration.sessionId)
    )
    const checkpoints: RelocatedCheckpoint[] = []
    for (const driver of runtimeDriverRegistry.getAgentSessionDrivers()) {
      if (!driver.workspaceRelocation) continue
      checkpoints.push(
        ...(await driver.workspaceRelocation.prepare({
          oldPath: workspace.path,
          newPath,
          oldDataRoot,
          directory,
          history: history.filter((row) => !retiredSessions.has(row.sessionId)),
          stage,
          assertAvailable: (...files) => assertNoPendingRelocation(...files.map((file) => path.relative(root, file)))
        }))
      )
    }
    if (relocatedStorage) {
      const prepared = path.join(directory, 'storage.json')
      await atomicWriteFile(AbsoluteFilePathSchema.parse(prepared), JSON.stringify(relocatedStorage), { mode: 0o600 })
      await stage([`${newPath}.storage.json`], `${newPath}.storage.json`, prepared)
    }
    await atomicWriteFile(AbsoluteFilePathSchema.parse(journalPath), JSON.stringify(journal), { mode: 0o600 })
    for (const [index, operation] of journal.operations.entries()) {
      const source = artifactPath(root, operation.source, newPath)
      if ((await digest(root, source)) !== operation.before)
        throw new Error('Runtime history changed during relocation')
      if (!('target' in operation)) {
        await rename(source, path.join(directory, 'backup', String(index)))
        continue
      }
      const target = artifactPath(root, operation.target, newPath)
      await ensureAgentStorageDirectory(root, path.dirname(target))
      if (source !== target && (await exists(target))) throw new Error('Runtime history target conflict')
      await rename(source, path.join(directory, 'backup', String(index)))
      if (await exists(target)) throw new Error('Runtime history target conflict')
      await rename(path.join(directory, 'staged', String(index)), target)
    }
    application.get('DbService').withWriteTx((tx) => {
      agentWorkspaceService.relocateSystemWorkspaceTx(tx, workspace.id, workspace.path, newPath)
      agentSessionMessageService.relocateCheckpointsTx(tx, workspace.id, checkpoints)
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
    agentWorkspaceStorageService.blockRelocation(workspace.path)
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
