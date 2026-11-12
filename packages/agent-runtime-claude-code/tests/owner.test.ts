import { mkdtemp, rm } from 'node:fs/promises'
import type * as Os from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it, vi } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { createClaudeCodeRuntime } from '../src'
import type * as Archive from '../src/archive'
import { confirmed, inputId } from './nativeFixture'
import { wireFixture, wireProcess } from './wireFixture'

const archiveMock = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/archive', async (original) => ({
  ...(await original<typeof Archive>()),
  readArchive: archiveMock.read
}))

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

it.each(['failed', 'cancelled', 'ambiguous'] as const)(
  'does not publish a compact checkpoint for %s evidence',
  async (scenario) => {
    const test = await wireFixture()
    const boundary = crypto.randomUUID()
    archiveMock.read.mockResolvedValue({
      messages: [],
      children: [],
      entries: [
        { entries: [{ type: 'system', subtype: 'compact_boundary', uuid: boundary, sessionId: test.sessionId }] }
      ]
    })
    try {
      test.send({
        type: 'user',
        uuid: crypto.randomUUID(),
        session_id: test.sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content: '/compact' }
      })
      test.send({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: boundary,
        session_id: test.sessionId,
        compact_metadata: { trigger: 'manual', pre_tokens: 1 }
      })
      await test.view.event((message) => 'uuid' in message && message.uuid === boundary)
      test.send({
        type: 'result',
        subtype: 'success',
        uuid: crypto.randomUUID(),
        session_id: test.sessionId,
        is_error: scenario === 'failed',
        terminal_reason: scenario === 'cancelled' ? 'aborted_streaming' : undefined,
        result: '',
        usage: { input_tokens: 1, output_tokens: 1 },
        modelUsage: {},
        permission_denials: []
      } as unknown as SDKMessage)
      await expect
        .poll(() => test.view.batches.flatMap((batch) => batch.controls ?? []).find((event) => event.type === 'result'))
        .toBeDefined()
      const result = test.view.batches.flatMap((batch) => batch.controls ?? []).find((event) => event.type === 'result')
      expect(result).toMatchObject({ messageUuid: undefined })
      if (scenario === 'ambiguous') expect(archiveMock.read).toHaveBeenCalled()
      else expect(archiveMock.read).not.toHaveBeenCalled()
    } finally {
      archiveMock.read.mockReset()
      await test.close()
    }
  }
)

it('keeps the compact summary checkpoint when another input is admitted during archive reading', async () => {
  const test = await wireFixture()
  const boundary = crypto.randomUUID()
  const summary = crypto.randomUUID()
  let release!: (value: unknown) => void
  archiveMock.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  try {
    test.send({
      type: 'user',
      uuid: crypto.randomUUID(),
      session_id: test.sessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: '/compact' }
    })
    test.send({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: boundary,
      session_id: test.sessionId,
      compact_metadata: { trigger: 'manual', pre_tokens: 1 }
    })
    await test.view.event((message) => 'uuid' in message && message.uuid === boundary)
    test.send({
      type: 'result',
      subtype: 'success',
      uuid: crypto.randomUUID(),
      session_id: test.sessionId,
      is_error: false,
      result: '',
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: []
    } as unknown as SDKMessage)
    await expect.poll(() => archiveMock.read.mock.calls.length).toBe(1)
    const laterId = inputId()
    const admitted = test.root.input!.submit({ inputId: laterId, text: 'Later input', whenBusy: 'steer' })
    await expect.poll(() => test.view.snapshot.inputs.some((input) => input.inputId === laterId)).toBe(true)
    release({
      messages: [],
      children: [],
      entries: [
        {
          entries: [
            { type: 'system', subtype: 'compact_boundary', uuid: boundary, sessionId: test.sessionId },
            { type: 'user', uuid: summary, sessionId: test.sessionId, parentUuid: boundary, isCompactSummary: true },
            { type: 'user', uuid: crypto.randomUUID(), sessionId: test.sessionId, parentUuid: summary }
          ]
        }
      ]
    })
    await expect
      .poll(() => test.view.batches.flatMap((batch) => batch.controls ?? []).find((event) => event.type === 'result'))
      .toMatchObject({ messageUuid: summary })
    expect((await admitted).status).toBe('acknowledged')
  } finally {
    archiveMock.read.mockReset()
    await test.close()
  }
})
