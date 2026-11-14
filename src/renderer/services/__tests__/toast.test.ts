import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

const { i18nMock, translateErrorByAI } = vi.hoisted(() => ({
  i18nMock: { language: 'en-US', t: (key: string) => key },
  translateErrorByAI: vi.fn()
}))

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

i18nMock.t = (key: string) => enUS[key as keyof typeof enUS] ?? key
vi.mock('@renderer/i18n/resolver', () => ({ default: i18nMock }))
vi.mock('@renderer/utils/errorDiagnosis', () => ({ translateErrorByAI }))

import { appErrorContextService } from '../AppErrorContextService'
import { presentedRouteService } from '../PresentedRouteService'
import { toast } from '../toast'

beforeEach(() => {
  i18nMock.language = 'en-US'
  translateErrorByAI.mockReset()
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
      title: enUS['models.detail.quota_exhausted'],
      description: planText,
      action: undefined,
      cause: failure
    })
    expect(shown?.details).toBeUndefined()
  })

  it('titles an unclassified error with its own text so app-localized recovery copy stays visible', () => {
    const text = '连接成功，但启用服务商失败，请稍后重试。'
    const key = toast.errorFromException(new Error(text), { provider: { id: 'acme', name: 'Acme' } })

    const shown = toast.getToastQueue().toasts.find((item) => item.key === key)!
    expect(shown.title).toBe(text)
    expect(shown.details).toBeUndefined()
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

describe('unclassified error toast translation', () => {
  const findToast = (key: string) => toast.getToastQueue().toasts.find((item) => item.key === key)

  it('retitles the toast with the translation once it arrives', async () => {
    i18nMock.language = 'zh-CN'
    let resolve!: (text: string) => void
    translateErrorByAI.mockReturnValue(new Promise<string>((done) => (resolve = done)))
    const raw = 'upstream exploded: weird_vendor_code_42'

    const key = toast.errorFromException(new Error(raw), { provider: { id: 'acme', name: 'Acme' } })
    expect(findToast(key)?.title).toBe(raw)

    resolve('上游服务出错：weird_vendor_code_42')
    await vi.waitFor(() => expect(findToast(key)?.title).toBe('上游服务出错：weird_vendor_code_42'))
    expect(findToast(key)?.description).toBe('Acme')
  })

  it('leaves a toast that replaced the original under the same key untouched', async () => {
    i18nMock.language = 'zh-CN'
    let resolve!: (text: string) => void
    translateErrorByAI.mockReturnValue(new Promise<string>((done) => (resolve = done)))

    const key = toast.errorFromException(new Error('first failure'), { key: 'shared' })
    toast.success({ key, title: '已恢复' })
    await vi.waitFor(() => expect(translateErrorByAI).toHaveBeenCalled())
    resolve('第一次失败')
    await new Promise((settled) => setTimeout(settled, 0))

    expect(findToast(key)).toMatchObject({ type: 'success', title: '已恢复' })
  })

  it('keeps text that already reads in the UI language and asks for no translation', () => {
    i18nMock.language = 'zh-CN'
    const text = '连接成功，但启用服务商失败，请稍后重试。'

    const key = toast.errorFromException(new Error(text))

    expect(findToast(key)?.title).toBe(text)
    expect(translateErrorByAI).not.toHaveBeenCalled()
  })
})
