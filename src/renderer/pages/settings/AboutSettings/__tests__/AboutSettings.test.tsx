import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('@renderer/hooks/useAppUpdateState', () => ({
  useAppUpdateState: () => ({
    appUpdateState: {
      available: false,
      checking: false,
      downloaded: false,
      downloading: false,
      downloadProgress: 0,
      info: null
    },
    updateAppUpdateState: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() })
}))

vi.mock('@renderer/hooks/useOpenReleaseNotes', () => ({
  useOpenReleaseNotes: () => vi.fn()
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/components/UpdateDialogPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('../DiagnosticBundleDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>diagnostic-dialog-open</div> : null)
}))

vi.mock('../../FeedbackDialog', () => ({
  FeedbackDialog: () => null
}))

import { AboutSettings } from '..'

describe('AboutSettings diagnostics entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'app.get_info') return { isPortable: false, version: '2.0.0' }
      return undefined
    })
  })

  it('places diagnostics next to the debug panel and opens the export dialog', async () => {
    const user = userEvent.setup()
    render(<AboutSettings />)
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('app.get_info'))

    const diagnostics = screen.getByRole('button', { name: 'settings.about.diagnostics.entry.button' })
    const debug = screen.getByRole('button', { name: 'settings.about.debug.open' })
    const buttons = screen.getAllByRole('button')
    expect(buttons.indexOf(debug)).toBe(buttons.indexOf(diagnostics) + 1)

    await user.click(diagnostics)
    expect(screen.getByText('diagnostic-dialog-open')).toBeInTheDocument()
  })
})
