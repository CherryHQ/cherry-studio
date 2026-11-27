import { mkdtemp, rm } from 'node:fs/promises'
import type * as Os from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Options } from '@anthropic-ai/claude-agent-sdk'
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
