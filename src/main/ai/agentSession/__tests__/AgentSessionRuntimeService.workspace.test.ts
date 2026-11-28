import { mkdtemp, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleTable } from '@data/db/schemas/job'
import { agentProviderService } from '@data/services/AgentProviderService'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { LocalRuntimeDriver } from '@main/ai/runtime/LocalRuntimeDriver'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeConnection, AgentRuntimeEvent } from '@main/ai/runtime/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type * as ShellEnv from '@main/utils/shellEnv'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import { bindLocalContext, localContext, resolveLocalContext, resolveLocalLaunch } from '../localContext'

vi.mock('@main/utils/shellEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof ShellEnv>()),
  getRawShellEnv: async () => ({ ...process.env })
}))

const dbh = setupTestDatabase()
const fixture = fileURLToPath(new URL('../../runtime/__tests__/fixtures/localAgent.mjs', import.meta.url))
let directory: string
let service: AgentSessionRuntimeService
let connections: AgentRuntimeConnection[]
let events: AgentRuntimeEvent[]
let release: (() => void) | undefined

beforeEach(async () => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
  directory = await realpath(await mkdtemp(path.join(tmpdir(), 'local-workspace-')))
  await Promise.all(['A', 'B'].map((name) => mkdir(path.join(directory, name))))
  connections = []
  events = []
  service = new AgentSessionRuntimeService()
})

afterEach(async () => {
  vi.useRealTimers()
  release?.()
  release = undefined
  await service.closeSession('session')
  if (service.isReady) await service._doDestroy()
  await Promise.all(connections.map(async (connection) => connection.close()))
  runtimeDriverRegistry.clearForTest()
  MockApplicationUtils.resetServices()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

function setup(protocol: 'acp' | 'codex', pauseFirst = false, scenario = 'workspace') {
  dbh.db
    .insert(agentTable)
    .values({
      id: 'agent',
      type: 'local',
      name: 'Local',
      instructions: '',
      orderKey: 'a0'
    })
    .run()
  agentProviderService.setBindingTx(dbh.db, 'agent', {
    enabled: true,
    presetId: protocol === 'codex' ? 'codex' : undefined,
    executableOverride: process.execPath,
    args: [fixture, protocol, scenario],
    env: { FIXTURE_LOG: path.join(directory, 'wire.jsonl') }
  })
  dbh.db
    .insert(agentWorkspaceTable)
    .values(
      ['A', 'B'].map((name) => ({
        id: name,
        name,
        path: path.join(directory, name),
        type: 'user' as const,
        orderKey: `a${name === 'A' ? 0 : 1}`
      }))
    )
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({
      id: 'session',
      agentId: 'agent',
      workspaceId: 'A',
      name: 'Session',
      orderKey: 'a0'
    })
    .run()
  const driver = new LocalRuntimeDriver()
  const gate = Promise.withResolvers<void>()
  release = gate.resolve
  const connect = driver.connect.bind(driver)
  vi.spyOn(driver, 'connect').mockImplementation(async (input) => {
    const connection = await connect(input)
    connections.push(connection)
    const push = connection.events as unknown as { push: (event: AgentRuntimeEvent) => void }
    const original = push.push.bind(push)
    push.push = (event) => {
      events.push(event)
      original(event)
    }
    if (pauseFirst && connections.length === 1) await gate.promise
    return connection
  })
  runtimeDriverRegistry.register(driver)
}

async function assertFirstInputUsesB(protocol: 'acp' | 'codex') {
  await connections.at(-1)!.send({
    message: agentSessionMessageService.saveMessage({
      sessionId: 'session',
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'cwd' }] } }
    })
  })
  await vi.waitFor(() =>
    expect(
      events.flatMap((event) =>
        event.type === 'message.parts'
          ? event.changes.flatMap((edit) => (edit.type === 'append' ? [edit.text] : []))
          : []
      )
    ).toContain(path.join(directory, 'B'))
  )
  const wire = (await readFile(path.join(directory, 'wire.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const starts = wire.filter((message) => message.method === (protocol === 'acp' ? 'session/new' : 'thread/start'))
  expect(starts.map((message) => message.params.cwd)).toEqual([path.join(directory, 'A'), path.join(directory, 'B')])
  expect(
    wire.filter((message) => ['session/load', 'session/resume', 'thread/resume'].includes(message.method))
  ).toEqual([])
  expect(connections).toHaveLength(2)
  await service.listSessionCommands('session')
  expect(connections).toHaveLength(2)
}

async function readAcpRequests(file = 'wire.jsonl'): Promise<
  {
    method: string
    params: { cwd?: string; sessionId?: string; prompt?: { text?: string }[]; input?: { text?: string }[] }
  }[]
> {
  return (await readFile(path.join(directory, file), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

it('opens ACP only when the conversation becomes interactive and shares the connection with the first prompt', async () => {
  await service._doInit()
  setup('acp', true)
  const backgroundSession = agentSessionService.create(
    { agentId: 'agent', name: 'Ad hoc task', workspace: { type: 'user', workspaceId: 'A' } },
    'background'
  )
  await expect(service.setLocalSessionInteractive('window', backgroundSession.id, true)).rejects.toThrow()
  const session = agentSessionService.create({
    agentId: 'agent',
    name: 'New conversation',
    workspace: { type: 'user', workspaceId: 'B' }
  })
  expect(service.getLocalSessionView(session.id)).toMatchObject({ info: null, permissionUnavailable: true })
  await expect(stat(path.join(directory, 'wire.jsonl'))).rejects.toHaveProperty('code', 'ENOENT')

  const activated = service.setLocalSessionInteractive('window', session.id, true)
  await vi.waitFor(
    async () => {
      const starts = (await readAcpRequests()).filter(
        ({ method }) => method === 'session/new' || method === 'session/prompt'
      )
      expect(starts).toEqual([
        expect.objectContaining({
          method: 'session/new',
          params: expect.objectContaining({ cwd: session.workspace.path })
        })
      ])
    },
    { timeout: 5000 }
  )
  expect(service.getLocalSessionView(session.id)).toMatchObject({
    info: null,
    permissionUnavailable: true,
    connecting: true
  })

  const userMessage = agentSessionMessageService.saveMessage({
    sessionId: session.id,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'cwd' }] } }
  })
  const assistant = agentSessionMessageService.saveMessage({
    sessionId: session.id,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  const turn = service.beginTurn({
    sessionId: session.id,
    topicId: buildAgentSessionTopicId(session.id),
    agentId: 'agent',
    agentType: 'local',
    modelId: 'runtime:agent',
    assistantMessageId: assistant.id,
    userMessage
  })
  service.openTurnStream({ sessionId: session.id, turnId: turn.turnId, signal: turn.abortController.signal })
  release!()
  await activated

  await vi.waitFor(async () => {
    const requests = await readAcpRequests()
    expect(requests.filter(({ method }) => method === 'session/new')).toHaveLength(1)
    expect(requests.filter(({ method }) => method === 'session/prompt')).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ sessionId: 'native-session' }) })
    ])
  })
})

