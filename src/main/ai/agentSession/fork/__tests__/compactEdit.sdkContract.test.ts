import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { prepareClaudeBranch, reserveClaudeBranchTx } from '@main/ai/runtime/claudeCode/claudeContext'
import { forkClaudeSession } from '@main/ai/runtime/claudeCode/claudeFork'
import { ClaudeForkCheckpointSchema } from '@main/ai/runtime/claudeCode/forkCheckpoint'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'

import { AgentSessionRuntimeService } from '../../AgentSessionRuntimeService'
import { AgentSessionForkOperations } from '../AgentSessionForkOperations'
import { getEditFailure } from '../historyActions'

vi.mock('@main/ai/runtime/claudeCode/forkWorker?nodeWorker', () => ({
  default: (options: ConstructorParameters<typeof Worker>[1]) =>
    new Worker(new URL('../../../runtime/claudeCode/forkWorker.ts', import.meta.url), options)
}))
vi.mock('@main/ai/runtime/claudeCode/forkValidationWorker?nodeWorker', () => ({
  default: (options: ConstructorParameters<typeof Worker>[1]) =>
    new Worker(new URL('../../../runtime/claudeCode/forkValidationWorker.ts', import.meta.url), options)
}))

const dbh = setupTestDatabase()
const runtime = new AgentSessionRuntimeService()
let directory: string
const previous = runtimeDriverRegistry.getAgentSessionDriver('claude-code')
afterEach(async () => {
  runtimeDriverRegistry.clearForTest()
  if (previous) runtimeDriverRegistry.register(previous)
  vi.restoreAllMocks()
  if (directory) await rm(directory, { recursive: true, force: true })
})

