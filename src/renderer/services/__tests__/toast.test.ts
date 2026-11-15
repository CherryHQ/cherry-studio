import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import { LocalizedToastError } from '@renderer/utils/errorToast'

const { i18nMock } = vi.hoisted(() => ({
  i18nMock: { language: 'en-US', t: (key: string) => key }
}))

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

i18nMock.t = (key: string) => enUS[key as keyof typeof enUS] ?? key
vi.mock('@renderer/i18n/resolver', () => ({ default: i18nMock }))

import { appErrorContextService } from '../AppErrorContextService'
import { presentedRouteService } from '../PresentedRouteService'
import { toast } from '../toast'

beforeEach(() => {
  MockCacheUtils.resetMocks()
})
afterEach(() => toast.closeAll())

describe('provider entitlement toasts', () => {
  it('shows permission without a billing action and preserves real quota recovery', () => {
    const provider = { id: 'groq', name: 'Groq' }
    const message = `service_tier auto is not available for this org. You can check your plan at
[Billing - Plans](https://console.groq.com/settings/billing/plans), and upgrade to access the
required service tier.`
    const permissionKey = toast.errorFromException({ name: 'Error', message, statusCode: 400 }, { provider })
    const quotaKey = toast.errorFromException(
      { name: 'Error', message: 'insufficient_quota', statusCode: 429 },
      { provider }
    )
    const { toasts } = toast.getToastQueue()
    expect(toasts.find((item) => item.key === permissionKey)).toMatchObject({
      title: enUS['error.diagnosis.permission'],
      action: undefined
    })
    expect(toasts.find((item) => item.key === quotaKey)).toMatchObject({
      title: enUS['error.diagnosis.quota'],
      action: { label: enUS['toast.error.configure'], onClick: expect.any(Function) }
    })
  })

  it('titles a Cherry AI plan quota rejection and shows the plan wording on the second line', () => {
    const planText = '套餐「Cherry Plus」额度已耗尽或不足以完成本次请求，建议 30天8小时后重试。'
    const failure = {
      name: 'Error',
      message: `429: ${JSON.stringify({ message: planText, type: 'rate_limit_error' })}`,
      statusCode: 429,
      providerErrorCategory: 'quota'
    }
    const key = toast.errorFromException(failure, {
      provider: { id: 'cherryai-subscription', name: 'CherryAI' },
      modelName: 'DeepSeek V4.1 Flash'
    })

    const shown = toast.getToastQueue().toasts.find((item) => item.key === key)
    expect(shown).toMatchObject({
      title: enUS['models.detail.quota_insufficient_for_request'],
      description: planText,
      action: undefined,
      cause: failure
    })
    expect(shown?.details).toBeUndefined()
  })

  it('titles an unclassified error generically and keeps its raw text only in the detail', () => {
    const raw = "ENOENT: no such file or directory, open '/Users/alice/notes.md'"
    const failure = new Error(raw)
    const key = toast.errorFromException(failure, { provider: { id: 'acme', name: 'Acme' } })

    const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
    expect(shown.title).toBe(enUS['toast.error.unexpected'])
    expect(shown.description).toBe(`Acme · ${enUS['toast.error.interrupted']}`)
    expect(shown.cause).toBe(failure)
    expect(shown.details).toBeUndefined()
  })

  it('titles an unclassified error with the caller summary but keeps classified diagnoses', () => {
    const failure = new Error('ipc handler threw')
    const summarized = toast.errorFromException(failure, { title: 'Failed to send message' })
    const classified = toast.errorFromException(
      { name: 'Error', message: 'fetch failed' },
      { key: 'classified', title: 'Failed to send message' }
    )

    const { toasts } = toast.getToastQueue()
    expect(toasts.find((item) => item.key === summarized)).toMatchObject({
      title: 'Failed to send message',
      cause: failure
    })
    expect(toasts.find((item) => item.key === classified)?.title).toBe(enUS['error.diagnosis.network'])
  })

  it('titles a recovery failure with its own localized summary and keeps the raw cause', async () => {
    const raw = new Error('Enablement unavailable')
    const key = toast.errorFromException(
      { name: 'Error', message: 'fetch failed' },
      {
        title: 'Original summary',
        actions: {
          retry: () => Promise.reject(new LocalizedToastError('Connected, but enabling failed', { cause: raw }))
        }
      }
    )

    await toast
      .getToastQueue()
      .toasts.find((item) => item.key === key)!
      .action!.onClick()

    expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
      type: 'error',
      title: 'Connected, but enabling failed',
      cause: raw
    })
  })
})

it('keeps Cloud rate limits retryable even when their text mentions quota', async () => {
  const retry = vi.fn().mockResolvedValue(false)
  const key = toast.errorFromException(
    { name: 'Error', statusCode: 429, message: '额度不足是另一种错误；本次仅为请求频率过高' },
    { provider: { id: 'cherryai-subscription', name: 'CherryAI' }, actions: { retry } }
  )
  const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
  expect(shown.title).toBe(enUS['error.diagnosis.rate_limit'])
  expect(shown.action?.label).toBe(enUS['toast.error.retry'])
  await shown.action!.onClick()
  expect(retry).toHaveBeenCalledOnce()
})

describe('error toast origin', () => {
  const contextOf = (key: string) => {
    const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
    return appErrorContextService.contextForHostError(String(shown.occurrence), shown)
  }

  it('attributes a generic exception to the route it was shown on, and a provider failure to the provider', () => {
    presentedRouteService.recordPresentedRoute('/files')

    expect(contextOf(toast.errorFromException(new Error('disk full'))).source).toBe('/files')
    expect(
      contextOf(toast.errorFromException(new Error('upstream down'), { provider: { id: 'acme', name: 'Acme' } })).source
    ).toBe('provider')
  })
})
