import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { AiStreamManager, type StreamListener } from '@main/ai/streamManager'
import type { AsInProcess, AiStreamRequest } from '@main/ai/types'
import { BaseService } from '@main/core/lifecycle'
import { areDiagnosticsSuppressed } from '@main/core/logger/diagnosticScope'
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

  async function finish(run: Run, text = 'Side answer') {
    const listeners = Array.isArray(run.listener) ? run.listener : [run.listener]
    for (const listener of listeners)
      await listener.onDone({
        status: 'success',
        finalMessage: { id: 'response', role: 'assistant', parts: [{ type: 'text', text }] }
      })
    live.delete(run.streamId)
  }

  function source() {
    const topic = topicService.create({ name: 'Source' })
    messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Original question' }] },
      status: 'success',
      setAsActive: true
    })
    const answer = messageService.create(topic.id, {
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'Original answer excerpt' }] },
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
    await service.submit('one', temporary.topicId, 'temporary secret')
    await finish(runs[0], 'temporary response')
    expect(dbh.db.select().from(messageTable).all()).toEqual(before)
    expect(service.get('one', durable.topicId).mode).toBe('saved')
    saved = true
    expect(service.get('one', temporary.topicId).mode).toBe('temporary')
    expect(runs[0].suppressed).toBe(true)
    expect(runs[0].disableTools).toBe(true)
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
    await service.submit('one', other.topicId, 'Other side text')
    await service.submit('one', first.topicId, 'Explain it')
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
    let view = await service.submit('one', side.topicId, 'First')
    const firstId = view.messages[0].id
    await finish(runs[0])
    view = await service.submit('one', side.topicId, 'Second')
    const secondId = view.messages.findLast((message) => message.role === 'user')!.id
    await service.stop('one', side.topicId)
    view = await service.retry('one', side.topicId, secondId)
    expect(view.questionCount).toBe(2)
    await finish(runs[2])
    view = await service.retry('one', side.topicId, firstId)
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
    await expect(service.submit('two', side.topicId, 'intruder')).rejects.toThrow('side_chat_not_found')
    await service.submit('one', side.topicId, 'private')
    const callbacks = runs[0].listener as StreamListener[]
    service.closeWindow('one')
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
    await service.submit('one', first.topicId, 'First')
    await service.submit('one', second.topicId, 'Second')
    await expect(service.submit('one', first.topicId, 'Duplicate')).rejects.toThrow('side_chat_busy')
    await service.stop('one', first.topicId)
    expect(service.get('one', first.topicId).generating).toBe(false)
    expect(service.get('one', second.topicId).generating).toBe(true)
    expect(service.get('one', first.topicId).questionCount).toBe(1)
  })

  it('hides temporary sessions with their source, restores them, and clears them on permanent removal', async () => {
    saved = false
    const input = source()
    const side = service.create('one', input, { modelId })
    await service.submit('one', side.topicId, 'Retain on restore')
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

  it('rejects an oversize selection/question without submitting a truncated question', async () => {
    const side = service.create('one', source(), { modelId })
    await expect(service.submit('one', side.topicId, 'x'.repeat(50_000))).rejects.toThrow('side_chat_context_too_large')
    expect(service.get('one', side.topicId).messages).toEqual([])
    expect(runs).toHaveLength(0)
  })

  it('counts provider failures and keeps history when the provider becomes unavailable', async () => {
    const side = service.create('one', source(), { modelId })
    await service.submit('one', side.topicId, 'Failed question')
    for (const listener of runs[0].listener as StreamListener[])
      await listener.onError({ status: 'error', error: { name: 'Error', message: 'provider failure', stack: null } })
    live.delete(runs[0].streamId)
    const failed = service.get('one', side.topicId)
    expect(failed.questionCount).toBe(1)
    expect(failed.messages.at(-1)?.status).toBe('error')
    dbh.db.update(userProviderTable).set({ isEnabled: false }).run()
    await expect(service.submit('one', side.topicId, 'Next')).rejects.toThrow('side_chat_model_unavailable')
    expect(service.get('one', side.topicId).messages).toEqual(failed.messages)
  })

  it.each([false, true])(
    'closes or deletes the selected session without deleting the source (saved=%s)',
    async (persist) => {
      saved = persist
      const input = source()
      const side = service.create('one', input, { modelId })
      await service.submit('one', side.topicId, 'Question')
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
    const submitted = service.submit('one', side.topicId, 'Queued text')
    service.closeWindow('one')
    await expect(submitted).rejects.toThrow()
    expect(runs).toHaveLength(0)
  })

  it('settles saved replies before shutdown and leaves no temporary topic to restore', async () => {
    const input = source()
    const durable = service.create('one', input, { modelId })
    await service.submit('one', durable.topicId, 'Saved pending question')
    saved = false
    const temporary = service.create('one', input, { modelId })
    await service.submit('one', temporary.topicId, 'Temporary pending question')
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
      await service.submit('one', side.topicId, 'Shared pipeline question')
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
      expect(captured).toMatchObject({ disableTools: true, contextOwner: 'caller' })
      if (!persist) expect(dbh.db.select().from(messageTable).all()).toEqual(before)
    }
  )
})