it('saves permission for a scheduled ACP conversation before starting its runtime', async () => {
  setup('acp')
  dbh.db
    .insert(jobScheduleTable)
    .values({
      id: 'schedule',
      type: 'agent.task',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: { agentId: 'agent' },
      catchUpPolicy: { kind: 'skip-missed' }
    })
    .run()
  const session = agentSessionService.create(
    { agentId: 'agent', name: 'Scheduled conversation', workspace: { type: 'user', workspaceId: 'A' } },
    'conversation',
    'schedule'
  )
  agentService.updateAgent('agent', { configuration: { permission_mode: 'acceptEdits' } })
  expect(agentService.getAgent(session.agentId!)?.configuration?.permission_mode).toBe('acceptEdits')
  await expect(stat(path.join(directory, 'wire.jsonl'))).rejects.toHaveProperty('code', 'ENOENT')
})

it('applies the Agent permission change to open ACP sessions and uses it again after reconnect', async () => {
  await service._doInit()
  setup('acp')
  const second = agentSessionService.create({
    agentId: 'agent',
    name: 'Second conversation',
    workspace: { type: 'user', workspaceId: 'B' }
  })

  await Promise.all([
    service.setLocalSessionInteractive('window-1', 'session', true),
    service.setLocalSessionInteractive('window-2', second.id, true)
  ])
  for (const id of ['session', second.id]) {
    expect(service.getLocalSessionView(id).info?.hostPermission?.currentValue).toBe('default')
  }
  agentService.updateAgent('agent', { configuration: { permission_mode: 'acceptEdits' } })
  await vi.waitFor(() => {
    for (const id of ['session', second.id]) {
      expect(service.getLocalSessionView(id).info?.hostPermission?.currentValue).toBe('acceptEdits')
    }
  })
  expect(connections).toHaveLength(2)

  await service.closeSession(second.id)
  await service.listSessionCommands(second.id)
  expect(service.getLocalSessionView(second.id).info?.hostPermission?.currentValue).toBe('acceptEdits')
})

