import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { AgentWorkspaceStorageService } from '@main/ai/agents/AgentWorkspaceStorageService'
import { BaseService } from '@main/core/lifecycle'
import * as shellEnv from '@main/utils/shellEnv'

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
let storage: AgentWorkspaceStorageService
let storageRoot: string
let created: TerminalHost[]
let starting: Promise<void> | undefined
let stopping: Promise<void> | undefined
let rejectNextAdmissionBarrier: boolean
let stopRequests: number
let faults: Map<string, () => void>

beforeAll(() => {
  if (process.platform !== 'win32') execFileSync('node', ['native/terminal-scope/build.cjs'], { cwd: root })
})
beforeEach(async () => {
  BaseService.resetInstances()
  MockApplicationUtils.resetServices()
  storageRoot = await mkdtemp(path.join(tmpdir(), 'terminal-workspace-usage-'))
  storage = new AgentWorkspaceStorageService()
  MockApplicationUtils.setService('AgentWorkspaceStorageService', storage)
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  MockApplicationUtils.setService('WindowManager', { getWindow: () => window })
  created = []
  starting = undefined
  stopping = undefined
  rejectNextAdmissionBarrier = false
  stopRequests = 0
  faults = new Map()
  vi.mocked(application.getPath).mockImplementation((key, filename) =>
    key === 'feature.agents.data'
      ? filename
        ? path.join(storageRoot, filename)
        : storageRoot
      : key.endsWith('ghostty')
        ? path.join(root, 'resources/terminal/ghostty')
        : key.endsWith('integration')
          ? path.join(root, 'resources/terminal/shellIntegration')
          : path.join(root, 'resources/binaries', `${process.platform}-${process.arch}`, 'terminal-scope')
  )
  MockApplicationUtils.setService('UtilityProcessManager', {
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
            case 'view':
              return host.view(input)
            case 'detachView': {
              const value = input as TerminalHostContract['methods']['detachView']['input']
              return host.detachView(value.host, value.id, value.viewId)
            }
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
            case 'advanceAdmission': {
              if (rejectNextAdmissionBarrier) {
                rejectNextAdmissionBarrier = false
                throw new Error('Injected admission transport failure')
              }
              const value = input as TerminalHostContract['methods']['advanceAdmission']['input']
              return host.advanceAdmission(value.host, value.admissionRevision)
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
  })
  service = new TerminalService()
  await service._doInit()
})
afterEach(async () => {
  await service._doStop()
  await storage._doStop()
  await rm(storageRoot, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('TerminalService with real Host kernels', () => {
  it('fences an old launch after a workspace change without stopping retained work', async () => {
    const lease = await service.attachRuntime({ conversationId: 'workspace', contextId: 'agent', bindingId: 'binding' })
    const running = await service.start({
      lease,
      replayKey: 'retained',
      turnId: 'turn',
      background: true,
      launch: launch('sleep 60')
    })
    if (running.kind !== 'resource') throw new Error('No retained execution')
    const host = running.resource.host
    await service.changeWorkspace('workspace', () => 'new-workspace')
    expect(service.list(terminalConversationId.parse('workspace'))[0]).toMatchObject({
      id: running.resource.id,
      host,
      retention: { kind: 'session' },
      process: { kind: 'running' }
    })
    await expect(
      service.start({ lease, replayKey: 'stale', turnId: 'turn', launch: launch('printf STALE') })
    ).resolves.toEqual({ kind: 'rejected', reason: 'stale_context' })
    const fresh = await service.attachRuntime({
      conversationId: 'workspace',
      contextId: 'fresh',
      bindingId: 'new-binding'
    })
    const next = await service.start({
      lease: fresh,
      replayKey: 'fresh',
      turnId: 'next',
      launch: launch('printf FRESH')
    })
    if (next.kind !== 'resource') throw new Error('No new execution')
    expect(next.resource.host).toEqual(host)
    await service.wait({ host, id: next.resource.id }, {})
    expect(service.readText({ host, id: next.resource.id }).output).toBe('FRESH')
    expect(
      service.list(terminalConversationId.parse('workspace')).find((item) => item.id === running.resource.id)?.process
        .kind
    ).toBe('running')
  })

  it('keeps the original workspace admission usable after a failed binding transaction', async () => {
    const lease = await service.attachRuntime({ conversationId: 'rollback', contextId: 'agent', bindingId: 'binding' })
    const first = await service.start({ lease, replayKey: 'before', turnId: 'turn', launch: launch('printf BEFORE') })
    if (first.kind !== 'resource') throw new Error('No execution')
    await expect(
      service.changeWorkspace('rollback', () => {
        throw new Error('database rollback')
      })
    ).rejects.toThrow('database rollback')
    const next = await service.start({ lease, replayKey: 'after', turnId: 'turn', launch: launch('printf AFTER') })
    if (next.kind !== 'resource') throw new Error('Original admission was lost')
    await service.wait({ host: next.resource.host, id: next.resource.id }, {})
    expect(service.readText({ host: next.resource.host, id: next.resource.id }).output).toBe('AFTER')
  })

  it('resynchronizes admission after a workspace barrier transport failure', async () => {
    const lease = await service.attachRuntime({
      conversationId: 'barrier-failure',
      contextId: 'agent',
      bindingId: 'binding'
    })
    const retained = await service.start({
      lease,
      replayKey: 'retained',
      turnId: 'turn',
      background: true,
      launch: launch('sleep 60')
    })
    if (retained.kind !== 'resource') throw new Error('No retained execution')
    rejectNextAdmissionBarrier = true
    await expect(service.changeWorkspace('barrier-failure', () => 'B')).rejects.toThrow('transport failure')
    const next = await service.start({
      lease,
      replayKey: 'after-failure',
      turnId: 'turn',
      launch: launch('printf ORIGINAL')
    })
    if (next.kind !== 'resource') throw new Error('Original admission was not restored')
    await service.wait({ host: next.resource.host, id: next.resource.id }, {})
    expect(service.readText({ host: next.resource.host, id: next.resource.id }).output).toBe('ORIGINAL')
    expect(service.list(lease.conversationId).find((item) => item.id === retained.resource.id)?.process.kind).toBe(
      'running'
    )
  })

  it('waits for admitted filesystem preparation before confirming conversation cleanup', async () => {
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const pending = service.createUserTerminal('preparing', root, 'bash', 'preparing', 0, async () => {
      entered.resolve()
      await finish.promise
    })
    await entered.promise
    let closed = false
    const closing = service.closeConversation(terminalConversationId.parse('preparing')).then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    finish.resolve()
    await expect(pending).resolves.toEqual({ kind: 'rejected', reason: 'closing' })
    await closing
    expect(service.hasActiveResources('preparing')).toBe(false)
    expect(created).toEqual([])
  })

  it('starts the configured default shell rather than forcing Bash', async () => {
    const environment = vi.spyOn(shellEnv, 'getShellEnv').mockResolvedValue({
      PATH: '/usr/bin:/bin',
      HOME: path.join(root, '.context/terminal-test-home'),
      SHELL: '/bin/zsh'
    })
    try {
      const receipt = await service.createUserTerminal(
        'user-default',
        root,
        'default',
        'user-default-shell',
        0,
        async () => {}
      )
      if (receipt.kind !== 'resource') throw new Error('No user terminal')
      expect(receipt.resource.shell).toBe('zsh')
      const ref = { host: receipt.resource.host, id: receipt.resource.id }
      await expect.poll(() => service.list(ref.host.conversationId)[0]?.shellFacts?.kind).toBe('prompt')
      await service.mutate(ref, {
        kind: 'input',
        id: ref.id,
        actor: { kind: 'user' },
        controlRevision: receipt.resource.controlRevision,
        data: 'printf "USER_ZSH:%s\\n" "$ZSH_VERSION"\n'
      })
      await expect.poll(() => Buffer.from(service.read(ref).data).toString()).toMatch(/USER_ZSH:[0-9]+\.[0-9.]+\r\n/)
    } finally {
      environment.mockRestore()
    }
  })

  it('reconnects user input without handing an ordinary terminal to a nonexistent Agent or stealing another view', async () => {
    const receipt = await service.createUserTerminal('user-view', root, 'bash', 'user-view', 0, async () => {})
    if (receipt.kind !== 'resource') throw new Error('No user terminal')
    const ref = { host: receipt.resource.host, id: receipt.resource.id }
    const first = service.openView(ref, 'window')
    expect(await service.viewFrame(first, 'window', 0, 0, null)).toMatchObject({
      controlling: true,
      agentConnected: false
    })
    expect(
      await service.userAction(first, 'window', 'invalid-return', receipt.resource.controlRevision, {
        kind: 'return-control'
      })
    ).toEqual({ kind: 'rejected', reason: 'stale_context' })
    const observer = service.openView(ref, 'window')
    expect((await service.viewFrame(observer, 'window', 0, 0, null)).controlling).toBe(false)
    await service.closeView(first, 'window')
    expect((await service.viewFrame(observer, 'window', 0, 0, null)).controlling).toBe(true)
    await service.closeView(observer, 'window')
    const reopened = service.openView(ref, 'window')
    const frame = await service.viewFrame(reopened, 'window', 0, 0, null)
    expect(frame).toMatchObject({ controlling: true, agentConnected: false })
    expect(frame.resource.controlRevision).toBe(receipt.resource.controlRevision)
    const sent = await service.userAction(reopened, 'window', 'reopened-input', frame.resource.controlRevision, {
      kind: 'key',
      geometryEpoch: frame.geometryEpoch,
      event: {
        key: 0,
        mods: 0,
        consumedMods: 0,
        composing: false,
        unshiftedCodepoint: 0,
        text: "printf 'RECONNECTED_INPUT\\n'\r",
        repeat: false
      }
    })
    expect(sent.kind).toBe('resource')
    await expect.poll(() => service.readText(ref).output).toMatch(/\r\nRECONNECTED_INPUT\r\n/)
    await service.closeView(reopened, 'window')
  })

  it.each([false, true])('restores user input after Agent release (previous takeover: %s)', async (takeover) => {
    const lease = await service.attachRuntime({ conversationId: 'agent-view', contextId: 'native', bindingId: 'one' })
    const receipt = await service.start({
      lease,
      replayKey: 'agent-shell',
      turnId: 'turn',
      launch: {
        kind: 'pty',
        shell: 'bash',
        file: '/bin/bash',
        args: ['--noprofile', '--norc'],
        cwd: root,
        env: { PATH: '/usr/bin:/bin' },
        cols: 80,
        rows: 24
      }
    })
    if (receipt.kind !== 'resource') throw new Error('No Agent terminal')
    const ref = { host: receipt.resource.host, id: receipt.resource.id }
    const view = service.openView(ref, 'window')
    expect(await service.viewFrame(view, 'window', 0, 0, null)).toMatchObject({
      controlling: false,
      agentConnected: true
    })
    if (takeover) {
      const taken = await service.userAction(view, 'window', 'take', receipt.resource.controlRevision, {
        kind: 'take-control'
      })
      if (taken.kind !== 'resource') throw new Error('Takeover failed')
    }
    await service.releaseRuntime(lease)
    const frame = await service.viewFrame(view, 'window', 0, 0, null)
    expect(frame).toMatchObject({
      controlling: true,
      agentConnected: false,
      resource: { control: { kind: 'user' }, process: { kind: 'running' } }
    })
    expect(
      await service.userAction(view, 'window', 'late-return', frame.resource.controlRevision, {
        kind: 'return-control'
      })
    ).toEqual({ kind: 'rejected', reason: 'stale_context' })
    await service.closeView(view, 'window')
  })

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

  it('restores launch admission without reviving old work or accepting old runtime leases', async () => {
    const lease = await service.attachRuntime({ conversationId: 'restore', contextId: 'runtime', bindingId: 'old' })
    const first = await service.start({ lease, replayKey: 'old', turnId: 'turn', launch: launch('sleep 60') })
    if (first.kind !== 'resource') throw new Error('Launch rejected')
    await service.closeConversation(lease.conversationId)
    await service.reopenConversation(lease.conversationId)
    expect(await service.start({ lease, replayKey: 'stale', turnId: 'turn', launch: launch('printf WRONG') })).toEqual({
      kind: 'rejected',
      reason: 'stale_context'
    })
    const next = await service.attachRuntime({ conversationId: 'restore', contextId: 'runtime', bindingId: 'new' })
    const started = await service.start({
      lease: next,
      replayKey: 'new',
      turnId: 'turn',
      launch: launch('printf RESTORED')
    })
    if (started.kind !== 'resource') throw new Error('Launch rejected')
    await service.wait({ host: started.resource.host, id: started.resource.id }, {})
    expect(service.readText({ host: started.resource.host, id: started.resource.id }).output).toBe('RESTORED')
    expect(service.list(lease.conversationId).find((state) => state.id === first.resource.id)?.cleanup).toBe(
      'confirmed'
    )
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
