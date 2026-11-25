import { describe, expect, it } from 'vitest'

import { isLikelyInLanguage } from '../errorLanguage'

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
