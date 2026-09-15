import { render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { QuickPanelRow } from '@renderer/components/QuickPanel'

const mocks = vi.hoisted(() => ({
  registerLaunchers: vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => () => undefined),
  updateAgent: vi.fn(),
  permissionMode: 'default'
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: { id: 'agent-1', configuration: { permission_mode: mocks.permissionMode } } }),
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
  beforeEach(() => {
    mocks.registerLaunchers.mockClear()
    mocks.permissionMode = 'default'
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
      session: { agentId: 'agent-1' }
    }
    const { rerender } = render(<Runtime context={context as any} />)

    expect(mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]?.tooltip).toBe('Permission Mode · Ask Before Acting')

    mocks.permissionMode = 'bypassPermissions'
    rerender(<Runtime context={context as any} />)

    expect(mocks.registerLaunchers.mock.calls.at(-1)?.[0][0]?.tooltip).toBe('Permission Mode · Full Access')
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
})
