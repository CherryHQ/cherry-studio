import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model
} from '@earendil-works/pi-ai'
import {
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

const model: Model<'openai-completions'> = {
  id: 'length-recovery-test',
  name: 'Length recovery test',
  api: 'openai-completions',
  provider: 'length-recovery-test',
  baseUrl: 'https://example.invalid/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000
}

function response(
  stopReason: 'length' | 'stop',
  output: number,
  text: string
): AssistantMessage & { stopReason: 'length' | 'stop' } {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{ type: 'text', text }],
    stopReason,
    usage: {
      input: 8_000,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 8_000 + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    // Keep provider responses newer than compaction boundaries even within the same millisecond.
    timestamp: Date.now() + 10_000
  }
}

async function createSession(responses: ReturnType<typeof response>[], cancelCompaction = false) {
  const cwd = process.cwd()
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 0, keepRecentTokens: 1 },
    retry: { enabled: false }
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        pi.on('session_before_compact', async (event) => {
          if (cancelCompaction) return { cancel: true }
          return {
            compaction: {
              summary: 'Synthetic summary',
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore
            }
          }
        })
      }
    ]
  })
  await resourceLoader.reload()
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(model.provider, 'synthetic-test-key')
  const modelRegistry = ModelRegistry.inMemory(authStorage)
  const { session } = await createAgentSession({
    cwd,
    model,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    tools: []
  })
  await session.bindExtensions({})
  const contexts: Context[] = []
  const events: AgentSessionEvent[] = []
  session.subscribe((event) => events.push(event))
  // pi-agent-core resolves its own @earendil-works/pi-ai copy, so its AssistantMessageEventStream
  // is a nominally distinct class from ours; the runtime object is the same shape.
  session.agent.streamFn = ((_model: Model<'openai-completions'>, context: Context) => {
    contexts.push(structuredClone(context))
    const message = responses[contexts.length - 1]
    if (!message) throw new Error('Unexpected extra provider request')
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'start', partial: message })
    stream.push({ type: 'done', reason: message.stopReason, message })
    stream.end()
    return stream
  }) as unknown as typeof session.agent.streamFn
  return { session, contexts, events }
}

describe('Pi context-clamped length recovery SDK contract', () => {
  it('compacts once and continues without replaying the truncated assistant response', async () => {
    const { session, contexts, events } = await createSession([
      response('length', 1, 'truncated response'),
      response('stop', 10, 'completed response')
    ])
    try {
      await session.prompt('Synthetic context. '.repeat(500))

      expect(contexts).toHaveLength(2)
      expect(events.filter((event) => event.type === 'compaction_start')).toHaveLength(1)
      expect(contexts[1].messages).not.toContainEqual(expect.objectContaining({ role: 'assistant' }))
      expect(session.messages.at(-1)).toEqual(expect.objectContaining({ stopReason: 'stop' }))
      expect(session.sessionManager.getEntries()).toContainEqual(
        expect.objectContaining({
          type: 'message',
          message: expect.objectContaining({ stopReason: 'length' })
        })
      )
    } finally {
      session.dispose()
    }
  })

  it('does not repeat compact-and-retry when the recovery response is also truncated', async () => {
    const { session, contexts, events } = await createSession([
      response('length', 1, 'first truncation'),
      response('length', 1, 'second truncation')
    ])
    try {
      await session.prompt('Synthetic context. '.repeat(500))

      expect(contexts).toHaveLength(2)
      expect(events.filter((event) => event.type === 'compaction_start')).toHaveLength(1)
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'compaction_end',
          willRetry: false,
          errorMessage: expect.stringContaining('one compact-and-retry attempt')
        })
      )
    } finally {
      session.dispose()
    }
  })

  it('does not recover a response that reached the configured output limit', async () => {
    const { session, contexts, events } = await createSession([response('length', model.maxTokens, 'output capped')])
    try {
      await session.prompt('Synthetic context. '.repeat(500))

      expect(contexts).toHaveLength(1)
      expect(events.filter((event) => event.type === 'compaction_start')).toHaveLength(0)
    } finally {
      session.dispose()
    }
  })

  it('does not continue when compaction is cancelled', async () => {
    const { session, contexts, events } = await createSession([response('length', 1, 'truncated response')], true)
    try {
      await session.prompt('Synthetic context. '.repeat(500))

      expect(contexts).toHaveLength(1)
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'compaction_end', aborted: true, willRetry: false })
      )
    } finally {
      session.dispose()
    }
  })
})
