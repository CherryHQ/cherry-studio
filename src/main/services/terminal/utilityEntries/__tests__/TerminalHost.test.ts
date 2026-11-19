import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  terminalConversationId,
  terminalGeneration,
  terminalOperationId,
  terminalResourceId,
  type TerminalCommand,
  type TerminalContext,
  type TerminalLaunch,
  type TerminalMutation,
  type TerminalResourceState
} from '../../contracts'
import { TerminalCapture } from '../../TerminalCapture'
import { TerminalHost } from '../TerminalHost'

const context: TerminalContext = { contextId: 'runtime', bindingId: 'connection', revision: 0 }
const root = process.cwd()
const launch = (script: string): Extract<TerminalLaunch, { kind: 'pipe' }> => ({
  kind: 'pipe',
  shell: 'bash',
  file: '/bin/bash',
  args: ['--noprofile', '--norc', '-c', script],
  cwd: root,
  env: { PATH: '/usr/bin:/bin' },
  stdin: ''
})
const logger = { debug() {}, info() {}, warn() {}, error() {} }

function createHost(outputDelayMs = 0) {
  const host = new TerminalHost(
    {
      host: {
        conversationId: terminalConversationId.parse(randomUUID()),
        generation: terminalGeneration.parse(randomUUID())
      },
      helperFile: path.join(root, 'resources/binaries', `${process.platform}-${process.arch}`, 'terminal-scope'),
      ghosttyDirectory: path.join(root, 'resources/terminal/ghostty')
    },
    logger
  )
  let sequence = 0
  const mutation = (command: TerminalCommand): TerminalMutation => {
    sequence++
    return {
      host: host.init.host,
      admissionRevision: 0,
      operation: { id: terminalOperationId.parse(`${host.init.host.generation}:${sequence}`), sequence },
      command
    }
  }
  const run = (command: TerminalCommand) => host.mutate(mutation(command))
  const states = new Map<string, TerminalResourceState>()
  const controller = new AbortController()
  const observing = host.observe(host.init.host, {
    signal: controller.signal,
    input: (async function* () {})(),
    logger,
    write: async (frame) => {
      if (frame.metadata.kind === 'output' && outputDelayMs)
        await new Promise((resolve) => setTimeout(resolve, outputDelayMs))
      if (frame.metadata.kind === 'state' && frame.payload) {
        const state = JSON.parse(Buffer.from(frame.payload).toString()) as TerminalResourceState
        states.set(state.id, state)
      }
    }
  })
  const dispose = async () => {
    await host.seal(host.init.host, 1)
    controller.abort()
    await observing
  }
  return { host, mutation, run, states, dispose }
}

describe('TerminalCapture', () => {
  it('reports exact byte gaps and retains a bounded suffix', () => {
    const capture = new TerminalCapture(5)
    capture.append(Buffer.from('abc'))
    capture.append(Buffer.from('defg'))
    const read = capture.read(0, 3)
    expect(read).toEqual({ start: 2, next: 5, end: 7, truncated: true, data: Uint8Array.from(Buffer.from('cde')) })
    expect(Buffer.from(capture.read(5, 8).data).toString()).toBe('fg')
    expect(() => capture.read(8, 1)).toThrow('cursor')
  })
})

