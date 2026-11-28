import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { bindCursorAccount, listCursorModels, openCursorSession } from '@cherrystudio/agent-runtime-cursor'
import { cursorApiKeyMethod, cursorLoginMethod } from '@cherrystudio/agent-runtime-cursor/cli'

const backend = 'https://api2.cursor.sh'
const resetsAt = Date.UTC(2027, 0, 1)
let directory: string
let authPath: string

beforeEach(async () => {
  vi.stubEnv('CURSOR_API_KEY', undefined)
  vi.stubEnv('CURSOR_BACKEND_URL', undefined)
  directory = await mkdtemp(join(tmpdir(), 'cursor-usage-'))
  authPath = join(directory, 'auth.json')
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

function mockDashboard(isMerged: boolean, changeLogin?: () => Promise<void>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, request) => {
    const auth = new Headers(request?.headers).get('Authorization')
    expect(String(url)).toMatch(/^https:\/\/api2\.cursor\.sh\//)
    expect(request?.redirect).toBe('error')
    if (String(url).endsWith('/auth/exchange_user_api_key')) {
      return auth === 'Bearer selected-key'
        ? Response.json({ accessToken: 'short-lived-token' })
        : new Response(null, { status: 401 })
    }
    expect(auth).toBe('Bearer short-lived-token')
    if (String(url).endsWith('/GetPlanInfo')) {
      return Response.json({
        isMerged,
        planInfo: isMerged
          ? { includedUsagePeriod: 'INCLUDED_USAGE_PERIOD_WEEKLY', includedUsageResetsAt: String(resetsAt) }
          : {}
      })
    }
    expect(String(url)).toMatch(/\/GetCurrentPeriodUsage$/)
    await changeLogin?.()
    return Response.json({
      billingCycleEnd: String(resetsAt),
      planUsage: { totalPercentUsed: 40, autoPercentUsed: isMerged ? 40 : 30, apiPercentUsed: isMerged ? 0 : 65 }
    })
  })
}

const readUsage = (env: Record<string, string> = {}, shellEnv: Record<string, string> = {}, methodId?: string) =>
  bindCursorAccount(env, async () => shellEnv, authPath, methodId).readSubscriptionUsage!(new AbortController().signal)

const login = (apiKey: string) => JSON.stringify({ version: 1, backendUrl: backend, apiKey, createdAtMs: Date.now() })

it('uses the Agent key before shell and SDK logins and shows one window for a merged plan', async () => {
  await writeFile(authPath, login('stored-key'))
  mockDashboard(true)
  await expect(readUsage({ CURSOR_API_KEY: 'selected-key' }, { CURSOR_API_KEY: 'shell-key' })).resolves.toMatchObject({
    status: 'available',
    windows: [{ id: 'included', groupLabel: 'Cursor', durationMinutes: 10080, usedRatio: 0.4, resetsAt }]
  })
})

it('shows both legacy pools for the SDK login without rewriting the SDK credentials', async () => {
  const original = login('selected-key')
  await writeFile(authPath, original)
  mockDashboard(false)
  await expect(readUsage()).resolves.toMatchObject({
    status: 'available',
    windows: [
      { id: 'cursor-models', usedRatio: 0.3, resetsAt },
      { id: 'other-models', usedRatio: 0.65, resetsAt }
    ]
  })
  expect(await readFile(authPath, 'utf8')).toBe(original)
})

it('omits the old account quota when the SDK login changes during the read', async () => {
  await writeFile(authPath, login('selected-key'))
  mockDashboard(true, () => writeFile(authPath, login('another-key')))
  await expect(readUsage()).resolves.toEqual({ status: 'unavailable' })
})

it('uses the selected browser login even when Agent and shell API keys are present', async () => {
  await writeFile(authPath, login('selected-key'))
  mockDashboard(true)
  const result = await readUsage({ CURSOR_API_KEY: 'agent-key' }, { CURSOR_API_KEY: 'shell-key' }, cursorLoginMethod.id)
  expect(result).toMatchObject({ status: 'available', windows: [{ id: 'included', usedRatio: 0.4 }] })
})

it('does not substitute a valid browser login or shell key for the selected Agent API key', async () => {
  await writeFile(authPath, login('selected-key'))
  mockDashboard(true)
  await expect(readUsage({}, { CURSOR_API_KEY: 'selected-key' }, cursorApiKeyMethod.id)).resolves.toEqual({
    status: 'signed-out'
  })
})

it('keeps an explicitly selected browser login signed out if only a shell key is available', async () => {
  const readShellEnv = async () => ({ CURSOR_API_KEY: 'selected-key' })
  const credential = { methodId: cursorLoginMethod.id, sdkAuthPath: authPath }
  const signal = new AbortController().signal

  await expect(listCursorModels({}, readShellEnv, signal, credential)).rejects.toThrow('Cursor authentication required')
  await expect(
    openCursorSession({ cwd: directory, model: 'auto', env: {}, readShellEnv, signal, credential, headless: true })
  ).rejects.toThrow('Cursor authentication required')
})

it('refuses to use a browser key issued for a different backend', async () => {
  await writeFile(authPath, login('selected-key'))
  vi.stubEnv('CURSOR_BACKEND_URL', 'https://alternative.invalid')
  const account = bindCursorAccount({}, async () => ({}), authPath, cursorLoginMethod.id)

  await expect(account.readAccount!(new AbortController().signal)).resolves.toEqual({ status: 'signed-out' })
})

it('reports a missing login without a network request and ignores unrelated endpoints', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(readUsage()).resolves.toEqual({ status: 'signed-out' })
  vi.stubEnv('CURSOR_BACKEND_URL', 'https://other.example')
  await expect(readUsage({ CURSOR_API_KEY: 'selected-key' })).resolves.toEqual({ status: 'unsupported' })
  expect(fetch).not.toHaveBeenCalled()
})
