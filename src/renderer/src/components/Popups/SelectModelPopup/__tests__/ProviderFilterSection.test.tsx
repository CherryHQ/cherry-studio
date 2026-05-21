import type { Provider } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderFilterSection from '../ProviderFilterSection'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key),
  getFancyProviderName: vi.fn((provider: Provider) => provider.name)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('@renderer/utils', () => ({
  getFancyProviderName: mocks.getFancyProviderName
}))

vi.mock('@renderer/components/Tags/CustomTag', () => ({
  default: ({
    children,
    inactive,
    onClick,
    tooltip
  }: {
    children: React.ReactNode
    inactive?: boolean
    onClick?: () => void
    tooltip?: string
  }) => {
    const React = require('react')
    return React.createElement(
      'button',
      {
        type: 'button',
        'aria-label': `provider-${children}`,
        'data-inactive': String(Boolean(inactive)),
        title: tooltip,
        onClick
      },
      children
    )
  }
}))

vi.mock('antd', () => ({
  Flex: ({ children }: { children: React.ReactNode }) => children
}))

function createProvider(id: string, name: string): Provider {
  return {
    id,
    name,
    type: 'openai',
    apiKey: '',
    apiHost: '',
    models: []
  }
}

const providers = [createProvider('openai', 'OpenAI'), createProvider('cherryai', 'CherryAI')]

describe('ProviderFilterSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render provider filters with all providers active by default', () => {
    render(<ProviderFilterSection providers={providers} hiddenProviderIds={new Set()} onToggleProvider={vi.fn()} />)

    expect(screen.getByText('models.filter.by_provider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'provider-OpenAI' })).toHaveAttribute('data-inactive', 'false')
    expect(screen.getByRole('button', { name: 'provider-CherryAI' })).toHaveAttribute('data-inactive', 'false')
  })

  it('should reflect inactive state based on hiddenProviderIds', () => {
    render(
      <ProviderFilterSection
        providers={providers}
        hiddenProviderIds={new Set(['cherryai'])}
        onToggleProvider={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'provider-CherryAI' })).toHaveAttribute('data-inactive', 'true')
  })

  it('should call onToggleProvider when a provider is clicked', () => {
    const handleToggle = vi.fn()
    render(
      <ProviderFilterSection providers={providers} hiddenProviderIds={new Set()} onToggleProvider={handleToggle} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'provider-OpenAI' }))

    expect(handleToggle).toHaveBeenCalledTimes(1)
    expect(handleToggle).toHaveBeenCalledWith('openai')
  })
})
