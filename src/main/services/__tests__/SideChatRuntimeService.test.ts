import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import type { UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { messageTable } from '@data/db/schemas/message'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { AiStreamManager, type StreamListener } from '@main/ai/streamManager'
import type { AsInProcess, AiStreamRequest } from '@main/ai/types'
import { BaseService } from '@main/core/lifecycle'
import { areDiagnosticsSuppressed } from '@main/core/logger/diagnosticScope'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { KeyedMutex } from '@shared/utils/async'

import { SideChatRuntimeService } from '../SideChatRuntimeService'

const modelId = createUniqueModelId('side-test', 'model')
type Run = Parameters<AiStreamManager['streamPrompt']>[0] & { suppressed: boolean }

describe('side-chat runtime boundaries', () => {
  const dbh = setupTestDatabase()
  let service: SideChatRuntimeService
  let saved: boolean
  let runs: Run[]
  let live: Set<string>

  async function finish(run: Run, text = 'Side answer', parts: CherryMessagePart[] = [{ type: 'text', text }]) {
    const listeners = Array.isArray(run.listener) ? run.listener : [run.listener]
    for (const listener of listeners)
      await listener.onDone({
        status: 'success',
        finalMessage: { id: 'response', role: 'assistant', parts }
      })
    live.delete(run.streamId)
  }

  function source(answerText = 'Original answer excerpt') {
    const topic = topicService.create({ name: 'Source' })
    messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Original question' }] },
      status: 'success',
      setAsActive: true
    })
    const answer = messageService.create(topic.id, {
      role: 'assistant',
      data: { parts: [{ type: 'text', text: answerText }] },
      status: 'success',
      setAsActive: true
    })
    return { topicId: topic.id, messageId: answer.id, selection: 'excerpt' }
  }

  beforeEach(() => {
    BaseService.resetInstances()
    saved = true
    runs = []
    live = new Set()
    const mutex = new KeyedMutex()
    vi.spyOn(application.get('PreferenceService'), 'get').mockImplementation(((key: string) =>
      key === 'chat.side_chat.save_history' ? saved : undefined) as never)
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({ isDestroyed: () => false } as never)
    MockApplicationUtils.setService('AiStreamManager', {
      isWriteQuiesced: false,
      withDispatchLock: (id: string, operation: () => Promise<unknown>) => mutex.runExclusive(id, operation),
      hasLiveStream: (id: string) => live.has(id),
      streamPrompt: (input: Run) => {
        runs.push({ ...input, suppressed: areDiagnosticsSuppressed() })
        live.add(input.streamId)
      },
      abort: (id: string) => {
        live.delete(id)
      },
      abortAndDrain: async (id: string) => {
        const run = runs.findLast((item) => item.streamId === id)
        if (run && live.has(id)) {
          for (const listener of Array.isArray(run.listener) ? run.listener : [run.listener])
            await listener.onPaused({ status: 'paused' })
        }
        live.delete(id)
      }
    })
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'side-test', name: 'Test', isEnabled: true, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: modelId,
        providerId: 'side-test',
        modelId: 'model',
        name: 'Test',
        capabilities: [],
        supportsStreaming: true,
        contextWindow: 32768,
        orderKey: 'a0'
      })
      .run()
    service = new SideChatRuntimeService()
  })

  it('fixes the mode at creation and never writes temporary questions into SQLite', async () => {
    const input = source()
    const durable = service.create('one', input, { modelId })
    saved = false
    const temporary = service.create('one', input, { modelId })
    const before = dbh.db.select().from(messageTable).all()
    await service.submit('one', temporary.topicId, 'temporary secret', modelId)
    await finish(runs[0], 'temporary response')
    expect(dbh.db.select().from(messageTable).all()).toEqual(before)
    expect(service.get('one', durable.topicId).mode).toBe('saved')
    saved = true
    expect(service.get('one', temporary.topicId).mode).toBe('temporary')
    expect(runs[0].suppressed).toBe(true)
    expect(runs[0].disableTools).not.toBe(true)
  })

  function secondModel() {
    const id = createUniqueModelId('side-test', 'second')
    dbh.db
      .insert(userModelTable)
      .values({
        id,
        providerId: 'side-test',
        modelId: 'second',
        name: 'Second',
        capabilities: [],
        supportsStreaming: true,
        contextWindow: 32768,
        orderKey: 'a1'
      })
      .run()
    return id
  }

  it.each([true, false])(
    'retains tool decisions and resumes the same reply only after every approval (saved=%s)',
    async (persist) => {
      saved = persist
      const origin = source()
      const assistant = assistantDataService.create({ name: 'Tool owner' })
      assistantDataService.update(assistant.id, { settings: { ...assistant.settings, enableWebSearch: true } })
      topicService.update(origin.topicId, { assistantId: assistant.id })
      const side = service.create('one', origin, { modelId })
      const before = dbh.db.select().from(messageTable).all()
      const started = await service.submit('one', side.topicId, 'Look this up', modelId)
      const answerId = started.messages.at(-1)!.id
      expect(runs[0].assistant?.settings.enableWebSearch).toBe(true)
      const parts: CherryMessagePart[] = ['a', 'b'].map((id) => ({
        type: 'dynamic-tool',
        toolName: 'example',
        toolCallId: id,
        input: {},
        state: 'approval-requested',
        approval: { id }
      }))
      await finish(runs[0], '', parts)
      await service.respondApproval('one', side.topicId, answerId, { approvalId: 'a', approved: false })
      await service.respondApproval('one', side.topicId, answerId, { approvalId: 'a', approved: true })
      expect(runs).toHaveLength(1)
      const resumed = await service.respondApproval('one', side.topicId, answerId, { approvalId: 'b', approved: true })
      expect(resumed.messages).toHaveLength(2)
      expect(resumed.messages.at(-1)?.id).toBe(answerId)
      expect(runs[1].messages?.at(-1)?.parts).toMatchObject([
        { state: 'approval-responded', approval: { id: 'a', approved: false } },
        { state: 'approval-responded', approval: { id: 'b', approved: true } }
      ])
      const result: CherryMessagePart = {
        type: 'dynamic-tool',
        toolName: 'example',
        toolCallId: 'b',
        input: {},
        state: 'output-available',
        output: 'Found result'
      }
      await finish(runs[1], '', [result])
      await service.submit('one', side.topicId, 'Explain that result', modelId)
      expect(runs[2].messages?.flatMap((message) => message.parts)).toContainEqual(result)
      if (!persist) expect(dbh.db.select().from(messageTable).all()).toEqual(before)
    }
  )

  it.each([true, false])(
    'binds the selected model to each submit and retry without changing a running request (saved=%s)',
    async (persist) => {
      saved = persist
      const second = secondModel()
      const side = service.create('one', source(), { modelId })
      const first = await service.submit('one', side.topicId, 'First', modelId)
      await expect(service.submit('one', side.topicId, 'While busy', second)).rejects.toThrow('side_chat_busy')
      expect(runs[0].uniqueModelId).toBe(modelId)
      await finish(runs[0])
      await service.submit('one', side.topicId, 'Second', second)
      expect(runs[1].uniqueModelId).toBe(second)
      await finish(runs[1])
      await service.retry('one', side.topicId, first.messages[0].id, modelId)
      expect(runs[2].uniqueModelId).toBe(modelId)
      await finish(runs[2])
      const before = service.get('one', side.topicId)
      await expect(service.retry('one', side.topicId, first.messages[0].id)).rejects.toThrow(
        'side_chat_model_unavailable'
      )
      expect(service.get('one', side.topicId).messages).toEqual(before.messages)
      expect(runs).toHaveLength(3)
    }
  )

  it('resolves the Agent model on admission and blocks creation during source removal', async () => {
    const second = secondModel()
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', model: modelId, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', name: 'Session', workspaceId: 'workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values([
        {
          id: 'user',
          sessionId: 'session',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'Agent question' }] },
          status: 'success'
        },
        {
          id: 'answer',
          sessionId: 'session',
          parentId: 'user',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'Agent answer' }] },
          status: 'success'
        }
      ])
      .run()
    const input = { topicId: 'agent-session:session', messageId: 'answer', selection: 'answer' }
    saved = false
    const side = service.create('one', input, { modelId: second })
    const first = await service.submit('one', side.topicId, 'Explain', second)
    expect(runs[0].uniqueModelId).toBe(modelId)
    dbh.db.update(agentTable).set({ model: second }).where(eq(agentTable.id, 'agent')).run()
    expect(runs[0].uniqueModelId).toBe(modelId)
    await finish(runs[0])
    await service.retry('one', side.topicId, first.messages[0].id, modelId)
    expect(runs[1].uniqueModelId).toBe(second)
    await service.withSourceRemoval([input.topicId], () => {
      expect(() => service.create('one', input, { modelId })).toThrow('side_chat_busy')
      agentSessionService.delete('session')
    })
    expect(live.size).toBe(0)
    expect(() => service.get('one', side.topicId)).toThrow()
    agentSessionService.restore('session')
    expect(service.get('one', side.topicId).questionCount).toBe(1)
    dbh.db.update(agentTable).set({ model: null }).where(eq(agentTable.id, 'agent')).run()
    await expect(service.submit('one', side.topicId, 'No model', modelId)).rejects.toThrow(
      'side_chat_model_unavailable'
    )
    expect(runs).toHaveLength(2)
  })

  it('isolates immutable source context and per-chat configuration', async () => {
    const input = source()
    const first = service.create('one', input, { modelId, prompt: 'Brief.' })
    const other = service.create('one', input, { modelId, prompt: 'Other.' })
    messageService.create(input.topicId, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Later main text' }] },
      status: 'success',
      setAsActive: true
    })
    await service.submit('one', other.topicId, 'Other side text', modelId)
    await service.submit('one', first.topicId, 'Explain it', modelId)
    const wire = JSON.stringify(runs[1].messages)
    expect(wire).toContain('Original question')
    expect(wire).toContain('Original answer excerpt')
    expect(wire).not.toContain('Later main text')
    expect(wire).not.toContain('Other side text')
    expect(runs[1].messages?.[0]).toMatchObject({ role: 'system', parts: [{ text: 'Brief.' }] })
    expect(runs[1].messages?.[1].role).toBe('user')
    await finish(runs[1])
    service.configure('one', first.topicId, { modelId, prompt: 'New prompt' })
    expect(service.get('one', other.topicId).metadata.config.prompt).toBe('Other.')
  })

  it.each([false, true])('keeps question counts through retry, failure and deletion (saved=%s)', async (persist) => {
    saved = persist
    const side = service.create('one', source(), { modelId })
    let view = await service.submit('one', side.topicId, 'First', modelId)
    const firstId = view.messages[0].id
    await finish(runs[0])
    view = await service.submit('one', side.topicId, 'Second', modelId)
    const secondId = view.messages.findLast((message) => message.role === 'user')!.id
    await service.stop('one', side.topicId)
    view = await service.retry('one', side.topicId, secondId, modelId)
    expect(view.questionCount).toBe(2)
    await finish(runs[2])
    view = await service.retry('one', side.topicId, firstId, modelId)
    expect(view.questionCount).toBe(2)
    expect(view.messages.filter((message) => message.role === 'user').map((message) => message.id)).toEqual([
      firstId,
      secondId
    ])
    await finish(runs[3])
    view = await service.deleteQuestion('one', side.topicId, firstId)
    expect(view.questionCount).toBe(1)
    expect(view.messages.filter((message) => message.role === 'user').map((message) => message.id)).toEqual([secondId])
  })

  it('rejects another window and discards late writes after window close', async () => {
    saved = false
    const input = source()
    const side = service.create('one', input, { modelId })
    expect(() => service.get('two', side.topicId)).toThrow('side_chat_not_found')
    await expect(service.submit('two', side.topicId, 'intruder', modelId)).rejects.toThrow('side_chat_not_found')
    await service.submit('one', side.topicId, 'private', modelId)
    const callbacks = runs[0].listener as StreamListener[]
    const send = vi.mocked(application.get('IpcApiService').send)
    send.mockClear()
    service.closeWindow('one')
    expect(send).toHaveBeenCalledWith(
      'one',
      'side_chat.changed',
      expect.objectContaining({ topicId: side.topicId, view: null })
    )
    callbacks[1].onMessage?.({ id: 'late', role: 'assistant', parts: [{ type: 'text', text: 'late response' }] })
    await finish(runs[0], 'late response')
    expect(service.list('one', input.topicId)).toEqual([])
    expect(
      dbh.db
        .select()
        .from(messageTable)
        .all()
        .some((message) => JSON.stringify(message.data).includes('private'))
    ).toBe(false)
  })

  it('stops only the selected side chat and rejects duplicate concurrent submits', async () => {
    saved = false
    const input = source()
    const first = service.create('one', input, { modelId })
    const second = service.create('one', input, { modelId })
    await service.submit('one', first.topicId, 'First', modelId)
    await service.submit('one', second.topicId, 'Second', modelId)
    await expect(service.submit('one', first.topicId, 'Duplicate', modelId)).rejects.toThrow('side_chat_busy')
    await service.stop('one', first.topicId)
    expect(service.get('one', first.topicId).generating).toBe(false)
    expect(service.get('one', second.topicId).generating).toBe(true)
    expect(service.get('one', first.topicId).questionCount).toBe(1)
  })

  it('hides temporary sessions with their source, restores them, and clears them on permanent removal', async () => {
    saved = false
    const input = source()
    const side = service.create('one', input, { modelId })
    await service.submit('one', side.topicId, 'Retain on restore', modelId)
    await service.beforeSourceRemoval([input.topicId], false)
    topicService.delete(input.topicId)
    expect(() => service.get('one', side.topicId)).toThrow()
    topicService.restore(input.topicId)
    expect(service.get('one', side.topicId).questionCount).toBe(1)
    topicService.deleteByIds([input.topicId], { permanent: true, targetState: 'active' })
    service.discardSources([input.topicId])
    await finish(runs[0], 'late text')
    expect(() => service.get('one', side.topicId)).toThrow()
  })

  it.each(['data', 'file'])('accepts the same image budget for %s URLs', async (transport) => {
    saved = false
    dbh.db.update(userModelTable).set({ contextWindow: 131072 }).run()
    const side = service.create('one', source(), { modelId })
    const url =
      transport === 'data'
        ? `data:image/png;base64,${Buffer.alloc(100 * 1024).toString('base64')}`
        : 'file:///example.png'
    const parts: CherryMessagePart[] = [
      { type: 'text', text: 'Explain' },
      { type: 'file', mediaType: 'image/png', url }
    ]
    await service.submit('one', side.topicId, 'Explain', modelId, undefined, parts)
    expect(runs[0].messages?.at(-1)?.parts).toEqual(parts)
    expect(service.get('one', side.topicId).omittedContext).toEqual([])
  })

  it('still reserves context for images rather than treating media as free', async () => {
    saved = false
    dbh.db.update(userModelTable).set({ contextWindow: 4096 }).run()
    const side = service.create('one', source(), { modelId })
    await service.submit('one', side.topicId, 'Explain', modelId)
    await finish(runs[0])
    const parts: CherryMessagePart[] = Array.from({ length: 4 }, () => ({
      type: 'file',
      mediaType: 'image/png',
      url: 'file:///example.png'
    }))
    await expect(service.submit('one', side.topicId, '', modelId, undefined, parts)).rejects.toThrow(
      'side_chat_context_too_large'
    )
    expect(service.get('one', side.topicId).questionCount).toBe(1)
    expect(runs).toHaveLength(1)
  })

  it('rejects oversized inline images before creating a question or starting a provider request', async () => {
    saved = false
    const side = service.create('one', source(), { modelId })
    const parts: CherryMessagePart[] = [
      {
        type: 'file',
        mediaType: 'image/png',
        url: `data:image/png;base64,${'A'.repeat(Math.ceil((100 * 1024 * 1024 + 1) / 3) * 4)}`
      }
    ]
    await expect(service.submit('one', side.topicId, '', modelId, undefined, parts)).rejects.toThrow(
      'side_chat_invalid_question'
    )
    expect(service.get('one', side.topicId).messages).toEqual([])
    expect(runs).toHaveLength(0)
  })

  it.each(['selection', 'question'])('rejects an oversize %s without truncation', async (kind) => {
    const oversized = 'x'.repeat(50_000)
    const input = kind === 'selection' ? { ...source(oversized), selection: oversized } : source()
    const side = service.create('one', input, { modelId })
    await expect(
      service.submit('one', side.topicId, kind === 'question' ? oversized : 'Explain', modelId)
    ).rejects.toThrow('side_chat_context_too_large')
    expect(service.get('one', side.topicId).messages).toEqual([])
    expect(runs).toHaveLength(0)
  })

  it('counts provider failures and keeps history when the provider becomes unavailable', async () => {
    const side = service.create('one', source(), { modelId })
    await service.submit('one', side.topicId, 'Failed question', modelId)
    for (const listener of runs[0].listener as StreamListener[])
      await listener.onError({ status: 'error', error: { name: 'Error', message: 'provider failure', stack: null } })
    live.delete(runs[0].streamId)
    const failed = service.get('one', side.topicId)
    expect(failed.questionCount).toBe(1)
    expect(failed.messages.at(-1)?.status).toBe('error')
    dbh.db.update(userProviderTable).set({ isEnabled: false }).run()
    await expect(service.submit('one', side.topicId, 'Next', modelId)).rejects.toThrow('side_chat_model_unavailable')
    expect(service.get('one', side.topicId).messages).toEqual(failed.messages)
  })

  it.each([false, true])(
    'closes or deletes the selected session without deleting the source (saved=%s)',
    async (persist) => {
      saved = persist
      const input = source()
      const side = service.create('one', input, { modelId })
      await service.submit('one', side.topicId, 'Question', modelId)
      await finish(runs[0])
      const lastRevision = service.get('one', side.topicId).revision
      await service.close('one', side.topicId)
      if (persist) {
        expect(service.get('one', side.topicId).questionCount).toBe(1)
        await service.delete('one', side.topicId)
      }
      expect(service.list('one', input.topicId)).toEqual([])
      expect(topicService.getById(input.topicId).id).toBe(input.topicId)
      expect(vi.mocked(application.get('IpcApiService').send).mock.calls.at(-1)?.[2]).toMatchObject({
        topicId: side.topicId,
        revision: lastRevision + 1,
        view: null
      })
    }
  )

  it('does not resurrect a closed temporary chat while its submit waits for admission', async () => {
    saved = false
    const side = service.create('one', source(), { modelId })
    const submitted = service.submit('one', side.topicId, 'Queued text', modelId)
    service.closeWindow('one')
    await expect(submitted).rejects.toThrow()
    expect(runs).toHaveLength(0)
  })

  it('settles saved replies before shutdown and leaves no temporary topic to restore', async () => {
    const input = source()
    const durable = service.create('one', input, { modelId })
    await service.submit('one', durable.topicId, 'Saved pending question', modelId)
    saved = false
    const temporary = service.create('one', input, { modelId })
    await service.submit('one', temporary.topicId, 'Temporary pending question', modelId)
    await (service as unknown as { onStop(): Promise<void> }).onStop()
    BaseService.resetInstances()
    const restarted = new SideChatRuntimeService()
    expect(restarted.list('one', input.topicId).map((side) => side.topicId)).toEqual([durable.topicId])
    expect(restarted.get('one', durable.topicId).messages.at(-1)?.status).toBe('paused')
  })

  it.each([false, true])(
    'consumes the real shared stream manager and terminal persistence (saved=%s)',
    async (persist) => {
      saved = persist
      const side = service.create('one', source(), { modelId })
      const before = dbh.db.select().from(messageTable).all()
      let controller!: ReadableStreamDefaultController<UIMessageChunk>
      let captured: AsInProcess<AiStreamRequest> | undefined
      let privateRequest = false
      const manager = new AiStreamManager()
      MockApplicationUtils.setService('AiStreamManager', manager)
      MockApplicationUtils.setService('AiService', {
        streamText: async (request: AsInProcess<AiStreamRequest>) => {
          captured = request
          privateRequest = areDiagnosticsSuppressed()
          return {
            kind: 'chunks',
            stream: new ReadableStream<UIMessageChunk>({
              start(value) {
                controller = value
              }
            })
          }
        }
      })
      await service.submit('one', side.topicId, 'Shared pipeline question', modelId)
      controller.enqueue({ type: 'start', messageId: 'provider-answer' })
      controller.enqueue({ type: 'text-start', id: 'text' })
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Live answer' })
      controller.enqueue({ type: 'text-end', id: 'text' })
      controller.enqueue({ type: 'finish' })
      controller.close()
      await vi.waitFor(() => expect(service.get('one', side.topicId).generating).toBe(false))
      expect(service.get('one', side.topicId).messages.at(-1)).toMatchObject({
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Live answer' }] }
      })
      expect(privateRequest).toBe(!persist)
      expect(captured).toMatchObject({ contextOwner: 'caller' })
      expect(captured?.disableTools).not.toBe(true)
      if (!persist) expect(dbh.db.select().from(messageTable).all()).toEqual(before)
    }
  )
})
