import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { queueRetiredAgentRuntimeMigration } from '@data/services/retiredAgentRuntimeMigration'
import { runForkWorker } from '@main/ai/runtime/fork'
import { loadPiAi, loadPiSdk } from '@main/ai/runtime/pi/piSdk'
import { resolveResumeTokenSessionFile } from '@main/ai/runtime/pi/piSessionFile'
import { migrateRetiredSessionHistories } from '@main/ai/runtime/pi/retiredSessionHistory'

import { AgentSessionMessageBackend } from '../persistence/AgentSessionMessageBackend'
import { relocateSystemWorkspaces } from '../relocateSystemWorkspaces'

const workerMocks = vi.hoisted(() => ({ source: undefined as string | undefined }))

// Keep filesystem publication and database recovery real; isolate only the native SDK worker.
vi.mock('../relocationWorker?nodeWorker', async () => {
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
          result: {
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
    workerMocks.source = undefined
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'cs-relocation-'))
    root = path.join(temporaryRoot, 'new', 'Data', 'Agents')
    await mkdir(root, { recursive: true })
    const paths: Record<string, string> = {
      'feature.agents.data': root,
      'feature.agents.system_workspaces': path.join(root, 'system'),
      'feature.agents.claude.root': path.join(root, '.claude'),
      'feature.agents.pi.sessions': path.join(root, '.pi', 'sessions')
    }
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const value = paths[key]
      if (!value) throw new Error(`Unexpected path: ${key}`)
      return filename ? path.join(value, filename) : value
    })
  })

  afterEach(async () => {
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

  it.each(
    ['retained', 'removed', 'ambiguous', 'linked', 'target-conflict'].flatMap((scenario) =>
      [false, true].map((obsolete) => ({ scenario, obsolete }))
    )
  )(
    'recovers canonical Claude project ownership with the native worker: $scenario, obsolete=$obsolete',
    async ({ scenario, obsolete }) => {
      const workspace = await createWorkspace('claude-code')
      const canonicalRoot = path.join(temporaryRoot, 'canonical-old')
      await mkdir(path.join(canonicalRoot, path.relative(path.join(temporaryRoot, 'old'), workspace.oldPath)), {
        recursive: true
      })
      const source = await readFile(path.resolve('src/main/ai/agentSession/relocationWorker.ts'), 'utf8')
      workerMocks.source = stripTypeScriptTypes(source).replaceAll(
        '@anthropic-ai/claude-agent-sdk',
        pathToFileURL(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')).href
      )
      const { default: createWorker } = await import('../relocationWorker?nodeWorker')
      const keys = () =>
        runForkWorker(
          createWorker({ workerData: { oldCwd: workspace.oldPath, newCwd: workspace.newPath } }),
          new AbortController().signal
        ) as Promise<{ oldKey: string; newKey: string }>
      const literalKey = (await keys()).oldKey
      const obsoleteFile = obsolete
        ? await writeHistory('claude-code', workspace.id, randomUUID(), literalKey)
        : undefined
      const obsoleteContents = obsoleteFile ? await readFile(obsoleteFile, 'utf8') : undefined
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
      if (obsoleteFile) expect(await readFile(obsoleteFile, 'utf8')).toBe(obsoleteContents)
      if (scenario === 'target-conflict')
        expect(await readFile(path.join(newProject, 'keep.txt'), 'utf8')).toBe('existing target')
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
