import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

vi.mock('@renderer/i18n/resolver', async () => {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'en-US',
    resources: { 'en-US': { translation: enUS } },
    keySeparator: false,
    interpolation: { escapeValue: false }
  })
  return { default: instance }
})

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

const mismatch = {
  name: 'ClaudeCodeBranchRuntimeMismatchError',
  message: 'The selected branch belongs to another runtime backend',
  stack: 'at prepareClaudeBranch',
  i18nKey: 'claude_code_branch_runtime_mismatch',
  detailI18nKey: 'claude_code_branch_runtime_mismatch_detail',
  streamStage: 'response-stream'
}

it('shows the localized branch mismatch without a retry or internal details', () => {
  const key = toast.errorFromException(mismatch, {
    provider: { id: 'test', name: 'Provider' },
    modelName: 'Model',
    actions: { retry: vi.fn() }
  })
  const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
  expect(shown).toMatchObject({
    type: 'error',
    title: 'This conversation branch cannot continue with the current agent settings.',
    details:
      'This branch was created with a different agent type or settings. Start a new conversation, or restore the original agent and settings. This is not a network problem.',
    description: 'Provider · Model',
    action: undefined
  })
  expect(shown.title).not.toBe(enUS['error.diagnosis.stream'])
  expect(shown.title).not.toBe(enUS['error.diagnosis.network'])
  expect(JSON.stringify([shown.title, shown.description, shown.details])).not.toMatch(
    /another runtime backend|ClaudeCodeBranchRuntimeMismatchError|at prepareClaudeBranch/
  )
})

it('does not expose raw details when the detail key is missing', () => {
  const key = toast.errorFromException({ ...mismatch, detailI18nKey: 'nonexistent_detail' })
  expect(toast.getToastQueue().toasts.find((item) => item.key === key)?.details).toBeUndefined()
})

it.each([
  'nonexistent_key',
  '',
  'claude_code_session_bus_missing',
  'missing_finish_reason',
  'image_unreadable_for_non_vision_model'
])('preserves existing toast behavior for %s', (i18nKey) => {
  const key = toast.errorFromException({ ...mismatch, i18nKey })
  const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
  expect(shown.title).toBe(i18nKey ? mismatch.message : enUS['error.diagnosis.stream'])
  expect(shown.details).toBe(i18nKey ? undefined : mismatch.message)
  expect(shown.action).toBeUndefined()
})

it('preserves existing behavior for a non-string i18n key', () => {
  const key = toast.errorFromException({ ...mismatch, i18nKey: 42 }, { actions: { retry: vi.fn() } })
  const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
  expect(shown.title).toBe(mismatch.message)
  expect(shown.details).toBeUndefined()
  expect(shown.action).toBeUndefined()
})
