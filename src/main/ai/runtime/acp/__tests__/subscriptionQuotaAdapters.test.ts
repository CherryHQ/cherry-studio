import { PassThrough, Readable } from 'node:stream'

import { afterEach, expect, it, vi } from 'vitest'

import { readKiroSubscriptionUsage } from '@cherrystudio/agent-runtime-kiro-acp'
import { readMiniMaxSubscriptionUsage } from '@cherrystudio/agent-runtime-minimax-acp'
import { readMuseSubscriptionUsage } from '@cherrystudio/agent-runtime-muse-code-acp'
import type { SpawnStdio, StdioProcess } from '@cherrystudio/agent-runtime/stdio'

const observer = new AbortController().signal
const profileArn = 'arn:aws:codewhisperer:us-east-1:123456789012:profile/test-profile'
const reset = Date.UTC(2026, 11, 1)
const kiroUsage = {
  nextDateReset: reset / 1000,
  usageBreakdownList: [
    {
      resourceType: 'CREDIT',
      currentUsageWithPrecision: 28.5,
      currentOveragesWithPrecision: 3.5,
      usageLimitWithPrecision: 100,
      bonuses: []
    }
  ]
}

afterEach(() => vi.restoreAllMocks())

function museCommand(version: string, reply: unknown): SpawnStdio {
  return ({ args }) => {
    if (args.join(' ') !== '--version' && args.join(' ') !== 'usage --json') {
      throw new Error('Unexpected Muse command')
    }
    if (version === '1.4.12' && args[0] !== '--version') {
      throw new Error('An old CLI could interpret the usage command as a prompt')
    }
    const output = args[0] === '--version' ? `Muse Code ${version}` : JSON.stringify(reply)
    const stdout = Readable.from([Buffer.from(output)])
    const closed: StdioProcess['closed'] = new Promise((resolve) =>
      stdout.once('end', () => resolve({ kind: 'exited', code: 0, signal: null }))
    )
    return { stdin: new PassThrough(), stdout, stderr: new PassThrough().end(), closed, closeAndJoin: async () => {} }
  }
}

it('reads both Muse quota windows only on CLI versions where usage is a command', async () => {
  const launch = { executable: 'muse', cwd: '/test', args: [], env: {} }
  const reply = {
    schemaVersion: 1,
    allowance: {
      tier: 'Muse Code Everyday Usage',
      window: { usedPercent: 9, resetsAtMs: reset },
      weekly: { usedPercent: 3, resetsAtMs: reset }
    }
  }
  await expect(readMuseSubscriptionUsage(launch, museCommand('1.4.12', reply), observer)).resolves.toEqual({
    status: 'unsupported'
  })
  await expect(readMuseSubscriptionUsage(launch, museCommand('1.4.23', reply), observer)).resolves.toMatchObject({
    status: 'available',
    windows: [
      { durationMinutes: 300, usedRatio: 0.09, resetsAt: reset },
      { durationMinutes: 10080, usedRatio: 0.03, resetsAt: reset }
    ]
  })
})

it('does not display Kiro overage usage as part of the included credits', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
    if (JSON.parse(String(request?.body)).profileArn !== profileArn) return new Response(null, { status: 403 })
    return Response.json(kiroUsage)
  })
  await expect(
    readKiroSubscriptionUsage(() => ({ accessToken: 'test-token', profileArn }), observer)
  ).resolves.toMatchObject({
    status: 'available',
    windows: [{ usedRatio: 0.25, resetsAt: reset }]
  })
})

it('discards a Kiro reply when the active login changes mid-request', async () => {
  let accessToken = 'test-token'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    accessToken = 'other-test-token'
    return Response.json(kiroUsage)
  })
  await expect(readKiroSubscriptionUsage(() => ({ accessToken, profileArn }), observer)).resolves.toEqual({
    status: 'unavailable'
  })
})

it('shows the matching official MiniMax Token Plan and skips a custom model or a relay credential', async () => {
  const config = { minimax_api: { apiKey: 'test-token', baseURL: 'https://api.minimaxi.com/anthropic' } }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url !== 'https://www.minimaxi.com/v1/token_plan/remains') throw new Error('Wrong quota region')
    return Response.json({
      base_resp: { status_code: 0 },
      model_remains: [
        { model_name: 'video', current_interval_remaining_percent: 100 },
        {
          model_name: 'general',
          current_interval_remaining_percent: 75,
          current_weekly_remaining_percent: 50,
          current_interval_usage_count: 0,
          end_time: reset
        }
      ]
    })
  })
  const readOfficial = async () => config
  const readRelay = async () => ({ minimax_api: { ...config.minimax_api, baseURL: 'https://relay.example/anthropic' } })
  await expect(
    readMiniMaxSubscriptionUsage('m:custom:MiniMax-M3:v:', undefined, readOfficial, observer)
  ).resolves.toEqual({ status: 'unsupported' })
  await expect(
    readMiniMaxSubscriptionUsage('m:minimax_api:MiniMax-M3:v:', undefined, readRelay, observer)
  ).resolves.toEqual({ status: 'unsupported' })
  await expect(
    readMiniMaxSubscriptionUsage('m:minimax:MiniMax-M3:v:', undefined, readOfficial, observer)
  ).resolves.toEqual({ status: 'unsupported' })
  const readSelectedApiKey = async () => ({ ...config, minimaxModelSource: 'minimax_api_key' })
  await expect(
    readMiniMaxSubscriptionUsage('m:minimax:MiniMax-M3:v:', undefined, readSelectedApiKey, observer)
  ).resolves.toMatchObject({
    status: 'available',
    windows: [{ usedRatio: 0.25, resetsAt: reset }, { usedRatio: 0.5 }]
  })
})
