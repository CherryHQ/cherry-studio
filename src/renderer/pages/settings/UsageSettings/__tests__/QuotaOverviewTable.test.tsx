import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: vi.fn(() => ({
    data: {
      buckets: [
        { groupBy: 'apiKey', apiKeyId: 'key1', requestCount: 30 },
        { groupBy: 'apiKey', apiKeyId: 'key2', requestCount: 20 }
      ]
    }
  }))
}))

vi.mock('@data/hooks/usePreference', () => {
  const mockSetLimits = vi.fn()
  return {
    usePreference: vi.fn((key) => {
      if (key === 'chat.routing.api_key_limits') {
        return [
          {
            'openrouter::key1': { limit: 100, period: 'monthly' },
            'openrouter::key2': { limit: 50, period: 'monthly' }
          },
          mockSetLimits
        ]
      }
      if (key === 'chat.routing.service_usage') {
        return [{}, vi.fn()]
      }
      return [null, vi.fn()]
    })
  }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    providers: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKeys: [
          { id: 'key1', label: 'Key 1', isEnabled: true, tier: 'free' },
          { id: 'key2', label: 'Key 2', isEnabled: true, tier: 'paid' }
        ]
      }
    ]
  })
}))

import { QuotaOverviewTable } from '../QuotaOverviewTable'

describe('QuotaOverviewTable', () => {
  it('renders pools grouped by provider and period', () => {
    render(<QuotaOverviewTable />)

    expect(screen.getByText('OpenRouter')).toBeInTheDocument()
  })

  it('expands and collapses pool details', async () => {
    const user = userEvent.setup()

    render(<QuotaOverviewTable />)

    // Initially, detail rows should not be visible
    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()

    // Click on pool row to expand
    const openrouterHeader = screen.getByText('OpenRouter').closest('tr')
    if (openrouterHeader) {
      await user.click(openrouterHeader)

      // Now detail rows should be visible
      expect(screen.getByText('Key 1')).toBeInTheDocument()
    }
  })
})
