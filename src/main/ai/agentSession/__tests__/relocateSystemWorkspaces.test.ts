import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'

import { relocateSystemWorkspaces } from '../relocateSystemWorkspaces'

// Keep filesystem publication and database recovery real; isolate only the native SDK worker.
vi.mock('../relocationWorker?nodeWorker', async () => {
  const { EventEmitter } = await import('node:events')
  const { basename } = await import('node:path')
  return {
    default: ({ workerData }: { workerData: { oldCwd: string; newCwd: string } }) => {
      const worker = Object.assign(new EventEmitter(), { terminate: async () => 0 })
      setImmediate(() =>
        worker.emit('message', {
          result: {
            oldKey: `old-${basename(workerData.oldCwd)}`,
            newKey: `new-${basename(workerData.newCwd)}`,
            dsh: []
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
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'cs-relocation-'))
    root = path.join(temporaryRoot, 'new', 'Data', 'Agents')
    await mkdir(root, { recursive: true })
    const paths: Record<string, string> = {
      'feature.agents.data': root,
      'feature.agents.system_workspaces': path.join(root, 'system'),
      'feature.agents.claude.root': path.join(root, '.claude'),
      'feature.agents.pi.sessions': path.join(root, '.pi', 'sessions'),
      'feature.agents.dsh.sessions': path.join(root, '.dsh', 'sessions')
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

  async function createWorkspace(runtime: 'claude-code' | 'pi') {
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
    return { id, sessionId, oldPath, newPath }
  }

  function workspacePath(id: string) {
    return dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, id)).get()!.path
  }

  async function writeHistory(runtime: 'claude-code' | 'pi', workspaceId: string, nativeId: string) {
    const file =
      runtime === 'claude-code'
        ? path.join(root, '.claude', 'projects', `old-${workspaceId}`, `${nativeId}.jsonl`)
        : path.join(root, '.pi', 'sessions', `2026-10-09_${nativeId}.jsonl`)
    const entry =
      runtime === 'claude-code'
        ? { type: 'assistant', sessionId: nativeId, uuid: 'boundary', message: { content: 'preserved' } }
        : { type: 'session', id: nativeId }
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(entry) + '\n')
    return file
  }

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