it('keeps ordinary ACP permission choices unavailable after a failed connection', async () => {
  setup('acp')
  const driver = runtimeDriverRegistry.getAgentSessionDriver('local')!
  vi.mocked(driver.connect).mockRejectedValueOnce(new Error('ACP startup failed'))

  await expect(service.setLocalSessionInteractive('window', 'session', true)).rejects.toThrow('ACP startup failed')
  expect(service.getLocalSessionView('session')).toMatchObject({ info: null, permissionUnavailable: true })
})

it('reclaims an idle ACP connection after the last interactive view leaves and restores it on return', async () => {
  await service._doInit()
  setup('acp')
  const anchor = agentSessionMessageService.saveMessage({
    sessionId: 'session',
    message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Existing history' }] } }
  })
  const launch = resolveLocalLaunch('session', 'agent')!
  const context = localContext('session', 'agent', anchor.id, launch.target, undefined)!
  bindLocalContext(context.id, 'native-session')
  await Promise.all([
    service.setLocalSessionInteractive('first-window', 'session', true),
    service.setLocalSessionInteractive('second-window', 'session', true)
  ])
  expect(service.getLocalSessionView('session').info?.resume).toBe(true)

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await service.setLocalSessionInteractive('first-window', 'session', false)
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  expect(service.getLocalSessionView('session').info?.resume).toBe(true)
  await service.setLocalSessionInteractive('second-window', 'session', false)
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  vi.useRealTimers()

  await vi.waitFor(() => expect(service.getLocalSessionView('session').info).toBeNull())
  expect((await readAcpRequests()).filter(({ method }) => method === 'session/load')).toHaveLength(1)
  await service.setLocalSessionInteractive('first-window', 'session', true)
  expect(
    (await readAcpRequests()).filter(({ method }) => method === 'session/load').map(({ params }) => params.sessionId)
  ).toEqual(['native-session', 'native-session'])
  expect((await readAcpRequests()).some(({ method }) => method === 'session/new' || method === 'session/prompt')).toBe(
    false
  )
})

it('rechecks the directory if it changes while reconciliation is awaiting', async () => {
  setup('acp')
  await service.listSessionCommands('session')
  const entered = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  release = gate.resolve
  const current = connections[0].reconcile.bind(connections[0])
  vi.spyOn(connections[0], 'reconcile').mockImplementationOnce(async (input) => {
    entered.resolve()
    await gate.promise
    return current(input)
  })
  const primed = service.listSessionCommands('session')
  await entered.promise
  agentSessionService.setWorkspace('session', { type: 'user', workspaceId: 'B' })
  gate.resolve()
  await primed
  await assertFirstInputUsesB('acp')
})

it('opens the first native session after failed dispatches have already written transcript rows', async () => {
  setup('acp')
  for (const role of ['user', 'assistant', 'user'] as const) {
    agentSessionMessageService.saveMessage({
      sessionId: 'session',
      message: { role, status: role === 'assistant' ? 'error' : 'success', data: { parts: [] } }
    })
  }
  await service.listSessionCommands('session')
  const wire = (await readFile(path.join(directory, 'wire.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(wire.filter((message) => message.method === 'session/new')).toHaveLength(1)
  expect(wire.some((message) => message.method === 'session/load')).toBe(false)
})

it('keeps a started conversation bound to its existing workspace', async () => {
  setup('acp')
  agentSessionMessageService.saveMessage({
    sessionId: 'session',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'hello' }] } }
  })
  expect(() => agentSessionService.setWorkspace('session', { type: 'user', workspaceId: 'B' })).toThrow(
    'workspace cannot be changed after messages are sent'
  )
  expect(agentSessionService.getById('session').workspace.path).toBe(path.join(directory, 'A'))
})

