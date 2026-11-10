import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.unmock('@cherrystudio/ui')
vi.unmock('react-i18next')

import McpInstructions from '../McpInstructions'

const i18n = createInstance()
await i18n.init({
  lng: 'en-US',
  keySeparator: false,
  resources: { 'en-US': { translation: en } },
  interpolation: { escapeValue: false }
})

const panel = (serverId = 'docs') => (
  <I18nextProvider i18n={i18n}>
    <McpInstructions serverId={serverId} connectionState="connected" />
  </I18nextProvider>
)

describe('MCP instructions panel', () => {
  beforeEach(() => request.mockReset())

  it('shows source and truncation, rendering remote HTML as text', async () => {
    request.mockResolvedValue({
      serverId: 'docs',
      serverName: 'Documents',
      text: '<script>remote()</script>',
      truncated: true
    })
    render(panel())
    expect(await screen.findByText('<script>remote()</script>')).toBeVisible()
    expect(screen.getByText(en['settings.mcp.instructions.truncated'])).toBeVisible()
    expect(screen.getByText(en['settings.mcp.instructions.source'].replace('{{name}}', 'Documents'))).toBeVisible()
  })

  it('can retry a failed read rather than reporting an empty catalog', async () => {
    request.mockRejectedValueOnce(new Error('IPC disconnected')).mockResolvedValueOnce(undefined)
    render(panel())
    expect(await screen.findByText(en['common.error'])).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: en['common.refresh'] }))
    expect(await screen.findByText(en['settings.mcp.instructions.empty'])).toBeVisible()
  })

  it('ignores a late response from the previously selected server', async () => {
    let finish!: (value: unknown) => void
    request
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      .mockResolvedValueOnce({
        serverId: 'new',
        serverName: 'New server',
        text: 'Current guidance',
        truncated: false
      })
    const view = render(panel())
    view.rerender(panel('new'))
    expect(await screen.findByText('Current guidance')).toBeVisible()
    finish({ serverId: 'docs', serverName: 'Old server', text: 'Stale guidance', truncated: false })
    await Promise.resolve()
    expect(screen.queryByText('Stale guidance')).not.toBeInTheDocument()
    expect(screen.getByText('Current guidance')).toBeVisible()
  })
})
