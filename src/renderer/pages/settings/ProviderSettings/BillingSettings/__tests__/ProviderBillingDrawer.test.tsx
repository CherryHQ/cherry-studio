import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelSchema } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'

import ProviderBillingDrawer from '../ProviderBillingDrawer'

vi.unmock('@cherrystudio/ui')

const provider = ProviderSchema.parse({
  id: 'group',
  name: 'Group',
  endpointConfigs: {},
  apiKeys: [],
  authType: 'api-key',
  reportsActualCost: false,
  isEnabled: true,
  settings: {
    timeout: 45,
    billing: {
      defaultMultiplier: 2,
      scheduleEnabled: true,
      timeZone: 'UTC',
      periods: [{ id: 'night', name: 'Night', start: '22:00', end: '06:00', mode: 'multiplier', multiplier: 0.5 }]
    }
  }
})
const model = ModelSchema.parse({
  id: 'group::model',
  providerId: 'group',
  name: 'Model',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  pricing: { input: { perMillionTokens: 2, currency: 'USD' }, output: { perMillionTokens: 6, currency: 'USD' } }
})
const patch = vi.fn().mockResolvedValue(provider)

describe('provider billing draft', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
    Element.prototype.scrollIntoView = () => {}
  })
  beforeEach(() => {
    patch.mockClear()
    MockUseDataApiUtils.mockQueryData('/models', [model])
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/providers/:providerId', patch)
  })
  afterEach(cleanup)

  it('keeps edits private until Save and discards Cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const view = render(<ProviderBillingDrawer provider={provider} onClose={onClose} />)
    const multiplier = screen.getByRole('spinbutton', { name: 'Default multiplier' })
    await user.clear(multiplier)
    await user.type(multiplier, '3')
    expect(patch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(patch).not.toHaveBeenCalled()
    view.unmount()
    render(<ProviderBillingDrawer provider={provider} onClose={onClose} />)
    expect(screen.getByRole('spinbutton', { name: 'Default multiplier' })).toHaveValue(2)
    await user.click(screen.getByRole('combobox', { name: 'UTC offset' }))
    await user.click(screen.getByRole('option', { name: 'UTC+05:45' }))
    await user.click(screen.getByRole('switch', { name: 'Time-based pricing' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith({
        params: { providerId: 'group' },
        body: {
          providerSettings: {
            billing: {
              ...provider.settings.billing,
              timeZone: '+05:45',
              scheduleEnabled: false,
              periods: [{ ...provider.settings.billing!.periods[0], name: '22:00–06:00' }]
            }
          }
        }
      })
    )
  })

  it('selects whole hours, blocks equal times and overlap, and previews unit prices only', async () => {
    const user = userEvent.setup()
    render(<ProviderBillingDrawer provider={provider} onClose={() => {}} />)
    const end = screen.getByRole('button', { name: 'End time' })
    await user.click(end)
    const hours = screen.getByRole('listbox', { name: 'Hour' })
    expect(
      within(hours)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(Array.from({ length: 25 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`))
    await user.click(within(hours).getByRole('option', { name: '22:00' }))
    expect(screen.getByText('Start and end must differ.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(within(hours).getByRole('option', { name: '06:00' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    const preview = screen.getByRole('region', { name: 'Unit price preview' })
    const night = within(preview).getByRole('row', { name: '22:00–06:00 1 3 1 1' })
    expect(night).toBeVisible()
    expect(within(preview).getByRole('row', { name: '06:00–22:00 4 12 4 4' })).toBeVisible()
    expect(within(preview).getByText('USD / M Tokens')).toBeVisible()
    expect(within(preview).queryByRole('spinbutton')).not.toBeInTheDocument()
    await user.click(end)
    await user.click(within(screen.getByRole('listbox', { name: 'Hour' })).getByRole('option', { name: '24:00' }))
    expect(end).toHaveTextContent('24:00')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    const start = screen.getByRole('button', { name: 'Start time' })
    await user.click(start)
    expect(
      within(screen.getByRole('listbox', { name: 'Hour' })).queryByRole('option', { name: '24:00' })
    ).not.toBeInTheDocument()
    await user.keyboard('{End}')
    expect(start).toHaveTextContent('23:00')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await user.click(screen.getByRole('button', { name: 'Add period' }))
    expect(screen.getAllByText('Periods must not overlap.')[0]).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('resets only billing when saved', async () => {
    const user = userEvent.setup()
    render(<ProviderBillingDrawer provider={provider} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(patch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith({
        params: { providerId: 'group' },
        body: { providerSettings: { billing: null } }
      })
    )
  })
})
