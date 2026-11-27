import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { methods, ndJsonStream, type InitializeRequest, type SessionUpdate } from '@agentclientprotocol/sdk'
import { afterEach, expect, it, vi } from 'vitest'

import { runtimeId, type ObservationPayload } from '@cherrystudio/agent-runtime'

import { createAcpRuntime, type AcpTransportLease } from '../src/v1'
import { configuration, confirmed, deferred, fixture, input } from './fixture'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

it('joins the owned process, retries a failed join, drains published callbacks and keeps native history', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'acp-lifecycle-'))
  const archive = path.join(directory, 'archive.txt')
  const child = spawn(process.execPath, [fileURLToPath(new URL('./processFixture.mjs', import.meta.url)), archive], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.resume()
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve())
    child.once('error', reject)
  })
  let joinAttempts = 0
  const runtime = createAcpRuntime({
    backendId: runtimeId<'backend'>('child'),
    report: () => {},
    connect: async () => ({
      stream: ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
      closeAndJoin: async () => {
        if (++joinAttempts === 1) throw new Error('Join unavailable')
        child.kill('SIGTERM')
        await exited
      }
    })
  })
  cleanups.push(async () => {
    child.kill('SIGKILL')
    await exited
    await runtime.shutdown()
    await rm(directory, { recursive: true, force: true })
  })
  const handle = confirmed(await runtime.create(configuration))
  const second = confirmed(await runtime.open(handle.thread))
  await handle.release()
  expect(child.exitCode).toBeNull()
  const events: ObservationPayload[] = []
  const delivery = deferred<void>()
  const observer = confirmed(
    await second.observe(async (event) => {
      events.push(event)
      if (event.type === 'closed') await delivery.promise
    })
  )
  expect(await runtime.shutdown()).toMatchObject({ status: 'unknown', error: { message: 'Join unavailable' } })
  expect(child.exitCode).toBeNull()
  let drained = false
  const joined = runtime.shutdown().then((result) => {
    drained = true
    return result
  })
  await expect.poll(() => events.some((event) => event.type === 'closed')).toBe(true)
  expect(drained).toBe(false)
  delivery.resolve()
  expect(await joined).toMatchObject({ status: 'confirmed' })
  await observer.drain()
  expect(child.exitCode).toBe(0)
  expect(await readFile(archive, 'utf8')).toBe('native-history')
})

it('advertises only host callbacks and rejects callbacks for another session', async () => {
  let init: InitializeRequest | undefined
  const paths: string[] = []
  const f = fixture(
    {
      initialize: ({ params }) => {
        init = params
        return { protocolVersion: 1, agentCapabilities: {}, authMethods: [] }
      }
    },
    {
      callbacks: {
        readTextFile: async (params, context) => {
          expect(context.thread.id).toBe('session-1')
          paths.push(params.path)
          return { content: 'host file' }
        }
      }
    }
  )
  cleanups.push(f.cleanup)
  const handle = confirmed(await f.runtime.create(configuration))
  expect(init?.clientCapabilities).toMatchObject({ fs: { readTextFile: true, writeTextFile: false }, terminal: false })
  expect(init?.clientCapabilities).not.toHaveProperty('elicitation')
  expect(
    await f.peer.client.request(methods.client.fs.readTextFile, { sessionId: handle.thread.id, path: '/allowed' })
  ).toEqual({ content: 'host file' })
  await expect(
    f.peer.client.request(methods.client.fs.readTextFile, { sessionId: 'foreign', path: '/denied' })
  ).rejects.toMatchObject({ code: -32002, data: { sessionId: 'foreign' } })
  expect(paths).toEqual(['/allowed'])
  expect(
    await handle.acp.submit({
      inputId: runtimeId<'input'>('image'),
      content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
      whenBusy: 'reject'
    })
  ).toMatchObject({ status: 'unsupported' })
  expect(
    await f.runtime.create({
      ...configuration,
      mcpServers: [{ type: 'http', name: 'unsupported', url: 'https://example.invalid/mcp', headers: [] }]
    })
  ).toMatchObject({ status: 'rejected' })
})

