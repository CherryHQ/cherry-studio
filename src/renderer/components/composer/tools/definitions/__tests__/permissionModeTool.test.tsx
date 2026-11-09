import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { QuickPanelRow } from '@renderer/components/QuickPanel'

// The global renderer UI stand-in closes ConfirmDialog unconditionally on
// confirm; the no-agent case needs the real return-false-keeps-open contract.
vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

const mocks = vi.hoisted(() => ({
  registerLaunchers: vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => () => undefined),
  updateAgent: vi.fn(),
  permissionMode: 'default',
  streamStatus: undefined as string | undefined,
  agent: { id: 'agent-1', name: 'Support Bot' } as { id: string; name: string } | undefined
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({
    agent: mocks.agent ? { ...mocks.agent, configuration: { permission_mode: mocks.permissionMode } } : undefined
  }),
  useUpdateAgent: () => ({ updateAgent: mocks.updateAgent })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: (topicId: string) => ({
    status: topicId === 'agent-session:session-1' ? mocks.streamStatus : undefined
  })
}))

import permissionModeTool from '../permissionModeTool'

const t = ((key: string, fallback?: string) => fallback ?? key) as unknown as TFunction

const renderLauncher = () => {
  const Runtime = permissionModeTool.composer!.runtime!
  const context = {
    t,
    launcher: { registerLaunchers: mocks.registerLaunchers },
    session: { agentId: 'agent-1', sessionId: 'session-1' }
  }

  render(<Runtime context={context as any} />)

  const launchers = mocks.registerLaunchers.mock.calls.at(-1)?.[0] ?? []
  return launchers[0]
}

const renderRuntime = () => renderLauncher()?.submenu ?? []

