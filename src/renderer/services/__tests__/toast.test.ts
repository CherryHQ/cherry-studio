import { afterEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => enUS[key as keyof typeof enUS] ?? key }
}))

import { toast } from '../toast'

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

  it('shows a Cherry AI plan quota rejection in the plan wording without provider settings', () => {
    const planText = '套餐「Cherry Plus」额度已耗尽或不足以完成本次请求，建议 30天8小时后重试。'
    const key = toast.errorFromException(
      {
        name: 'Error',
        message: `429: ${JSON.stringify({ type: 'error', error: { type: 'quota_error', code: 'QUOTA_EXHAUSTED', message: planText } })}`,
        statusCode: 429,
        providerErrorCategory: 'quota'
      },
      { provider: { id: 'cherryai-subscription', name: 'CherryAI' }, modelName: 'DeepSeek V4.1 Flash' }
    )

    expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
      title: enUS['models.detail.quota_insufficient_for_request'],
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
  expect(shown.title).toBe(enUS['models.detail.cloud_request_limited'])
  expect(shown.details).toBe('额度不足是另一种错误；本次仅为请求频率过高')
  expect(shown.action?.label).toBe(enUS['toast.error.retry'])
  await shown.action!.onClick()
  expect(retry).toHaveBeenCalledOnce()
})

it('shows an AMD daily-quota 429 with its reset text and no plan wording or billing action', () => {
  const resetText = 'Daily quota exhausted. Your quota resets at 00:00 (UTC+8). 今日额度已用完，将于 0 点重置。'
  const key = toast.errorFromException(
    {
      name: 'AI_APICallError',
      statusCode: 429,
      message: resetText,
      providerErrorCategory: 'quota',
      providerErrorCode: 'daily_quota_exceeded'
    },
    { provider: { id: 'cherryai-subscription', name: 'CherryAI' } }
  )

  expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
    title: enUS['models.detail.cloud_request_limited'],
    details: resetText,
    action: undefined
  })
})

it('offers no billing action for a textless Cloud quota refusal', () => {
  const key = toast.errorFromException(
    {
      name: 'AI_APICallError',
      statusCode: 429,
      message: '',
      providerErrorCategory: 'quota',
      providerErrorCode: 'insufficient_quota'
    },
    { provider: { id: 'cherryai-subscription', name: 'CherryAI' } }
  )

  expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({ action: undefined })
})
