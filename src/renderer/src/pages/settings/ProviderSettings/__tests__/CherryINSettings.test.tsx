import { CHERRYIN_HOSTS } from '@shared/config/cherryin'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CherryINSettings from '../CherryINSettings'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { host?: string }) => (values?.host ? `${key}: ${values.host}` : key)
  })
}))

describe('CherryINSettings', () => {
  const getEndpointSelection = vi.fn()
  const setHostMode = vi.fn()

  beforeEach(() => {
    getEndpointSelection.mockReset().mockResolvedValue({
      host: CHERRYIN_HOSTS.china,
      mode: 'auto',
      source: 'probe'
    })
    setHostMode.mockReset()
    window.api.cherryin = {
      ...window.api.cherryin,
      getEndpointSelection,
      setHostMode
    }
  })

  it('loads and displays the process-wide endpoint selection', async () => {
    const setApiHost = vi.fn()

    render(<CherryINSettings apiHost={CHERRYIN_HOSTS.global} setApiHost={setApiHost} />)

    await waitFor(() => {
      expect(setApiHost).toHaveBeenCalledWith(CHERRYIN_HOSTS.china)
    })
    expect(screen.getByText(`settings.provider.cherryin_route.current: ${CHERRYIN_HOSTS.china}`)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })
})
