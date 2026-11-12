import { mkdtemp, rm } from 'node:fs/promises'
import type * as Os from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startup, type Options } from '@anthropic-ai/claude-agent-sdk'
import { expect, it, vi } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { createClaudeCodeRuntime } from '../src'
import { confirmed, inputId } from './nativeFixture'
import { wireProcess } from './wireFixture'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof Os>()),
  homedir: () => home.dir
}))

async function spawnEnvironment(configDir: (home: string) => string, env: Options['env'] = {}) {
  home.dir = await mkdtemp(join(tmpdir(), 'cherry-claude-home-'))
  const { process, exit } = wireProcess()
  let spawned: Options['env'] | undefined
  const runtime = createClaudeCodeRuntime({ backendId: runtimeId<'backend'>('env'), configDir: configDir(home.dir) })
  try {
    const root = confirmed(
      await runtime.create({
        cwd: home.dir,
        env,
        spawnClaudeCodeProcess: (options) => {
          spawned = options.env
          return process
        }
      })
    )
    await root.input!.submit({ inputId: inputId(), text: 'Spawn', whenBusy: 'steer' })
    await expect.poll(() => spawned).toBeDefined()
    return spawned!
  } finally {
    exit()
    await runtime.shutdown()
    await rm(home.dir, { recursive: true, force: true })
  }
}

it('leaves the CLI default config dir implicit so a macOS `claude /login` stays readable', async () => {
  const env = await spawnEnvironment((home) => join(home, '.claude'), {
    CLAUDE_CONFIG_DIR: undefined,
    PATH: '/usr/bin'
  })
  expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  expect(env.PATH).toBe('/usr/bin')
})

it('points the CLI at a non-default config dir', async () => {
  const env = await spawnEnvironment((home) => join(home, 'agents', 'claude'))
  expect(env.CLAUDE_CONFIG_DIR).toMatch(/agents[\\/]claude$/)
})

async function controlledOwner() {
  const directory = await mkdtemp(join(tmpdir(), 'cherry-claude-shutdown-'))
  const wire = wireProcess(undefined, false)
  const runtime = createClaudeCodeRuntime({ backendId: runtimeId<'backend'>('shutdown'), configDir: directory })
  const root = confirmed(await runtime.create({ cwd: directory, env: {}, spawnClaudeCodeProcess: () => wire.process }))
  await root.input!.submit({ inputId: inputId(), text: 'Start', whenBusy: 'steer' })
  await expect.poll(() => wire.inputs.length).toBe(1)
  return {
    wire,
    runtime,
    root,
    async close() {
      wire.exit(1)
      await runtime.shutdown()
      await rm(directory, { recursive: true, force: true })
    }
  }
}

it('waits through SDK escalation for an eight-second nonzero exit', async () => {
  const test = await controlledOwner()
  vi.useFakeTimers()
  try {
    let result: unknown
    const closing = test.runtime.shutdown().then((value) => {
      result = value
      return value
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(result).toBeUndefined()
    expect(test.wire.process.exitCode).toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    test.wire.exit(1)
    await vi.advanceTimersByTimeAsync(0)
    await expect(closing).resolves.toMatchObject({ status: 'confirmed' })
    expect(test.wire.process.exitCode).toBe(1)
  } finally {
    vi.useRealTimers()
    await test.close()
  }
})

it('returns unknown at ten seconds without exit evidence even after kill and source EOF', async () => {
  const test = await controlledOwner()
  vi.useFakeTimers()
  try {
    let settled = false
    const closing = test.runtime.shutdown().then((result) => {
      settled = true
      return result
    })
    test.wire.process.kill('SIGKILL')
    test.wire.process.stdout.push(null)
    await vi.advanceTimersByTimeAsync(9999)
    expect(settled).toBe(false)
    expect(test.wire.process.killed).toBe(true)
    expect(test.wire.process.exitCode).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await expect(closing).resolves.toMatchObject({
      status: 'unknown',
      error: { operation: 'shutdown', code: 'process-exit-unconfirmed' }
    })
  } finally {
    vi.useRealTimers()
    await test.close()
  }
})

it('requires source-reader drain after exit and only confirms an explicit retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cherry-claude-drain-'))
  const wire = wireProcess(undefined, false)
  let releaseDrain!: () => void
  const drain = new Promise<void>((resolve) => {
    releaseDrain = resolve
  })
  const exited = new Promise<void>((resolve) => wire.process.once('exit', () => resolve()))
  const options = { cwd: directory, env: {}, spawnClaudeCodeProcess: () => wire.process }
  const warm = await startup({ options })
  const take = warm.query.bind(warm)
  vi.spyOn(warm, 'query').mockImplementation((prompt) => {
    const native = take(prompt)
    const iterator = native[Symbol.asyncIterator]()
    vi.spyOn(native, Symbol.asyncIterator).mockImplementation(async function* () {
      try {
        for await (const message of { [Symbol.asyncIterator]: () => iterator }) yield message
      } finally {
        await drain
      }
    })
    return native
  })
  const runtime = createClaudeCodeRuntime({ backendId: runtimeId<'backend'>('drain'), configDir: directory })
  const root = confirmed(await runtime.create(options))
  confirmed(root.claude.start({ query: warm, exited }))
  await root.input!.submit({ inputId: inputId(), text: 'Drain source', whenBusy: 'steer' })
  await expect.poll(() => wire.inputs.length).toBe(1)
  vi.useFakeTimers()
  try {
    let settled = false
    const closing = runtime.shutdown().then((result) => {
      settled = true
      return result
    })
    wire.exit(1)
    await vi.advanceTimersByTimeAsync(9999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(closing).resolves.toMatchObject({ status: 'unknown', error: { code: 'source-drain-unconfirmed' } })
    releaseDrain()
    await vi.advanceTimersByTimeAsync(0)
    await expect(runtime.shutdown()).resolves.toMatchObject({ status: 'confirmed' })
  } finally {
    releaseDrain()
    wire.exit(1)
    vi.useRealTimers()
    await runtime.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})
