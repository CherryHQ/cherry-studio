import { afterEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import { classifyError } from '@renderer/utils/errorClassifier'

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string) => enUS[key as keyof typeof enUS] ?? key,
    exists: (key: string) => Object.hasOwn(enUS, key)
  }
}))

import { toast } from '../toast'

afterEach(() => toast.closeAll())

it('shows actionable Pi session guidance for an ambiguous response-stream failure', () => {
  const error = {
    name: 'PiSessionIdentityAmbiguousError',
    message: 'Pi session identity is ambiguous. Start a new task to continue.',
    stack: null,
    i18nKey: 'pi_session_identity_ambiguous',
    detailI18nKey: 'pi_session_identity_ambiguous_detail',
    streamStage: 'response-stream' as const
  }
  const provider = { id: 'openai', name: 'OpenAI' }
  expect(classifyError(error, provider.id)).toMatchObject({ category: 'unknown', navTarget: null })
  const key = toast.errorFromException(error, { provider, actions: { retry: vi.fn() } })
  const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
  expect(shown.title).toBe(enUS['error.pi_session_identity_ambiguous'])
  expect(shown.title).not.toBe(error.message)
  expect(shown.title).not.toBe(enUS['error.diagnosis.stream'])
  expect(shown.title).not.toBe(enUS['error.diagnosis.unknown'])
  expect(shown.action).toBeUndefined()
})

it('shows the Durable turn headline instead of transport wording', () => {
  const error = {
    name: 'PiDurableTurnInProgressError',
    message: 'A Durable turn is already running. Wait for it to finish, then send again.',
    stack: null,
    streamStage: 'response-stream' as const,
    i18nKey: 'pi_durable_turn_in_progress',
    detailI18nKey: 'pi_durable_turn_in_progress_detail'
  }
  const key = toast.errorFromException(error, { provider: { id: 'openai', name: 'OpenAI' } })
  const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
  expect(shown.title).toBe('A turn is already running')
  expect(shown.title).not.toBe(enUS['error.diagnosis.stream'])
  expect(shown.title).not.toBe(error.message)
})

it('falls back to the existing unknown title when the app-owned translation is unavailable', () => {
  for (const message of ['Unmapped local failure', '']) {
    const key = toast.errorFromException({ name: 'Error', message, i18nKey: 'unregistered_error' })
    expect(toast.getToastQueue().toasts.find((item) => item.key === key)?.title).toBe(message || enUS['error.unknown'])
  }
})

it('preserves known-category presentation when an app-owned key is present', async () => {
  const cases = [
    { category: 'network', error: { name: 'Error', message: 'fetch failed' } },
    { category: 'stream', error: { name: 'Error', message: 'stream interrupted', providerErrorCategory: 'stream' } },
    { category: 'server', error: { name: 'Error', message: 'Service unavailable', statusCode: 503 } }
  ] as const
  for (const { category, error } of cases) {
    const retry = vi.fn().mockResolvedValue(false)
    const context = { provider: { id: 'openai', name: 'OpenAI' }, actions: { retry } }
    const originalKey = toast.errorFromException(error, context)
    const appOwnedKey = toast.errorFromException({ ...error, i18nKey: 'pi_session_identity_ambiguous' }, context)
    const original = toast.getToastQueue().toasts.find((item) => item.key === originalKey)!
    const appOwned = toast.getToastQueue().toasts.find((item) => item.key === appOwnedKey)!
    expect(original.title).toBe(enUS[`error.diagnosis.${category}`])
    expect(appOwned.title).toBe(original.title)
    expect(appOwned.details).toBe(original.details)
    expect(appOwned.action?.label).toBe(original.action?.label)
    expect(appOwned.action?.label).toBe(enUS['toast.error.retry'])
    await original.action!.onClick()
    await appOwned.action!.onClick()
    expect(retry).toHaveBeenCalledTimes(2)
  }
})

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

  it('shows a Cherry AI plan quota rejection in the plan wording without provider settings', () => {
    const planText = '套餐「Cherry Plus」额度已耗尽或不足以完成本次请求，建议 30天8小时后重试。'
    const key = toast.errorFromException(
      {
        name: 'Error',
        message: `429: ${JSON.stringify({ message: planText, type: 'rate_limit_error' })}`,
        statusCode: 429,
        providerErrorCategory: 'quota'
      },
      { provider: { id: 'cherryai-subscription', name: 'CherryAI' }, modelName: 'DeepSeek V4.1 Flash' }
    )

    expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
      title: enUS['models.detail.quota_exhausted'],
      details: planText,
      action: undefined
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
