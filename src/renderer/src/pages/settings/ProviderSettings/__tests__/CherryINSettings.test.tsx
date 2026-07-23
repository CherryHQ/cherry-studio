import { CHERRYIN_HOSTS } from '@shared/config/cherryin'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CherryINSettings from '../CherryINSettings'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { url?: string }) => (values?.url ? `${key}: ${values.url}` : key)
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
    const previewUrl = `${CHERRYIN_HOSTS.china}/v1/chat/completions`

    render(<CherryINSettings previewUrl={previewUrl} setApiHost={setApiHost} />)

    await waitFor(() => {
      expect(setApiHost).toHaveBeenCalledWith(CHERRYIN_HOSTS.china)
    })
    expect(screen.getByText(`settings.provider.api_host_preview: ${previewUrl}`)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })
})
