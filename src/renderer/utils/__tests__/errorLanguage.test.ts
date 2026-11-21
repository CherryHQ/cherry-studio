import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { translateErrorByAI } = vi.hoisted(() => ({ translateErrorByAI: vi.fn() }))

vi.mock('@renderer/utils/errorDiagnosis', () => ({ translateErrorByAI }))

import { isLikelyInLanguage, translateErrorMessage } from '../errorLanguage'

const GATEWAY_ZH =
  '操作系统拒绝 API 网关在 ::1，TCP 端口 49152 上监听（EACCES）。请在“设置 → API 网关”中选择其他“端口”，然后点击“启动”。'
const PROVIDER_EN = 'The response was blocked because the input may contain unsafe descriptions.'

describe('isLikelyInLanguage', () => {
  it.each([
    [GATEWAY_ZH, 'zh-CN', true],
    [GATEWAY_ZH, 'zh-TW', true],
    [PROVIDER_EN, 'zh-CN', false],
    [PROVIDER_EN, 'en-US', true],
    [GATEWAY_ZH, 'en-US', false],
    ['リクエストがタイムアウトしました', 'ja-JP', true],
    ['リクエストがタイムアウトしました', 'zh-CN', false],
    ['请求超时', 'ja-JP', false],
    ['Сервис временно недоступен', 'ru-RU', true],
    [PROVIDER_EN, 'ru-RU', false],
    ['HTTP 503 (ECONNRESET)', 'zh-CN', false],
    ['503 ::1:49152', 'zh-CN', true]
  ])('%s in %s → %s', (text, language, expected) => {
    expect(isLikelyInLanguage(text, language)).toBe(expected)
  })

  it('never claims a Latin-script language other than English, since it cannot tell them apart', () => {
    expect(isLikelyInLanguage('Der Dienst ist vorübergehend nicht verfügbar', 'de-DE')).toBe(false)
    expect(isLikelyInLanguage(PROVIDER_EN, 'fr-FR')).toBe(false)
  })
})

describe('translateErrorMessage', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    translateErrorByAI.mockReset()
  })

  it('returns text already in the UI language unchanged without calling the model', async () => {
    await expect(translateErrorMessage(GATEWAY_ZH, 'zh-CN')).resolves.toBe(GATEWAY_ZH)
    expect(translateErrorByAI).not.toHaveBeenCalled()
  })

  it('translates once and reuses the translation for the same text and language', async () => {
    translateErrorByAI.mockResolvedValue('输入可能包含不安全内容，请求已被拦截。')

    await expect(translateErrorMessage(PROVIDER_EN, 'zh-CN')).resolves.toBe('输入可能包含不安全内容，请求已被拦截。')
    await expect(translateErrorMessage(PROVIDER_EN, 'zh-CN')).resolves.toBe('输入可能包含不安全内容，请求已被拦截。')
    expect(translateErrorByAI).toHaveBeenCalledTimes(1)
    expect(translateErrorByAI).toHaveBeenCalledWith(PROVIDER_EN, 'zh-CN')
  })

  it('does not cache a missing translation, so a later failure of the same text can retry', async () => {
    translateErrorByAI.mockResolvedValueOnce('').mockResolvedValueOnce('请求已被拦截。')

    await expect(translateErrorMessage(PROVIDER_EN, 'zh-CN')).resolves.toBe('')
    await expect(translateErrorMessage(PROVIDER_EN, 'zh-CN')).resolves.toBe('请求已被拦截。')
    expect(translateErrorByAI).toHaveBeenCalledTimes(2)
  })

  it('resolves empty when the translation module cannot run', async () => {
    translateErrorByAI.mockRejectedValue(new Error('chunk failed'))

    await expect(translateErrorMessage(PROVIDER_EN, 'ja-JP')).resolves.toBe('')
  })
})
