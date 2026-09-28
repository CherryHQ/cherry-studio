import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BuiltinMcpServerActiveToggle } from '../BuiltinMcpServerActiveToggle'

const updateMcpServer = vi.fn()
const toastError = vi.fn()

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServerMutations: () => ({ updateMcpServer })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) }
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
    'aria-label'?: string
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={props['aria-label']}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  )
}))

describe('BuiltinMcpServerActiveToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateMcpServer.mockResolvedValue(undefined)
  })

  it('says a server is off rather than letting "installed" imply it is working', () => {
    // The seeder installs builtins inactive. The row used to show a green check either way, so a
    // capability that was doing nothing looked switched on.
    render(<BuiltinMcpServerActiveToggle serverId="s1" isActive={false} />)

    expect(screen.getByText('settings.mcp.builtin.off')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('switches a server on', async () => {
    render(<BuiltinMcpServerActiveToggle serverId="s1" isActive={false} />)

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(updateMcpServer).toHaveBeenCalledWith({ body: { isActive: true } }))
  })

  it('switches a server back off', async () => {
    render(<BuiltinMcpServerActiveToggle serverId="s1" isActive />)

    expect(screen.getByText('settings.mcp.builtin.on')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(updateMcpServer).toHaveBeenCalledWith({ body: { isActive: false } }))
  })

  it('says so when the change did not take', async () => {
    // Silently snapping back would leave the user believing they had switched it on.
    updateMcpServer.mockRejectedValue(new Error('nope'))
    render(<BuiltinMcpServerActiveToggle serverId="s1" isActive={false} />)

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('settings.mcp.builtin.toggle_failed'))
  })
})
