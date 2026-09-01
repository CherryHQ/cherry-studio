import { CodeCli } from '@shared/types/codeCli'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CodeCliSidebar, type CodeCliSidebarProps } from '../CodeCliSidebar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  // oxlint-disable-next-line consistent-type-imports
  ...(await importOriginal<typeof import('@cherrystudio/ui')>()),
  Scrollbar: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/icons/CliIcon', () => ({
  CliIcon: ({ id }: { id: string }) => <span data-testid={`cli-icon-${id}`} />
}))

type MockMenuItem = { id: string; label: string; onSelect: () => void }

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children, extraItems }: { children: ReactNode; extraItems: readonly MockMenuItem[] }) => (
    <div>
      {children}
      {extraItems.map((item) => (
        <button key={item.id} type="button" aria-label={`context:${item.label}`} onClick={item.onSelect} />
      ))}
    </div>
  ),
  CommandPopupMenu: ({ children, extraItems }: { children: ReactNode; extraItems: readonly MockMenuItem[] }) => (
    <div>
      {children}
      {extraItems.map((item) => (
        <button key={item.id} type="button" aria-label={`popup:${item.label}`} onClick={item.onSelect} />
      ))}
    </div>
  )
}))

const tools = [
  { value: CodeCli.CLAUDE_CODE, label: 'Claude Code', icon: undefined },
  { value: CodeCli.OPENAI_CODEX, label: 'OpenAI Codex', icon: undefined }
] as const

function renderSidebar(
  statuses: CodeCliSidebarProps['statuses'] = {},
  providerSummaries: CodeCliSidebarProps['providerSummaries'] = {},
  pinnedTools = new Set<CodeCli>()
) {
  const onSelectTool = vi.fn()
  const onToggleSidebar = vi.fn()
  render(
    <CodeCliSidebar
      tools={tools as unknown as CodeCliSidebarProps['tools']}
      selectedCliTool={CodeCli.CLAUDE_CODE}
      onSelectTool={onSelectTool}
      toMeta={(tool) => ({ id: tool.value, label: tool.label, icon: tool.icon })}
      statuses={{
        [CodeCli.CLAUDE_CODE]: { installed: false, source: 'none', canUpgrade: false },
        [CodeCli.OPENAI_CODEX]: { installed: true, source: 'mise', current: '1.2.3', canUpgrade: false },
        ...statuses
      }}
      installingTools={new Set()}
      upgradingTools={new Set()}
      providerSummaries={providerSummaries}
      isSidebarPinned={(tool) => pinnedTools.has(tool)}
      onToggleSidebar={onToggleSidebar}
    />
  )
  return { onSelectTool, onToggleSidebar }
}

describe('CodeCliSidebar', () => {
  it('renders no version or upgrade indicator for installed tools', () => {
    renderSidebar({
      [CodeCli.OPENAI_CODEX]: {
        installed: true,
        source: 'mise',
        current: '1.2.3',
        latest: '1.3.0',
        canUpgrade: true
      }
    })

    expect(screen.queryByText('v1.2.3')).not.toBeInTheDocument()
    expect(screen.queryByText('v1.3.0')).not.toBeInTheDocument()
  })

  it('renders the enabled-model label only on its matching tool', () => {
    renderSidebar({}, { [CodeCli.CLAUDE_CODE]: 'deepseek-v4-flash' })

    expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveTextContent('deepseek-v4-flash')
    expect(screen.getByRole('button', { name: /OpenAI Codex/ }).textContent).not.toContain('deepseek-v4-flash')
  })

  it('offers the same add action from More and right click for an installed CLI', () => {
    const { onToggleSidebar } = renderSidebar()

    expect(screen.getByRole('button', { name: 'common.more' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'popup:miniApp.add_to_sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'context:miniApp.add_to_sidebar' }))

    expect(onToggleSidebar).toHaveBeenNthCalledWith(1, tools[1])
    expect(onToggleSidebar).toHaveBeenNthCalledWith(2, tools[1])
  })

  it('does not offer sidebar management for an uninstalled, unpinned CLI', () => {
    renderSidebar()

    const uninstalledRow = screen.getByRole('button', { name: /Claude Code/ }).parentElement
    if (!uninstalledRow) throw new Error('Expected a CLI row')

    expect(screen.getAllByRole('button', { name: 'common.more' })).toHaveLength(1)
    expect(within(uninstalledRow).queryByRole('button', { name: 'common.more' })).not.toBeInTheDocument()
    expect(within(uninstalledRow).queryByRole('button', { name: /add_to_sidebar/ })).not.toBeInTheDocument()
  })

  it('lets an uninstalled pinned CLI be removed without selecting its row', () => {
    const { onSelectTool, onToggleSidebar } = renderSidebar({}, {}, new Set([CodeCli.CLAUDE_CODE]))

    fireEvent.click(screen.getByRole('button', { name: 'popup:miniApp.remove_from_sidebar' }))

    expect(onToggleSidebar).toHaveBeenCalledWith(tools[0])
    expect(onSelectTool).not.toHaveBeenCalled()
  })
})