describe.skipIf(process.platform === 'win32')('TerminalHost real executions', () => {
  beforeAll(() => execFileSync('node', ['native/terminal-scope/build.cjs'], { cwd: root }))

  it('answers a burst of terminal queries without closing the PTY', async () => {
    const item = createHost()
    const id = terminalResourceId.parse(randomUUID())
    try {
      await item.run({ kind: 'bind', context })
      await item.run({
        kind: 'start',
        id,
        context,
        retention: { kind: 'session' },
        launch: {
          kind: 'pty',
          shell: 'bash',
          file: '/bin/bash',
          args: [
            '--noprofile',
            '--norc',
            '-c',
            "stty raw -echo; printf '\\033[6n%.0s' {1..50}; IFS= read -r -n 300 reply; [[ ${#reply} == 300 ]] && printf REPLIES_RECEIVED"
          ],
          cwd: root,
          env: { PATH: '/usr/bin:/bin' },
          cols: 80,
          rows: 24
        }
      })
      await expect
        .poll(() => Buffer.from(item.host.read(item.host.init.host, id, 0, 4096).data).toString())
        .toContain('REPLIES_RECEIVED')
      await expect.poll(() => item.states.get(id)?.cleanup).toBe('confirmed')
      expect(item.states.get(id)?.process).toMatchObject({ kind: 'exited', exitCode: 0 })
    } finally {
      await item.dispose()
    }
  })

  it('deduplicates a lost acknowledgement and rejects changed payload under the same identity', async () => {
    const item = createHost()
    try {
      await item.run({ kind: 'bind', context })
      const id = terminalResourceId.parse(randomUUID())
      const request = item.mutation({
        kind: 'start',
        id,
        context,
        retention: { kind: 'turn', turnId: 'turn' },
        launch: launch('printf ONCE; exit 23')
      })
      const [first, retry] = await Promise.all([item.host.mutate(request), item.host.mutate(request)])
      expect(retry).toEqual(first)
      expect(
        await item.host.mutate({
          ...request,
          command: {
            ...request.command,
            kind: 'start',
            id,
            context,
            retention: { kind: 'session' },
            launch: launch('printf TWICE')
          }
        })
      ).toEqual({ kind: 'rejected', reason: 'identity_conflict' })
      await expect.poll(() => item.states.get(id)?.cleanup).toBe('confirmed')
      expect(item.states.get(id)?.process).toEqual({ kind: 'exited', exitCode: 23, signal: null })
      expect(Buffer.from(item.host.read(item.host.init.host, id, 0, 1024).data).toString()).toBe('ONCE')
      expect(item.host.release(item.host.init.host, id)).toBe(true)
      for (let n = 0; n < 1024; n++) await item.run({ kind: 'bind', context })
      expect(await item.host.mutate(request)).toEqual({ kind: 'rejected', reason: 'outcome_unknown' })
    } finally {
      await item.dispose()
    }
  })

  it('commits background retention before a captured Agent Stop and preserves the deadline', async () => {
    const item = createHost()
    try {
      await item.run({ kind: 'bind', context })
      const id = terminalResourceId.parse(randomUUID())
      await item.run({
        kind: 'start',
        id,
        context,
        retention: { kind: 'turn', turnId: 'turn' },
        launch: { ...launch('sleep 60'), deadlineAt: Date.now() + 500 }
      })
      const promoted = await item.run({ kind: 'promote', id, context, cancelRevision: 0 })
      expect(promoted.kind === 'resource' && promoted.resource.retention).toEqual({ kind: 'session' })
      expect(
        await item.run({
          kind: 'stop',
          id,
          actor: { kind: 'agent', context },
          cancelRevision: 0,
          controlRevision: 0,
          reason: 'agent_stop'
        })
      ).toEqual({ kind: 'rejected', reason: 'stale_control' })
      await expect.poll(() => item.states.get(id)?.cleanup).toBe('confirmed')
      expect(item.states.get(id)?.stopReason).toBe('deadline')
      expect(item.states.get(id)?.process).toEqual({ kind: 'exited', exitCode: null, signal: 15 })
    } finally {
      await item.dispose()
    }
  })

  it('preserves user-owned PTY input across runtime release and rejects stale Agent input', async () => {
    const item = createHost()
    try {
      await item.run({ kind: 'bind', context })
      const id = terminalResourceId.parse(randomUUID())
      await item.run({
        kind: 'start',
        id,
        context,
        retention: { kind: 'session' },
        launch: {
          kind: 'pty',
          shell: 'bash',
          file: '/bin/bash',
          args: ['--noprofile', '--norc', '-i'],
          cwd: root,
          env: { PATH: '/usr/bin:/bin', PS1: '' },
          cols: 80,
          rows: 24
        }
      })
      await item.run({ kind: 'control', id, actor: { kind: 'user' }, controlRevision: 0, target: { kind: 'user' } })
      await item.run({ kind: 'release-context', context, nextRevision: 1 })
      expect(
        await item.run({ kind: 'input', id, actor: { kind: 'agent', context }, controlRevision: 0, data: 'exit\n' })
      ).toEqual({ kind: 'rejected', reason: 'stale_control' })
      await item.run({
        kind: 'input',
        id,
        actor: { kind: 'user' },
        controlRevision: 1,
        data: 'printf "USER_%s\\n" "ALIVE"\n'
      })
      await expect
        .poll(() => Buffer.from(item.host.read(item.host.init.host, id, 0, 1024).data).toString())
        .toContain('USER_ALIVE')
      expect(item.states.get(id)?.control).toEqual({ kind: 'user' })
    } finally {
      await item.dispose()
    }
  })

  it('distinguishes explicit background task Stop from stopping the Agent turn', async () => {
    const item = createHost()
    try {
      await item.run({ kind: 'bind', context })
      const id = terminalResourceId.parse(randomUUID())
      await item.run({ kind: 'start', id, context, retention: { kind: 'session' }, launch: launch('sleep 60') })
      expect(
        await item.run({
          kind: 'stop',
          id,
          actor: { kind: 'agent', context },
          cancelRevision: 0,
          controlRevision: 0,
          reason: 'agent_stop'
        })
      ).toEqual({ kind: 'rejected', reason: 'stale_control' })
      const receipt = await item.run({
        kind: 'stop',
        id,
        actor: { kind: 'agent', context },
        cancelRevision: 0,
        controlRevision: 0,
        reason: 'task_stop'
      })
      expect(receipt.kind === 'resource' && receipt.resource.cleanup).toBe('confirmed')
      expect(receipt.kind === 'resource' && receipt.resource.process).toEqual({
        kind: 'exited',
        exitCode: null,
        signal: 15
      })
    } finally {
      await item.dispose()
    }
  })

  it('seals pending and future admissions without launching another resource', async () => {
    const item = createHost()
    await item.run({ kind: 'bind', context })
    await item.host.seal(item.host.init.host, 1)
    expect(
      await item.run({
        kind: 'start',
        id: terminalResourceId.parse(randomUUID()),
        context,
        retention: { kind: 'session' },
        launch: launch('printf SHOULD_NOT_RUN')
      })
    ).toEqual({ kind: 'rejected', reason: 'closing' })
    expect(item.states.size).toBe(0)
    await item.dispose()
  })

  it('records an expired pre-launch deadline without fabricating a process exit', async () => {
    const item = createHost()
    try {
      await item.run({ kind: 'bind', context })
      const id = terminalResourceId.parse(randomUUID())
      const receipt = await item.run({
        kind: 'start',
        id,
        context,
        retention: { kind: 'turn', turnId: 'turn' },
        launch: { ...launch('printf MUST_NOT_RUN'), deadlineAt: Date.now() - 1 }
      })
      expect(receipt.kind === 'resource' && receipt.resource.process).toEqual({ kind: 'not_started' })
      expect(receipt.kind === 'resource' && receipt.resource.cleanup).toBe('confirmed')
      expect(item.host.read(item.host.init.host, id, 0, 1024).end).toBe(0)
    } finally {
      await item.dispose()
    }
  })

  it('delivers sibling completion while a noisy resource outruns a slow observer', async () => {
    const item = createHost(5)
    try {
      await item.run({ kind: 'bind', context })
      const noisy = terminalResourceId.parse(randomUUID())
      const sibling = terminalResourceId.parse(randomUUID())
      await item.run({ kind: 'start', id: noisy, context, retention: { kind: 'session' }, launch: launch('yes flood') })
      await item.run({
        kind: 'start',
        id: sibling,
        context,
        retention: { kind: 'turn', turnId: 'turn' },
        launch: launch('printf SIBLING_DONE; exit 12')
      })
      await expect.poll(() => item.states.get(sibling)?.cleanup, { timeout: 3000 }).toBe('confirmed')
      expect(item.states.get(sibling)?.process).toEqual({ kind: 'exited', exitCode: 12, signal: null })
    } finally {
      await item.dispose()
    }
  })

  it('retains an unconfirmed job-control scope and releases it only after all jobs exit', async () => {
    const item = createHost()
    try {
      await item.run({ kind: 'bind', context })
      const id = terminalResourceId.parse(randomUUID())
      await item.run({
        kind: 'start',
        id,
        context,
        retention: { kind: 'turn', turnId: 'turn' },
        launch: launch('set -m; sleep 7 & printf READY; wait')
      })
      await expect
        .poll(() => Buffer.from(item.host.read(item.host.init.host, id, 0, 1024).data).toString())
        .toContain('READY')
      const stopped = await item.run({
        kind: 'stop',
        id,
        actor: { kind: 'user' },
        cancelRevision: 0,
        controlRevision: 0,
        reason: 'user'
      })
      expect(stopped.kind === 'resource' && stopped.resource.cleanup).toBe('unconfirmed')
      expect(item.host.release(item.host.init.host, id)).toBe(false)
      await expect.poll(() => item.states.get(id)?.cleanup, { timeout: 4000 }).toBe('confirmed')
      expect(item.host.release(item.host.init.host, id)).toBe(true)
    } finally {
      await item.dispose()
    }
  })

  it('preserves a user-owned pipe when its old runtime is released', async () => {
    const item = createHost()
    try {
      await item.run({ kind: 'bind', context })
      const id = terminalResourceId.parse(randomUUID())
      await item.run({
        kind: 'start',
        id,
        context,
        retention: { kind: 'turn', turnId: 'turn' },
        launch: launch('sleep 60')
      })
      await item.run({ kind: 'control', id, actor: { kind: 'user' }, controlRevision: 0, target: { kind: 'user' } })
      await item.run({ kind: 'release-context', context, nextRevision: 1 })
      await expect.poll(() => item.states.get(id)?.control.kind).toBe('user')
      expect(item.states.get(id)?.process.kind).toBe('running')
      expect(item.states.get(id)?.cleanup).toBe('none')
    } finally {
      await item.dispose()
    }
  })
})