it('keeps the prompt busy after a cancellation deadline until its native response arrives', async () => {
  const end = deferred<void>()
  const f = fixture({
    'session/prompt': async () => {
      await end.promise
      return { stopReason: 'end_turn' }
    }
  })
  cleanups.push(f.cleanup)
  const handle = confirmed(await f.runtime.create(configuration))
  await handle.input!.submit(input())
  vi.useFakeTimers()
  const result = handle.interrupt!()
  await vi.advanceTimersByTimeAsync(10_001)
  expect(await result).toMatchObject({ status: 'unknown' })
  expect(await handle.input!.submit(input('next'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
  vi.useRealTimers()
  end.resolve()
  expect(await handle.interrupt!()).toMatchObject({ status: 'confirmed' })
})

it('fails cold replay on bounded setup overflow', async () => {
  const f = fixture({
    'session/load': async ({ client, params }) => {
      for (let i = 0; i < 257; i++)
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '.' } }
        })
      return {}
    }
  })
  cleanups.push(f.cleanup)
  expect(
    await f.runtime.open({ backendId: runtimeId<'backend'>('fixture'), id: runtimeId<'thread'>('large') })
  ).toMatchObject({ status: 'rejected', error: { message: 'ACP setup update buffer overflow' } })
})

it('preserves native-only updates through observer recovery without repeating their revisions', async () => {
  const f = fixture()
  cleanups.push(f.cleanup)
  const handle = confirmed(await f.runtime.create(configuration))
  const release = deferred<void>()
  const updates: { revision: number; update: SessionUpdate }[] = []
  const observer = confirmed(
    await handle.acp.observe(async (frame) => {
      if (frame.event.type === 'snapshot' && updates.length === 0 && !frame.update) await release.promise
      if (frame.update) updates.push({ revision: frame.revision, update: frame.update })
    })
  )
  for (let i = 0; i < 120; i++)
    await f.peer.client.notify(methods.client.session.update, {
      sessionId: handle.thread.id,
      update: { sessionUpdate: 'available_commands_update', availableCommands: [], _meta: { index: i } }
    })
  await expect.poll(() => handle.acp.state().metadata[0]?._meta?.index).toBe(119)
  release.resolve()
  await observer.drain()
  expect(updates.map((item) => item.update._meta?.index)).toEqual(Array.from({ length: 120 }, (_, index) => index))
  expect(new Set(updates.map((item) => item.revision)).size).toBe(120)
})

it('does not confirm shutdown while a transport acquisition is still pending', async () => {
  const acquisition = deferred<AcpTransportLease>()
  let joined = false
  const runtime = createAcpRuntime({
    backendId: runtimeId<'backend'>('late'),
    connect: () => acquisition.promise,
    report: () => {}
  })
  cleanups.push(async () => {
    await runtime.shutdown()
  })
  const initialization = runtime.initialize()
  vi.useFakeTimers()
  const closing = runtime.shutdown()
  await vi.advanceTimersByTimeAsync(10_001)
  expect(await closing).toMatchObject({ status: 'unknown' })
  expect(joined).toBe(false)
  vi.useRealTimers()
  acquisition.resolve({
    stream: { readable: new ReadableStream(), writable: new WritableStream() },
    closeAndJoin: async () => {
      joined = true
    }
  })
  expect(await initialization).toMatchObject({ status: 'rejected' })
  expect(await runtime.shutdown()).toMatchObject({ status: 'confirmed' })
  expect(joined).toBe(true)
})

