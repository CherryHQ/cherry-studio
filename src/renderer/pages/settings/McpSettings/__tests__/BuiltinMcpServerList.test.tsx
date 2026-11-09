import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import zh from '@renderer/i18n/locales/zh-cn.json'

vi.unmock('@cherrystudio/ui')

import BuiltinMcpServerList from '../BuiltinMcpServerList'

afterEach(cleanup)

describe('BuiltinMcpServerList documentation', () => {
  it.each([
    [
      'zh-CN',
      zh,
      'https://cherryai.com.cn/docs/zh-cn/advanced-basic/extensions/mcp/#nei-zhi-fu-wu-qi-yu-fu-wu-shi-chang'
    ],
    ['en-US', en, 'https://cherryai.com/docs/en/advanced-basic/extensions/mcp/#built-in-servers-and-marketplaces']
  ])('links configuration help to the published section for %s', async (language, translations, expectedUrl) => {
    const i18n = createInstance()
    await i18n.init({
      lng: language,
      keySeparator: false,
      resources: { [language]: { translation: translations } },
      interpolation: { escapeValue: false }
    })
    render(
      <I18nextProvider i18n={i18n}>
        <BuiltinMcpServerList />
      </I18nextProvider>
    )

    const links = screen.getAllByRole('link', { name: translations['settings.mcp.requiresConfig'] })
    for (const link of links) expect(link).toHaveAttribute('href', expectedUrl)
  })
})
