import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn(), error: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.error } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => `localized:${key}` }) }))
vi.mock('../../hooks/useCopyToClipboard', () => ({ useCopyToClipboard: () => [false, vi.fn()] }))
vi.mock('../../primitives/ProviderSettingsPrimitives', () => ({ ProviderHelpLink: ({ children }: any) => children }))
vi.mock('@cherrystudio/ui', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }))

import ClaudeCodeSettings from '../ClaudeCodeSettings'
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
describe('Claude login terminal errors', () => {
  it.each(['C:\\Tools\\claude.exe crashed: switch to the managed binary', ''])(
    'keeps a localized headline and exact service diagnostic: %s',
    async (message) => {
      mocks.request.mockImplementation(async (route: string) => {
        if (route === 'oauth.check_external_login') return false
        if (route === 'app.get_info') return { homePath: '/home/test' }
        if (route === 'code_cli.run') return { success: false, message }
        throw new Error(`Unexpected route ${route}`)
      })
      render(<ClaudeCodeSettings providerId="claude-code" />)
      fireEvent.click(await screen.findByText('localized:settings.provider.claude_code.open_terminal'))
      await waitFor(() =>
        expect(mocks.error).toHaveBeenCalledWith({
          title: 'localized:settings.provider.claude_code.launch_failed',
          details: message
        })
      )
    }
  )
  it('uses the localized fallback when IPC throws', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'oauth.check_external_login') return false
      if (route === 'app.get_info') return { homePath: '/home/test' }
      throw new Error('IPC unavailable')
    })
    render(<ClaudeCodeSettings providerId="claude-code" />)
    fireEvent.click(await screen.findByText('localized:settings.provider.claude_code.open_terminal'))
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('localized:settings.provider.claude_code.launch_failed')
    )
  })
})
