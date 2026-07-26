import type { McpServer } from '@shared/data/types/mcpServer'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import QuickCreateMcpServerDialog from '../QuickCreateMcpServerDialog'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

const existing = [{ id: '1', name: 'taken' }] as McpServer[]

function setup(onCreate = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn()
  render(<QuickCreateMcpServerDialog open onOpenChange={onOpenChange} existingServers={existing} onCreate={onCreate} />)
  return { onCreate, onOpenChange, user: userEvent.setup() }
}

const submit = () => screen.getByRole('button', { name: 'common.add' })

describe('QuickCreateMcpServerDialog', () => {
  it('blocks submission until the required fields are filled', async () => {
    const { onCreate, user } = setup()

    await user.click(submit())

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('creates a stdio server, splitting args from the advanced section', async () => {
    const { onCreate, onOpenChange, user } = setup()

    await user.type(screen.getByLabelText('settings.mcp.name'), 'my-server')
    await user.type(screen.getByLabelText('settings.mcp.command'), 'npx')

    await user.click(screen.getByText('settings.mcp.addServer.advanced'))
    await user.type(await screen.findByLabelText('settings.mcp.args'), '-y{enter}mcp-server-example')

    await user.click(submit())

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-server',
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'mcp-server-example'],
        isActive: false,
        installSource: 'manual'
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('rejects a duplicate name instead of creating', async () => {
    const { onCreate, user } = setup()

    await user.type(screen.getByLabelText('settings.mcp.name'), 'taken')
    await user.type(screen.getByLabelText('settings.mcp.command'), 'npx')
    await user.click(submit())

    expect(await screen.findByText('settings.mcp.addServer.importFrom.nameExists')).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
