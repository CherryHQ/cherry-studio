import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cherryCloudAnalyticsEventSchema,
  type CherryCloudLoginResult,
  type CherryCloudStatus
} from '@shared/ipc/schemas/cherryCloud'

import { CherryCloudSubscriptionService } from '../CherryCloudSubscriptionService'

const request = vi.mocked(window.api.ipcApi.request)
const signedOut: CherryCloudStatus = {
  phase: 'signed-out',
  accountId: null,
  displayName: null,
  scopeId: '0:0',
  revision: 0
}
const signedIn: CherryCloudStatus = {
  phase: 'signed-in',
  accountId: 'account-1',
  displayName: 'Test',
  scopeId: '0:1',
  revision: 2
}
const sources = ['settings', 'account_panel'] as const
const owners: CherryCloudSubscriptionService[] = []

afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose()
})

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]]
  return items.flatMap((item, index) =>
    permutations(items.filter((_, other) => index !== other)).map((suffix) => [item, ...suffix])
  )
}

type Step = 'clickA' | 'clickB' | 'statusA' | 'statusB' | 'login' | 'close'
const schedules = [
  ...permutations<Step>(['clickA', 'clickB', 'statusA', 'statusB', 'login']),
  ...permutations<Step>(['clickA', 'clickB', 'statusA', 'statusB', 'login', 'close'])
].filter((steps) => {
  const at = (step: Step) => steps.indexOf(step)
  return (
    at('clickA') < at('clickB') &&
    at('clickA') < at('statusA') &&
    at('clickB') < at('statusB') &&
    Math.min(at('statusA'), at('statusB')) < at('login')
  )
})

async function settlePendingWork() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

// Catches an old click, status listener or closed-window continuation opening a late portal.
describe('bounded actual subscription schedules', () => {
  it.each(['signed-in', 'cancelled', 'failed'] as const)('preserves intent ownership for %s', async (outcome) => {
    for (const steps of schedules) {
      vi.clearAllMocks()
      const statusReplies = [Promise.withResolvers<unknown>(), Promise.withResolvers<unknown>()]
      const login = Promise.withResolvers<unknown>()
      const portals: string[] = []
      const openings: { input: unknown; expectedSource: string; closed: boolean }[] = []
      const events: { event: string; flowId?: string }[] = []
      const starts: ReturnType<CherryCloudSubscriptionService['start']>[] = []
      let click = -1
      let closed = false
      const owner = new CherryCloudSubscriptionService()
      owners.push(owner)
      request.mockImplementation(async (route, input) => {
        if (route === 'cherry_cloud.status.get') return statusReplies[click].promise
        if (route === 'cherry_cloud.login.start') return login.promise
        if (route === 'cherry_cloud.account_portal.open') {
          openings.push({ input, expectedSource: sources[click], closed })
          if (input && typeof input === 'object' && 'flowId' in input && typeof input.flowId === 'string') {
            portals.push(input.flowId)
          }
          return { ok: true, data: { outcome: 'opened' } }
        }
        if (route === 'cherry_cloud.analytics.track' && input && typeof input === 'object' && 'payload' in input) {
          events.push(cherryCloudAnalyticsEventSchema.parse(input.payload))
        }
        return { ok: true, data: undefined }
      })
      for (const step of steps) {
        if (step === 'clickA' || step === 'clickB') {
          click = step === 'clickA' ? 0 : 1
          starts.push(owner.start(sources[click]))
        } else if (step === 'statusA' || step === 'statusB') {
          statusReplies[step === 'statusA' ? 0 : 1].resolve({ ok: true, data: signedOut })
        } else if (step === 'close') {
          closed = true
          owner.dispose()
        } else {
          const result: CherryCloudLoginResult =
            outcome === 'signed-in' ? { outcome, status: signedIn } : { outcome: 'cancelled', status: signedOut }
          login.resolve(
            outcome === 'failed'
              ? { ok: false, error: { code: 'INTERNAL', message: 'offline refusal' } }
              : { ok: true, data: result }
          )
        }
        await settlePendingWork()
      }
      await Promise.all(starts)
      for (const opening of openings) {
        expect(opening.closed, steps.join(' → ')).toBe(false)
        expect(opening.input, steps.join(' → ')).toMatchObject({
          entrySource: opening.expectedSource,
          scopeId: signedIn.scopeId
        })
      }
      expect(new Set(portals).size, steps.join(' → ')).toBe(portals.length)
      if (outcome !== 'signed-in') expect(portals).toEqual([])
      for (const flowId of new Set(events.map((event) => event.flowId))) {
        for (const terminal of ['subscription_sign_in_result', 'subscription_portal_open']) {
          expect(
            events.filter((event) => event.flowId === flowId && event.event === terminal).length
          ).toBeLessThanOrEqual(1)
        }
      }
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.login.cancel')).toBe(false)
      owner.dispose()
      owners.pop()
    }
    expect(schedules).toHaveLength(49)
  })

  it('keeps two window continuations independent while they share one login', async () => {
    vi.clearAllMocks()
    const login = Promise.withResolvers<unknown>()
    const opened: unknown[] = []
    request.mockImplementation(async (route, input) => {
      if (route === 'cherry_cloud.status.get') return { ok: true, data: signedOut }
      if (route === 'cherry_cloud.login.start') return login.promise
      if (route === 'cherry_cloud.account_portal.open') opened.push(input)
      return { ok: true, data: { outcome: 'opened' } }
    })
    const first = new CherryCloudSubscriptionService()
    const second = new CherryCloudSubscriptionService()
    owners.push(first, second)
    const a = first.start('settings')
    const b = second.start('account_panel')
    await settlePendingWork()
    first.dispose()
    login.resolve({ ok: true, data: { outcome: 'signed-in', status: signedIn } })
    await Promise.all([a, b])
    expect(opened).toEqual([expect.objectContaining({ entrySource: 'account_panel', scopeId: signedIn.scopeId })])
    expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.login.cancel')).toBe(false)
  })
})
