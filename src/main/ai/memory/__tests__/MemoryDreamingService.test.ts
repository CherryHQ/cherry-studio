import '@data/services/AgentSessionMessageService'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
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
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import type { AgentSessionTurnTerminalEvent } from '@main/ai/agentSession/AgentSessionRuntimeService'
import type { AiService } from '@main/ai/AiService'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import type { JobContext } from '@main/core/job/types'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { MemoryDreamingService } from '../MemoryDreamingService'
import { needsDreaming, observeMemory, readDreamingState, writeDreamingState } from '../memoryDreamingState'
import { parseMemoryEntries, serializeMemoryEntries } from '../memoryEntries'
import { extractContextCandidates, readExtractionRange } from '../memoryExtraction'
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

  function previewFixture() {
    const chat = conversation(true, '这台 Windows 机器缺少 ATL，系统语音组件编译不了。')
    const [user] = dbh.db
      .insert(messageTable)
      .values({
        topicId: chat.topicId,
        parentId: chat.response.id,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: '以后本机默认跳过这个组件的编译，其他构建照常。' }] }
      })
      .returning()
      .all()
    const [response] = dbh.db
      .insert(messageTable)
      .values({
        topicId: chat.topicId,
        parentId: user.id,
        role: 'assistant',
        status: 'success',
        data: { parts: [] },
        messageSnapshot: chat.response.messageSnapshot
      })
      .returning()
      .all()
    return {
      chat,
      range: {
        source: { kind: 'assistant' as const, topicId: chat.topicId, responseId: response.id },
        fromMessageId: chat.user.id
      }
    }
  }

  function candidateReply(input: Parameters<AiService['generateText']>[0]) {
    const prompt = JSON.parse(input.prompt!)
    return {
      outcome: 'candidates',
      reason: 'Explicit reusable local constraint',
      candidates: [
        {
          text: '在这台 Windows 机器上，因缺少 ATL，默认跳过系统语音组件编译；其他构建照常。',
          subject: '当前机器',
          scope: 'project',
          kind: 'constraint',
          conditions: '仅本机；其他构建照常',
          time: '',
          usefulness: '避免重复尝试无法编译的组件',
          action: 'add',
          reason: '明确长期约束',
          evidence: prompt.messages
            .filter((message: { role: string }) => message.role === 'user')
            .map((message: { id: string; text: string }) => ({
              messageId: message.id,
              quote: message.text
            })),
          existing: []
        }
      ]
    }
  }

  function automaticReply(candidates = [{ kind: 'preference', quote: 'I prefer concise answers.' }]) {
    const input = generate.mock.calls.at(-1)![0]
    const messages = JSON.parse(input.prompt!).messages as { id: string; role: string; text: string }[]
    return JSON.stringify({
      outcome: candidates.length ? 'candidates' : 'no_eligible',
      reason: 'Fixture evidence',
      candidates: candidates.map(({ kind, quote }) => ({
        text: quote,
        subject: 'user',
        scope: ['project', 'customer', 'uncertain'].includes(kind) ? kind : 'personal',
        kind: ['project', 'customer'].includes(kind) ? 'personal_fact' : kind,
        conditions: '',
        time: '',
        usefulness: 'Personalize future assistance',
        action: 'add',
        reason: 'Explicit user evidence',
        evidence: [
          {
            messageId:
              messages.find((message) => message.role === 'user' && message.text.includes(quote))?.id ?? 'invalid',
            quote
          }
        ],
        existing: []
      }))
    })
  }

  it.each([true, false])('blocks preview for forgotten source (known=%s)', async (known) => {
    const { chat, range } = previewFixture()
    await save('')
    const content = serializeMemoryEntries([
      {
        schemaVersion: 1,
        id: 'forgotten',
        status: 'forgotten',
        text: '',
        derivedFrom: [],
        sources: known
          ? [{ kind: 'chat', conversationId: chat.topicId, messageId: chat.user.id, sourceVersion: 'old-version' }]
          : []
      }
    ])
    const target = application.getPath('feature.memory.data', 'MEMORY.md')
    await writeFile(target, content)
    const inputs: string[] = []
    generate.mockImplementation(async (input) => {
      inputs.push(input.prompt ?? '')
      return { text: JSON.stringify(candidateReply(input)), finishReason: 'stop' }
    })
    await expect(dreaming.previewExtraction(range, () => undefined)).rejects.toThrow()
    expect(inputs).toEqual([])
    expect(await readFile(target, 'utf8')).toBe(content)
  })

  it('filters actual candidate input and rejects a result after scope state changes', async () => {
    const { range } = previewFixture()
    await save('')
    const target = application.getPath('feature.memory.data', 'MEMORY.md')
    const entries = [
      {
        schemaVersion: 1 as const,
        id: 'old',
        status: 'expired' as const,
        text: 'expired secret',
        derivedFrom: [],
        sources: [
          { kind: 'chat' as const, conversationId: 'other-topic', messageId: 'other-message', sourceVersion: 'v1' }
        ]
      }
    ]
    await writeFile(target, serializeMemoryEntries(entries))
    let inputText: string | undefined
    generate.mockImplementationOnce(async (input) => {
      inputText = input.prompt!
      await writeFile(target, serializeMemoryEntries([{ ...entries[0], status: 'forgotten', text: '' }]))
      return { text: JSON.stringify(candidateReply(input)), finishReason: 'stop' }
    })
    await expect(dreaming.previewExtraction(range, () => undefined)).rejects.toThrow()
    expect(inputText).toContain('messages')
    expect(inputText).not.toContain('expired secret')
    expect(await readFile(target, 'utf8')).toContain('forgotten')
  })

  it('previews a complete multi-turn candidate with topic memory without saving, advancing a cursor or reading a sibling', async () => {
    const { chat, range } = previewFixture()
    await save('已有入口')
    await save('本机仍然执行其他构建。', '.memories/build.md')
    const source = readExtractionRange(range, 0)
    const existing = await session.read('.memories/build.md')
    dbh.db
      .insert(messageTable)
      .values({
        topicId: chat.topicId,
        parentId: chat.user.parentId,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Sibling must not be read' }] }
      })
      .run()
    generate.mockImplementationOnce(async (input) => {
      const prompt = JSON.parse(input.prompt!)
      expect(prompt.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant', 'user'])
      expect(input.prompt).not.toContain('Sibling must not be read')
      expect(prompt.existingMemory).toContainEqual(
        expect.objectContaining({ path: '.memories/build.md', content: '本机仍然执行其他构建。' })
      )
      for (const message of source.messages) expect(input.prompt).not.toContain(message.version)
      expect(input.prompt).not.toContain(existing.hash!)
      const reply = candidateReply(input)
      Object.assign(reply.candidates[0], {
        action: 'exists',
        existing: [{ path: '.memories/build.md', quote: '本机仍然执行其他构建。' }]
      })
      return { text: JSON.stringify(reply), finishReason: 'stop' }
    })
    const before = dbh.db.select().from(appStateTable).all()
    const result = await dreaming.previewExtraction(range, () => undefined)
    expect(result).toMatchObject({
      mode: 'preview',
      saveBlocked: 'forgetting_protection_required',
      calls: 1,
      candidates: [{ action: 'out_of_scope', evidence: [{ messageId: chat.user.id }, {}] }]
    })
    expect((await session.read('MEMORY.md')).content).toBe('已有入口')
    expect(result.candidates[0].evidence).toEqual(
      source.messages
        .filter((message) => message.role === 'user')
        .map((message) => ({ messageId: message.id, version: message.version, quote: message.text }))
    )
    expect(result.candidates[0].existing).toEqual([
      { path: '.memories/build.md', version: existing.hash, quote: '本机仍然执行其他构建。' }
    ])
    expect((await session.read('.memories/build.md')).content).toBe('本机仍然执行其他构建。')
    expect(dbh.db.select().from(appStateTable).all()).toEqual(before)
  })

  it.each([
    ['personal', 'experience', 'add'],
    ['personal', 'decision', 'add'],
    ['personal', 'constraint', 'add'],
    ['project', 'experience', 'out_of_scope'],
    ['customer', 'experience', 'out_of_scope'],
    ['uncertain', 'experience', 'insufficient']
  ])('classifies %s %s by ownership rather than rejecting all experiences', async (scope, kind, action) => {
    const text = 'I completed a charity run for mental health in May 2023.'
    const chat = conversation(true, text)
    await save('Existing memory')
    generate.mockImplementationOnce(async (input) => {
      const reply = candidateReply(input)
      Object.assign(reply.candidates[0], {
        text,
        subject: 'user',
        scope,
        kind,
        conditions: '',
        time: 'May 2023',
        usefulness: 'Recall the cause supported by the user when discussing future charity runs',
        reason: 'Supported information with a concrete future use'
      })
      return { text: JSON.stringify(reply), finishReason: 'stop' }
    })
    const result = await dreaming.previewExtraction(
      {
        source: { kind: 'assistant', topicId: chat.topicId, responseId: chat.response.id },
        fromMessageId: chat.user.id
      },
      () => undefined
    )
    expect(result).toMatchObject({
      saveBlocked: 'forgetting_protection_required',
      candidates: [{ text, action, scope, kind }]
    })
    expect((await session.read('MEMORY.md')).content).toBe('Existing memory')
  })

  it.each([
    'assistant-evidence',
    'invented-quote',
    'unknown-message',
    'injected-version',
    'invented-memory',
    'unknown-memory',
    'wrong-memory-quote'
  ])('rejects unsupported preview evidence: %s', async (kind) => {
    const { range } = previewFixture()
    generate.mockImplementationOnce(async (input) => {
      const output = candidateReply(input)
      const evidence = output.candidates[0].evidence[0]
      if (kind === 'assistant-evidence') {
        const message = JSON.parse(input.prompt!).messages[1]
        Object.assign(evidence, { messageId: message.id, quote: message.text })
      }
      if (kind === 'invented-quote') evidence.quote = '用户讨厌语音'
      if (kind === 'unknown-message') evidence.messageId = 'unknown'
      if (kind === 'injected-version') Object.assign(evidence, { version: 'stale' })
      if (kind === 'unknown-memory' || kind === 'wrong-memory-quote')
        Object.assign(output.candidates[0], {
          action: 'exists',
          existing: [{ path: kind === 'unknown-memory' ? '.memories/missing.md' : 'MEMORY.md', quote: 'invented' }]
        })
      if (kind === 'invented-memory') output.candidates[0].action = 'exists'
      return { text: JSON.stringify(output), finishReason: 'stop' }
    })
    await expect(dreaming.previewExtraction(range, () => undefined)).rejects.toMatchObject({ reason: 'output' })
    expect((await session.read('MEMORY.md')).content ?? '').toBe('')
  })

  it.each(['source-edit', 'memory-edit', 'cancel', 'clear', 'disable', 'revoke', 'stop'])(
    'discards a delayed preview after %s',
    async (kind) => {
      const { chat, range } = previewFixture()
      await save('Current memory')
      generate.mockImplementationOnce(async (input) => {
        if (kind === 'source-edit')
          dbh.db
            .update(messageTable)
            .set({ data: { parts: [{ type: 'text', text: 'edited' }] } })
            .where(eq(messageTable.id, chat.user.id))
            .run()
        if (kind === 'memory-edit') await save('Manual edit')
        if (kind === 'cancel') dreaming.cancel(scope)
        if (kind === 'clear') await session.clear((await session.previewClear()).token, approve)
        if (kind === 'disable')
          await application.get('PreferenceService').set('feature.memory.generation.enabled', false)
        if (kind === 'revoke')
          assistantDataService.update(chat.assistantId, {
            settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableSharedMemory: false }
          })
        if (kind === 'stop') controller.abort()
        return { text: JSON.stringify(candidateReply(input)), finishReason: 'stop' }
      })
      const controller = new AbortController()
      await expect(
        dreaming.previewExtraction(range, () => {
          controller.signal.throwIfAborted()
          return undefined
        })
      ).rejects.toBeInstanceOf(Error)
      expect((await session.read('MEMORY.md')).content ?? '').toBe(
        kind === 'clear' ? '' : kind === 'memory-edit' ? 'Manual edit' : 'Current memory'
      )
    }
  )

  it('rejects an unauthorized caller before reading sources or calling the model', async () => {
    const { range } = previewFixture()
    await expect(
      dreaming.previewExtraction(range, () => {
        throw new Error('denied')
      })
    ).rejects.toThrow('denied')
    expect(generate).not.toHaveBeenCalled()
  })

  it('does not revisit a range before the clear boundary, even on a manual preview', async () => {
    const { range } = previewFixture()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100)
    await session.clear((await session.previewClear()).token, approve)
    await expect(dreaming.previewExtraction(range, () => undefined)).rejects.toMatchObject({ reason: 'unavailable' })
    expect(generate).not.toHaveBeenCalled()
  })

  it.each(['no_eligible', 'insufficient'] as const)(
    'reports %s without pretending an empty extraction was saved',
    async (outcome) => {
      const { range } = previewFixture()
      generate.mockResolvedValueOnce({
        text: JSON.stringify({ outcome, reason: 'No supported durable claim', candidates: [] }),
        finishReason: 'stop'
      })
      expect(await dreaming.previewExtraction(range, () => undefined)).toMatchObject({
        mode: 'preview',
        candidates: [],
        batches: [{ outcome, reason: 'No supported durable claim' }]
      })
    }
  )

  it('rejects a selected start on a sibling branch without sending any text to the model', async () => {
    const { chat, range } = previewFixture()
    const [sibling] = dbh.db
      .insert(messageTable)
      .values({
        topicId: chat.topicId,
        parentId: chat.user.parentId,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Other branch' }] }
      })
      .returning()
      .all()
    await expect(
      dreaming.previewExtraction({ ...range, fromMessageId: sibling.id }, () => undefined)
    ).rejects.toBeInstanceOf(Error)
    expect(generate).not.toHaveBeenCalled()
  })

  it('splits a selected range into overlapping complete messages and checks every selected message', async () => {
    const { chat, range } = previewFixture()
    dbh.db
      .update(messageTable)
      .set({ data: { parts: [{ type: 'text', text: 'a'.repeat(7000) }] } })
      .where(eq(messageTable.id, chat.user.id))
      .run()
    dbh.db
      .update(messageTable)
      .set({ data: { parts: [{ type: 'text', text: 'b'.repeat(7000) }] } })
      .where(eq(messageTable.id, chat.response.id))
      .run()
    const [last] = dbh.db.select().from(messageTable).where(eq(messageTable.id, range.source.responseId)).all()
    dbh.db
      .update(messageTable)
      .set({ data: { parts: [{ type: 'text', text: 'c'.repeat(7000) }] } })
      .where(eq(messageTable.id, last.parentId!))
      .run()
    generate.mockResolvedValue({
      text: JSON.stringify({ outcome: 'no_eligible', reason: 'Filler text only', candidates: [] }),
      finishReason: 'stop'
    })
    const result = await dreaming.previewExtraction(range, () => undefined)
    expect(result.calls).toBe(2)
    const inputs = generate.mock.calls.map(([input]) => JSON.parse(input.prompt!))
    expect(inputs[0].messages.map((message: { id: string }) => message.id)).toEqual([chat.user.id, chat.response.id])
    expect(inputs[1].messages.map((message: { id: string }) => message.id)).toEqual([chat.response.id, last.parentId])
    expect(inputs[1].leftContextIncomplete).toBe(true)
  })

  it.each([
    'conflict',
    'cross-kind-conflict',
    'duplicate',
    'independent',
    'insufficient',
    'missing',
    'repeated',
    'unknown',
    'cancel',
    'edit'
  ])('reconciles cross-batch candidates without losing evidence or returning unchecked additions: %s', async (kind) => {
    const { chat, range } = previewFixture()
    const last = dbh.db.select().from(messageTable).where(eq(messageTable.id, range.source.responseId)).get()!
    const quotes = [
      '以后回答一律详细。',
      kind === 'duplicate'
        ? '以后回答都请详细展开。'
        : kind === 'independent'
          ? '以后使用中文回答。'
          : '更正：以后回答一律简短。'
    ]
    for (const [id, text] of [
      [chat.user.id, quotes[0]],
      [chat.response.id, '收到。'],
      [last.parentId!, quotes[1]]
    ]) {
      dbh.db
        .update(messageTable)
        .set({ data: { parts: [{ type: 'text', text: text + 'x'.repeat(7000) }] } })
        .where(eq(messageTable.id, id))
        .run()
    }
    let extractionCalls = 0
    generate.mockImplementation(async (input) => {
      const prompt = JSON.parse(input.prompt!)
      if (prompt.messages) {
        const message = prompt.messages.find((item: { role: string }) => item.role === 'user')
        const quote = quotes[extractionCalls++]
        const candidate = {
          ...candidateReply(input).candidates[0],
          text: quote,
          subject: '用户',
          scope: 'personal',
          kind: kind === 'cross-kind-conflict' && extractionCalls === 2 ? 'decision' : 'preference',
          conditions: '',
          evidence: [{ messageId: message.id, quote }]
        }
        return {
          text: JSON.stringify({ outcome: 'candidates', reason: 'Explicit preference', candidates: [candidate] }),
          finishReason: 'stop'
        }
      }
      expect(prompt.candidates.map((item: { text: string }) => item.text)).toEqual(quotes)
      expect(input.prompt).not.toContain('"version"')
      expect(
        prompt.candidates.flatMap((item: { evidence: { messageId: string }[] }) =>
          item.evidence.map((e) => e.messageId)
        )
      ).toEqual([chat.user.id, last.parentId])
      if (kind === 'cancel') dreaming.cancel(scope)
      if (kind === 'edit')
        dbh.db
          .update(messageTable)
          .set({ data: { parts: [{ type: 'text', text: 'edited' }] } })
          .where(eq(messageTable.id, chat.user.id))
          .run()
      const groups =
        kind === 'independent'
          ? [{ ids: [0, 1], relation: 'independent', reason: 'Different preferences' }]
          : [
              {
                ids: kind === 'missing' ? [0] : kind === 'repeated' ? [0, 0] : kind === 'unknown' ? [0, 2] : [0, 1],
                relation: ['duplicate', 'insufficient'].includes(kind) ? kind : 'conflict',
                reason: 'Checked user evidence'
              }
            ]
      return { text: JSON.stringify({ groups }), finishReason: 'stop' }
    })
    const preview = dreaming.previewExtraction(range, () => undefined)
    if (['missing', 'repeated', 'unknown'].includes(kind)) {
      await expect(preview).rejects.toMatchObject({ reason: 'output' })
    } else if (['cancel', 'edit'].includes(kind)) {
      await expect(preview).rejects.toBeInstanceOf(Error)
    } else {
      const result = await preview
      expect(result.calls).toBe(3)
      expect(result.candidates.map((item) => item.action)).toEqual(
        kind === 'duplicate' ? ['add'] : kind === 'independent' ? ['add', 'add'] : ['insufficient', 'insufficient']
      )
      expect(new Set(result.candidates.flatMap((item) => item.evidence.map((e) => e.messageId)))).toEqual(
        new Set([chat.user.id, last.parentId])
      )
      expect(result.candidates.map((item) => item.text)).toEqual(kind === 'duplicate' ? [quotes[0]] : quotes)
    }
    expect((await session.read('MEMORY.md')).content ?? '').toBe('')
  })

  it.each(['independent', 'conflict', 'duplicate'] as const)(
    'preserves dated facts and their own evidence after relation review: %s',
    async (relation) => {
      const texts =
        relation === 'duplicate'
          ? [
              'I still need to collect my exchanged boots from Zara.',
              'My exchanged boots are still waiting at Zara for pickup.'
            ]
          : [
              'I ran 5K in 27:12 on February 1.',
              relation === 'conflict'
                ? 'Correction: my February 1 5K time was 25:50, not 27:12.'
                : 'I ran 5K in 25:50 on March 1.'
            ]
      const messages = texts.map((text, id) => ({
        id: String(id),
        role: 'user',
        version: `v${id}`,
        createdAt: Date.UTC(2023, id + 1, 2),
        text: text + ' '.repeat(7000)
      }))
      messages.splice(1, 0, { id: 'context', role: 'assistant', version: 'v0', createdAt: 0, text: 'x'.repeat(7000) })
      let batch = 0
      generate.mockImplementation(async (input) => {
        const prompt = JSON.parse(input.prompt!)
        if (prompt.messages) {
          const id = batch++
          return {
            finishReason: 'stop',
            text: JSON.stringify({
              outcome: 'candidates',
              reason: 'Useful personal event or pending errand',
              candidates: [
                {
                  ...candidateReply(input).candidates[0],
                  text: texts[id],
                  subject: 'user',
                  scope: 'personal',
                  kind: relation === 'duplicate' ? 'personal_fact' : 'experience',
                  conditions: '',
                  time:
                    relation === 'duplicate' ? '' : id === 0 || relation === 'conflict' ? '2023-02-01' : '2023-03-01',
                  evidence: Array.from({ length: relation === 'conflict' ? 7 : 1 }, (_, n) => ({
                    messageId: String(id),
                    quote: texts[id] + ' '.repeat(n)
                  }))
                }
              ]
            })
          }
        }
        expect(prompt.candidates.map((c: { evidence: { createdAt: number }[] }) => c.evidence[0].createdAt)).toEqual(
          messages.filter((m) => m.role === 'user').map((m) => m.createdAt)
        )
        return {
          finishReason: 'stop',
          text: JSON.stringify({
            groups: [
              {
                ids: [0, 1],
                relation,
                reason:
                  relation === 'conflict'
                    ? 'The later user statement corrects the February 1 time from 27:12 to 25:50.'
                    : relation === 'duplicate'
                      ? 'Same unfinished Zara pickup.'
                      : 'Two separate dated races; both can be true.'
              }
            ]
          })
        }
      })
      const result = await extractContextCandidates(
        { messages, hash: 'quality-fixture' },
        [],
        new AbortController().signal,
        () => undefined
      )
      expect(result.candidates.map((c) => c.text)).toEqual(relation === 'duplicate' ? [texts[0]] : texts)
      expect(result.candidates.map((c) => c.action)).toEqual(
        relation === 'duplicate' ? ['add'] : relation === 'conflict' ? ['insufficient', 'insufficient'] : ['add', 'add']
      )
      if (relation === 'duplicate') {
        expect(result.candidates[0].evidence.map((e) => e.messageId)).toEqual(['0', '1'])
      } else {
        result.candidates.forEach((c, id) => {
          expect(c.evidence.every((e) => e.messageId === String(id) && e.version === `v${id}`)).toBe(true)
          expect(c.evidence).toHaveLength(relation === 'conflict' ? 7 : 1)
          expect(c.time).toBe(id === 0 || relation === 'conflict' ? '2023-02-01' : '2023-03-01')
        })
        if (relation === 'conflict') expect(result.candidates[1].reason).toContain('corrects the February 1 time')
      }
      expect(result.saveBlocked).toBe('forgetting_protection_required')
      expect((await session.read('MEMORY.md')).content ?? '').toBe('')
    }
  )

  it.each(['subject', 'scope', 'kind', 'action', 'conditions', 'time', 'references', 'singleton'])(
    'retains original candidates and unrelated facts when a duplicate merge fails: %s',
    async (mismatch) => {
      const messages = ['I practice tennis.', 'I hope to reach the quarterfinals.', 'My 5K best is 27:12.'].map(
        (text, id) => ({ id: String(id), role: 'user', version: 'v1', createdAt: id, text: text + 'x'.repeat(7000) })
      )
      const originals: ReturnType<typeof candidateReply>['candidates'] = []
      let batch = 0
      generate.mockImplementation(async (input) => {
        const prompt = JSON.parse(input.prompt!)
        if (prompt.messages) {
          const message = prompt.messages[0]
          const candidate = {
            ...candidateReply(input).candidates[0],
            text: batch === 0 ? 'I practice tennis.' : 'I train at tennis.',
            subject: 'user',
            scope: 'personal',
            kind: 'personal_fact',
            conditions: '',
            time: '',
            evidence: [{ messageId: message.id, quote: message.text.slice(0, 20) }]
          }
          if (batch++ === 1) {
            if (mismatch === 'scope') candidate.scope = 'project'
            else if (mismatch === 'kind') candidate.kind = 'decision'
            else if (mismatch === 'action') candidate.action = 'omit'
            else if (['subject', 'conditions', 'time'].includes(mismatch))
              Object.assign(candidate, { [mismatch]: 'different' })
          }
          if (mismatch === 'references') {
            candidate.evidence = Array.from({ length: 7 }, (_, index) => ({
              messageId: message.id,
              quote: message.text.slice(0, 20 + index)
            }))
          }
          const reply = [candidate]
          if (batch === 2)
            reply.push({
              ...candidate,
              text: 'My 5K best is 27:12.',
              scope: 'personal',
              action: 'add',
              evidence: [{ messageId: '2', quote: 'My 5K best is 27:12.' }]
            })
          originals.push(
            ...reply.map((item) => ({
              ...item,
              action: item.scope === 'project' ? 'out_of_scope' : item.action,
              evidence: item.evidence.map((e) => ({ ...e, version: 'v1' }))
            }))
          )
          return {
            text: JSON.stringify({ outcome: 'candidates', reason: 'Useful facts', candidates: reply }),
            finishReason: 'stop'
          }
        }
        if (!['references', 'singleton'].includes(mismatch)) {
          expect(prompt.duplicateGroups.some((ids: number[]) => ids.includes(0) && ids.includes(1))).toBe(false)
        } else expect(prompt.duplicateGroups).toContainEqual([0, 1, 2])
        return {
          text: JSON.stringify({
            groups:
              mismatch === 'singleton'
                ? [
                    { ids: [0], relation: 'duplicate', reason: 'Invalid singleton' },
                    { ids: [1, 2], relation: 'independent', reason: 'Distinct facts' }
                  ]
                : [
                    { ids: [0, 1], relation: 'duplicate', reason: 'Equivalent tennis facts' },
                    { ids: [2], relation: 'independent', reason: 'Running record' }
                  ]
          }),
          finishReason: 'stop'
        }
      })
      const result = await extractContextCandidates(
        { messages, hash: 'fixture' },
        [],
        new AbortController().signal,
        () => undefined
      )
      expect(result.candidates).toEqual(originals)
      expect(result.saveBlocked).toBe('forgetting_protection_required')
    }
  )

  it.each(['save', 'edit-context', 'topic-change', 'conflict', 'exists', 'capacity'] as const)(
    'runs continuous-context extraction through the real queue and store: %s',
    async (scenario) => {
      const { chat, range } = previewFixture()
      const lastUserId = dbh.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.id, range.source.responseId))
        .get()!.parentId!
      dbh.db
        .update(messageTable)
        .set({ data: { parts: [{ type: 'text', text: '我每周三晚上游泳。' }] } })
        .where(eq(messageTable.id, chat.user.id))
        .run()
      dbh.db
        .update(messageTable)
        .set({ data: { parts: [{ type: 'text', text: '这个安排从三月开始，出差时暂停。' }] } })
        .where(eq(messageTable.id, lastUserId))
        .run()
      await save(scenario === 'capacity' ? 'x'.repeat(24990) : 'Existing entry.\n')
      await save('Related old fact.', '.memories/facts.md')
      const original = (await session.read('MEMORY.md')).content
      generate.mockImplementationOnce(async (input) => {
        const prompt = JSON.parse(input.prompt!)
        expect(prompt.messages.map((m: { id: string }) => m.id)).toEqual([
          chat.user.id,
          chat.response.id,
          dbh.db.select().from(messageTable).where(eq(messageTable.id, range.source.responseId)).get()!.parentId
        ])
        expect(prompt.existingMemory).toContainEqual({ path: '.memories/facts.md', content: 'Related old fact.' })
        const candidate = {
          ...candidateReply(input).candidates[0],
          subject: '用户',
          scope: 'personal',
          kind: 'personal_fact',
          conditions: '出差时暂停',
          time: '三月开始',
          text: '从三月开始，每周三晚上游泳，出差时暂停。',
          action: scenario === 'conflict' || scenario === 'exists' ? scenario : 'add',
          existing:
            scenario === 'conflict' || scenario === 'exists'
              ? [{ path: '.memories/facts.md', quote: 'Related old fact.' }]
              : []
        }
        if (scenario === 'edit-context')
          dbh.db
            .update(messageTable)
            .set({ data: { parts: [{ type: 'text', text: 'Edited previous turn' }] } })
            .where(eq(messageTable.id, chat.user.id))
            .run()
        if (scenario === 'topic-change') await save('Changed related fact.', '.memories/facts.md')
        return {
          text: JSON.stringify({ outcome: 'candidates', reason: 'Cross-turn fact', candidates: [candidate] }),
          finishReason: 'stop'
        }
      })
      chats.fire({
        topicId: chat.topicId,
        turnId: range.source.responseId,
        completedAt: Date.now(),
        memoryResponseIds: [range.source.responseId]
      })
      if (['edit-context', 'topic-change', 'capacity'].includes(scenario)) {
        await expect(dreaming.execute(job())).rejects.toBeInstanceOf(Error)
        expect((await session.read('MEMORY.md')).content).toBe(original)
      } else {
        const added = scenario === 'save'
        expect(await dreaming.execute(job())).toMatchObject({
          saved: Number(added),
          outcomes: [added ? 'add' : scenario]
        })
        expect((await session.read('MEMORY.md')).content).toBe(
          added ? original + '- "从三月开始，每周三晚上游泳，出差时暂停。"\n' : original
        )
        if (added) {
          const reader = memory.open({ scope, assertAuthorized: () => undefined })
          expect((await reader.entry()).content).toContain('每周三晚上游泳，出差时暂停')
          reader.dispose()
        }
      }
    }
  )

  it('marks bounded context as incomplete and never crosses the generation boundary', async () => {
    const { chat, range } = previewFixture()
    dbh.db.update(messageTable).set({ createdAt: 1 }).where(eq(messageTable.id, chat.user.id)).run()
    generate.mockImplementationOnce(async (input) => {
      const prompt = JSON.parse(input.prompt!)
      expect(prompt.leftContextIncomplete).toBe(true)
      expect(prompt.messages).toHaveLength(1)
      expect(prompt.messages[0].text).toContain('以后本机')
      return {
        text: JSON.stringify({ outcome: 'insufficient', reason: 'Missing antecedent', candidates: [] }),
        finishReason: 'stop'
      }
    })
    chats.fire({
      topicId: chat.topicId,
      turnId: range.source.responseId,
      completedAt: Date.now(),
      memoryResponseIds: [range.source.responseId]
    })
    expect(await dreaming.execute(job())).toMatchObject({ saved: 0, batches: [{ outcome: 'insufficient' }] })
    expect((await session.read('MEMORY.md')).content ?? '').toBe('')
  })

  it('extracts authorized new user evidence with organization off, preserves facts, and recovers the actual append', async () => {
    await save('Existing fact with an exception.\n')
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
    const chat = conversation()
    generate.mockImplementationOnce(async () => ({
      text: automaticReply(),
      finishReason: 'stop'
    }))
    chat.emit()
    expect(await dreaming.execute(job())).toMatchObject({ extracted: 1 })
    expect((await session.read('MEMORY.md')).content).toBe(
      'Existing fact with an exception.\n- "I prefer concise answers."\n'
    )
    expect(generate.mock.calls[0][0]).toMatchObject({
      disableTools: true,
      contextOwner: 'caller',
      requestOptions: { maxRetries: 0 }
    })
    expect(JSON.parse(generate.mock.calls[0][0].prompt!)).toMatchObject({
      messages: [{ id: chat.user.id, text: 'Please remember: I prefer concise answers.' }],
      existingMemory: [{ path: 'MEMORY.md', content: 'Existing fact with an exception.\n' }]
    })
    expect(JSON.stringify(dbh.db.select().from(appStateTable).all())).not.toContain('concise answers')
    chat.emit()
    expect(await dreaming.execute(job())).toEqual({ idle: true })
    const recovery = await session.previewRecovery()
    await session.recover(recovery!.token, approve)
    expect((await session.read('MEMORY.md')).content).toBe('Existing fact with an exception.\n')
  })

  it.each(['queued', 'running'] as const)(
    'keeps extraction after a title-only topic update while %s',
    async (stage) => {
      await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
      const chat = conversation()
      const rename = () => {
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100)
        topicService.update(chat.topicId, { name: 'Generated title', isNameManuallyEdited: false })
      }
      generate.mockImplementationOnce(async () => {
        if (stage === 'running') rename()
        return {
          text: automaticReply(),
          finishReason: 'stop'
        }
      })
      chat.emit()
      if (stage === 'queued') rename()
      expect(await dreaming.execute(job())).toMatchObject({ extracted: 1 })
      expect((await session.read('MEMORY.md')).content).toBe('- "I prefer concise answers."\n')
      chat.emit()
      expect(await dreaming.execute(job())).toEqual({ idle: true })
    }
  )

  it.each(['owner', 'move', 'delete'] as const)(
    'discards queued extraction after topic %s and restoration',
    async (action) => {
      await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
      const chat = conversation()
      const other = conversation()
      chat.emit()
      if (action === 'owner') {
        topicService.update(chat.topicId, { assistantId: null })
        topicService.update(chat.topicId, { assistantId: chat.assistantId })
      } else if (action === 'move') {
        topicService.move(chat.topicId, { assistantId: other.assistantId, order: { position: 'first' } })
        topicService.move(chat.topicId, { assistantId: chat.assistantId, order: { position: 'first' } })
      } else {
        topicService.delete(chat.topicId)
        topicService.restore(chat.topicId)
      }
      chat.emit()
      expect(await dreaming.execute(job())).toEqual({ idle: true })
      expect(generate).not.toHaveBeenCalled()
      other.emit()
      generate.mockImplementationOnce(async () => ({
        text: automaticReply(),
        finishReason: 'stop'
      }))
      expect(await dreaming.execute(job())).toMatchObject({ extracted: 1 })
    }
  )

  it.each([
    'edit',
    'delete-user',
    'delete-response',
    'delete-topic',
    'owner',
    'owner-roundtrip',
    'topic-restore',
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
    const started = Promise.withResolvers<void>()
    generate.mockImplementationOnce(() => {
      started.resolve()
      return response.promise
    })
    chat.emit()
    const outcome = dreaming.execute(job()).catch((error: unknown) => error)
    await started.promise
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
    if (action === 'owner-roundtrip') {
      topicService.update(chat.topicId, { assistantId: null })
      topicService.update(chat.topicId, { assistantId: chat.assistantId })
    }
    if (action === 'topic-restore') {
      topicService.delete(chat.topicId)
      topicService.restore(chat.topicId)
    }
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
    response.resolve({
      text: automaticReply(),
      finishReason: 'stop'
    })
    expect(await outcome).toBeInstanceOf(Error)
    expect((await session.read('MEMORY.md')).content).not.toContain('concise answers')
  })

  it.each(['unsupported', 'oversized', 'invalid-json', 'truncated', 'missing-kind', 'unknown-kind'] as const)(
    'retains memory when extraction output is %s',
    async (kind) => {
      await save('Original fact')
      conversation().emit()
      generate.mockImplementationOnce(async () => {
        const result = JSON.parse(automaticReply())
        if (kind === 'unsupported') result.candidates[0].evidence[0].quote = 'Assistant-only unsupported claim'
        if (kind === 'oversized') result.candidates[0].text = 'x'.repeat(1001)
        if (kind === 'missing-kind') delete result.candidates[0].kind
        if (kind === 'unknown-kind') result.candidates[0].kind = 'global'
        return {
          text: kind === 'invalid-json' ? 'no' : JSON.stringify(result),
          finishReason: kind === 'truncated' ? 'length' : 'stop'
        }
      })
      await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'output' })
      expect((await session.read('MEMORY.md')).content).toBe('Original fact')
      expect(dreaming.status(scope).lastResult).toMatchObject({ outcome: 'failed', reason: 'output' })
    }
  )

  it('appends personal candidates without promoting project, customer, or uncertain facts', async () => {
    await save('Existing preference.\n')
    const candidates = [
      { kind: 'preference', quote: 'I prefer concise answers, except when debugging.' },
      { kind: 'personal_fact', quote: 'I use PowerShell 7.' },
      { kind: 'project', quote: 'Project Blue uses Java 21.' },
      { kind: 'customer', quote: 'Customer A requires a December release.' },
      { kind: 'uncertain', quote: 'This might describe me or the customer.' }
    ]
    conversation(true, candidates.map(({ quote }) => quote).join(' ')).emit()
    generate.mockImplementationOnce(async () => ({ text: automaticReply(candidates), finishReason: 'stop' }))
    expect(await dreaming.execute(job())).toMatchObject({ extracted: 1 })
    expect((await session.read('MEMORY.md')).content).toBe(
      'Existing preference.\n- "I prefer concise answers, except when debugging."\n- "I use PowerShell 7."\n'
    )
  })

  it.each(['project', 'customer', 'uncertain'] as const)(
    'does not save a %s-only extraction or create a recovery batch',
    async (kind) => {
      await save('Existing preference.\n')
      const before = await session.previewRecovery()
      const quote = 'Project Blue uses Java 21.'
      conversation(true, `Please remember: ${quote}`).emit()
      generate.mockImplementationOnce(async () => ({ text: automaticReply([{ kind, quote }]), finishReason: 'stop' }))
      expect(await dreaming.execute(job())).toMatchObject({ extracted: 0 })
      expect((await session.read('MEMORY.md')).content).toBe('Existing preference.\n')
      expect((await session.previewRecovery())?.batchId).toBe(before?.batchId)
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
    response.resolve({
      text: automaticReply(),
      finishReason: 'stop'
    })
    expect(await outcome).toMatchObject({ extracted: 1 })
  })

  it.each([
    'desktop',
    'preview',
    'preview-unrelated-response',
    'renamed-queued',
    'renamed-running',
    'restored-queued',
    'restored-running',
    'channel',
    'background',
    'headless',
    'failed',
    'disabled'
  ] as const)('enforces %s agent source eligibility', async (kind) => {
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
    dbh.db.insert(agentWorkspaceTable).values({ id: workspaceId, name: 'W', path: '/workspace', orderKey: 'a0' }).run()
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
        parentId: kind === 'preview-unrelated-response' ? null : user.id,
        status: kind === 'failed' ? 'error' : 'success',
        data: { parts: [] },
        messageSnapshot: { id: agentId, name: 'Agent', model: { id: 'gpt-4o', name: 'Fixture', provider: 'fixture' } }
      })
      .returning()
      .all()
    if (kind.startsWith('preview')) {
      generate.mockImplementationOnce(async (input) => {
        const message = JSON.parse(input.prompt!).messages[0]
        return {
          finishReason: 'stop',
          text: JSON.stringify({
            outcome: 'candidates',
            reason: 'Explicit preference',
            candidates: [
              {
                text: 'The user prefers concise answers.',
                subject: 'user',
                scope: 'personal',
                kind: 'preference',
                conditions: '',
                time: '',
                usefulness: 'Choose answer length',
                action: 'add',
                reason: 'Explicit lasting preference',
                evidence: [{ messageId: message.id, quote: message.text }],
                existing: []
              }
            ]
          })
        }
      })
      const preview = dreaming.previewExtraction(
        {
          source: { kind: 'agent', sessionId, userMessageId: user.id, responseId: response.id },
          fromMessageId: user.id
        },
        () => undefined
      )
      if (kind === 'preview')
        await expect(preview).resolves.toMatchObject({ mode: 'preview', candidates: [{ action: 'add' }] })
      else await expect(preview).rejects.toMatchObject({ reason: 'unavailable' })
      expect((await session.read('MEMORY.md')).content ?? '').toBe('')
      return
    }
    const changeSession = () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100)
      if (kind.startsWith('renamed')) agentSessionService.update(sessionId, { name: 'Generated title' })
      if (kind.startsWith('restored')) {
        agentSessionService.delete(sessionId)
        agentSessionService.restore(sessionId)
      }
    }
    generate.mockImplementationOnce(async () => {
      if (kind.endsWith('running')) changeSession()
      return {
        text: automaticReply(),
        finishReason: 'stop'
      }
    })
    agentTurns.fire({
      sessionId,
      assistantMessageId: response.id,
      status: 'success',
      boundary: 'turn',
      ...(kind === 'headless' ? {} : { memoryUserMessageId: user.id })
    })
    if (kind.endsWith('queued')) changeSession()
    const eligible = kind === 'desktop' || kind.startsWith('renamed')
    if (kind === 'restored-running') await expect(dreaming.execute(job())).rejects.toBeInstanceOf(Error)
    else expect(await dreaming.execute(job())).toMatchObject(eligible ? { extracted: 1 } : { idle: true })
    expect((await session.read('MEMORY.md')).content ?? '').toBe(eligible ? '- "I prefer concise answers."\n' : '')
  })

  it('scans other scopes while the required entry is blocked and detects an external entry repair', async () => {
    dbh.db.update(userModelTable).set({ maxOutputTokens: 4096 }).run()
    const original = 'reason '.repeat(3000)
    await save(original)
    for (let index = 0; index < 10; index++) await save(`Topic ${index}`, '.memories/topic.md')
    await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'budget' })

    const agentId = '00000000-0000-4000-8000-000000000001'
    const privateScope = { kind: 'private', agentId } as const
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'A', instructions: '', orderKey: 'a0' }).run()
    const directory = path.join(fixture, 'feature.agents.data', agentId)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'MEMORY.md'), 'Private fact')

    await dreaming.execute(job())
    expect(readDreamingState(privateScope).files['MEMORY.md'].observedHash).toBe(
      memoryHash(Buffer.from('Private fact'))
    )
    expect((await session.read('MEMORY.md')).content).toBe(original)
    expect(readDreamingState(scope).files['.memories/topic.md'].changes).toBe(10)

    await writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'Repaired entry')
    await dreaming.execute(job())
    await dreaming.execute(job())
    expect(readDreamingState(scope).files['.memories/topic.md']).toMatchObject({
      changes: 0,
      processedHash: (await session.read('.memories/topic.md')).hash
    })
    expect((await session.read('MEMORY.md')).content).toBe('Repaired entry')
  })

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
      const beforeResponse = await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')
      if (action === 'clear') {
        expect(beforeResponse).not.toContain('Original fact')
        expect(parseMemoryEntries(beforeResponse).filter((part) => typeof part !== 'string')).toMatchObject([
          { status: 'forgotten', sources: [], text: '' }
        ])
      }
      response.resolve({
        text: '{"writes":[{"path":"MEMORY.md","content":"Stale model output"}],"deletes":[]}',
        finishReason: 'stop'
      })
      expect(await outcome).toBeInstanceOf(Error)
      expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe(
        action === 'external-edit' ? 'External edit' : action === 'clear' ? beforeResponse : 'Original fact'
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
    response.resolve({
      text: automaticReply(),
      finishReason: 'stop'
    })
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