it.each(['acp', 'codex'] as const)('rebuilds a warmed %s session in B without resuming A', async (protocol) => {
  setup(protocol)
  await service.listSessionCommands('session')
  agentSessionService.setWorkspace('session', { type: 'user', workspaceId: 'B' })
  await service.listSessionCommands('session')
  await assertFirstInputUsesB(protocol)
})

it.each(['acp', 'codex'] as const)(
  'discards an in-flight %s connection to A after switching to B',
  async (protocol) => {
    setup(protocol, true)
    const primed = service.listSessionCommands('session')
    await vi.waitFor(() => expect(connections).toHaveLength(1))
    agentSessionService.setWorkspace('session', { type: 'user', workspaceId: 'B' })
    release!()
    await primed
    await assertFirstInputUsesB(protocol)
  }
)

it('reconnects a claimed ACP context to its original provider after its Agent switches providers', async () => {
  setup('acp')
  await service.listSessionCommands('session')
  expect(resolveLocalContext('session')).toBeUndefined()
  const message = agentSessionMessageService.saveMessage({
    sessionId: 'session',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'first' }] } }
  })
  await connections[0].send({ message })
  const original = resolveLocalContext('session')!
  expect(original.context.nativeThreadId).toBe('native-session')
  await service.closeSession('session')

  const next = agentProviderService.setBindingTx(dbh.db, 'agent', {
    env: { FIXTURE_LOG: path.join(directory, 'new-provider.jsonl') }
  })
  await service.listSessionCommands('session')
  expect(service.getLocalSessionView('session').providerId).toBe(original.providerId)
  expect(
    (await readAcpRequests()).filter(({ method }) => method === 'session/load').map(({ params }) => params.sessionId)
  ).toEqual(['native-session'])
  expect(resolveLocalContext('session')?.context.id).toBe(original.context.id)

  const fresh = agentSessionService.create({
    agentId: 'agent',
    name: 'New',
    workspace: { type: 'user', workspaceId: 'A' }
  })
  await service.listSessionCommands(fresh.id)
  expect(service.getLocalSessionView(fresh.id).providerId).toBe(next.providerId)
  expect((await readAcpRequests('new-provider.jsonl')).filter(({ method }) => method === 'session/new')).toHaveLength(1)
  await service.closeSession(fresh.id)
})

it('replaces an unclaimed ACP warmup when the Agent provider changes during startup', async () => {
  setup('acp', true)
  const opening = service.listSessionCommands('session')
  await vi.waitFor(() => expect(connections).toHaveLength(1))
  const next = agentProviderService.setBindingTx(dbh.db, 'agent', {
    env: { FIXTURE_LOG: path.join(directory, 'new-provider.jsonl') }
  })
  release!()
  await opening
  expect(resolveLocalContext('session')).toBeUndefined()
  expect(service.getLocalSessionView('session').providerId).toBe(next.providerId)
  const message = agentSessionMessageService.saveMessage({
    sessionId: 'session',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'first' }] } }
  })
  await connections.at(-1)!.send({ message })
  expect((await readAcpRequests()).some(({ method }) => method === 'session/prompt')).toBe(false)
  expect(
    (await readAcpRequests('new-provider.jsonl')).filter(({ method }) => method === 'session/prompt')
  ).toHaveLength(1)
  expect(resolveLocalContext('session')?.providerId).toBe(next.providerId)
})

it('reopens the original native thread when the provider login changes', async () => {
  setup('acp')
  agentProviderService.setBindingTx(dbh.db, 'agent', { account: { methodId: 'oauth', accountId: 'first' } })
  const message = agentSessionMessageService.saveMessage({
    sessionId: 'session',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'first' }] } }
  })
  const launch = resolveLocalLaunch('session', 'agent')!
  localContext('session', 'agent', message.id, launch.target, undefined, 'native-session')
  const original = resolveLocalContext('session')!
  await service.listSessionCommands('session')

  const updated = agentProviderService.setBindingTx(dbh.db, 'agent', {
    account: { methodId: 'oauth', accountId: 'second' }
  })
  expect(updated.providerId).toBe(original.providerId)
  await service.listSessionCommands('session')

  const requests = await readAcpRequests()
  expect(requests.filter(({ method }) => method === 'session/new')).toHaveLength(0)
  expect(requests.filter(({ method }) => method === 'session/load').map(({ params }) => params.sessionId)).toEqual([
    original.context.nativeThreadId,
    original.context.nativeThreadId
  ])
  expect(resolveLocalContext('session')?.context.id).toBe(original.context.id)
  expect(connections.at(-1)?.localRuntime?.account?.accountId).toBe('second')
})

