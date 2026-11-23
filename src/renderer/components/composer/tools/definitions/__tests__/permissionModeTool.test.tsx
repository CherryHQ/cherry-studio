import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TFunction } from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'

// The global renderer UI stand-in closes ConfirmDialog unconditionally on
// confirm; the no-agent case needs the real return-false-keeps-open contract.
vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

const mocks = vi.hoisted(() => ({
  registerLaunchers: vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => () => undefined),
  updateAgent: vi.fn(),
  ipcRequest: vi.fn(),
  toastError: vi.fn(),
  permissionMode: 'default',
  agent: { id: 'agent-1', name: 'Support Bot' } as { id: string; name: string } | undefined
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({
    agent: mocks.agent ? { ...mocks.agent, configuration: { permission_mode: mocks.permissionMode } } : undefined
  }),
  useUpdateAgent: () => ({ updateAgent: mocks.updateAgent })
}))

import permissionModeTool from '../permissionModeTool'

const t = ((key: string, fallback?: string) => fallback ?? key) as unknown as TFunction

const renderLauncher = () => {
  const Runtime = permissionModeTool.composer!.runtime!
  const context = {
    t,
    launcher: { registerLaunchers: mocks.registerLaunchers },
    session: { agentId: 'agent-1' }
  }

  render(<Runtime context={context as any} />)

  const launchers = mocks.registerLaunchers.mock.calls.at(-1)?.[0] ?? []
  return launchers[0]
}

const renderRuntime = () => renderLauncher()?.submenu ?? []

