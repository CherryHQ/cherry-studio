import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import {
  createModels,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxProviderHandle,
  type AssistantMessage
} from '@earendil-works/pi-ai'
import { configure, createRegistry, Harness } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { onTestFinished } from 'vitest'

import type { ContractHarness, HarnessPorts, ScriptedReply } from '@cherrystudio/agent-behavior'
import type { ThreadId } from '@cherrystudio/agent-runtime'

import { createPiDurableBehavior, type PiDurableBehavior } from '../src/behavior/harness'
import { conversationId, pages, threadId } from '../src/behavior/history'
import { meteredModels } from '../src/behavior/models'

export async function openDurableHarness(
  install: (ports: HarnessPorts) => void
): Promise<{ harness: ContractHarness; errors: unknown[]; native(): Harness; behavior(): PiDurableBehavior }> {
  const directory = await mkdtemp(join(tmpdir(), 'durable-behavior-'))
  const path = join(directory, 'store.sqlite')
  const models = createModels()
  const scripts = new Map<string, ScriptedReply[]>()
  const providers = new Map<string, FauxProviderHandle>()
  const provider = (thread: ThreadId) => {
    let found = providers.get(thread)
    if (!found) {
      found = fauxProvider({ provider: `thread-${thread}`, tokensPerSecond: 100000 })
      providers.set(thread, found)
      models.setProvider({
        ...found.provider,
        streamSimple(model) {
          const reply = scripts.get(thread)?.shift()
          const message: AssistantMessage =
            reply && !('error' in reply)
              ? fauxAssistantMessage(
                  [
                    { type: 'text', text: reply.text },
                    ...(reply.toolCalls ?? []).map((call) =>
                      fauxToolCall(call.name, call.args as Record<string, never>)
                    )
                  ],
                  { stopReason: reply.toolCalls?.length ? 'toolUse' : 'stop' }
                )
              : fauxAssistantMessage('', {
                  stopReason: 'error',
                  errorMessage: reply && 'error' in reply ? reply.error : 'Script exhausted'
                })
          message.api = model.api
          message.provider = model.provider
          message.model = model.id
          const usage = reply && 'usage' in reply ? reply.usage : undefined
          message.usage = {
            input: usage?.input ?? 0,
            output: usage?.output ?? 0,
            cacheRead: usage?.cacheRead ?? 0,
            cacheWrite: usage?.cacheWrite ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage?.costUsd ?? 0 }
          }
          const stream = createAssistantMessageEventStream()
          stream.push({ type: 'start', partial: message })
          if (message.stopReason === 'error') stream.push({ type: 'error', reason: 'error', error: message })
          else stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message })
          stream.end(message)
          return stream
        }
      })
    }
    return found
  }
  const errors: unknown[] = []
  let native: Harness
  let behavior: PiDurableBehavior
  let closed = false
  const modelOf = (thread: ThreadId) => {
    const model = provider(thread).getModel()
    return { provider: model.provider, modelId: model.id }
  }
  async function open() {
    const registry = createRegistry()
    behavior = createPiDurableBehavior({
      install,
      configureChild: (child) => ({ model: modelOf(child) }),
      onError: (error) => errors.push(error)
    })
    registry.install(behavior.extension)
    native = await Harness.open(
      await openNodeSqliteStorage(path),
      {
        models: meteredModels(models, behavior),
        registry,
        settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } },
        onReport: (error) => errors.push(error)
      },
      context
    )
    await behavior.bind(native)
  }
  await open()
  const harness: ContractHarness = {
    async createThread() {
      const conversation = await native.createConversation({ ownership: { kind: 'ownerless' } }, context)
      const thread = threadId(conversation.id)
      await native.commit((tx) => configure(tx, conversation.id, { model: modelOf(thread) }), context)
      await behavior.open(thread)
      return thread
    },
    withCall(thread, use) {
      native.resume()
      return behavior.withCall(thread, use)
    },
    script(thread, replies) {
      scripts.set(thread, [...(scripts.get(thread) ?? []), ...replies])
    },
    async sendUser(thread, text) {
      await (await native.conversation(conversationId(thread), context))!.submit(
        { type: 'input', content: text, whenBusy: 'followUp' },
        context
      )
    },
    async compact(thread) {
      const task = await (await native.conversation(conversationId(thread), context))!.compact(undefined, context)
      await native.waitForTask(task, context)
    },
    async settle() {
      for (;;) {
        const tasks = await native.commit((tx) => pages((cursor) => tx.scanTasks({}, 256, cursor)), context)
        const active = tasks.filter((task) => task.state.status !== 'terminal')
        if (!active.length) return
        await Promise.all(active.map((task) => native.waitForTask(task.id, context)))
      }
    },
    async restart() {
      await behavior.close()
      await native.close(context)
      await open()
      native.resume()
    },
    async close() {
      if (closed) return
      closed = true
      await behavior.close()
      await native.close(context)
      await rm(directory, { recursive: true, force: true })
    }
  }
  onTestFinished(() => harness.close())
  return { harness, errors, native: () => native, behavior: () => behavior }
}
