import { fireEvent, render, screen } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { McpTool } from '@renderer/types/tool'

import { AutoApproveCell } from '../McpTool'
vi.mock('@cherrystudio/ui/components/composites/markdown/styles', () => ({}))
vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children, content }: any) => <div title={content}>{children}</div>,
  Switch: ({ checked, disabled, onCheckedChange }: any) => (
    <button role="switch" aria-checked={checked} disabled={disabled} onClick={() => onCheckedChange(!checked)}>
      Auto approve
    </button>
  )
}))
vi.mock('@renderer/hooks/useMcpServer', () => ({ useIsToolAutoApproved: () => false }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/components/icons/SvgIcon', () => ({ McpLogo: () => null }))
afterEach(cleanup)
describe('mandatory MCP approval editor', () => {
  it('shows manual approval and disables ineffective wildcard auto-approve', () => {
    const toggle = vi.fn()
    render(<AutoApproveCell tool={{ name: 'play' } as McpTool} enabled approvalEnforced onToggle={toggle} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByTitle('settings.mcp.tools.autoApprove.tooltip.disabled')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch'))
    expect(toggle).not.toHaveBeenCalled()
  })
  it('keeps an ordinary enabled tool toggle editable', () => {
    const toggle = vi.fn()
    const tool = { name: 'play' } as McpTool
    render(<AutoApproveCell tool={tool} enabled onToggle={toggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(toggle).toHaveBeenCalledWith(tool, true)
  })
})
