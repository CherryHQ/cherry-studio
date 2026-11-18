import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import { createTestBinding, scriptedModel } from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { createPiBehaviorHost } from './piBehaviorHost'

const captureUsageMock = vi.hoisted(() => vi.fn(() => ({ headers: {}, release: () => {} })))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  // DbService pins a known key so the literal satisfies the weak-type ServiceOverrides
  // check; it re-selects the default mock, so runtime behavior is unchanged.
  const overrides = {
    DbService: defaultServiceInstances.DbService,
    ApiGatewayService: { captureAgentSessionUsage: captureUsageMock }
  }
  return mockApplicationFactory(overrides)
})

const root = runtimeId<'thread'>('root')
const child = { backendId: runtimeId<'backend'>('pi'), id: runtimeId<'thread'>('restored-child') }
const openRouterKey = 'router/router:sonnet'
const anthropicKey = 'anthropic/anthropic:sonnet'

describe('Pi behavior host model lookup', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(userProviderTable)
      .values([
        { providerId: 'router', name: 'OpenRouter', isEnabled: true, orderKey: 'a0' },
        { providerId: 'anthropic', name: 'Anthropic', isEnabled: true, orderKey: 'a1' },
        { providerId: 'disabled', name: 'Disabled', isEnabled: false, orderKey: 'a2' }
      ])
      .run()
    dbh.db
      .insert(userModelTable)
      .values([
        {
          id: 'router::sonnet',
          providerId: 'router',
          modelId: 'sonnet',
          name: 'Claude Sonnet 4.5',
          orderKey: 'a0',
          capabilities: ['function-call'],
          supportsStreaming: true
        },
        {
          id: 'anthropic::sonnet',
          providerId: 'anthropic',
          modelId: 'sonnet',
          name: 'Claude Sonnet 4.5',
          orderKey: 'a0',
          capabilities: ['function-call'],
          supportsStreaming: true
        },
        {
          id: 'disabled::sonnet',
          providerId: 'disabled',
          modelId: 'sonnet',
          name: 'Claude Sonnet 4.5',
          orderKey: 'a0',
          capabilities: ['function-call'],
          supportsStreaming: true
        },
        {
          id: 'router::image',
          providerId: 'router',
          modelId: 'image',
          name: 'Image',
          orderKey: 'a1',
          capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
          supportsStreaming: false
        },
        {
          id: 'router::off',
          providerId: 'router',
          modelId: 'off',
          name: 'Disabled model',
          orderKey: 'a2',
          capabilities: ['function-call'],
          supportsStreaming: true,
          isEnabled: false
        },
        {
          id: 'router::text',
          providerId: 'router',
          modelId: 'text',
          name: 'Text only',
          orderKey: 'a3',
          capabilities: [],
          supportsStreaming: true
        }
      ])
      .run()
  })

  async function createHost(overrides?: { usageSessionId?: (thread: ThreadId) => Promise<string> }) {
    const rootModel = modelService.list({ enabled: true }).find((model) => model.id === 'anthropic::sonnet')!
    const binding = await createTestBinding({ stream: scriptedModel([]).model })
    return createPiBehaviorHost({
      input: { sessionId: 'session', agentId: 'agent', modelId: rootModel.id },
      root: () => root,
      model: rootModel,
      binding,
      rootModelKey: anthropicKey,
      bindModel: async (model: Model) => ({
        ...binding,
        model: { ...binding.model, id: model.id, provider: model.providerId }
      }),
      approval: {
        sessionId: 'session',
        workspacePath: '/tmp',
        agentDataPath: '/tmp',
        additionalReadOnlyRoots: [],
        getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
        getPermissionMode: () => 'default',
        isDisabled: () => false,
        autoApprovedTools: new Set(),
        approvalRequiredTools: new Set(),
        nonBypassableApprovalTools: new Set(),
        delegationTools: new Set()
      },
      usageSessionId: overrides?.usageSessionId ?? (async () => 'usage'),
      toolCallIdentity: async () => ({ toolCallId: 'call' }),
      emit: () => {},
      observe: () => {}
    })
  }

  it('selects the provider-qualified model even when the parent uses another provider', async () => {
    const { host } = await createHost()
    const candidates = await host.models.find('OpenRouter Claude Sonnet 4.5', root)
    expect(candidates).toEqual([{ key: openRouterKey, provider: 'router', model: 'sonnet', exact: true }])
  })

  it('leaves duplicate bare names ambiguous for the decision owner', async () => {
    const { host } = await createHost()
    const candidates = await host.models.find('Claude Sonnet 4.5', root)
    expect(candidates).toHaveLength(2)
    expect(candidates).toEqual(
      expect.arrayContaining([
        { key: openRouterKey, provider: 'router', model: 'sonnet', exact: true },
        { key: anthropicKey, provider: 'anthropic', model: 'sonnet', exact: true }
      ])
    )
  })

  it('enumerates enabled compatible models and restores a child with no previous lookup', async () => {
    const { host } = await createHost()
    expect(await host.models.find('', root)).toEqual(
      expect.arrayContaining([
        { key: openRouterKey, provider: 'router', model: 'sonnet', exact: false },
        { key: anthropicKey, provider: 'anthropic', model: 'sonnet', exact: false },
        { key: 'router/router:text', provider: 'router', model: 'text', exact: false }
      ])
    )
    expect(await host.models.find('', root)).toHaveLength(3)
    const restored = await createHost()
    expect((await restored.configureChild({ thread: child, modelKey: openRouterKey })).model).toMatchObject({
      id: 'router::sonnet',
      provider: 'router'
    })
    expect(await restored.host.models.current(child.id)).toEqual({
      parentModelKey: openRouterKey,
      defaultChildModelKey: openRouterKey,
      supportsTools: true
    })
  })

  it('caches non-matching models while looking up another name', async () => {
    const { host, configureChild } = await createHost()
    await host.models.find('No such model', root)
    host.models.find = async () => {
      throw new Error('Catalog should already be cached')
    }
    expect((await configureChild({ thread: child, modelKey: openRouterKey })).model.id).toBe('router::sonnet')
  })

  it('resolves the child usage owner at its first summary request and freezes it per child', async () => {
    // Mirrors the desktop callback contract (PiRuntimeConnection): the usage owner exists only
    // once the child is registered, which happens after configureChild returns.
    const registered = new Set<string>()
    const usageSessionId = vi.fn(async (thread: ThreadId) => {
      if (!registered.has(thread)) throw new Error('Native child usage context is unavailable')
      return `usage-${thread}`
    })
    const { configureChild } = await createHost({ usageSessionId })

    // Configuring a child on a non-root model must not touch the usage owner: the child is not
    // registered yet, so the desktop callback would throw and abort the child before it starts.
    const configured = await configureChild({ thread: child, modelKey: openRouterKey })
    expect(usageSessionId).not.toHaveBeenCalled()

    registered.add(child.id)
    const completeSimple = vi.fn().mockResolvedValue(assistant({ content: [{ type: 'text', text: 'summary' }] }))
    const summarize = configured.compaction?.summarize
    if (!summarize) throw new Error('child binding carries no summarizer')
    const first = await summarize(request([user('hello')], meteredStream(completeSimple)))
    if (typeof first === 'string') throw new Error('expected a structured summary')
    expect(first.summary).toBe('summary')
    expect(usageSessionId).toHaveBeenCalledTimes(1)
    expect(captureUsageMock).toHaveBeenCalledWith('session', `usage-${child.id}`)

    // Frozen for this child: later summaries reuse the resolved owner.
    await summarize(request([user('again')], meteredStream(completeSimple)))
    expect(usageSessionId).toHaveBeenCalledTimes(1)

    // A second child on the same model attributes usage to its own session, not the cached one.
    const sibling = { backendId: child.backendId, id: runtimeId<'thread'>('sibling-child') }
    const configuredSibling = await configureChild({ thread: sibling, modelKey: openRouterKey })
    registered.add(sibling.id)
    const siblingSummarize = configuredSibling.compaction?.summarize
    if (!siblingSummarize) throw new Error('sibling binding carries no summarizer')
    await siblingSummarize(request([user('sibling')], meteredStream(completeSimple)))
    expect(usageSessionId).toHaveBeenCalledTimes(2)
    expect(captureUsageMock).toHaveBeenLastCalledWith('session', `usage-${sibling.id}`)
  })
})

const emptyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } }

function assistant(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage: emptyUsage,
    stopReason: 'stop',
    timestamp: 0,
    ...overrides
  } as AssistantMessage
}

const user = (content: string): Message => ({ role: 'user', content, timestamp: 0 })

/** The metered stream the runtime supplies; its result resolves like pi's stream output. */
function meteredStream(completeSimple: ReturnType<typeof vi.fn>) {
  return vi.fn().mockImplementation((...args: unknown[]) => ({
    result: () => (completeSimple as (...a: unknown[]) => unknown)(...args)
  }))
}

function request(messages: Message[], stream: ReturnType<typeof meteredStream>) {
  return {
    reason: 'threshold' as const,
    sessionId: 's1',
    model: {} as never,
    messages,
    signal: new AbortController().signal,
    stream: stream as never
  }
}