it.each([
  ['acp', 'resume-lost', 'session/prompt'],
  ['codex', 'lost-rollout', 'turn/start']
] as const)(
  'rebuilds a missing %s thread with reference history on the first new prompt only',
  async (protocol, scenario, promptMethod) => {
    setup(protocol, false, scenario)
    const remembered = agentSessionMessageService.saveMessage({
      sessionId: 'session',
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Keep the blue notebook' }] } }
    })
    const launch = resolveLocalLaunch('session', 'agent')!
    const original = localContext('session', 'agent', remembered.id, launch.target, undefined, 'lost-thread')!
    agentSessionMessageService.saveMessage({
      sessionId: 'session',
      runtimeResumeToken: 'lost-thread',
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Notebook saved' }] } }
    })
    await service.listSessionCommands('session')
    expect(resolveLocalContext('session')?.context.id).toBe(original.id)
    expect((await readAcpRequests()).some(({ method }) => method === promptMethod)).toBe(false)

    async function send(text: string) {
      const userMessage = agentSessionMessageService.saveMessage({
        sessionId: 'session',
        message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
      })
      const assistant = agentSessionMessageService.saveMessage({
        sessionId: 'session',
        message: { role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      const turn = service.beginTurn({
        sessionId: 'session',
        topicId: buildAgentSessionTopicId('session'),
        agentId: 'agent',
        agentType: 'local',
        modelId: 'runtime:agent',
        assistantMessageId: assistant.id,
        userMessage
      })
      const { stream } = service.openTurnStream({
        sessionId: 'session',
        turnId: turn.turnId,
        signal: turn.abortController.signal
      })
      for await (const event of stream) {
        if (event.type === 'error') throw event.error
      }
      service.markTurnTerminal('session', 'success', turn.turnId)
      await service.closeSession('session')
    }

    await send('What did we save?')
    expect(resolveLocalContext('session')?.context).toMatchObject({ nativeThreadId: 'native-session' })

    await send('Next question')
    const prompts = (await readAcpRequests())
      .filter(({ method }) => method === promptMethod)
      .map(({ params }) => (params.prompt ?? params.input)?.map(({ text }) => text))
    expect(prompts).toHaveLength(2)
    expect(prompts[0]?.[0]).toContain('Keep the blue notebook')
    expect(prompts[0]?.[0]).toContain('Notebook saved')
    expect(prompts[0]?.at(-1)).toBe('What did we save?')
    expect(prompts[1]).toEqual(['Next question'])
    expect(agentSessionMessageService.getSessionMessage('session', remembered.id).data.parts).toEqual([
      { type: 'text', text: 'Keep the blue notebook' }
    ])
  }
)

it('keeps an unchanged ACP warmup and rejects changed model or credentials at first input', async () => {
  setup('acp', true)
  const account = { methodId: 'native', accountId: 'test-account' }
  agentProviderService.setBindingTx(dbh.db, 'agent', { account })
  const opening = service.listSessionCommands('session')
  await vi.waitFor(() => expect(connections).toHaveLength(1))
  const unchanged = agentProviderService.setBindingTx(dbh.db, 'agent', { enabled: true })
  release!()
  await opening
  expect((await readAcpRequests()).filter(({ method }) => method === 'session/new')).toHaveLength(1)

  const message = agentSessionMessageService.saveMessage({
    sessionId: 'session',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'first' }] } }
  })

  const rotated = agentProviderService.setBindingTx(dbh.db, 'agent', {
    account,
    encryptedEnv: 'different-sealed-credentials'
  })
  expect(rotated.providerId).toBe(unchanged.providerId)
  expect(connections[0].claimLocalContext?.(message.id)).toBe(false)

  const edited = agentProviderService.setBindingTx(dbh.db, 'agent', {
    account,
    encryptedEnv: null,
    nativeModel: 'new-model'
  })
  expect(edited.providerId).toBe(unchanged.providerId)
  expect(connections[0].claimLocalContext?.(message.id)).toBe(false)
  expect(resolveLocalContext('session')).toBeUndefined()
})
