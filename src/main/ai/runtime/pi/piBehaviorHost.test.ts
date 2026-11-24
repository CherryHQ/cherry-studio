import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { callKeyOf } from '@cherrystudio/agent-behavior'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { AgentFileSnapshotService } from '@main/ai/agentSession/AgentFileSnapshotService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import { createTestBinding, scriptedModel } from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import type { AgentRuntimeEvent } from '../types'
import { createPiBehaviorHost, createPiInteractionPorts } from './piBehaviorHost'

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

  async function createHost(cwd = process.cwd()) {
    const rootModel = modelService.list({ enabled: true }).find((model) => model.id === 'anthropic::sonnet')!
    const binding = await createTestBinding({ stream: scriptedModel([]).model })
    return createPiBehaviorHost({
      cwd,
      runtime: 'pi',
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

  it('excludes absolute agent data paths, blocks relative escapes, and snapshots workspace paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-snapshot-'))
    const cwd = path.join(dir, 'workspace')
    const agentData = path.join(dir, 'agent')
    await mkdir(cwd)
    await mkdir(agentData)
    BaseService.resetInstances()
    const snapshots = new AgentFileSnapshotService()
    const round = { sessionId: 'session', replyId: 'reply', inputMessageIds: ['input'] }
    try {
      vi.spyOn(application, 'getPath').mockReturnValue(path.join(dir, 'snapshots'))
      vi.spyOn(snapshots, 'workspaceRoots').mockResolvedValue([])
      MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
      MockApplicationUtils.setService('AgentSessionRuntimeService', { getLiveSnapshotRound: () => round })
      await snapshots.admitRound(round)
      const { host } = await createHost(cwd)
      const protect = (filePath: string, callKey: string) =>
        host.fileWrites!.protect({
          thread: root,
          callKey,
          tool: 'write',
          args: { path: filePath, content: 'new' },
          signal: new AbortController().signal
        })
      expect(await protect(path.join(agentData, 'SOUL.md'), 'external')).toEqual({})
      expect(await protect('../escape', 'escape')).toEqual({ block: 'outside-workspace' })
      expect(await protect('ordinary', 'ordinary')).toEqual({})
      const manifest = JSON.parse(await readFile(path.join(dir, 'snapshots/session/reply/manifest.json'), 'utf8'))
      expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([path.join(cwd, 'ordinary')])
    } finally {
      vi.restoreAllMocks()
      MockApplicationUtils.resetServices()
      BaseService.resetInstances()
      await rm(dir, { recursive: true, force: true })
    }
  })

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

describe('Pi approval identity', () => {
  // Separate Durable stores number their conversations and tasks alike, so two chats can ask with the same CallRef.
  it('keeps approvals from two sessions with the same call apart', async () => {
    const call = { thread: runtimeId<'thread'>('1'), key: callKeyOf('1') }
    const requests: { sessionId: string; approvalId: string }[] = []
    const ask = (sessionId: string) =>
      createPiInteractionPorts({
        input: { sessionId, agentId: 'agent', modelId: 'test::model' },
        approval: {
          sessionId,
          workspacePath: '/workspace',
          agentDataPath: '/agent',
          additionalReadOnlyRoots: [],
          getPermissionMode: () => 'default',
          getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
          isDisabled: () => false,
          autoApprovedTools: new Set(),
          approvalRequiredTools: new Set(),
          nonBypassableApprovalTools: new Set(),
          delegationTools: new Set()
        },
        toolCallIdentity: async () => ({ toolCallId: `${sessionId}-call` }),
        emit: (event: AgentRuntimeEvent) => {
          if (event.type === 'tool-approval-request') requests.push({ sessionId, approvalId: event.request.approvalId })
        }
      }).approvals.ask(
        {
          call,
          tool: { callId: 'c1', callKey: call.key, name: 'Bash', args: { command: 'ls' } },
          presentation: 'stream'
        },
        new AbortController().signal
      )

    const first = ask('s1')
    const second = ask('s2')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[0].approvalId).not.toBe(requests[1].approvalId)

    toolApprovalRegistry.dispatch(requests[1].approvalId, { approved: true })
    toolApprovalRegistry.dispatch(requests[0].approvalId, { approved: false })

    await expect(second).resolves.toMatchObject({ kind: 'granted' })
    await expect(first).resolves.toMatchObject({ kind: 'denied' })
  })

  // An edit and resend can start a fresh Durable store under the same session, which numbers its calls again.
  it('gives each registration its own approval ID within one session', async () => {
    const call = { thread: runtimeId<'thread'>('1'), key: callKeyOf('1') }
    const ids: string[] = []
    const ports = createPiInteractionPorts({
      input: { sessionId: 's1', agentId: 'agent', modelId: 'test::model' },
      approval: {
        sessionId: 's1',
        workspacePath: '/workspace',
        agentDataPath: '/agent',
        additionalReadOnlyRoots: [],
        getPermissionMode: () => 'default',
        getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
        isDisabled: () => false,
        autoApprovedTools: new Set(),
        approvalRequiredTools: new Set(),
        nonBypassableApprovalTools: new Set(),
        delegationTools: new Set()
      },
      toolCallIdentity: async () => ({ toolCallId: 'call' }),
      emit: (event: AgentRuntimeEvent) => {
        if (event.type === 'tool-approval-request') ids.push(event.request.approvalId)
      }
    })
    const askOnce = async () => {
      const answer = ports.approvals.ask(
        {
          call,
          tool: { callId: 'c1', callKey: call.key, name: 'Bash', args: { command: 'ls' } },
          presentation: 'stream'
        },
        new AbortController().signal
      )
      await vi.waitFor(() => expect(toolApprovalRegistry.peek(ids.at(-1) ?? '')).toBeDefined())
      toolApprovalRegistry.dispatch(ids.at(-1)!, { approved: true })
      return answer
    }

    await askOnce()
    await askOnce()

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})