it.each(['summary', 'boundary'] as const)(
  'edits the first input after compaction using the %s anchor',
  async (anchor) => {
    directory = await mkdtemp(path.join(tmpdir(), 'claude-compact-edit-'))
    const runtimeSessionId = '374c8467-e787-4c67-b890-a3d91b50dba6'
    const user = '20249b48-e174-4610-84c2-af6224228290'
    const reply = '8ac51a42-1adb-4fe0-a139-64af7af18232'
    const boundary = '590bf21c-a5c3-413d-821e-cd33a4016d33'
    const summary = '2fcdb52e-39d4-4cc9-aee0-53db2df99c33'
    const prompt = '781c8715-59da-426a-8688-481660b69d16'
    const answer = '9ad4b714-fe5d-4664-9f76-2b0cd13f4c03'
    const entries = [
      {
        type: 'user',
        uuid: user,
        parentUuid: null,
        sessionId: runtimeSessionId,
        message: { role: 'user', content: 'PRESERVED_USER' }
      },
      {
        type: 'assistant',
        uuid: reply,
        parentUuid: user,
        sessionId: runtimeSessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: 'PRESERVED_REPLY' }] }
      },
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: boundary,
        parentUuid: null,
        logicalParentUuid: reply,
        sessionId: runtimeSessionId,
        compactMetadata: { trigger: 'manual', preTokens: 1000 }
      },
      {
        type: 'user',
        uuid: summary,
        parentUuid: boundary,
        sessionId: runtimeSessionId,
        isCompactSummary: true,
        message: { role: 'user', content: 'COMPACT_SUMMARY secret=24250' }
      },
      {
        type: 'user',
        uuid: prompt,
        parentUuid: summary,
        sessionId: runtimeSessionId,
        message: { role: 'user', content: 'POST_COMPACT_PROMPT' }
      },
      {
        type: 'assistant',
        uuid: answer,
        parentUuid: prompt,
        sessionId: runtimeSessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: 'POST_COMPACT_REPLY' }] }
      }
    ]
    const sourceFile = path.join(directory, 'projects', 'project', runtimeSessionId + '.jsonl')
    await mkdir(path.dirname(sourceFile), { recursive: true })
    const source = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    await writeFile(sourceFile, source)
    const originalPath = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.agents.forks' ? path.join(directory, 'forks', filename ?? '') : originalPath(key, filename)
    )
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Claude', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'work', type: 'user', name: 'Work', path: directory, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'product', agentId: 'agent', workspaceId: 'work', name: 'Tree', orderKey: 'a0' })
      .run()
    runtimeDriverRegistry.register({
      type: 'claude-code',
      fork: forkClaudeSession,
      isForkCheckpoint: (value) => ClaudeForkCheckpointSchema.safeParse(value).success,
      validateSession() {},
      async connect() {
        throw new Error('No model needed')
      }
    })
    const context = prepareClaudeBranch('product', directory, runtimeSessionId)
    const checkpoint = (messageUuid: string) => ({
      runtime: 'claude-code' as const,
      runtimeSessionId,
      messageUuid,
      configDir: directory
    })
    const save = (role: 'user' | 'assistant', text: string, anchor?: ReturnType<typeof checkpoint>) =>
      messages.saveMessage({
        sessionId: 'product',
        ...(anchor
          ? { runtimeResumeToken: runtimeSessionId, nativeContextId: context.id, runtimeAnchor: { checkpoint: anchor } }
          : {}),
        message: { role, status: 'success', data: { parts: [{ type: 'text', text }] } }
      })
    save('user', '/compact')
    save('assistant', 'Compacted', checkpoint(anchor === 'summary' ? summary : boundary))
    const first = save('user', 'POST_COMPACT_PROMPT')
    save('assistant', 'POST_COMPACT_REPLY', checkpoint(answer))
    const second = save('user', 'Second')
    const actions = runtime.getHistoryActions('product', [first.id, second.id])
    expect(actions.get(first.id)?.edit).toBeNull()
    expect(actions.get(second.id)?.edit).toBeNull()
    const driver = runtimeDriverRegistry.getAgentSessionDriver('claude-code')
    const target = { role: 'user' as const, delivery: null }
    expect(getEditFailure(driver, target, { role: 'assistant', status: 'success', anchor: undefined })).toBe(
      'checkpoint_unsupported'
    )
    expect(
      getEditFailure(driver, target, {
        role: 'assistant',
        status: 'success',
        anchor: { checkpoint: checkpoint('invalid') }
      })
    ).toBe('checkpoint_unsupported')

    const rowsBefore = dbh.db.select().from(agentSessionTable).all()
    const messagesBefore = dbh.db.select().from(agentSessionMessageTable).all()
    const nativeFilesBefore = await readdir(path.join(directory, 'projects'), { recursive: true })
    const version = messages.readEditSnapshotTx(dbh.db, 'product', first.id).version
    const operation = new AgentSessionForkOperations().edit(
      'product',
      { messageId: first.id, version },
      async () => {},
      (tx, nativeId) => {
        const [row] = messages.saveMessagesTx(tx, {
          sessionId: 'product',
          messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Edited' }] } }]
        })
        reserveClaudeBranchTx(tx, 'product', row.id, nativeId)
        messages.setEditRuntimeTx(tx, 'product', row.id, nativeId)
        return { row, nativeId }
      }
    )
    if (anchor === 'boundary') {
      await expect(operation).rejects.toMatchObject({ reason: 'unsupported_checkpoint' })
      expect(dbh.db.select().from(agentSessionTable).all()).toEqual(rowsBefore)
      expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(messagesBefore)
      expect(await readdir(path.join(directory, 'projects'), { recursive: true })).toEqual(nativeFilesBefore)
      expect(await readdir(path.join(directory, 'forks'))).toEqual([])
      expect(await readFile(sourceFile, 'utf8')).toBe(source)
      return
    }
    const result = await operation
    const projects = path.join(directory, 'projects')
    const files = await Promise.all(
      (await readdir(projects)).map(async (project) => {
        const file = path.join(projects, project, result.nativeId + '.jsonl')
        return readFile(file, 'utf8').catch(() => undefined)
      })
    )
    const restored = files.find((file) => file !== undefined)
    expect(restored).toBeDefined()
    expect(restored).toContain('COMPACT_SUMMARY secret=24250')
    expect(JSON.stringify(restored)).not.toContain('POST_COMPACT_PROMPT')
    expect(JSON.stringify(restored)).not.toContain('POST_COMPACT_REPLY')
    expect(await readFile(sourceFile, 'utf8')).toBe(source)
  }
)
