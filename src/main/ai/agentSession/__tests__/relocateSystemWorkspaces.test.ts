import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { cp, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { queueRetiredAgentRuntimeMigration } from '@data/services/retiredAgentRuntimeMigration'
import * as workspaceStorage from '@main/ai/agents/agentWorkspaceStorage'
import { agentWorkspaceStorageService } from '@main/ai/agents/AgentWorkspaceStorageService'
import { assertAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { runForkWorker } from '@main/ai/runtime/fork'
import { loadPiAi, loadPiSdk } from '@main/ai/runtime/pi/piSdk'
import { resolveResumeTokenSessionFile } from '@main/ai/runtime/pi/piSessionFile'
import { migrateRetiredSessionHistories } from '@main/ai/runtime/pi/retiredSessionHistory'
import { registerRuntimeDrivers } from '@main/ai/runtime/registerDrivers'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'

import { AgentSessionMessageBackend } from '../persistence/AgentSessionMessageBackend'
import { relocateSystemWorkspaces } from '../relocateSystemWorkspaces'

const workerMocks = vi.hoisted(() => ({
  source: undefined as string | undefined,
  keys: undefined as { oldKey: string; newKey: string } | undefined
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AgentSessionRuntimeService: {
      cancelSessionForks: vi.fn().mockResolvedValue(undefined),
      closeSessionForArchive: vi.fn().mockResolvedValue(undefined)
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

// Keep filesystem publication and database recovery real; isolate only the native SDK worker.
vi.mock('../../runtime/claudeCode/relocationWorker?nodeWorker', async () => {
  const { EventEmitter } = await import('node:events')
  const { basename } = await import('node:path')
  const { Worker } = await import('node:worker_threads')
  return {
    default: ({ workerData }: { workerData: { oldCwd: string; newCwd: string } }) => {
      if (workerMocks.source)
        return new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerMocks.source)}`), { workerData })
      const worker = Object.assign(new EventEmitter(), { terminate: async () => 0 })
      setImmediate(() =>
        worker.emit('message', {
          result: workerMocks.keys ?? {
            oldKey: `old-${basename(workerData.oldCwd)}`,
            newKey: `new-${basename(workerData.newCwd)}`
          }
        })
      )
      return worker
    }
  }
})

describe('system workspace relocation', () => {
  const dbh = setupTestDatabase()
  let temporaryRoot: string
  let root: string

  beforeEach(async () => {
    registerRuntimeDrivers()
    workerMocks.source = undefined
    workerMocks.keys = undefined
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'cs-relocation-'))
    root = path.join(temporaryRoot, 'new', 'Data', 'Agents')
    await mkdir(root, { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const paths: Record<string, string> = {
        'feature.agents.data': root,
        'feature.agents.system_workspaces': path.join(root, 'system'),
        'feature.agents.claude.root': path.join(root, '.claude'),
        'feature.agents.pi.sessions': path.join(root, '.pi', 'sessions')
      }
      const value = paths[key]
      if (!value) throw new Error(`Unexpected path: ${key}`)
      return filename ? path.join(value, filename) : value
    })
  })

  afterEach(async () => {
    runtimeDriverRegistry.clearForTest()
    vi.restoreAllMocks()
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  async function createWorkspace(runtime: 'claude-code' | 'pi' | 'dsh') {
    const id = randomUUID()
    const sessionId = randomUUID()
    const agentId = randomUUID()
    const suffix = path.join('2026-10-09', id)
    const oldPath = path.join(temporaryRoot, 'old', 'Data', 'Agents', 'system', suffix)
    const newPath = path.join(root, 'system', suffix)
    await mkdir(newPath, { recursive: true })
    dbh.db
      .insert(agentTable)
      .values({ id: agentId, type: runtime, name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id, name: 'Workspace', type: 'system', path: oldPath, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, agentId, workspaceId: id, name: 'Session', orderKey: 'a0' })
      .run()
    return { id, sessionId, agentId, oldPath, newPath }
  }

  function workspacePath(id: string) {
    return dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, id)).get()!.path
  }

  async function writeHistory(
    runtime: 'claude-code' | 'pi',
    workspaceId: string,
    nativeId: string,
    projectKey = `old-${workspaceId}`
  ) {
    const file =
      runtime === 'claude-code'
        ? path.join(root, '.claude', 'projects', projectKey, `${nativeId}.jsonl`)
        : path.join(root, '.pi', 'sessions', `2026-10-09_${nativeId}.jsonl`)
    const entry =
      runtime === 'claude-code'
        ? { type: 'assistant', sessionId: nativeId, uuid: 'boundary', message: { content: 'preserved' } }
        : { type: 'session', id: nativeId }
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(entry) + '\n')
    return file
  }

  function persistClaudeTurn(
    sessionId: string,
    nativeId: string,
    status: 'success' | 'paused' | 'error',
    configDir: string
  ) {
    const id = randomUUID()
    new AgentSessionMessageBackend({
      sessionId,
      assistantMessageId: id,
      runtimeResumeToken: nativeId,
      forkAnchor: () => ({
        checkpoint: { runtime: 'claude-code', runtimeSessionId: nativeId, messageUuid: randomUUID(), configDir }
      })
    }).persistAssistant({ status, finalMessage: { id, role: 'assistant', parts: [{ type: 'text', text: status }] } })
  }

  it.each([false, true])(
    'keeps adapter checkpoint payloads opaque and workspace-scoped (foreign target: %s)',
    async (foreignTarget) => {
      const workspace = await createWorkspace('pi')
      const foreign = await createWorkspace('pi')
      dbh.db.update(agentTable).set({ type: 'test-runtime' }).where(eq(agentTable.id, workspace.agentId)).run()
      const messageId = randomUUID()
      const foreignMessageId = randomUUID()
      const checkpoint = { runtime: 'test-runtime', locator: { volume: 'old', cursor: [1, 2, 3] }, version: 7 }
      for (const [id, sessionId] of [
        [messageId, workspace.sessionId],
        [foreignMessageId, foreign.sessionId]
      ]) {
        dbh.db
          .insert(agentSessionMessageTable)
          .values({
            id,
            sessionId,
            role: 'assistant',
            status: 'success',
            createdAt: 123,
            updatedAt: 456,
            data: {
              parts: [{ type: 'text', text: 'unchanged' }],
              runtimeAnchor: { checkpoint, excludedMessageIds: ['excluded'] }
            }
          })
          .run()
      }
      const replacement = { ...checkpoint, locator: { ...checkpoint.locator, volume: 'new' } }
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        validateSession: () => {},
        listAvailableTools: async () => [],
        connect: async () => {
          throw new Error('Relocation must not connect a runtime')
        },
        workspaceRelocation: {
          ownsArtifact: () => false,
          prepare: async ({ history }) =>
            history.some((row) => row.messageId === messageId)
              ? [{ messageId: foreignTarget ? foreignMessageId : messageId, checkpoint: replacement }]
              : []
        }
      })
      expect(await relocateSystemWorkspaces()).toEqual(new Set(foreignTarget ? [workspace.sessionId] : []))
      expect(workspacePath(workspace.id)).toBe(foreignTarget ? workspace.oldPath : workspace.newPath)
      const read = (id: string) =>
        dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, id)).get()!
      expect(read(messageId)).toMatchObject({
        createdAt: 123,
        updatedAt: 456,
        data: {
          parts: [{ type: 'text', text: 'unchanged' }],
          runtimeAnchor: {
            checkpoint: foreignTarget ? checkpoint : replacement,
            excludedMessageIds: ['excluded']
          }
        }
      })
      expect(read(foreignMessageId).data).toMatchObject({ runtimeAnchor: { checkpoint } })
    }
  )

  it('blocks native admission until the missing history has been recovered', async () => {
    const workspace = await createWorkspace('pi')
    const nativeId = randomUUID()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: randomUUID(),
        sessionId: workspace.sessionId,
        role: 'assistant',
        status: 'success',
        runtimeResumeToken: nativeId,
        data: { parts: [] }
      })
      .run()
    expect(await relocateSystemWorkspaces()).toEqual(new Set([workspace.sessionId]))
    await expect(assertAgentSessionWorkspaceDirectory(workspace.sessionId, workspace.oldPath)).rejects.toThrow(
      'relocation requires recovery'
    )
    await writeHistory('pi', workspace.id, nativeId)
    expect(await relocateSystemWorkspaces()).toEqual(new Set())
    await expect(assertAgentSessionWorkspaceDirectory(workspace.sessionId, workspace.newPath)).resolves.toBeUndefined()
    expect(agentWorkspaceStorageService.isRelocationBlocked(workspace.oldPath)).toBe(false)
  })

  it.each([
    { runtime: 'pi', linked: false },
    { runtime: 'claude-code', linked: false },
    { runtime: 'claude-code', linked: true }
  ] as const)(
    'relocates archived $runtime storage without restoring it (linked ancestor: $linked)',
    async ({ runtime, linked }) => {
      const workspace = await createWorkspace(runtime)
      if (linked) {
        const profile = path.join(temporaryRoot, 'new')
        const physicalProfile = path.join(temporaryRoot, 'physical-profile')
        await rename(profile, physicalProfile)
        await symlink(physicalProfile, profile, process.platform === 'win32' ? 'junction' : 'dir')
      }
      const output = Buffer.from([0, 1, 2, 255])
      await writeFile(path.join(workspace.newPath, 'output.bin'), output)
      let nativeId: string = randomUUID()
      let nativeFile: string
      let leafId: string | undefined
      let destinationProject: string | undefined
      if (runtime === 'pi') {
        const { SessionManager } = await loadPiSdk()
        const manager = SessionManager.create(workspace.oldPath, path.join(root, '.pi', 'sessions'))
        manager.appendMessage({ role: 'user', content: 'Save output', timestamp: 1 })
        leafId = manager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'Output saved' }],
          api: 'openai-completions',
          provider: 'fixture',
          model: 'fixture',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: 'stop',
          timestamp: 2
        })
        nativeId = manager.getSessionId()
        nativeFile = manager.getSessionFile()!
      } else {
        const source = await readFile(path.resolve('src/main/ai/runtime/claudeCode/relocationWorker.ts'), 'utf8')
        workerMocks.source = stripTypeScriptTypes(source).replaceAll(
          '@anthropic-ai/claude-agent-sdk',
          pathToFileURL(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')).href
        )
        const { default: createWorker } = await import('../../runtime/claudeCode/relocationWorker?nodeWorker')
        const keys = (await runForkWorker(
          createWorker({ workerData: { oldCwd: workspace.oldPath, newCwd: workspace.newPath } }),
          new AbortController().signal
        )) as { oldKey: string; newKey: string }
        nativeFile = await writeHistory(runtime, workspace.id, nativeId, keys.oldKey)
        destinationProject = path.join(root, '.claude', 'projects', keys.newKey)
      }
      const nativeContents = await readFile(nativeFile, 'utf8')
      const checkpoint =
        runtime === 'pi'
          ? { runtime, runtimeSessionId: nativeId, leafId: leafId! }
          : {
              runtime,
              runtimeSessionId: nativeId,
              messageUuid: 'boundary',
              configDir: path.join(temporaryRoot, 'old', 'Data', 'Agents', '.claude')
            }
      agentSessionMessageService.saveMessage({
        sessionId: workspace.sessionId,
        runtimeResumeToken: nativeId,
        runtimeAnchor: { checkpoint },
        message: {
          id: randomUUID(),
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'Output saved' }] }
        }
      })
      dbh.db
        .update(agentSessionTable)
        .set({ deletedAt: 123 })
        .where(eq(agentSessionTable.id, workspace.sessionId))
        .run()
      await agentWorkspaceStorageService.archiveWorkspace({ id: workspace.sessionId, path: workspace.newPath })
      const archive = `${workspace.newPath}.tar.gz`
      const archiveContents = await readFile(archive)

      expect(await relocateSystemWorkspaces()).toEqual(new Set())
      expect(workspacePath(workspace.id)).toBe(workspace.newPath)
      await expect(readdir(workspace.newPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(archive)).toEqual(archiveContents)
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, workspace.sessionId)).get()!.deletedAt
      ).toBe(123)
      expect(await relocateSystemWorkspaces()).toEqual(new Set())
      await agentWorkspaceStorageService.restoreWorkspaces(
        [{ id: workspace.sessionId, path: workspacePath(workspace.id) }],
        () => {
          dbh.db
            .update(agentSessionTable)
            .set({ deletedAt: null })
            .where(eq(agentSessionTable.id, workspace.sessionId))
            .run()
        }
      )
      expect(await readFile(path.join(workspace.newPath, 'output.bin'))).toEqual(output)
      expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(nativeId)
      expect(
        await readFile(destinationProject ? path.join(destinationProject, `${nativeId}.jsonl`) : nativeFile, 'utf8')
      ).toBe(nativeContents)
      if (runtime === 'claude-code') {
        const [history] = agentSessionMessageService.readWorkspaceRelocationHistory(workspace.id)
        expect(JSON.parse(history.checkpoint!).configDir).toBe(path.join(root, '.claude'))
      }
    }
  )

  it.each<{
    phase: 'packing' | 'restoring'
    copy: boolean
    empty?: boolean
    fault?:
      | 'contents'
      | 'source-identity'
      | 'source-journal'
      | 'foreign-owner'
      | 'missing-source'
      | 'linked'
      | 'hardlinked'
      | 'occupied'
      | 'rollback'
      | 'interrupted'
  }>([
    { phase: 'packing', copy: false },
    { phase: 'restoring', copy: false },
    { phase: 'packing', copy: true },
    { phase: 'restoring', copy: true },
    { phase: 'packing', copy: true, empty: true },
    { phase: 'restoring', copy: true, empty: true },
    ...(['packing', 'restoring'] as const).flatMap((phase) =>
      (
        [
          'contents',
          'source-identity',
          'source-journal',
          'foreign-owner',
          'missing-source',
          'linked',
          'hardlinked',
          'occupied',
          'rollback',
          'interrupted'
        ] as const
      ).map((fault) => ({ phase, copy: true, fault }))
    )
  ])(
    'relocates interrupted archived storage: $phase (copy: $copy, empty: $empty, fault: $fault)',
    async ({ phase, copy, empty, fault }) => {
      const workspace = await createWorkspace('pi')
      dbh.db
        .update(agentWorkspaceTable)
        .set({ path: workspace.newPath })
        .where(eq(agentWorkspaceTable.id, workspace.id))
        .run()
      dbh.db
        .update(agentSessionTable)
        .set({ deletedAt: 123 })
        .where(eq(agentSessionTable.id, workspace.sessionId))
        .run()
      const nativeId = randomUUID()
      await writeHistory('pi', workspace.id, nativeId)
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          sessionId: workspace.sessionId,
          role: 'assistant',
          status: 'success',
          runtimeResumeToken: nativeId,
          data: { parts: [] }
        })
        .run()
      if (empty)
        dbh.db.delete(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, workspace.sessionId)).run()
      await writeFile(path.join(workspace.newPath, 'output.txt'), 'recoverable output')
      const packing = vi
        .spyOn(workspaceStorage, 'packWorkspaceDirectory')
        .mockRejectedValueOnce(new Error('packing interrupted'))
      await expect(
        agentWorkspaceStorageService.archiveWorkspace({ id: workspace.sessionId, path: workspace.newPath })
      ).rejects.toThrow('packing interrupted')
      packing.mockRestore()
      if (phase === 'restoring') {
        const move = workspaceStorage.moveWorkspacePath
        const restoring = vi
          .spyOn(workspaceStorage, 'moveWorkspacePath')
          .mockImplementation(async (managedRoot, from, to) => {
            if (to === workspace.newPath) throw new Error('restore interrupted')
            await move(managedRoot, from, to)
          })
        await expect(
          agentWorkspaceStorageService.restoreWorkspaces(
            [{ id: workspace.sessionId, path: workspace.newPath }],
            () => undefined
          )
        ).rejects.toThrow('restore interrupted')
        restoring.mockRestore()
      }
      const journal = await readFile(`${workspace.newPath}.storage.json`)
      const nextRoot = path.join(temporaryRoot, 'moved', 'Data', 'Agents')
      await mkdir(path.dirname(nextRoot), { recursive: true })
      if (copy) await cp(root, nextRoot, { recursive: true, force: false, errorOnExist: true, dereference: true })
      else await rename(root, nextRoot)
      root = nextRoot
      const relocated = path.join(root, 'system', '2026-10-09', workspace.id)
      const original = JSON.parse(journal.toString())
      const suffix = phase === 'packing' ? '.archiving' : path.join('.restoring', original.operationId)
      const oldDirectory = `${workspace.newPath}${suffix}`
      const newDirectory = `${relocated}${suffix}`
      if (fault === 'contents') await writeFile(path.join(newDirectory, 'output.txt'), 'changed copy')
      if (fault === 'source-identity') {
        await rename(oldDirectory, `${oldDirectory}.saved`)
        await cp(`${oldDirectory}.saved`, oldDirectory, { recursive: true })
      }
      if (fault === 'source-journal')
        await writeFile(`${workspace.newPath}.storage.json`, JSON.stringify({ ...original, operationId: randomUUID() }))
      if (fault === 'foreign-owner')
        await writeFile(`${relocated}.storage.json`, JSON.stringify({ ...original, sessionId: randomUUID() }))
      if (fault === 'missing-source') await rename(oldDirectory, `${oldDirectory}.saved`)
      if (fault === 'linked') {
        await rename(newDirectory, `${newDirectory}.saved`)
        await symlink(oldDirectory, newDirectory, process.platform === 'win32' ? 'junction' : 'dir')
      }
      if (fault === 'hardlinked') {
        await rm(path.join(newDirectory, 'output.txt'))
        await link(path.join(oldDirectory, 'output.txt'), path.join(newDirectory, 'output.txt'))
      }
      if (fault === 'occupied') await mkdir(relocated)
      let publishedJournal: Buffer | undefined
      if (fault === 'rollback' || fault === 'interrupted') {
        vi.spyOn(agentWorkspaceService, 'relocateSystemWorkspaceTx').mockImplementationOnce(() => {
          if (fault === 'interrupted') {
            publishedJournal = readFileSync(`${relocated}.storage.json`)
            writeFileSync(`${relocated}.storage.json`, 'conflicting journal')
          }
          throw new Error('database commit interrupted')
        })
      }
      if (fault) {
        const before = await readFile(`${relocated}.storage.json`)
        expect(await relocateSystemWorkspaces()).toEqual(new Set([workspace.sessionId]))
        expect(workspacePath(workspace.id)).toBe(workspace.newPath)
        if (fault === 'interrupted') {
          expect(await readFile(`${relocated}.storage.json`, 'utf8')).toBe('conflicting journal')
          await writeFile(`${relocated}.storage.json`, publishedJournal!)
        } else expect(await readFile(`${relocated}.storage.json`)).toEqual(before)
        if (fault !== 'rollback' && fault !== 'interrupted') return
      }

      mockMainLoggerService.error.mockClear()
      const protectedSessions = await relocateSystemWorkspaces()
      expect(
        protectedSessions,
        mockMainLoggerService.error.mock.calls.map(([, context]) => context?.error?.stack).join('\n')
      ).toEqual(new Set())
      expect(workspacePath(workspace.id)).toBe(relocated)
      if (copy) {
        const relocatedRecord = JSON.parse(await readFile(`${relocated}.storage.json`, 'utf8'))
        expect(relocatedRecord).toEqual({ ...original, directory: expect.any(Object) })
        expect(relocatedRecord.directory).not.toEqual(original.directory)
      } else expect(await readFile(`${relocated}.storage.json`)).toEqual(journal)
      await expect(readdir(relocated)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await relocateSystemWorkspaces()).toEqual(new Set())
      await agentWorkspaceStorageService.restoreWorkspaces([{ id: workspace.sessionId, path: relocated }], () => {
        dbh.db
          .update(agentSessionTable)
          .set({ deletedAt: null })
          .where(eq(agentSessionTable.id, workspace.sessionId))
          .run()
      })
      expect(await readFile(path.join(relocated, 'output.txt'), 'utf8')).toBe('recoverable output')
      expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(empty ? null : nativeId)
      await expect(readFile(`${relocated}.storage.json`)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it.each(['missing', 'corrupt', 'linked', 'hardlinked'] as const)(
    'retains the old path when archived workspace storage is %s',
    async (scenario) => {
      const workspace = await createWorkspace('pi')
      const nativeId = randomUUID()
      const nativeFile = await writeHistory('pi', workspace.id, nativeId)
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          sessionId: workspace.sessionId,
          role: 'assistant',
          status: 'success',
          runtimeResumeToken: nativeId,
          data: { parts: [] }
        })
        .run()
      await writeFile(path.join(workspace.newPath, 'output.txt'), 'preserved')
      await agentWorkspaceStorageService.archiveWorkspace({ id: workspace.sessionId, path: workspace.newPath })
      const archive = `${workspace.newPath}.tar.gz`
      if (scenario === 'missing') await rm(archive)
      if (scenario === 'corrupt') await writeFile(archive, 'invalid archive')
      if (scenario === 'hardlinked') await link(archive, path.join(temporaryRoot, 'other.tar.gz'))
      if (scenario === 'linked') {
        const outside = path.join(temporaryRoot, 'outside')
        const date = path.dirname(workspace.newPath)
        await rename(date, outside)
        await symlink(outside, date, process.platform === 'win32' ? 'junction' : 'dir')
      }
      const contents = scenario === 'missing' ? undefined : await readFile(archive)
      const nativeContents = await readFile(nativeFile)

      expect(await relocateSystemWorkspaces()).toEqual(new Set([workspace.sessionId]))
      expect(workspacePath(workspace.id)).toBe(workspace.oldPath)
      await expect(readdir(workspace.newPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(nativeFile)).toEqual(nativeContents)
      if (contents) expect(await readFile(archive)).toEqual(contents)
      else await expect(readFile(archive)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it.each(
    ['retained', 'removed', 'ambiguous', 'linked', 'target-conflict'].flatMap((scenario) =>
      ['absent', 'obsolete', 'required'].map((literal) => ({ scenario, literal }))
    )
  )(
    'recovers canonical Claude project ownership with the native worker: $scenario, literal=$literal',
    async ({ scenario, literal }) => {
      const workspace = await createWorkspace('claude-code')
      const canonicalRoot = path.join(temporaryRoot, 'canonical-old')
      await mkdir(path.join(canonicalRoot, path.relative(path.join(temporaryRoot, 'old'), workspace.oldPath)), {
        recursive: true
      })
      const source = await readFile(path.resolve('src/main/ai/runtime/claudeCode/relocationWorker.ts'), 'utf8')
      workerMocks.source = stripTypeScriptTypes(source).replaceAll(
        '@anthropic-ai/claude-agent-sdk',
        pathToFileURL(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')).href
      )
      const { default: createWorker } = await import('../../runtime/claudeCode/relocationWorker?nodeWorker')
      const keys = () =>
        runForkWorker(
          createWorker({ workerData: { oldCwd: workspace.oldPath, newCwd: workspace.newPath } }),
          new AbortController().signal
        ) as Promise<{ oldKey: string; newKey: string }>
      const literalKey = (await keys()).oldKey
      const literalId = randomUUID()
      const literalFile =
        literal !== 'absent' ? await writeHistory('claude-code', workspace.id, literalId, literalKey) : undefined
      const literalContents = literalFile ? await readFile(literalFile, 'utf8') : undefined
      if (literal === 'required') {
        const messageId = randomUUID()
        agentSessionMessageService.saveMessage({
          sessionId: workspace.sessionId,
          runtimeResumeToken: literalId,
          runtimeAnchor: {
            checkpoint: {
              runtime: 'claude-code',
              runtimeSessionId: literalId,
              messageUuid: 'boundary',
              configDir: path.join(temporaryRoot, 'old', 'Data', 'Agents', '.claude')
            }
          },
          message: { id: messageId, role: 'assistant', status: 'pending', data: { parts: [] } }
        })
        const orphaned = agentSessionMessageService.findCrashOrphanedAssistantMessages()
        agentSessionMessageService.resolveCrashOrphanedMessages(orphaned, [workspace.sessionId])
        expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBeNull()
      }
      await symlink(canonicalRoot, path.join(temporaryRoot, 'old'), process.platform === 'win32' ? 'junction' : 'dir')
      const before = await keys()
      const nativeId = randomUUID()
      const file = await writeHistory('claude-code', workspace.id, nativeId, before.oldKey)
      const contents = await readFile(file, 'utf8')
      persistClaudeTurn(
        workspace.sessionId,
        nativeId,
        'paused',
        path.join(temporaryRoot, 'old', 'Data', 'Agents', '.claude')
      )
      const oldProject = path.dirname(file)
      const newProject = path.join(root, '.claude', 'projects', before.newKey)
      let preservedFile = file
      if (scenario === 'ambiguous')
        await cp(oldProject, path.join(path.dirname(oldProject), 'duplicate-project'), { recursive: true })
      if (scenario === 'linked') {
        const outside = path.join(temporaryRoot, 'outside-history')
        await rename(oldProject, outside)
        await symlink(outside, oldProject, process.platform === 'win32' ? 'junction' : 'dir')
        preservedFile = path.join(outside, `${nativeId}.jsonl`)
      }
      if (scenario === 'target-conflict') {
        await mkdir(newProject)
        await writeFile(path.join(newProject, 'keep.txt'), 'existing target')
      }
      if (scenario !== 'retained') await rm(canonicalRoot, { recursive: true })
      expect((await keys()).oldKey === before.oldKey).toBe(scenario === 'retained')

      const blocked = !['retained', 'removed'].includes(scenario)
      expect(await relocateSystemWorkspaces()).toEqual(new Set(blocked ? [workspace.sessionId] : []))
      expect(workspacePath(workspace.id)).toBe(blocked ? workspace.oldPath : workspace.newPath)
      expect(await readFile(blocked ? preservedFile : path.join(newProject, `${nativeId}.jsonl`), 'utf8')).toBe(
        contents
      )
      expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(nativeId)
      if (literalFile) {
        const preservedLiteral =
          literal === 'required' && !blocked ? path.join(newProject, `${literalId}.jsonl`) : literalFile
        expect(await readFile(preservedLiteral, 'utf8')).toBe(literalContents)
      }
      if (scenario === 'target-conflict')
        expect(await readFile(path.join(newProject, 'keep.txt'), 'utf8')).toBe('existing target')
    }
  )

  it.each(['disjoint', 'conflict', 'rollback', 'interrupted', 'repeated'] as const)(
    'preserves multiple Claude project sources during %s publication',
    async (scenario) => {
      const workspace = await createWorkspace('claude-code')
      const firstId = randomUUID()
      const secondId = randomUUID()
      const firstFile = await writeHistory('claude-code', workspace.id, firstId)
      const secondFile = await writeHistory('claude-code', workspace.id, secondId, `canonical-${workspace.id}`)
      const originals = await Promise.all([firstFile, secondFile].map((file) => readFile(file, 'utf8')))
      for (const [index, id] of [firstId, secondId].entries()) {
        dbh.db
          .insert(agentSessionMessageTable)
          .values({
            sessionId: workspace.sessionId,
            role: 'assistant',
            status: 'paused',
            runtimeResumeToken: id,
            data: { parts: [] },
            createdAt: index + 1
          })
          .run()
      }
      const firstArtifact = path.join(path.dirname(firstFile), 'subdirectory', 'first.txt')
      const secondArtifact = path.join(
        path.dirname(secondFile),
        'subdirectory',
        scenario === 'conflict' ? 'first.txt' : 'second.txt'
      )
      for (const [file, contents] of [
        [firstArtifact, 'first artifact'],
        [secondArtifact, 'second artifact']
      ]) {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, contents)
      }
      const newProject = path.join(root, '.claude', 'projects', `new-${workspace.id}`)
      let published: string[] = []
      if (scenario === 'rollback' || scenario === 'interrupted') {
        vi.spyOn(agentWorkspaceService, 'relocateSystemWorkspaceTx').mockImplementationOnce(() => {
          published = [firstId, secondId].map((id) => readFileSync(path.join(newProject, `${id}.jsonl`), 'utf8'))
          if (scenario === 'interrupted') writeFileSync(path.join(newProject, `${firstId}.jsonl`), 'external change')
          throw new Error('Database transaction failed')
        })
      }

      const blocked = !['disjoint', 'repeated'].includes(scenario)
      expect(await relocateSystemWorkspaces()).toEqual(new Set(blocked ? [workspace.sessionId] : []))
      expect(workspacePath(workspace.id)).toBe(blocked ? workspace.oldPath : workspace.newPath)
      if (blocked) {
        expect(await readFile(secondFile, 'utf8')).toBe(originals[1])
        expect(await readFile(secondArtifact, 'utf8')).toBe('second artifact')
      }
      if (scenario === 'conflict' || scenario === 'rollback') {
        expect(await readFile(firstFile, 'utf8')).toBe(originals[0])
        expect(await readFile(firstArtifact, 'utf8')).toBe('first artifact')
        await expect(readdir(newProject)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      if (scenario === 'rollback' || scenario === 'interrupted') {
        expect(published).toEqual(originals)
        if (scenario === 'interrupted') {
          const backup = path.join(root, '.relocation', workspace.id, 'backup', '0', `${firstId}.jsonl`)
          expect(await readFile(backup, 'utf8')).toBe(originals[0])
          await writeFile(path.join(newProject, `${firstId}.jsonl`), originals[0])
        }
        expect(await relocateSystemWorkspaces()).toEqual(new Set())
        await expect(readFile(secondFile)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      if (scenario !== 'conflict') {
        expect(workspacePath(workspace.id)).toBe(workspace.newPath)
        for (const [index, id] of [firstId, secondId].entries()) {
          expect(await readFile(path.join(newProject, `${id}.jsonl`), 'utf8')).toBe(originals[index])
        }
        expect(await readFile(path.join(newProject, 'subdirectory', 'first.txt'), 'utf8')).toBe('first artifact')
        expect(await readFile(path.join(newProject, 'subdirectory', 'second.txt'), 'utf8')).toBe('second artifact')
        expect(await relocateSystemWorkspaces()).toEqual(new Set())
      }
      if (scenario === 'repeated') {
        const nextRoot = path.join(temporaryRoot, 'next', 'Data', 'Agents')
        await mkdir(path.dirname(nextRoot), { recursive: true })
        await rename(root, nextRoot)
        root = nextRoot
        workerMocks.keys = { oldKey: 'unavailable-old-key', newKey: `next-${workspace.id}` }

        expect(await relocateSystemWorkspaces()).toEqual(new Set())
        expect(workspacePath(workspace.id)).toBe(path.join(root, 'system', '2026-10-09', workspace.id))
        const projects = path.join(root, '.claude', 'projects')
        expect(await readdir(projects)).toEqual([workerMocks.keys.newKey])
        for (const [index, id] of [firstId, secondId].entries()) {
          expect(await readFile(path.join(projects, workerMocks.keys.newKey, `${id}.jsonl`), 'utf8')).toBe(
            originals[index]
          )
        }
      }
      expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(secondId)
      expect(await readdir(path.join(root, '.relocation'))).toEqual([])
    }
  )

  it.each(['paused', 'error'] as const)('retains external Claude history ownership after a %s turn', async (status) => {
    const workspace = await createWorkspace('claude-code')
    const nativeId = randomUUID()
    const configDir = path.join(temporaryRoot, 'external-claude')
    const file = path.join(configDir, 'projects', `old-${workspace.id}`, `${nativeId}.jsonl`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ type: 'assistant', sessionId: nativeId, uuid: randomUUID() }) + '\n')
    persistClaudeTurn(workspace.sessionId, nativeId, 'success', configDir)
    persistClaudeTurn(workspace.sessionId, nativeId, status, configDir)
    const messages = dbh.db.select().from(agentSessionMessageTable).all()
    const contents = await readFile(file, 'utf8')

    expect(await relocateSystemWorkspaces()).toEqual(new Set())
    expect(workspacePath(workspace.id)).toBe(workspace.newPath)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(messages)
    expect(await readFile(file, 'utf8')).toBe(contents)
  })

  it.each(['managed', 'other-native', 'other-session'] as const)(
    'still requires missing managed Claude history: %s',
    async (scenario) => {
      const workspace = await createWorkspace('claude-code')
      const nativeId = randomUUID()
      const configDir =
        scenario === 'managed'
          ? path.join(temporaryRoot, 'old', 'Data', 'Agents', '.claude')
          : path.join(temporaryRoot, 'external-claude')
      persistClaudeTurn(workspace.sessionId, nativeId, 'success', configDir)
      const sessionId = scenario === 'other-session' ? randomUUID() : workspace.sessionId
      if (sessionId !== workspace.sessionId) {
        dbh.db
          .insert(agentSessionTable)
          .values({
            id: sessionId,
            agentId: workspace.agentId,
            workspaceId: workspace.id,
            name: 'Other session',
            orderKey: 'a1'
          })
          .run()
      }
      persistClaudeTurn(sessionId, scenario === 'other-native' ? randomUUID() : nativeId, 'paused', configDir)

      expect(await relocateSystemWorkspaces()).toEqual(new Set([workspace.sessionId, sessionId]))
      expect(workspacePath(workspace.id)).toBe(workspace.oldPath)
    }
  )

  it.each(['orphan', 'subagent', 'required'] as const)(
    'handles truncated Claude %s history without losing artifacts',
    async (kind) => {
      const workspace = await createWorkspace('claude-code')
      const nativeId = randomUUID()
      const file = await writeHistory('claude-code', workspace.id, nativeId)
      const contents = await readFile(file, 'utf8')
      persistClaudeTurn(
        workspace.sessionId,
        nativeId,
        'paused',
        path.join(temporaryRoot, 'old', 'Data', 'Agents', '.claude')
      )
      const relative =
        kind === 'subagent'
          ? path.join(nativeId, 'subagents', 'agent-child.jsonl')
          : `${kind === 'required' ? nativeId : randomUUID()}.jsonl`
      const artifact = path.join(path.dirname(file), relative)
      const truncated = '{"type":"assistant","message":'
      await mkdir(path.dirname(artifact), { recursive: true })
      await writeFile(artifact, truncated)

      expect(await relocateSystemWorkspaces()).toEqual(new Set(kind === 'required' ? [workspace.sessionId] : []))
      expect(workspacePath(workspace.id)).toBe(kind === 'required' ? workspace.oldPath : workspace.newPath)
      const project = path.join(root, '.claude', 'projects', `${kind === 'required' ? 'old' : 'new'}-${workspace.id}`)
      expect(await readFile(path.join(project, relative), 'utf8')).toBe(truncated)
      if (kind !== 'required') expect(await readFile(path.join(project, `${nativeId}.jsonl`), 'utf8')).toBe(contents)
    }
  )

  it.each(
    (['claude-code', 'pi'] as const).flatMap((runtime) =>
      (
        ['complete', 'tail', 'terminated-tail', 'middle', 'missing-checkpoint', 'wrong-identity', 'no-records'] as const
      ).map((scenario) => ({ runtime, scenario }))
    )
  )('validates recoverable $runtime JSONL history: $scenario', async ({ runtime, scenario }) => {
    const workspace = await createWorkspace(runtime)
    let nativeId: string = randomUUID()
    let boundary: string = 'boundary'
    let file: string
    if (runtime === 'pi') {
      const { SessionManager } = await loadPiSdk()
      const manager = SessionManager.create(workspace.oldPath, path.join(root, '.pi', 'sessions'))
      manager.appendMessage({ role: 'user', content: 'Save output', timestamp: 1 })
      boundary = manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Output saved' }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fixture',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp: 2
      })
      nativeId = manager.getSessionId()
      file = manager.getSessionFile()!
    } else file = await writeHistory(runtime, workspace.id, nativeId)
    let contents = await readFile(file, 'utf8')
    const requiredBoundary = scenario === 'missing-checkpoint' ? 'unsaved-boundary' : boundary
    const checkpoint =
      runtime === 'pi'
        ? { runtime, runtimeSessionId: nativeId, leafId: requiredBoundary }
        : {
            runtime,
            runtimeSessionId: nativeId,
            messageUuid: requiredBoundary,
            configDir: path.join(temporaryRoot, 'old', 'Data', 'Agents', '.claude')
          }
    agentSessionMessageService.saveMessage({
      sessionId: workspace.sessionId,
      runtimeResumeToken: nativeId,
      runtimeAnchor: { checkpoint },
      message: { id: randomUUID(), role: 'assistant', status: 'success', data: { parts: [] } }
    })
    const partial = '{"type":"message","id":"unsaved-boundary","uuid":"unsaved-boundary","content":'
    if (scenario === 'tail' || scenario === 'missing-checkpoint') contents += partial
    if (scenario === 'terminated-tail') contents += partial + '\n'
    if (scenario === 'middle') contents = partial + '\n' + contents
    if (scenario === 'wrong-identity') contents = contents.replaceAll(nativeId, randomUUID()) + partial
    if (scenario === 'no-records') contents = partial
    await writeFile(file, contents)
    const blocked = ['missing-checkpoint', 'wrong-identity', 'no-records'].includes(scenario)
    expect(await relocateSystemWorkspaces()).toEqual(new Set(blocked ? [workspace.sessionId] : []))
    expect(workspacePath(workspace.id)).toBe(blocked ? workspace.oldPath : workspace.newPath)
    const relocated =
      runtime === 'pi' || blocked
        ? file
        : path.join(root, '.claude', 'projects', `new-${workspace.id}`, `${nativeId}.jsonl`)
    expect(await readFile(relocated, 'utf8')).toBe(contents)
    expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(nativeId)
    if (!blocked) {
      if (runtime === 'pi') {
        const { SessionManager } = await loadPiSdk()
        expect(SessionManager.open(relocated).getLeafId()).toBe(boundary)
      } else {
        vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(root, '.claude'))
        try {
          const { getSessionMessages, forkSession } = await import('@anthropic-ai/claude-agent-sdk')
          expect((await getSessionMessages(nativeId)).some((message) => message.uuid === boundary)).toBe(true)
          expect((await forkSession(nativeId, { upToMessageId: boundary })).sessionId).not.toBe(nativeId)
        } finally {
          vi.unstubAllEnvs()
        }
      }
    }
  })

  it.each(['claude-code', 'pi'] as const)(
    'relocates an edited %s conversation using its materialized history',
    async (runtime) => {
      const workspace = await createWorkspace(runtime)
      const actualId = randomUUID()
      const initializationId = randomUUID()
      const checkpoint =
        runtime === 'claude-code'
          ? {
              runtime,
              runtimeSessionId: actualId,
              messageUuid: 'boundary',
              configDir: path.join(temporaryRoot, 'old', 'Data', 'Agents', '.claude')
            }
          : { runtime, runtimeSessionId: actualId, leafId: 'boundary' }
      dbh.db
        .insert(agentSessionMessageTable)
        .values([
          {
            sessionId: workspace.sessionId,
            role: 'user',
            status: 'success',
            data: { nativeSessionId: randomUUID(), parts: [] },
            createdAt: 1
          },
          {
            sessionId: workspace.sessionId,
            role: 'assistant',
            status: 'success',
            data: { runtimeAnchor: { checkpoint }, parts: [] },
            runtimeResumeToken: actualId,
            createdAt: 2
          },
          {
            sessionId: workspace.sessionId,
            role: 'user',
            status: 'success',
            data: { nativeSessionId: initializationId, parts: [] },
            createdAt: 3
          }
        ])
        .run()
      const file = await writeHistory(runtime, workspace.id, actualId)
      if (runtime === 'pi')
        await writeFile(
          file,
          (await readFile(file, 'utf8')) +
            JSON.stringify({
              type: 'message',
              id: 'boundary',
              parentId: null,
              message: { role: 'user', content: 'saved' }
            }) +
            '\n'
        )
      const contents = await readFile(file, 'utf8')

      expect(await relocateSystemWorkspaces()).toEqual(new Set())
      expect(workspacePath(workspace.id)).toBe(workspace.newPath)
      expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(actualId)
      expect(agentSessionMessageService.getNativeSessionId(workspace.sessionId)).toBe(initializationId)
      const relocated =
        runtime === 'claude-code'
          ? path.join(root, '.claude', 'projects', `new-${workspace.id}`, `${actualId}.jsonl`)
          : file
      expect(await readFile(relocated, 'utf8')).toBe(contents)
    }
  )

  it.each(['claude-code', 'pi'] as const)('allows an unmaterialized %s initialization marker', async (runtime) => {
    const workspace = await createWorkspace(runtime)
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        sessionId: workspace.sessionId,
        role: 'user',
        status: 'success',
        data: { nativeSessionId: randomUUID(), parts: [] }
      })
      .run()

    expect(await relocateSystemWorkspaces()).toEqual(new Set())
    expect(workspacePath(workspace.id)).toBe(workspace.newPath)
  })

  it.each(['token', 'checkpoint'] as const)(
    'relocates retired DSH history with a %s before Pi recovery',
    async (evidence) => {
      const workspace = await createWorkspace('dsh')
      const oldToken = randomUUID()
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          sessionId: workspace.sessionId,
          role: 'assistant',
          status: 'success',
          runtimeResumeToken: oldToken,
          data: {
            parts: [{ type: 'text', text: 'Preserved DSH answer' }],
            ...(evidence === 'checkpoint'
              ? { runtimeAnchor: { checkpoint: { runtime: 'dsh', runtimeSessionId: oldToken, boundary: 1 } } }
              : {})
          }
        })
        .run()
      queueRetiredAgentRuntimeMigration(dbh.db)

      expect(await relocateSystemWorkspaces()).toEqual(new Set())
      expect(workspacePath(workspace.id)).toBe(workspace.newPath)
      expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(oldToken)

      await migrateRetiredSessionHistories()

      const token = agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)
      expect(token).toBeTruthy()
      expect(token).not.toBe(oldToken)
      const file = resolveResumeTokenSessionFile(token!, path.join(root, '.pi', 'sessions'))
      expect(file).toBeTruthy()
      const contents = await readFile(file!, 'utf8')
      expect(JSON.parse(contents.split('\n')[0])).toMatchObject({ type: 'session', id: token, cwd: workspace.newPath })
      expect(contents).toContain('Preserved DSH answer')
      expect(await relocateSystemWorkspaces()).toEqual(new Set())
    }
  )

  it('relocates an initial Pi session after empty compaction fails without flushing history', async () => {
    const workspace = await createWorkspace('pi')
    const pi = await loadPiSdk()
    const { InMemoryCredentialStore } = await loadPiAi()
    const sessionDir = path.join(root, '.pi', 'sessions')
    const manager = pi.SessionManager.create(workspace.oldPath, sessionDir, { id: workspace.sessionId })
    const settingsManager = pi.SettingsManager.inMemory()
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd: workspace.newPath,
      agentDir: path.join(temporaryRoot, 'pi-agent'),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true
    })
    await resourceLoader.reload()
    const modelRuntime = await pi.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    const { session } = await pi.createAgentSession({
      cwd: workspace.newPath,
      sessionManager: manager,
      settingsManager,
      resourceLoader,
      modelRuntime,
      model: modelRuntime.getModels()[0],
      tools: []
    })
    try {
      agentSessionMessageService.saveMessage({
        sessionId: workspace.sessionId,
        message: {
          id: randomUUID(),
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text: '/compact' }] }
        }
      })
      await expect(session.compact()).rejects.toThrow('Nothing to compact')
      const token = session.sessionId
      new AgentSessionMessageBackend({
        sessionId: workspace.sessionId,
        assistantMessageId: randomUUID(),
        runtimeResumeToken: token
      }).persistAssistant({ status: 'error', finalMessage: undefined })
      const messages = dbh.db.select().from(agentSessionMessageTable).all()
      expect(resolveResumeTokenSessionFile(token, sessionDir)).toBeNull()

      expect(await relocateSystemWorkspaces()).toEqual(new Set())
      expect(workspacePath(workspace.id)).toBe(workspace.newPath)
      expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(messages)
      expect(await relocateSystemWorkspaces()).toEqual(new Set())
      expect(pi.SessionManager.create(workspace.newPath, sessionDir, { id: token }).getSessionId()).toBe(token)
    } finally {
      session.dispose()
    }
  })

  it.each(['prompt', 'success', 'checkpoint', 'edited', 'foreign-token'] as const)(
    'still blocks missing Pi history with materialization evidence: %s',
    async (evidence) => {
      const workspace = await createWorkspace('pi')
      const token = evidence === 'foreign-token' ? randomUUID() : workspace.sessionId
      const userId = randomUUID()
      agentSessionMessageService.saveMessage({
        sessionId: workspace.sessionId,
        message: {
          id: userId,
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text: evidence === 'prompt' ? 'Hello' : '/compact' }] }
        }
      })
      if (evidence === 'edited') agentSessionMessageService.setEditRuntimeTx(dbh.db, workspace.sessionId, userId, token)
      agentSessionMessageService.saveMessage({
        sessionId: workspace.sessionId,
        runtimeResumeToken: token,
        ...(evidence === 'checkpoint'
          ? { runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: token, leafId: 'saved-leaf' } } }
          : {}),
        message: {
          id: randomUUID(),
          role: 'assistant',
          status: evidence === 'success' ? 'success' : 'error',
          data: { parts: [] }
        }
      })

      expect(await relocateSystemWorkspaces()).toEqual(new Set([workspace.sessionId]))
      expect(workspacePath(workspace.id)).toBe(workspace.oldPath)
      expect(agentSessionMessageService.getLastRuntimeResumeToken(workspace.sessionId)).toBe(token)
    }
  )

  it.each([
    ['claude-code', 'token'],
    ['claude-code', 'checkpoint'],
    ['pi', 'token'],
    ['pi', 'checkpoint']
  ] as const)('blocks missing %s history required by a %s', async (runtime, evidence) => {
    const workspace = await createWorkspace(runtime)
    const id = randomUUID()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        sessionId: workspace.sessionId,
        role: 'assistant',
        status: 'success',
        runtimeResumeToken: evidence === 'token' ? id : null,
        data: {
          parts: [],
          ...(evidence === 'checkpoint' ? { runtimeAnchor: { checkpoint: { runtime, runtimeSessionId: id } } } : {})
        }
      })
      .run()

    expect(await relocateSystemWorkspaces()).toEqual(new Set([workspace.sessionId]))
    expect(workspacePath(workspace.id)).toBe(workspace.oldPath)
  })

  it('waits for absent shared Claude config to recover before committing another workspace', async () => {
    const first = await createWorkspace('claude-code')
    const second = await createWorkspace('claude-code')
    const configFile = path.join(root, '.claude', '.claude.json')
    const config = JSON.stringify({
      projects: { [first.oldPath]: { allowedTools: ['Read'] }, [second.oldPath]: { allowedTools: ['Edit'] } }
    })
    const directory = path.join(root, '.relocation', first.id)
    const backup = path.join(directory, 'backup', '0')
    await mkdir(path.dirname(configFile), { recursive: true })
    await mkdir(path.dirname(backup), { recursive: true })
    // An interrupted publication owns the missing config; an invalid backup prevents recovery.
    await writeFile(backup, 'temporarily unverifiable backup')
    const before = createHash('sha256').update('""').update('file').update(config).digest('hex')
    const relative = path.relative(root, configFile)
    await writeFile(
      path.join(directory, 'journal.json'),
      JSON.stringify({
        version: 1,
        workspaceId: first.id,
        oldPath: first.oldPath,
        newPath: first.newPath,
        operations: [{ source: relative, target: relative, before, after: before }]
      })
    )

    expect(await relocateSystemWorkspaces()).toEqual(new Set([first.sessionId, second.sessionId]))
    expect(workspacePath(first.id)).toBe(first.oldPath)
    expect(workspacePath(second.id)).toBe(second.oldPath)
    await expect(readFile(configFile)).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(backup, config)
    expect(await relocateSystemWorkspaces()).toEqual(new Set())
    expect(workspacePath(first.id)).toBe(first.newPath)
    expect(workspacePath(second.id)).toBe(second.newPath)
    expect(JSON.parse(await readFile(configFile, 'utf8'))).toEqual({
      projects: { [first.newPath]: { allowedTools: ['Read'] }, [second.newPath]: { allowedTools: ['Edit'] } }
    })
  })
})
