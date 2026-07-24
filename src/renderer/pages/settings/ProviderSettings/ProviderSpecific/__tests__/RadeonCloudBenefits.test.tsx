import enUS from '@renderer/i18n/locales/en-us.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import RadeonCloudBenefits from '../RadeonCloudBenefits'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('RadeonCloudBenefits', () => {
  it('renders localized benefit copy and the attributed Token Factory link', () => {
    render(<RadeonCloudBenefits />)

    expect(screen.getByTestId('radeon-cloud-benefits')).toHaveAttribute('role', 'note')
    expect(screen.getByText('settings.provider.radeon_cloud.benefits.title')).toBeInTheDocument()
    expect(screen.getByText('settings.provider.radeon_cloud.benefits.description')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'settings.provider.radeon_cloud.benefits.cta' })
    const url = new URL(link.getAttribute('href')!)
    expect(`${url.origin}${url.pathname}`).toBe('https://developer.amd.com.cn/radeon/tokenfactory')
    expect(Object.fromEntries(url.searchParams)).toEqual({ source: 'cherry-studio' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('provides complete English and Chinese benefit copy', () => {
    for (const locale of [enUS, zhCN]) {
      const benefits = locale.settings.provider.radeon_cloud.benefits
      expect(benefits.title).toBeTruthy()
      expect(benefits.description).toBeTruthy()
      expect(benefits.cta).toBeTruthy()
    }

    expect(enUS.settings.provider.radeon_cloud.benefits.title).toContain('10M to 111M')
    expect(enUS.settings.provider.radeon_cloud.benefits.description).toContain('$10')
    expect(enUS.settings.provider.radeon_cloud.benefits.description).toContain('model and token type')
    expect(zhCN.settings.provider.radeon_cloud.benefits.title).toContain('1000 万–1.11 亿')
    expect(zhCN.settings.provider.radeon_cloud.benefits.description).toContain('模型和 Token 类型')
    expect(zhCN.settings.provider.radeon_cloud.benefits.description).toContain('每日重置')
  })
})