describe('permissionModeTool submenu', () => {
  afterEach(async () => {
    cleanup()
    // Radix restores focus in a deferred task, before this jsdom environment is disposed.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  beforeEach(() => {
    mocks.registerLaunchers.mockClear()
    mocks.updateAgent.mockClear()
    mocks.ipcRequest.mockReset().mockResolvedValue(null)
    mocks.toastError.mockClear()
    mocks.permissionMode = 'default'
    mocks.agent = { id: 'agent-1', name: 'Support Bot' }
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
    const context = { t, launcher: { registerLaunchers: mocks.registerLaunchers }, session: { agentId: 'agent-1' } }
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

  it('mounts only when a local agent offers unified permission modes', () => {
    const codexMode = {
      id: 'codex-mode',
      currentValue: 'workspace',
      options: [
        { value: 'readOnly', name: 'Read Only' },
        { value: 'workspace', name: 'Workspace' },
        { value: 'fullAccess', name: 'Full Access' }
      ]
    }
    const piMode = {
      id: 'mode',
      currentValue: 'medium',
      options: [
        { value: 'off', name: 'Thinking: off' },
        { value: 'medium', name: 'Thinking: medium' }
      ]
    }

    expect(
      permissionModeTool.condition?.({
        scope: 'session',
        session: { agentId: 'a1', sessionId: 's1', agentType: 'local', localPermission: { mode: codexMode } }
      } as any)
    ).toBe(true)
    expect(
      permissionModeTool.condition?.({
        scope: 'session',
        session: {
          agentId: 'a2',
          sessionId: 's2',
          agentType: 'local',
          localPermission: { mode: piMode, presetId: 'pi-acp' }
        }
      } as any)
    ).toBe(false)
    expect(
      permissionModeTool.condition?.({
        scope: 'session',
        session: { agentId: 'a3', sessionId: 's3', agentType: 'local', localPermission: {} }
      } as any)
    ).toBe(false)
  })

  it('exposes plan inside local submenu, maps canonical picks back to native values, and guards streaming/high-risk', async () => {
    const user = userEvent.setup()
    mocks.agent = { id: 'agent-local', name: 'ZCode Local' }
    const Runtime = permissionModeTool.composer!.runtime!
    const zcodeMode = {
      id: 'mode',
      currentValue: 'build',
      options: [
        { value: 'plan', name: 'plan' },
        { value: 'build', name: 'build' },
        { value: 'edit', name: 'edit' },
        { value: 'guarded', name: 'guarded' },
        { value: 'yolo', name: 'yolo' }
      ]
    }
    const context = {
      t,
      launcher: { registerLaunchers: mocks.registerLaunchers },
      session: {
        agentId: 'agent-local',
        sessionId: 'session-zcode',
        agentType: 'local',
        localPermission: { mode: zcodeMode, presetId: 'zcode', disabled: false }
      }
    }

    const { rerender } = render(<Runtime context={context as any} />)
    const launchers = mocks.registerLaunchers.mock.calls.at(-1)?.[0] ?? []
    const permission = launchers.find((item) => item.id === 'permission-mode')
    const submenu = permission?.submenu ?? []
    expect(submenu.map((item) => item.id)).toEqual([
      'permission-mode-plan',
      'permission-mode-default',
      'permission-mode-acceptEdits',
      'permission-mode-bypassPermissions'
    ])
    expect(submenu.find((item) => item.id === 'permission-mode-acceptEdits')?.active).toBe(true)

    submenu.find((item) => item.id === 'permission-mode-default')?.action?.({} as any)
    expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.local_agents.set_mode', {
      sessionId: 'session-zcode',
      configId: 'mode',
      value: 'guarded'
    })

    mocks.ipcRequest.mockClear()
    submenu.find((item) => item.id === 'permission-mode-plan')?.action?.({} as any)
    expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.local_agents.set_mode', {
      sessionId: 'session-zcode',
      configId: 'mode',
      value: 'plan'
    })

    // High-risk mode requires confirmation and sends native 'yolo' only when confirmed.
    mocks.ipcRequest.mockClear()
    submenu.find((item) => item.id === 'permission-mode-bypassPermissions')?.action?.({} as any)
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toHaveTextContent('ZCode Local')
    await user.click(screen.getByRole('button', { name: 'Enable Full Access' }))
    expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.local_agents.set_mode', {
      sessionId: 'session-zcode',
      configId: 'mode',
      value: 'yolo'
    })

    // Streaming disables submenu choices and blocks mode switches.
    mocks.ipcRequest.mockClear()
    rerender(
      <Runtime
        context={
          {
            ...context,
            session: {
              ...context.session,
              localPermission: { mode: zcodeMode, presetId: 'zcode', disabled: true }
            }
          } as any
        }
      />
    )
    const disabledSubmenu = mocks.registerLaunchers.mock.calls.at(-1)?.[0]?.[0]?.submenu ?? []
    expect(disabledSubmenu.every((item) => item.disabled === true)).toBe(true)
    disabledSubmenu.find((item) => item.id === 'permission-mode-default')?.action?.({} as any)
    expect(mocks.ipcRequest).not.toHaveBeenCalled()

    // Config-backed permissions (e.g. MiniMax / Amp) dispatch set_config_option instead of set_mode.
    mocks.ipcRequest.mockClear()
    const ampConfigPermission = {
      id: 'permissions',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'bypass', name: 'Bypass' }
      ]
    }
    rerender(
      <Runtime
        context={
          {
            ...context,
            session: {
              agentId: 'agent-amp',
              sessionId: 'session-amp',
              agentType: 'local',
              localPermission: { mode: ampConfigPermission, kind: 'config', presetId: 'amp-acp', disabled: false }
            }
          } as any
        }
      />
    )
    const ampSubmenu = mocks.registerLaunchers.mock.calls.at(-1)?.[0]?.[0]?.submenu ?? []
    expect(ampSubmenu.map((item) => item.id)).toEqual(['permission-mode-default', 'permission-mode-bypassPermissions'])
    act(() => {
      ampSubmenu.find((item) => item.id === 'permission-mode-bypassPermissions')?.action?.({} as any)
    })
    await user.click(await screen.findByRole('button', { name: 'Enable Full Access' }))
    expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
      sessionId: 'session-amp',
      configId: 'permissions',
      value: 'bypass'
    })
  })
})