it('delegates the complete terminal lifecycle and session-scoped form elicitation', async () => {
  let terminal: 'absent' | 'running' | 'exited' | 'released' = 'absent'
  const f = fixture(
    {},
    {
      callbacks: {
        terminal: {
          create: async (params) => {
            expect(params.command).toBe('fixture')
            terminal = 'running'
            return { terminalId: 'terminal' }
          },
          output: async () => ({ output: terminal, truncated: false }),
          kill: async () => {
            terminal = 'exited'
            return {}
          },
          waitForExit: async () => ({ exitCode: terminal === 'exited' ? 0 : 1 }),
          release: async () => {
            terminal = 'released'
            return {}
          }
        },
        elicitation: async (params, context) => {
          expect(context.thread.id).toBe('session-1')
          expect(params.mode).toBe('form')
          return { action: 'accept', content: { choice: 'host choice' } }
        }
      }
    }
  )
  cleanups.push(f.cleanup)
  const handle = confirmed(await f.runtime.create(configuration))
  const scope = { sessionId: handle.thread.id, terminalId: 'terminal' }
  expect(
    await f.peer.client.request(methods.client.terminal.create, { sessionId: handle.thread.id, command: 'fixture' })
  ).toEqual({ terminalId: 'terminal' })
  expect(await f.peer.client.request(methods.client.terminal.output, scope)).toMatchObject({ output: 'running' })
  await f.peer.client.request(methods.client.terminal.kill, scope)
  expect(await f.peer.client.request(methods.client.terminal.waitForExit, scope)).toMatchObject({ exitCode: 0 })
  await f.peer.client.request(methods.client.terminal.release, scope)
  expect(terminal).toBe('released')
  expect(
    await f.peer.client.request(methods.client.elicitation.create, {
      mode: 'form',
      sessionId: handle.thread.id,
      message: 'Choose',
      requestedSchema: { type: 'object', properties: { choice: { type: 'string' } } }
    })
  ).toMatchObject({ action: 'accept', content: { choice: 'host choice' } })
})

it('validates advertised configuration choices and retains confirmed mode changes without a notification', async () => {
  const configOptions = [{ id: 'enabled', name: 'Enabled', type: 'boolean' as const, currentValue: false }]
  const f = fixture({
    'session/new': () => ({
      sessionId: 'config',
      modes: {
        currentModeId: 'normal',
        availableModes: [
          { id: 'normal', name: 'Normal' },
          { id: 'plan', name: 'Plan' }
        ]
      },
      configOptions
    }),
    'session/set_mode': () => ({}),
    'session/set_config_option': ({ params }) => {
      expect(params).toMatchObject({ type: 'boolean', value: true })
      return { configOptions: [{ ...configOptions[0], currentValue: true }] }
    }
  })
  cleanups.push(f.cleanup)
  const handle = confirmed(await f.runtime.create(configuration))
  expect(await handle.acp.setConfigOption('enabled', 'true')).toMatchObject({ status: 'rejected' })
  confirmed(await handle.acp.setConfigOption('enabled', true))
  confirmed(await handle.acp.setMode('plan'))
  expect(handle.acp.state().configuration).toMatchObject({
    modes: { currentModeId: 'plan' },
    configOptions: [{ currentValue: true }]
  })
  expect(await f.runtime.authenticate('invented')).toMatchObject({ status: 'unsupported' })
})

it('ends only the observer that exceeds the native backlog limit', async () => {
  const f = fixture()
  cleanups.push(f.cleanup)
  const handle = confirmed(await f.runtime.create(configuration))
  const release = deferred<void>()
  const slow: ObservationPayload[] = []
  let fastIndex: unknown
  const slowObserver = confirmed(
    await handle.acp.observe(async (frame) => {
      slow.push(frame.event)
      if (slow.length === 1) await release.promise
    })
  )
  const fastObserver = confirmed(
    await handle.acp.observe((frame) => {
      if (frame.update) fastIndex = frame.update._meta?.index
    })
  )
  for (let index = 0; index < 1005; index++)
    await f.peer.client.notify(methods.client.session.update, {
      sessionId: handle.thread.id,
      update: { sessionUpdate: 'available_commands_update', availableCommands: [], _meta: { index } }
    })
  await expect.poll(() => fastIndex).toBe(1004)
  release.resolve()
  await slowObserver.drain()
  await fastObserver.drain()
  expect(slow.at(-1)).toEqual({ type: 'closed', reason: 'source-lost' })
  expect(await handle.input!.submit(input('still-live'))).toMatchObject({ status: 'acknowledged' })
})
