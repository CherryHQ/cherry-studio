import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { NON_VISION_IMAGE_GUIDANCE } from '@shared/ai/nonVisionImageGuidance'

import * as navigation from '../mainWindowNavigation'

const locale = vi.hoisted(() => ({ language: 'en' }))

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string) => (locale.language === 'zh' ? zhCN : enUS)[key as keyof typeof enUS] ?? key,
    exists: (key: string) => Object.hasOwn(locale.language === 'zh' ? zhCN : enUS, key)
  }
}))

import { toast } from '../toast'

beforeEach(() => {
  locale.language = 'en'
})

afterEach(() => {
  toast.closeAll()
  vi.restoreAllMocks()
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
})

describe('error toast display titles', () => {
  describe.each([
    ['English', 'en', enUS],
    ['Chinese', 'zh', zhCN]
  ] as const)('%s', (_label, language, catalog) => {
    it.each([
      ['structured', { providerErrorCategory: 'ocr', i18nKey: 'image_unreadable_for_non_vision_model' }],
      ['legacy', {}]
    ])('uses attachment guidance for a %s failure and keeps raw diagnostics', (_shape, fields) => {
      locale.language = language
      const key = toast.errorFromException(
        { name: 'NonVisionImageOcrError', message: NON_VISION_IMAGE_GUIDANCE, ...fields },
        { provider: { id: 'deepseek', name: 'DeepSeek' }, modelName: 'DeepSeek V4 Flash' }
      )
      expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
        title: catalog['error.image_unreadable_for_non_vision_model'],
        type: 'warning',
        details: NON_VISION_IMAGE_GUIDANCE,
        description: 'DeepSeek · DeepSeek V4 Flash',
        action: undefined
      })
    })
  })

  it('keeps the generic OCR title for an engine initialization failure', () => {
    const key = toast.errorFromException(new Error('OCR engine not initialized'))
    expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
      title: enUS['error.diagnosis.ocr'],
      type: 'warning',
      details: 'OCR engine not initialized'
    })
  })

  it('does not promote a provider-interpolating app key into a plain toast title', () => {
    const key = toast.errorFromException({
      name: 'Error',
      message: 'No API key',
      i18nKey: 'chat.no_api_key',
      providerId: 'openai'
    })
    const notification = toast.getToastQueue().toasts.find((item) => item.key === key)
    expect(notification).toMatchObject({ title: enUS['error.diagnosis.auth'], details: 'No API key' })
    expect(notification?.title).not.toMatch(/<provider>|{{provider}}/)
  })

  it('keeps an unknown error as a raw safe title without separate details', () => {
    const key = toast.errorFromException({
      name: 'Error',
      message: 'Opaque local failure',
      i18nKey: 'tool_call_limit_reached'
    })
    expect(toast.getToastQueue().toasts.find((item) => item.key === key)).toMatchObject({
      title: 'Opaque local failure',
      type: 'error',
      details: undefined
    })
  })

  it('retains an explicit MCP category title, server description, and settings action', async () => {
    const openSettingsTab = vi.spyOn(navigation, 'openSettingsTab').mockImplementation(() => {})
    const key = toast.errorFromException(new Error('OCR engine not initialized'), {
      category: 'mcp',
      mcpServer: { id: 'server/one', name: 'Image tools' }
    })
    const notification = toast.getToastQueue().toasts.find((item) => item.key === key)
    expect(notification).toMatchObject({
      title: enUS['error.diagnosis.mcp'],
      type: 'warning',
      description: 'Image tools',
      details: 'OCR engine not initialized',
      action: { label: enUS['toast.error.mcp'], onClick: expect.any(Function) }
    })
    await notification!.action!.onClick()
    expect(openSettingsTab).toHaveBeenCalledWith('/settings/mcp/settings/server%2Fone')
  })
})
