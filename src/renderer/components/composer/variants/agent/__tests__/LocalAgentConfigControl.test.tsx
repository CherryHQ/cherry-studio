import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { LocalAgentConfigOption } from '@shared/ai/localAgent'

import { LocalAgentConfigControl } from '../LocalAgentConfigControl'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const options: LocalAgentConfigOption[] = [
  {
    id: 'detail',
    name: 'Answer detail',
    description: 'Response length',
    type: 'select',
    currentValue: 'brief',
    options: [
      {
        group: 'levels',
        name: 'Detail levels',
        options: [
          { value: 'brief', name: 'Brief' },
          { value: 'full', name: 'Detailed', description: 'Include explanation' }
        ]
      }
    ]
  },
  { id: 'notify', name: 'Notifications', type: 'boolean', currentValue: false }
]
beforeEach(() => {
  vi.mocked(ipcApi.request).mockReset()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('LocalAgentConfigControl', () => {
  it('renders native descriptions and groups, and applies only confirmed selections', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    const { rerender } = render(<LocalAgentConfigControl sessionId="session" options={options} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.getByText('Response length')).toBeVisible()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Answer detail' }), { key: 'ArrowDown' })
    expect(screen.getByText('Detail levels')).toBeVisible()
    fireEvent.click(screen.getByRole('option', { name: 'Detailed Include explanation' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'detail',
        value: 'full'
      })
    )
    expect(screen.getByRole('combobox', { name: 'Answer detail' })).toHaveTextContent('Brief')
    rerender(
      <LocalAgentConfigControl
        sessionId="session"
        options={[{ ...options[0], currentValue: 'full' } as LocalAgentConfigOption, options[1]]}
        disabled={false}
      />
    )
    expect(screen.getByRole('combobox', { name: 'Answer detail' })).toHaveTextContent('Detailed')
    rerender(<LocalAgentConfigControl sessionId="session" options={[]} disabled={false} />)
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('sends boolean values and blocks duplicate changes while saving', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockReturnValue(new Promise(() => {}))
    render(<LocalAgentConfigControl sessionId="session" options={options} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('switch', { name: 'Notifications' }))
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
      sessionId: 'session',
      configId: 'notify',
      value: true
    })
  })

  it('keeps advertised settings read-only while a turn is running', async () => {
    const user = userEvent.setup()
    render(<LocalAgentConfigControl sessionId="session" options={options} disabled />)
    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
