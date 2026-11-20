import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { LocalRuntimeDriver } from '@main/ai/runtime/localAgent/LocalRuntimeDriver'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeConnection, AgentRuntimeEvent, AgentRuntimeUserInput } from '@main/ai/runtime/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type * as ShellEnv from '@main/utils/shellEnv'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

vi.mock('@main/utils/shellEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof ShellEnv>()),
  getRawShellEnv: async () => ({ ...process.env })
}))

const dbh = setupTestDatabase()
const fixture = fileURLToPath(new URL('../../runtime/localAgent/__tests__/fixtures/localAgent.mjs', import.meta.url))
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
  release?.()
  release = undefined
  await service.closeSession('session')
  await Promise.all(connections.map(async (connection) => connection.close()))
  runtimeDriverRegistry.clearForTest()
  MockApplicationUtils.resetServices()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

function setup(protocol: 'acp' | 'codex', pauseFirst = false) {
  dbh.db
    .insert(agentTable)
    .values({
      id: 'agent',
      type: 'local',
      name: 'Local',
      instructions: '',
      orderKey: 'a0',
      configuration: {
        localRuntime: {
          enabled: true,
          protocol,
          executableOverride: process.execPath,
          args: [fixture, protocol, 'workspace'],
          env: { FIXTURE_LOG: path.join(directory, 'wire.jsonl') }
        }
      }
    })
    .run()
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
    const push = connection.events as { push: (event: AgentRuntimeEvent) => void }
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
  await connections
    .at(-1)!
    .send({ message: { data: { parts: [{ type: 'text', text: 'cwd' }] } } } as AgentRuntimeUserInput)
  await vi.waitFor(() =>
    expect(
      events.flatMap((event) =>
        event.type === 'chunk' && event.chunk.type === 'text-delta' ? [event.chunk.delta] : []
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
  await service.primeConnection('session')
  expect(connections).toHaveLength(2)
}

it('rechecks the directory if it changes while reconciliation is awaiting', async () => {
  setup('acp')
  expect(await service.primeConnection('session')).toBe(true)
  const entered = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  release = gate.resolve
  const current = connections[0].reconcile.bind(connections[0])
  vi.spyOn(connections[0], 'reconcile').mockImplementationOnce(async (input) => {
    entered.resolve()
    await gate.promise
    return current(input)
  })
  const primed = service.primeConnection('session')
  await entered.promise
  agentSessionService.setWorkspace('session', { type: 'user', workspaceId: 'B' })
  gate.resolve()
  expect(await primed).toBe(true)
  await assertFirstInputUsesB('acp')
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
  expect(await service.primeConnection('session')).toBe(true)
  agentSessionService.setWorkspace('session', { type: 'user', workspaceId: 'B' })
  expect(await service.primeConnection('session')).toBe(true)
  await assertFirstInputUsesB(protocol)
})

it.each(['acp', 'codex'] as const)(
  'discards an in-flight %s connection to A after switching to B',
  async (protocol) => {
    setup(protocol, true)
    const primed = service.primeConnection('session')
    await vi.waitFor(() => expect(connections).toHaveLength(1))
    agentSessionService.setWorkspace('session', { type: 'user', workspaceId: 'B' })
    release!()
    expect(await primed).toBe(true)
    await assertFirstInputUsesB(protocol)
  }
)
