import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import { createTestBinding, scriptedModel } from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { createPiBehaviorHost } from './piBehaviorHost'

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

  async function createHost() {
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
      usageSessionId: async () => 'usage',
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
})
