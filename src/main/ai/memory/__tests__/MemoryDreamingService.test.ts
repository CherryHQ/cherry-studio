import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelSessionTable, agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import type { AgentSessionTurnTerminalEvent } from '@main/ai/agentSession/AgentSessionRuntimeService'
import type { AiService } from '@main/ai/AiService'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import type { JobContext } from '@main/core/job/types'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { MemoryDreamingService } from '../MemoryDreamingService'
import { needsDreaming, observeMemory, readDreamingState, writeDreamingState } from '../memoryDreamingState'
import { memoryHash } from '../memoryFiles'
import { MemoryService, type MemorySession } from '../MemoryService'

describe('memory organization lifecycle and commit fences', () => {
  const dbh = setupTestDatabase()
  const scope = { kind: 'shared' } as const
  const approve = async () => () => undefined
  const generate = vi.fn<
    (input: Parameters<AiService['generateText']>[0]) => Promise<{ text: string; finishReason: string }>
  >(async () => ({
    text: '{"writes":[],"deletes":[]}',
    finishReason: 'stop'
  }))
  const busy = vi.fn(() => false)
  let fixture: string
  let memory: MemoryService
  let dreaming: MemoryDreamingService
  let session: MemorySession
  let chats: Emitter<ConversationCompletedEvent>
  let agentTurns: Emitter<AgentSessionTurnTerminalEvent>

  async function removeFixture(directory: string): Promise<void> {
    if (directory !== fixture && !directory.startsWith(`${fixture}${path.sep}`)) throw new Error('Outside fixture')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await removeFixture(target)
      else await unlink(target)
    }
    await rmdir(directory)
  }

  const job = (): JobContext<Record<string, never>> => ({
    jobId: 'memory-test',
    input: {},
    attempt: 1,
    parentId: null,
    metadata: {},
    signal: new AbortController().signal,
    patchMetadata: async () => undefined,
    reportProgress: () => undefined,
    logger: loggerService.withContext('MemoryDreamingTest')
  })

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'fixture::gpt-4o')
    generate.mockReset().mockResolvedValue({ text: '{"writes":[],"deletes":[]}', finishReason: 'stop' })
    busy.mockReset().mockReturnValue(false)
    chats = new Emitter()
    agentTurns = new Emitter()
    fixture = await mkdtemp(path.join(os.tmpdir(), 'cherry-memory-dreaming-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(fixture, key, name ?? ''))
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'fixture', name: 'Fixture', orderKey: 'a0', isEnabled: true })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'fixture::gpt-4o',
        providerId: 'fixture',
        modelId: 'gpt-4o',
        name: 'Fixture',
        capabilities: [],
        supportsStreaming: true,
        contextWindow: 128000,
        maxInputTokens: 100000,
        maxOutputTokens: 32000,
        orderKey: 'a0'
      })
      .run()
    memory = new MemoryService()
    dreaming = new MemoryDreamingService()
    MockApplicationUtils.setService('MemoryService', memory)
    MockApplicationUtils.setService('AiService', { generateText: generate })
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      hasBusySessions: busy,
      onTurnTerminal: agentTurns.event
    })
    MockApplicationUtils.setService('AiStreamManager', {
      listActiveWork: () => [],
      onConversationCompleted: chats.event
    })
    await memory._doInit()
    await dreaming._doInit()
    session = memory.open({ scope, assertAuthorized: () => undefined })
  })

  afterEach(async () => {
    await dreaming._doStop()
    session.dispose()
    await memory._doStop()
    chats.dispose()
    agentTurns.dispose()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
    await removeFixture(fixture)
  })

  async function save(content: string, target = 'MEMORY.md') {
    const read = await session.read(target)
    return session.commit([{ kind: 'write', receipt: read.receipt, content }], approve)
  }

  it('processes smaller due topics past an unfit topic and retries the blocked file only after it changes', async () => {
    dbh.db.update(userModelTable).set({ maxOutputTokens: 4096 }).run()
    await save('Entry that is not due')
    const large = '.memories/a-large.md'
    const small = '.memories/b-small.md'
    for (let index = 0; index < 10; index++) {
      await save(`Large ${index}: ${'reason '.repeat(3000)}`, large)
      await save(`Small ${index}`, small)
    }
    const original = (await session.read(large)).content
    await expect(dreaming.execute(job())).resolves.toMatchObject({ checked: 2 })
    const state = readDreamingState(scope)
    expect(state.files[small]).toMatchObject({ changes: 0, processedHash: (await session.read(small)).hash })
    expect(state.files[large]).toMatchObject({ changes: 10, attempts: 2, reason: 'budget' })
    expect(state.files[large].processedHash).toBeUndefined()
    expect((await session.read(large)).content).toBe(original)
    await dreaming.execute(job())
    await dreaming.execute(job())
    expect(generate).toHaveBeenCalledTimes(1)
    await save('Now the large topic fits', large)
    await expect(dreaming.execute(job())).resolves.toMatchObject({ checked: 3 })
    expect(readDreamingState(scope).files[large]).toMatchObject({
      changes: 0,
      processedHash: (await session.read(large)).hash
    })
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('defers a topic that fits alone to the next batch without exhausting its attempts', async () => {
    dbh.db.update(userModelTable).set({ maxOutputTokens: 4096 }).run()
    await save('Entry')
    const topics = ['.memories/a.md', '.memories/b.md']
    for (let index = 0; index < 10; index++)
      for (const target of topics) await save(`${index} ${'reason '.repeat(1000)}`, target)
    await expect(dreaming.execute(job())).resolves.toMatchObject({ checked: 2 })
    expect(readDreamingState(scope).files[topics[1]]).toMatchObject({ changes: 10, attempts: 0 })
    await expect(dreaming.execute(job())).resolves.toMatchObject({ checked: 2 })
    for (const target of topics)
      expect(readDreamingState(scope).files[target]).toMatchObject({
        changes: 0,
        processedHash: (await session.read(target)).hash
      })
  })

  it('keeps an unfit required entry intact and blocks repeated preflight until a fresh request', async () => {
    dbh.db.update(userModelTable).set({ maxOutputTokens: 4096 }).run()
    const original = 'reason '.repeat(3000)
    await save(original)
    dreaming.request(scope)
    await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'budget' })
    expect(readDreamingState(scope).files['MEMORY.md']).toMatchObject({ attempts: 2, reason: 'budget' })
    await expect(dreaming.execute(job())).resolves.toMatchObject({ deferred: true })
    expect(generate).not.toHaveBeenCalled()
    expect((await session.read('MEMORY.md')).content).toBe(original)
  })

  function conversation(enabled = true, text = 'Please remember: I prefer concise answers.') {
    const assistantId = randomUUID()
    const topicId = randomUUID()
    dbh.db
      .insert(assistantTable)
      .values({
        id: assistantId,
        name: 'Memory assistant',
        emoji: '',
        orderKey: 'a0',
        settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableSharedMemory: enabled }
      })
      .run()
    dbh.db.insert(topicTable).values({ id: topicId, assistantId, orderKey: 'a0' }).run()
    const [root] = dbh.db
      .insert(messageTable)
      .values({ topicId, role: 'root', data: { parts: [] }, status: 'success', parentId: null })
      .returning()
      .all()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100)
    const [user] = dbh.db
      .insert(messageTable)
      .values({
        topicId,
        parentId: root.id,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text }] }
      })
      .returning()
      .all()
    const [response] = dbh.db
      .insert(messageTable)
      .values({
        topicId,
        parentId: user.id,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Assistant-only unsupported claim' }] },
        messageSnapshot: {
          id: assistantId,
          name: 'Memory assistant',
          model: { id: 'gpt-4o', name: 'Fixture', provider: 'fixture' }
        }
      })
      .returning()
      .all()
    const emit = () =>
      chats.fire({ topicId, turnId: response.id, completedAt: Date.now(), memoryResponseIds: [response.id] })
    return { assistantId, topicId, user, response, emit }
  }

  it('extracts authorized new user evidence with organization off, preserves facts, and recovers the actual append', async () => {
    await save('Existing fact with an exception.\n')
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
    const chat = conversation()
    generate.mockResolvedValueOnce({ text: '{"quotes":["I prefer concise answers."]}', finishReason: 'stop' })
    chat.emit()
    expect(await dreaming.execute(job())).toEqual({ extracted: 1 })
    expect((await session.read('MEMORY.md')).content).toBe(
      'Existing fact with an exception.\n- "I prefer concise answers."\n'
    )
    expect(generate.mock.calls[0][0]).toMatchObject({
      disableTools: true,
      contextOwner: 'caller',
      requestOptions: { maxRetries: 0 }
    })
    expect(JSON.parse(generate.mock.calls[0][0].prompt!)).toEqual({
      userText: 'Please remember: I prefer concise answers.',
      existingMemory: 'Existing fact with an exception.\n'
    })
    expect(JSON.stringify(dbh.db.select().from(appStateTable).all())).not.toContain('concise answers')
    chat.emit()
    expect(await dreaming.execute(job())).toEqual({ idle: true })
    const recovery = await session.previewRecovery()
    await session.recover(recovery!.token, approve)
    expect((await session.read('MEMORY.md')).content).toBe('Existing fact with an exception.\n')
  })

  it.each([
    'edit',
    'delete-user',
    'delete-response',
    'delete-topic',
    'owner',
    'access-off-on',
    'parent-off-on',
    'clear',
    'recovery',
    'cancel',
    'foreground'
  ] as const)('rejects delayed extraction after %s', async (action) => {
    await save('Original fact')
    const chat = conversation()
    const response = Promise.withResolvers<{ text: string; finishReason: string }>()
    generate.mockImplementationOnce(() => response.promise)
    chat.emit()
    const outcome = dreaming.execute(job()).catch((error: unknown) => error)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    if (action === 'edit')
      dbh.db
        .update(messageTable)
        .set({ data: { parts: [{ type: 'text', text: 'Changed source' }] } })
        .where(eq(messageTable.id, chat.user.id))
        .run()
    if (action === 'delete-user') dbh.db.delete(messageTable).where(eq(messageTable.id, chat.user.id)).run()
    if (action === 'delete-response') dbh.db.delete(messageTable).where(eq(messageTable.id, chat.response.id)).run()
    if (action === 'delete-topic') dbh.db.delete(topicTable).where(eq(topicTable.id, chat.topicId)).run()
    if (action === 'owner')
      dbh.db.update(topicTable).set({ assistantId: null }).where(eq(topicTable.id, chat.topicId)).run()
    if (action === 'access-off-on') {
      assistantDataService.update(chat.assistantId, { settings: { enableSharedMemory: false } })
      assistantDataService.update(chat.assistantId, { settings: { enableSharedMemory: true } })
    }
    if (action === 'parent-off-on') {
      await application.get('PreferenceService').set('feature.memory.generation.enabled', false)
      await application.get('PreferenceService').set('feature.memory.generation.enabled', true)
    }
    if (action === 'clear') await session.clear((await session.previewClear()).token, approve)
    if (action === 'recovery') await session.recover((await session.previewRecovery())!.token, approve)
    if (action === 'cancel') dreaming.cancel(scope)
    if (action === 'foreground') busy.mockReturnValue(true)
    response.resolve({ text: '{"quotes":["I prefer concise answers."]}', finishReason: 'stop' })
    expect(await outcome).toBeInstanceOf(Error)
    expect((await session.read('MEMORY.md')).content).not.toContain('concise answers')
  })

  it.each(['unsupported', 'oversized', 'invalid-json', 'truncated'] as const)(
    'retains memory when extraction output is %s',
    async (kind) => {
      await save('Original fact')
      conversation().emit()
      generate.mockResolvedValueOnce({
        text:
          kind === 'unsupported'
            ? '{"quotes":["Assistant-only unsupported claim"]}'
            : kind === 'oversized'
              ? JSON.stringify({ quotes: ['x'.repeat(501)] })
              : kind === 'invalid-json'
                ? 'no'
                : '{"quotes":[]}',
        finishReason: kind === 'truncated' ? 'length' : 'stop'
      })
      await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'output' })
      expect((await session.read('MEMORY.md')).content).toBe('Original fact')
      expect(dreaming.status(scope).lastResult).toMatchObject({ outcome: 'failed', reason: 'output' })
    }
  )

  it('does not backfill historical, disabled, cancelled, cleared, or restarted conversation work', async () => {
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
    const old = conversation()
    dbh.db.update(messageTable).set({ createdAt: 1 }).where(eq(messageTable.id, old.user.id)).run()
    old.emit()
    conversation(false).emit()
    const pending = conversation()
    pending.emit()
    await session.clear((await session.previewClear()).token, approve)
    pending.emit()
    expect(await dreaming.execute(job())).toEqual({ idle: true })
    const afterClear = conversation()
    afterClear.emit()
    await dreaming._doStop()
    BaseService.resetInstances()
    dreaming = new MemoryDreamingService()
    await dreaming._doInit()
    afterClear.emit()
    expect(await dreaming.execute(job())).toEqual({ idle: true })
    expect(generate).not.toHaveBeenCalled()
  })

  it('does not cancel extraction when only the organization child is switched off', async () => {
    conversation().emit()
    const response = Promise.withResolvers<{ text: string; finishReason: string }>()
    generate.mockImplementationOnce(() => response.promise)
    const outcome = dreaming.execute(job())
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
    response.resolve({ text: '{"quotes":["I prefer concise answers."]}', finishReason: 'stop' })
    expect(await outcome).toEqual({ extracted: 1 })
  })

  it.each(['desktop', 'channel', 'background', 'headless', 'failed', 'disabled'] as const)(
    'enforces %s agent source eligibility',
    async (kind) => {
      await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
      const agentId = randomUUID(),
        sessionId = randomUUID(),
        workspaceId = randomUUID()
      dbh.db
        .insert(agentTable)
        .values({
          id: agentId,
          type: 'pi',
          name: 'Agent',
          instructions: '',
          orderKey: 'a0',
          configuration: { shared_memory_enabled: kind !== 'disabled' }
        })
        .run()
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: workspaceId, name: 'W', path: '/workspace', orderKey: 'a0' })
        .run()
      dbh.db
        .insert(agentSessionTable)
        .values({
          id: sessionId,
          agentId,
          workspaceId,
          name: 'S',
          orderKey: 'a0',
          type: kind === 'background' ? 'background' : 'conversation'
        })
        .run()
      if (kind === 'channel') {
        const channelId = randomUUID()
        dbh.db
          .insert(agentChannelTable)
          .values({ id: channelId, name: 'C', type: 'telegram', agentId, workspace: { type: 'system' }, config: {} })
          .run()
        dbh.db.insert(agentChannelSessionTable).values({ sessionId, channelId }).run()
      }
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100)
      const [user] = dbh.db
        .insert(agentSessionMessageTable)
        .values({
          sessionId,
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'I prefer concise answers.' }] }
        })
        .returning()
        .all()
      const [response] = dbh.db
        .insert(agentSessionMessageTable)
        .values({
          sessionId,
          role: 'assistant',
          status: kind === 'failed' ? 'error' : 'success',
          data: { parts: [] },
          messageSnapshot: { id: agentId, name: 'Agent', model: { id: 'gpt-4o', name: 'Fixture', provider: 'fixture' } }
        })
        .returning()
        .all()
      generate.mockResolvedValueOnce({ text: '{"quotes":["I prefer concise answers."]}', finishReason: 'stop' })
      agentTurns.fire({
        sessionId,
        assistantMessageId: response.id,
        status: 'success',
        boundary: 'turn',
        ...(kind === 'headless' ? {} : { memoryUserMessageId: user.id })
      })
      expect(await dreaming.execute(job())).toEqual(kind === 'desktop' ? { extracted: 1 } : { idle: true })
      expect((await session.read('MEMORY.md')).content ?? '').toBe(
        kind === 'desktop' ? '- "I prefer concise answers."\n' : ''
      )
    }
  )

  it('counts only changed controlled writes and keeps the earliest pending time across recovery', async () => {
    await save('First fact')
    const initial = readDreamingState(scope).files['MEMORY.md']
    expect(initial).toMatchObject({ changes: 1, pendingSince: expect.any(Number) })
    await save('First fact')
    await save('Second fact')
    const recovery = await session.previewRecovery()
    await session.recover(recovery!.token, approve)
    expect((await session.read('MEMORY.md')).content).toBe('First fact')
    const file = readDreamingState(scope).files['MEMORY.md']
    expect(file.changes).toBe(2)
    expect(file.pendingSince).toBe(initial.pendingSince)
    expect(needsDreaming(file, initial.pendingSince! + 7 * 24 * 60 * 60_000)).toBe(true)
  })

  it('runs an explicit request with automatic organization off and persists no-op progress without file bodies', async () => {
    await save('Keep this complete fact')
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
    dreaming.request(scope)
    expect(await dreaming.execute(job())).toMatchObject({ checked: 1, changed: 0 })
    expect((await session.read('MEMORY.md')).content).toBe('Keep this complete fact')
    expect(readDreamingState(scope).files['MEMORY.md']).toMatchObject({ changes: 0, processedAt: expect.any(Number) })
    expect(readDreamingState(scope).files['MEMORY.md'].pendingSince).toBeUndefined()
    expect(dreaming.status(scope).lastResult).toMatchObject({ outcome: 'completed', finishedAt: expect.any(Number) })
    expect(JSON.stringify(dbh.db.select().from(appStateTable).all())).not.toContain('Keep this complete fact')
  })

  it.each(['cancel', 'disable', 'foreground', 'external-edit', 'clear'] as const)(
    'does not publish delayed model output after %s',
    async (action) => {
      await save('Original fact')
      const response = Promise.withResolvers<{ text: string; finishReason: string }>()
      generate.mockImplementationOnce(() => response.promise)
      dreaming.request(scope)
      const outcome = dreaming.execute(job()).catch((error: unknown) => error)
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
      if (action === 'cancel') dreaming.cancel(scope)
      if (action === 'disable') await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
      if (action === 'foreground') busy.mockReturnValue(true)
      if (action === 'external-edit')
        await writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'External edit')
      if (action === 'clear') await session.clear((await session.previewClear()).token, approve)
      response.resolve({
        text: '{"writes":[{"path":"MEMORY.md","content":"Stale model output"}],"deletes":[]}',
        finishReason: 'stop'
      })
      expect(await outcome).toBeInstanceOf(Error)
      expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe(
        action === 'external-edit' ? 'External edit' : action === 'clear' ? '' : 'Original fact'
      )
    }
  )

  it.each(['automatic', 'manual'] as const)('allows %s organization while chat generation is off', async (mode) => {
    await application.get('PreferenceService').set('feature.memory.generation.enabled', false)
    for (let i = 0; i < 10; i++) await save(`Fact ${i}`)
    if (mode === 'manual') {
      await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
      dreaming.request(scope)
    }
    expect(await dreaming.execute(job())).toMatchObject({ checked: 1, changed: 0 })
    expect((await session.read('MEMORY.md')).content).toBe('Fact 9')
    expect(dreaming.status(scope).lastResult?.outcome).toBe('completed')
  })

  it('does not cancel in-flight organization when chat generation is disabled', async () => {
    await save('Original fact')
    const response = Promise.withResolvers<{ text: string; finishReason: string }>()
    generate.mockImplementationOnce(() => response.promise)
    dreaming.request(scope)
    const outcome = dreaming.execute(job())
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    await application.get('PreferenceService').set('feature.memory.generation.enabled', false)
    response.resolve({ text: '{"writes":[],"deletes":[]}', finishReason: 'stop' })
    expect(await outcome).toMatchObject({ checked: 1, changed: 0 })
    expect((await session.read('MEMORY.md')).content).toBe('Original fact')
  })

  it('keeps the last failed result after disabling organization instead of reporting idle as success', async () => {
    await save('A fact to retain')
    generate.mockResolvedValueOnce({ text: 'Invalid proposal', finishReason: 'stop' })
    dreaming.request(scope)
    await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'output' })
    const failed = dreaming.status(scope).lastResult
    expect(failed).toMatchObject({ outcome: 'failed', reason: 'output', finishedAt: expect.any(Number) })
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
    expect(dreaming.status(scope)).toMatchObject({ status: 'idle', lastResult: failed })
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', true)
    dreaming.request(scope)
    await dreaming.execute(job())
    expect(dreaming.status(scope).lastResult?.outcome).toBe('completed')
  })

  it('rejects deletion while another memory file still links to the source', async () => {
    await save('[Details](.memories/old.md)')
    await save('Fact with its exception', '.memories/old.md')
    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        writes: [{ path: '.memories/new.md', content: 'Fact with its exception' }],
        deletes: [{ path: '.memories/old.md', transferTo: '.memories/new.md' }]
      }),
      finishReason: 'stop'
    })
    dreaming.request(scope)
    await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'output' })
    expect((await session.read('.memories/old.md')).content).toBe('Fact with its exception')
    expect((await session.read('.memories/new.md')).content).toBeNull()
  })

  it.each(['MEMORY.md', '../outside.md', '.memories/old.md', '.memories/nested/new.md'])(
    'rejects invalid transfer destination %s before any write',
    async (transferTo) => {
      const original = 'Fact with its exception\n'
      await save('[Details](.memories/old.md)')
      await save(original, '.memories/old.md')
      generate.mockResolvedValueOnce({
        text: JSON.stringify({
          writes: [{ path: transferTo, content: original }],
          deletes: [{ path: '.memories/old.md', transferTo }]
        }),
        finishReason: 'stop'
      })
      dreaming.request(scope)
      await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'output' })
      expect((await session.read('MEMORY.md')).content).toBe('[Details](.memories/old.md)')
      expect((await session.read('.memories/old.md')).content).toBe(original)
      expect(await session.list()).toEqual(['.memories/old.md', 'MEMORY.md'])
    }
  )

  it('rejects a rewritten transfer that omits part of the source', async () => {
    await save('[Details](.memories/old.md)')
    await save('Prefer concise answers, except when debugging.\n', '.memories/old.md')
    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        writes: [
          { path: '.memories/new.md', content: 'Prefer concise answers.\n' },
          { path: 'MEMORY.md', content: '[Details](.memories/new.md)' }
        ],
        deletes: [{ path: '.memories/old.md', transferTo: '.memories/new.md' }]
      }),
      finishReason: 'stop'
    })
    dreaming.request(scope)
    await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'output' })
    expect((await session.read('MEMORY.md')).content).toBe('[Details](.memories/old.md)')
    expect((await session.read('.memories/old.md')).content).toBe('Prefer concise answers, except when debugging.\n')
    expect((await session.read('.memories/new.md')).content).toBeNull()
  })

  it('writes the complete destination and updated link before removing the transferred topic', async () => {
    await save('[Details](.memories/old.md)')
    await save('Fact with its exception', '.memories/old.md')
    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        writes: [
          { path: '.memories/new.md', content: 'Fact with its exception' },
          { path: 'MEMORY.md', content: '[Details](.memories/new.md)' }
        ],
        deletes: [{ path: '.memories/old.md', transferTo: '.memories/new.md' }]
      }),
      finishReason: 'stop'
    })
    dreaming.request(scope)
    expect(await dreaming.execute(job())).toMatchObject({ changed: 3, checked: 3 })
    expect((await session.read('MEMORY.md')).content).toBe('[Details](.memories/new.md)')
    expect((await session.read('.memories/new.md')).content).toBe('Fact with its exception')
    expect((await session.read('.memories/old.md')).content).toBeNull()
    expect(readDreamingState(scope).files['.memories/new.md'].changes).toBe(0)
    const recovery = await session.previewRecovery()
    await session.recover(recovery!.token, approve)
    expect((await session.read('MEMORY.md')).content).toBe('[Details](.memories/old.md)')
    expect((await session.read('.memories/old.md')).content).toBe('Fact with its exception')
    expect((await session.read('.memories/new.md')).content).toBeNull()
  })

  it('serializes extraction and organization even when a cancelled model ignores its signal', async () => {
    await save('Original fact')
    conversation().emit()
    const response = Promise.withResolvers<{ text: string; finishReason: string }>()
    generate.mockImplementationOnce(() => response.promise)
    const controller = new AbortController()
    const first = dreaming.execute({ ...job(), signal: controller.signal }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    controller.abort()
    dreaming.cancel(scope)
    dreaming.request(scope)
    const second = dreaming.execute(job())
    await Promise.resolve()
    expect(generate).toHaveBeenCalledTimes(1)
    response.resolve({ text: '{"quotes":["I prefer concise answers."]}', finishReason: 'stop' })
    expect(await first).toBeInstanceOf(Error)
    expect(await second).toMatchObject({ checked: 1, changed: 0 })
    expect((await session.read('MEMORY.md')).content).toBe('Original fact')
  })

  it('preserves the seven-day deadline when external content changes without inventing edits', () => {
    const state = readDreamingState(scope)
    const original = { path: 'MEMORY.md', content: 'First', hash: memoryHash(Buffer.from('First')) }
    observeMemory(state, original, 1000)
    writeDreamingState(state)
    const restored = readDreamingState(scope)
    observeMemory(restored, { ...original, content: 'Second', hash: memoryHash(Buffer.from('Second')) }, 2000)
    expect(restored.files['MEMORY.md']).toMatchObject({ changes: 0, pendingSince: 1000 })
    expect(needsDreaming(restored.files['MEMORY.md'], 1000 + 7 * 24 * 60 * 60_000)).toBe(true)
  })

  it('abandons a queued generation on lifecycle restart', async () => {
    dreaming.request(scope)
    const previous = readDreamingState(scope).generation
    await dreaming._doStop()
    await dreaming._doInit()
    expect(readDreamingState(scope)).toMatchObject({ generation: previous + 1, manual: false, status: 'cancelled' })
  })
})
