import { PassThrough } from 'node:stream'

import { expect, it } from 'vitest'

import type { LaunchSpec, StdioProcess } from '@cherrystudio/agent-runtime/stdio'

import {
  launchCodexAppServer,
  readCodexAccount,
  readCodexSubscriptionUsage,
  withCodexAppServer,
  type CodexLaunch,
  type CodexProcessHost
} from '../src/launcher'
import { createPeer } from './peer'

function fixture() {
  const peer = createPeer()
  const stderr = new PassThrough()
  const exit = Promise.withResolvers<Awaited<StdioProcess['closed']>>()
  const reaped = Promise.withResolvers<void>()
  let command: LaunchSpec | undefined
  const host: CodexProcessHost = {
    clientInfo: { name: 'test', title: null, version: '1' },
    redactDiagnostic: (text, env) => text.replaceAll(env.TEST_TOKEN, '<redacted>'),
    spawnStdio(spec) {
      command = spec
      return {
        stdin: peer.stdin,
        stdout: peer.stdout,
        stderr,
        closed: exit.promise,
        async closeAndJoin() {
          if (!peer.stdin.writableEnded) {
            peer.close()
            stderr.end()
            exit.resolve({ kind: 'exited', code: 0, signal: null })
            reaped.resolve()
          }
          await reaped.promise
        }
      }
    }
  }
  const target: CodexLaunch = {
    installation: { componentId: 'codex', path: '/installed/codex', source: 'system' },
    cwd: '/workspace',
    env: { TEST_TOKEN: 'private-token-value' },
    args: [],
    executableOverride: false
  }
  return { peer, stderr, exit, reaped: reaped.promise, host, target, command: () => command }
}

it.each([
  {
    args: ['app-server', '-c', 'features.goals=true'],
    expected: ['app-server', '-c', 'features.goals=true', '--listen', 'stdio://']
  },
  { args: ['--stdio'], expected: ['app-server', '--stdio'] }
])('probes the selected binary over stdio and closes without opening a thread', async ({ args, expected }) => {
  const f = fixture()
  const probe = withCodexAppServer({ ...f.target, args }, f.host, new AbortController().signal, () => undefined)
  await f.peer.handshake()
  await probe
  expect(f.command()).toEqual({
    executable: '/installed/codex',
    cwd: '/workspace',
    env: f.target.env,
    args: expected
  })
  await expect(f.peer.read()).rejects.toThrow('Client closed before writing the expected frame')
  await f.reaped
})

it('preserves an explicit wrapper command and joins an aborted handshake', async () => {
  const f = fixture()
  const abort = new AbortController()
  const probe = withCodexAppServer(
    { ...f.target, executableOverride: true, args: ['/wrapper', '--profile', 'work'] },
    f.host,
    abort.signal,
    () => {
      throw new Error('The handshake was cancelled')
    }
  )
  const rejected = expect(probe).rejects.toThrow('connection closed')
  await f.peer.read()
  abort.abort()
  await rejected
  await f.reaped
  expect(f.command()?.args).toEqual(['/wrapper', '--profile', 'work'])
})

it('keeps diagnostics from a failed spawn and reaps the process without exposing the token', async () => {
  const f = fixture()
  const server = launchCodexAppServer(f.target, f.host)
  const failure = expect(server.ready).rejects.toThrow('Cannot open profile <redacted>')
  f.stderr.write('Cannot open profile private-token-value')
  f.exit.resolve({ kind: 'spawn-failed', error: new Error('Cannot spawn Codex') })
  await failure
  await f.reaped
})

it('rejects a different listener before spawning an installed Codex', () => {
  const f = fixture()
  expect(() => launchCodexAppServer({ ...f.target, args: ['app-server', '--listen=unix://'] }, f.host)).toThrow(
    'requires the Codex App Server stdio transport'
  )
  expect(f.command()).toBeUndefined()
})

it('returns the active Codex account and workspace without opening a thread', async () => {
  const f = fixture()
  const read = readCodexAccount(f.target, f.host, new AbortController().signal)
  await f.peer.handshake()
  const config = await f.peer.read()
  expect(config.method).toBe('config/read')
  f.peer.send({ id: config.id, result: { config: { model_provider: 'openai' } } })
  const account = await f.peer.read()
  expect(account).toMatchObject({ method: 'account/read', params: { refreshToken: false } })
  f.peer.send({
    id: account.id,
    result: {
      requiresOpenaiAuth: true,
      account: { type: 'chatgpt', email: 'active@example.test' },
      userId: 'native-user',
      workspaceRouting: { chatgptAccountId: 'native-workspace' }
    }
  })
  await expect(read).resolves.toEqual({
    status: 'signed-in',
    account: { email: 'active@example.test', id: 'native-user', workspace: { id: 'native-workspace' } }
  })
  await f.reaped
  await expect(f.peer.read()).rejects.toThrow('Client closed before writing the expected frame')
})

it.each([false, true])(
  'checks subscription ownership after reading native windows (account changed: %s)',
  async (changed) => {
    const f = fixture()
    const probe = readCodexSubscriptionUsage(f.target, f.host, new AbortController().signal)
    await f.peer.handshake()
    async function reply(method: string, result: unknown) {
      const request = await f.peer.read()
      expect(request.method).toBe(method)
      f.peer.send({ id: request.id, result })
    }

    await reply('config/read', { config: { model_provider: 'openai' } })
    const account = {
      requiresOpenaiAuth: true,
      account: { type: 'chatgpt' },
      workspaceRouting: { chatgptAccountId: 'team-a' }
    }
    await reply('account/read', account)
    await reply('account/rateLimits/read', {
      accountId: 'team-a',
      rateLimits: {},
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1800000000 } },
        spark: { secondary: { usedPercent: 50 } }
      }
    })
    await reply('account/read', changed ? { ...account, workspaceRouting: { chatgptAccountId: 'team-b' } } : account)

    if (changed) await expect(probe).resolves.toEqual({ status: 'unavailable' })
    else
      await expect(probe).resolves.toMatchObject({
        status: 'available',
        windows: [
          { id: 'codex:primary', groupLabel: 'Codex', usedRatio: 0, durationMinutes: 300, resetsAt: 1800000000000 },
          { id: 'spark:secondary', groupLabel: undefined, usedRatio: 0.5 }
        ]
      })
    await f.reaped
    await expect(f.peer.read()).rejects.toThrow('Client closed before writing the expected frame')
  }
)
