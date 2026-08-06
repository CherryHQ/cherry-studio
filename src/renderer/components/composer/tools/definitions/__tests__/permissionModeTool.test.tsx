import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { QuickPanelRow } from '@renderer/components/QuickPanel'
import { render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerLaunchers: vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => () => undefined),
  updateAgent: vi.fn()
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: { id: 'agent-1', configuration: { permission_mode: 'default' } } }),
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
          label: launcher!.label,
          description: launcher!.description,
          isMenu: true
        }}
        onSelect={vi.fn()}
      />
    )
    expect(container.querySelector('.lucide-chevron-right')).toBeInTheDocument()
  })

  // The quick panel row is a fixed 30px single line: a stacked warning under the title
  // overflows it and collides with the neighbouring rows.
  it('keeps the caveat out of the label and shows it in the description column', () => {
    const submenu = renderRuntime()
    const auto = submenu.find((item) => item.id === 'permission-mode-auto')
    expect(auto).toBeDefined()

    render(<>{auto!.label}</>)
    expect(screen.queryByText(/Needs a model/)).not.toBeInTheDocument()

    render(<>{auto!.description}</>)
    expect(screen.getByText(/Needs a model/)).toBeInTheDocument()
  })
})