describe('permissionModeTool submenu', () => {
  beforeEach(() => {
    mocks.registerLaunchers.mockClear()
    mocks.updateAgent.mockClear()
    mocks.permissionMode = 'default'
    mocks.streamStatus = undefined
    mocks.agent = { id: 'agent-1', name: 'Support Bot' }
  })

  it('keeps the current mode in the description so the submenu indicator remains visible', () => {
    const launcher = renderLauncher()

    expect(launcher?.description).toBe('Ask Before Acting')
    expect(launcher?.suffix).toBeUndefined()
    expect(launcher?.submenu).not.toHaveLength(0)

    const { container } = render(
      <QuickPanelRow
        active={false}
        item={{
          label: launcher.label,
          description: launcher.description,
          isMenu: true
        }}
        onSelect={vi.fn()}
      />
    )
    expect(container.querySelector('.lucide-chevron-right')).toBeInTheDocument()
  })

  it('keeps the live permission mode in the pinned toolbar tooltip', () => {
    const Runtime = permissionModeTool.composer!.runtime!
    const context = {
      t,
      launcher: { registerLaunchers: mocks.registerLaunchers },
      session: { agentId: 'agent-1', sessionId: 'session-1' }
    }
    const { rerender } = render(<Runtime context={context as any} />)

    expect(mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]?.tooltip).toBe('Permission Mode · Ask Before Acting')

    mocks.permissionMode = 'bypassPermissions'
    rerender(<Runtime context={context as any} />)

    expect(mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]?.tooltip).toBe('Permission Mode · Full Access')
  })

  it('offers planning as a root toggle instead of a permission submenu choice', () => {
    renderLauncher()
    const launchers = mocks.registerLaunchers.mock.calls.at(-1)?.[0] ?? []
    const permission = launchers.find((item) => item.id === 'permission-mode')
    const plan = launchers.find((item) => item.id === 'plan-mode')
    expect(permission?.submenu?.some((item) => item.id === 'permission-mode-plan')).toBe(false)
    expect(plan?.sources).toEqual(['popover', 'root-panel'])
    expect(plan?.active).toBe(false)
    plan?.action?.({} as any)
    expect(mocks.updateAgent).toHaveBeenCalledWith(
      { id: 'agent-1', configuration: { permission_mode: 'plan' } },
      { showSuccessToast: false }
    )
  })

  it('returns to ordinary approval when the active root plan toggle is selected', () => {
    mocks.permissionMode = 'plan'
    renderLauncher()
    const plan = mocks.registerLaunchers.mock.calls.at(-1)?.[0].find((item) => item.id === 'plan-mode')
    expect(plan?.active).toBe(true)
    plan?.action?.({} as any)
    expect(mocks.updateAgent).toHaveBeenCalledWith(
      { id: 'agent-1', configuration: { permission_mode: 'default' } },
      { showSuccessToast: false }
    )
  })

  // The quick panel row is a fixed-height single line: a stacked warning under the title
  // overflows it and collides with the neighbouring rows.
  it('keeps the caveat out of permanent copy and exposes it as row metadata', () => {
    const submenu = renderRuntime()
    const auto = submenu.find((item) => item.id === 'permission-mode-auto')
    expect(auto).toBeDefined()

    render(<>{auto!.label}</>)
    expect(screen.queryByText(/Needs a model/)).not.toBeInTheDocument()

    render(<>{auto!.description}</>)
    expect(screen.queryByText(/Needs a model/)).not.toBeInTheDocument()
    expect(auto?.tooltip).toBe('Needs a model that supports it; others may ignore it or keep asking.')

    render(<QuickPanelRow active item={auto!} onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Needs a model/ })).toBeInTheDocument()
  })

  it('holds Full Access behind a scope confirmation instead of persisting it from the submenu', async () => {
    const user = userEvent.setup()
    const submenu = renderRuntime()
    const fullAccess = submenu.find((item) => item.id === 'permission-mode-bypassPermissions')
    expect(fullAccess).toBeDefined()

    fullAccess?.action?.({} as any)

    expect(mocks.updateAgent).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Enable Full Access?')).toBeInTheDocument()
    expect(screen.getByText('Support Bot')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Enable Full Access' }))

    expect(mocks.updateAgent).toHaveBeenCalledTimes(1)
    expect(mocks.updateAgent).toHaveBeenCalledWith(
      { id: 'agent-1', configuration: { permission_mode: 'bypassPermissions' } },
      { showSuccessToast: false }
    )
  })

  it('persists other modes from the submenu without a confirmation', () => {
    const submenu = renderRuntime()
    const auto = submenu.find((item) => item.id === 'permission-mode-auto')
    expect(auto).toBeDefined()

    auto?.action?.({} as any)

    expect(mocks.updateAgent).toHaveBeenCalledWith(
      { id: 'agent-1', configuration: { permission_mode: 'auto' } },
      { showSuccessToast: false }
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('drops a pending Full Access confirmation when another mode is chosen', async () => {
    const submenu = renderRuntime()
    submenu.find((item) => item.id === 'permission-mode-bypassPermissions')?.action?.({} as any)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    submenu.find((item) => item.id === 'permission-mode-auto')?.action?.({} as any)

    expect(mocks.updateAgent).toHaveBeenCalledTimes(1)
    expect(mocks.updateAgent).toHaveBeenCalledWith(
      { id: 'agent-1', configuration: { permission_mode: 'auto' } },
      { showSuccessToast: false }
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('drops a pending Full Access confirmation when a newer restrictive mode arrives', async () => {
    mocks.permissionMode = 'auto'
    const Runtime = permissionModeTool.composer!.runtime!
    const context = {
      t,
      launcher: { registerLaunchers: mocks.registerLaunchers },
      session: { agentId: 'agent-1', sessionId: 'session-1' }
    }
    const { rerender } = render(<Runtime context={context as any} />)
    const submenu = mocks.registerLaunchers.mock.calls.at(-1)?.[0]?.[0]?.submenu ?? []
    submenu.find((item) => item.id === 'permission-mode-bypassPermissions')?.action?.({} as any)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    mocks.permissionMode = 'plan'
    rerender(<Runtime context={context as any} />)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Enable Full Access' })).not.toBeInTheDocument()
    expect(mocks.updateAgent).not.toHaveBeenCalled()
  })

  it('keeps the confirmation open when there is no agent to apply it to', async () => {
    const user = userEvent.setup()
    mocks.agent = undefined
    const submenu = renderRuntime()
    submenu.find((item) => item.id === 'permission-mode-bypassPermissions')?.action?.({} as any)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Enable Full Access' }))

    expect(mocks.updateAgent).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  describe('while the session runs a turn', () => {
    it.each(['streaming', 'awaiting-approval'])(
      'holds a mode switch behind an immediate-effect confirmation (%s)',
      async (status) => {
        const user = userEvent.setup()
        mocks.streamStatus = status
        renderRuntime()
          .find((item) => item.id === 'permission-mode-auto')
          ?.action?.({} as any)

        expect(mocks.updateAgent).not.toHaveBeenCalled()
        expect(await screen.findByRole('dialog')).toBeInTheDocument()
        expect(screen.getByText('Switch permission mode now?')).toBeInTheDocument()
        expect(screen.getByText('Support Bot')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Switch Now' }))

        expect(mocks.updateAgent).toHaveBeenCalledTimes(1)
        expect(mocks.updateAgent).toHaveBeenCalledWith(
          { id: 'agent-1', configuration: { permission_mode: 'auto' } },
          { showSuccessToast: false }
        )
      }
    )

    it('keeps the current mode when the confirmation is cancelled', async () => {
      const user = userEvent.setup()
      mocks.streamStatus = 'streaming'
      renderLauncher()
      mocks.registerLaunchers.mock.calls
        .at(-1)?.[0]
        .find((item) => item.id === 'plan-mode')
        ?.action?.({} as any)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mocks.updateAgent).not.toHaveBeenCalled()
    })

    it('shows only the Full Access confirmation for Full Access', async () => {
      mocks.streamStatus = 'streaming'
      renderRuntime()
        .find((item) => item.id === 'permission-mode-bypassPermissions')
        ?.action?.({} as any)

      expect(await screen.findAllByRole('dialog')).toHaveLength(1)
      expect(screen.getByText('Enable Full Access?')).toBeInTheDocument()
      expect(screen.queryByText('Switch permission mode now?')).not.toBeInTheDocument()
    })
  })
})
