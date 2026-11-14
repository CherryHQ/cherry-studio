import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'

import { ProviderIdentity } from '../ProviderIdentity'

const provider: Provider = {
  id: 'first',
  name: 'Shared',
  presetProviderId: 'openai-codex',
  apiKeys: [],
  authType: 'oauth',
  reportsActualCost: false,
  settings: {},
  isEnabled: true
}

describe('provider identity', () => {
  it('shows each Codex account and falls back to the name without requesting other providers', () => {
    mockUseQuery.mockImplementation(
      (path, options) =>
        ({
          data:
            path === '/providers/:providerId/auth-config'
              ? {
                  accountId:
                    (options as { params?: { providerId?: string } } | undefined)?.params?.providerId === 'first'
                      ? 'account-a'
                      : (options as { params?: { providerId?: string } } | undefined)?.params?.providerId === 'second'
                        ? 'account-b'
                        : null
                }
              : null
        }) as never
    )
    render(
      <>
        <span>
          <ProviderIdentity provider={provider} />
        </span>
        <span>
          <ProviderIdentity provider={{ ...provider, id: 'second' }} />
        </span>
        <span>
          <ProviderIdentity provider={{ ...provider, id: 'third' }} />
        </span>
        <span>
          <ProviderIdentity provider={{ ...provider, id: 'other', presetProviderId: 'openai' }} />
        </span>
      </>
    )
    expect(screen.getByText('Shared · account-a')).toBeInTheDocument()
    expect(screen.getByText('Shared · account-b')).toBeInTheDocument()
    expect(screen.getAllByText('Shared')).toHaveLength(2)
    expect(mockUseQuery).not.toHaveBeenCalledWith(
      '/providers/:providerId/auth-config',
      expect.objectContaining({ params: { providerId: 'other' } })
    )
  })
})
