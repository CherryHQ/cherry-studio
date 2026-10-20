import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import DoubaoSetupGuide from '../DoubaoSetupGuide'

const useProviderMetaMock = vi.fn()

vi.mock('@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: unknown[]) => useProviderMetaMock(...args)
}))

describe('DoubaoSetupGuide', () => {
  it('explains Ark setup and links to Volcengine console pages', () => {
    useProviderMetaMock.mockReturnValue({
      apiKeyWebsite: 'https://www.volcengine.com/experience/ark',
      modelsWebsite: 'https://console.volcengine.com/ark/region:cn-beijing/model',
      docsWebsite: 'https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1099455'
    })

    const { container } = render(<DoubaoSetupGuide providerId="doubao" />)

    expect(useProviderMetaMock).toHaveBeenCalledWith('doubao')
    expect(container.textContent).toMatch(/ark\.cn-beijing\.volces\.com\/api\/v3/)
    expect(screen.getByRole('link', { name: /密钥|API key/i })).toHaveAttribute(
      'href',
      'https://www.volcengine.com/experience/ark'
    )
    expect(screen.getByRole('link', { name: /模型广场|model console/i })).toHaveAttribute(
      'href',
      'https://console.volcengine.com/ark/region:cn-beijing/model'
    )
  })
})
