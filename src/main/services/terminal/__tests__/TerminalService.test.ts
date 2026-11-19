import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LifecycleModule from '@main/core/lifecycle'

import type {
  UtilityProcessDefinition,
  UtilityProcessInstanceOptions,
  UtilityProcessStreamFrame,
  UtilityProcessStreamOptions
} from '../../../core/utilityProcess/types'
import {
  terminalConversationId,
  type TerminalHostContract,
  type TerminalHostInit,
  type TerminalLaunch
} from '../contracts'
import { TerminalHost } from '../utilityEntries/TerminalHost'

const { get, getPath } = vi.hoisted(() => ({ get: vi.fn(), getPath: vi.fn() }))
vi.mock('@application', () => ({ application: { get, getPath } }))
vi.mock('@main/core/lifecycle', async (original) => {
  const actual = await original<typeof LifecycleModule>()
  class MockBaseService {
    protected onInit?(): void | Promise<void>
    protected onStop?(): void | Promise<void>
    async _doInit() {
      await this.onInit?.()
    }
    async _doStop() {
      await this.onStop?.()
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

const { TerminalService } = await import('../TerminalService')
const root = process.cwd()
const logger = { debug() {}, info() {}, warn() {}, error() {} }
const launch = (script: string): TerminalLaunch => ({
  kind: 'pipe',
  shell: 'bash',
  file: '/bin/bash',
  args: ['--noprofile', '--norc', '-c', script],
  cwd: root,
  env: { PATH: '/usr/bin:/bin' },
  stdin: ''
})
let service: InstanceType<typeof TerminalService>
let created: TerminalHost[]
let starting: Promise<void> | undefined
let stopping: Promise<void> | undefined
let stopRequests: number
let faults: Map<string, () => void>

beforeAll(() => {
  if (process.platform !== 'win32') execFileSync('node', ['native/terminal-scope/build.cjs'], { cwd: root })
})
beforeEach(async () => {
  created = []
  starting = undefined
  stopping = undefined
  stopRequests = 0
  faults = new Map()
  getPath.mockImplementation((key: string) =>
    key.endsWith('ghostty')
      ? path.join(root, 'resources/terminal/ghostty')
      : path.join(root, 'resources/binaries', `${process.platform}-${process.arch}`, 'terminal-scope')
  )
  get.mockImplementation((name: string) => {
    if (name !== 'UtilityProcessManager') throw new Error(`Unexpected service ${name}`)
    return {
      register() {},
      createInstance(
        _definition: UtilityProcessDefinition<TerminalHostContract, TerminalHostInit>,
        options: UtilityProcessInstanceOptions<TerminalHostInit>
      ) {
        const initialized = Promise.resolve(options.createInitData!()).then((init) => {
          const host = new TerminalHost(init, logger)
          created.push(host)
          return host
        })
        return {
          async request(method: string, input: never) {
            const host = await initialized
            switch (method) {
              case 'identity':
                await starting
                return host.init.host
              case 'mutate':
                return host.mutate(input)
              case 'operation': {
                const value = input as TerminalHostContract['methods']['operation']['input']
                return host.operation(value.host, value.id)
              }
              case 'release': {
                const value = input as TerminalHostContract['methods']['release']['input']
                return host.release(value.host, value.id)
              }
              case 'seal': {
                const value = input as TerminalHostContract['methods']['seal']['input']
                return host.seal(value.host, value.admissionRevision)
              }
              default:
                throw new Error(`Unexpected method ${method}`)
            }
          },
          async openStream(_method: string, _input: unknown, options: UtilityProcessStreamOptions) {
            const host = await initialized
            const fault = Promise.withResolvers<never>()
            void fault.promise.catch(() => {})
            faults.set(host.init.host.conversationId, () => fault.reject(new Error('Injected Host disconnect')))
            const queue: UtilityProcessStreamFrame[] = []
            let changed = Promise.withResolvers<void>()
            let ended = false
            const completed = host
              .observe(host.init.host, {
                signal: options.signal!,
                logger,
                input: (async function* () {})(),
                write: async (frame) => {
                  queue.push(frame)
                  changed.resolve()
                }
              })
              .finally(() => {
                ended = true
                changed.resolve()
              })
            const output = (async function* () {
              while (!ended || queue.length) {
                const frame = queue.shift()
                if (frame) yield frame
                else {
                  changed = Promise.withResolvers<void>()
                  await Promise.race([changed.promise, fault.promise])
                }
              }
            })()
            return {
              output,
              completed,
              closed: completed,
              finishInput: async () => {},
              cancel: async () => {},
              write: async () => {}
            }
          },
          async stop() {
            stopRequests++
            await stopping
            const host = await initialized
            await host.seal(host.init.host, 1)
          },
          async dispose() {}
        }
      }
    }
  })
  service = new TerminalService()
  await service._doInit()
})
afterEach(async () => {
  await service._doStop()
})

describe.skipIf(process.platform === 'win32')('TerminalService with real Host kernels', () => {
  it('coalesces concurrent first launches and retains replay receipts after Host retirement', async () => {
    const lease = await service.attachRuntime({
      conversationId: 'conversation',
      contextId: 'runtime',
      bindingId: 'connection'
    })
    const first = { lease, replayKey: 'one', turnId: 'turn', launch: launch('printf FIRST; sleep 60') }
    const [a, b] = await Promise.all([
      service.start(first),
      service.start({ ...first, replayKey: 'two', launch: launch('printf SECOND; sleep 60') })
    ])
    expect(a.kind).toBe('resource')
    expect(b.kind).toBe('resource')
    if (a.kind !== 'resource' || b.kind !== 'resource') throw new Error('Launch rejected')
    expect(a.resource.host).toEqual(b.resource.host)
    await expect
      .poll(() => Buffer.from(service.read({ host: a.resource.host, id: a.resource.id }).data).toString())
      .toBe('FIRST')
    await expect
      .poll(() => Buffer.from(service.read({ host: b.resource.host, id: b.resource.id }).data).toString())
      .toBe('SECOND')
    await service.stopTurn(lease, 'turn')
    await expect.poll(() => stopRequests).toBe(1)
    expect(await service.start(first)).toEqual(a)
    expect(created.length).toBe(1)
  })

  it('waits for confirmed old Host exit before admitting its replacement', async () => {
    const lease = await service.attachRuntime({
      conversationId: 'conversation',
      contextId: 'runtime',
      bindingId: 'connection'
    })
    const gate = Promise.withResolvers<void>()
    stopping = gate.promise
    const first = await service.start({ lease, replayKey: 'one', turnId: 'turn', launch: launch('exit 0') })
    await expect.poll(() => stopRequests).toBe(1)
    const replacement = service.start({ lease, replayKey: 'two', turnId: 'turn', launch: launch('sleep 60') })
    const concurrent = service.start({ lease, replayKey: 'three', turnId: 'turn', launch: launch('sleep 60') })
    await new Promise((resolve) => setImmediate(resolve))
    expect(created.length).toBe(1)
    gate.resolve()
    const next = await replacement
    const sibling = await concurrent
    expect(next.kind).toBe('resource')
    if (first.kind !== 'resource' || next.kind !== 'resource') throw new Error('Launch rejected')
    expect(next.resource.host.generation).not.toBe(first.resource.host.generation)
    expect(sibling.kind === 'resource' && sibling.resource.host).toEqual(next.resource.host)
    expect(created.length).toBe(2)
  })

  it('seals startup admission before waiting for the Host handshake', async () => {
    const lease = await service.attachRuntime({
      conversationId: 'conversation',
      contextId: 'runtime',
      bindingId: 'connection'
    })
    const gate = Promise.withResolvers<void>()
    starting = gate.promise
    const execution = service.start({
      lease,
      replayKey: 'one',
      turnId: 'turn',
      launch: launch('printf MUST_NOT_START')
    })
    const closing = service.closeConversation(lease.conversationId)
    gate.resolve()
    expect((await execution).kind).toBe('rejected')
    expect(await closing).toEqual([])
    expect(await service.start({ lease, replayKey: 'two', turnId: 'turn', launch: launch('exit 0') })).toEqual({
      kind: 'rejected',
      reason: 'closing'
    })
  })

  it('keeps promoted work across Agent Stop and runtime release', async () => {
    const lease = await service.attachRuntime({
      conversationId: 'conversation',
      contextId: 'runtime',
      bindingId: 'connection'
    })
    const receipt = await service.start({
      lease,
      replayKey: 'server',
      turnId: 'turn',
      launch: launch('printf SERVER; sleep 60')
    })
    if (receipt.kind !== 'resource') throw new Error('Launch rejected')
    const ref = { host: receipt.resource.host, id: receipt.resource.id }
    await service.mutate(ref, { kind: 'promote', id: ref.id, context: lease.context, cancelRevision: 0 })
    await service.stopTurn(lease, 'turn')
    await service.releaseRuntime(lease)
    const state = service.list(lease.conversationId)[0]
    expect(state.retention).toEqual({ kind: 'session' })
    expect(state.process.kind).toBe('running')
    expect(state.control).toEqual({ kind: 'unassigned' })
    expect((await service.closeConversation(lease.conversationId))[0].cleanup).toBe('confirmed')
    expect(service.list(terminalConversationId.parse('missing'))).toEqual([])
  })

  it('retains lost-generation cleanup while a sibling conversation and replacement keep running', async () => {
    const a = await service.attachRuntime({ conversationId: 'a', contextId: 'runtime', bindingId: 'connection' })
    const b = await service.attachRuntime({ conversationId: 'b', contextId: 'runtime', bindingId: 'connection' })
    const first = await service.start({ lease: a, replayKey: 'old', turnId: 'turn', launch: launch('sleep 60') })
    const sibling = await service.start({
      lease: b,
      replayKey: 'sibling',
      turnId: 'turn',
      launch: launch('sleep 0.2; printf SURVIVED; sleep 60')
    })
    if (first.kind !== 'resource' || sibling.kind !== 'resource') throw new Error('Launch rejected')
    faults.get('a')!()
    await expect.poll(() => service.list(a.conversationId)[0]?.cleanup).toBe('unconfirmed')
    const replacement = await service.start({ lease: a, replayKey: 'new', turnId: 'turn', launch: launch('sleep 60') })
    if (replacement.kind !== 'resource') throw new Error('Replacement rejected')
    expect(replacement.resource.host.generation).not.toBe(first.resource.host.generation)
    await expect
      .poll(() => Buffer.from(service.read({ host: sibling.resource.host, id: sibling.resource.id }).data).toString())
      .toBe('SURVIVED')
    expect(service.list(a.conversationId).find((state) => state.id === first.resource.id)?.cleanup).toBe('unconfirmed')
    expect(service.list(a.conversationId).find((state) => state.id === replacement.resource.id)?.process.kind).toBe(
      'running'
    )
    expect(await service.start({ lease: a, replayKey: 'old', turnId: 'turn', launch: launch('sleep 60') })).toEqual(
      first
    )
  })
})
