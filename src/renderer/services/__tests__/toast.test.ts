import { afterEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string, values?: Record<string, string>) => {
      const template = enUS[key as keyof typeof enUS] ?? key
      if (!values || typeof template !== 'string') return template
      return Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), template)
    },
    exists: (key: string) => key in enUS
  }
}))

import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

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

describe('admission runtime errors', () => {
  const admissionPayload = {
    name: 'ClaudeCodeRuntimeUnavailableError',
    message: 'Claude Agent is not ready.',
    stack: null,
    i18nKey: 'claude_code_runtime_missing',
    detailI18nKey: 'claude_code_runtime_missing_detail'
  }

  it('shows the localized runtime-missing recovery copy instead of the legacy message', () => {
    const admissionError = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, admissionPayload.message, admissionPayload)
    const key = toast.errorFromException(admissionError)
    expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
      title: enUS['error.claude_code_runtime_missing'],
      details: enUS['error.claude_code_runtime_missing_detail']
    })
  })

  it('prefers the runtime copy even when the failed message carries a model provider', () => {
    const admissionError = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, admissionPayload.message, admissionPayload)
    const key = toast.errorFromException(admissionError, {
      provider: { id: 'anthropic', name: 'Anthropic' },
      modelName: 'claude-sonnet-4-5'
    })
    expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
      title: enUS['error.claude_code_runtime_missing'],
      details: enUS['error.claude_code_runtime_missing_detail']
    })
  })
})
