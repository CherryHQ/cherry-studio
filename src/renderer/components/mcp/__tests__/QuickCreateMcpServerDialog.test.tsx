import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { McpServer } from '@shared/data/types/mcpServer'

import QuickCreateMcpServerDialog from '../QuickCreateMcpServerDialog'

const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))

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
  const { rerender } = render(
    <QuickCreateMcpServerDialog open onOpenChange={onOpenChange} existingServers={existing} onCreate={onCreate} />
  )
  const setOpen = (open: boolean) =>
    rerender(
      <QuickCreateMcpServerDialog
        open={open}
        onOpenChange={onOpenChange}
        existingServers={existing}
        onCreate={onCreate}
      />
    )

  return { onCreate, onOpenChange, setOpen, user: userEvent.setup() }
}

const submit = () => screen.getByRole('button', { name: 'common.add' })

describe('QuickCreateMcpServerDialog', () => {
  it('marks the current required fields', async () => {
    const { user } = setup()

    expect(screen.getByLabelText('settings.mcp.name')).toBeRequired()
    expect(screen.getByLabelText('settings.mcp.command')).toBeRequired()
    expect(screen.getByText('settings.mcp.name').closest('label')).toHaveAttribute('required')
    expect(screen.getByText('settings.mcp.type').closest('label')).toHaveAttribute('required')
    expect(screen.getByText('settings.mcp.command').closest('label')).toHaveAttribute('required')

    await user.click(screen.getByRole('button', { name: 'settings.mcp.sse' }))

    expect(screen.getByLabelText('settings.mcp.url')).toBeRequired()
    expect(screen.getByText('settings.mcp.url').closest('label')).toHaveAttribute('required')
  })

  it('blocks submission until the required fields are filled', async () => {
    const { onCreate, user } = setup()

    await user.click(submit())

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('creates a stdio server with args available before the advanced section', async () => {
    const { onCreate, onOpenChange, user } = setup()

    await user.type(screen.getByLabelText('settings.mcp.name'), 'my-server')
    await user.type(screen.getByLabelText('settings.mcp.command'), 'npx')
    await user.type(screen.getByLabelText('settings.mcp.args'), '-y{enter}mcp-server-example')

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

  it('rejects a whitespace-only name with inline validation', async () => {
    const { onCreate, user } = setup()

    await user.type(screen.getByLabelText('settings.mcp.name'), '   ')
    await user.type(screen.getByLabelText('settings.mcp.command'), 'npx')
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent('common.name')
    expect(onCreate).not.toHaveBeenCalled()
  })

  // The modal traps focus, so a Details entry that only lives in the global toast is unreachable by keyboard.
  it('keeps the dialog open with keyboard-reachable Details for a create failure', async () => {
    const failure = new Error('registry down')
    const { onCreate, onOpenChange, user } = setup(vi.fn().mockRejectedValue(failure))

    await user.type(screen.getByLabelText('settings.mcp.name'), 'new-server')
    await user.type(screen.getByLabelText('settings.mcp.command'), 'npx')
    await user.click(submit())

    const dialog = screen.getByRole('dialog')
    const notice = await within(dialog).findByText('settings.mcp.addError')
    expect(notice).not.toHaveTextContent('registry down')
    within(dialog).getByRole('button', { name: 'common.detail' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(detailMocks.open).toHaveBeenCalledWith(
        expect.objectContaining({
          localizedErrorMessage: 'settings.mcp.addError',
          context: expect.objectContaining({
            message: 'registry down',
            source: 'settings.mcp',
            operation: 'mcp.server.create',
            recordId: 'new-server'
          })
        })
      )
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('shows why the server was rejected instead of offering it as a fault', async () => {
    const rejection = DataApiErrorFactory.conflict('MCP server name already exists')
    const { onOpenChange, user } = setup(vi.fn().mockRejectedValue(rejection))

    await user.type(screen.getByLabelText('settings.mcp.name'), 'new-server')
    await user.type(screen.getByLabelText('settings.mcp.command'), 'npx')
    await user.click(submit())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith({
        title: 'settings.mcp.addError',
        description: 'MCP server name already exists',
        data: { suppressDetail: true }
      })
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('resets registry options when reopened', async () => {
    const { setOpen, user } = setup()

    await user.type(screen.getByLabelText('settings.mcp.command'), 'npx')
    await user.click(screen.getByText('settings.mcp.addServer.advanced'))
    expect(screen.getByText('settings.mcp.registry')).toBeInTheDocument()

    setOpen(false)
    setOpen(true)
    await user.click(screen.getByText('settings.mcp.addServer.advanced'))

    expect(screen.getByLabelText('settings.mcp.command')).toHaveValue('')
    expect(screen.queryByText('settings.mcp.registry')).not.toBeInTheDocument()
  })

  it('clears the selected registry when switching command families', async () => {
    const { onCreate, user } = setup()

    await user.type(screen.getByLabelText('settings.mcp.name'), 'python-server')
    const commandInput = screen.getByLabelText('settings.mcp.command')
    await user.type(commandInput, 'npx')
    await user.click(screen.getByText('settings.mcp.addServer.advanced'))
    await user.click(screen.getByRole('radio', { name: 'settings.mcp.registryOptions.npmTaobao' }))
    expect(screen.getByTestId('radio-group')).toHaveAttribute('data-value', 'https://registry.npmmirror.com')

    await user.clear(commandInput)
    await user.type(commandInput, 'uvx')
    await user.click(submit())

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'uvx',
        registryUrl: ''
      })
    )
  })
})
