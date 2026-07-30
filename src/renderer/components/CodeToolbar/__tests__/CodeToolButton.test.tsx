import type * as CherryStudioUi from '@cherrystudio/ui'
import type { ActionTool } from '@renderer/components/ActionTools'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import CodeToolButton from '../CodeToolButton'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

function makeTool(overrides: Partial<ActionTool> = {}): ActionTool {
  return {
    id: 'copy',
    type: 'core',
    order: 10,
    icon: null,
    tooltip: 'Copy',
    onClick: vi.fn(),
    ...overrides
  }
}

describe('CodeToolButton', () => {
  it('activates a tool by click, Enter, and Space', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<CodeToolButton tool={makeTool({ onClick })} />)
    const button = screen.getByRole('button', { name: 'Copy' })

    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('runs a child action and closes its menu', async () => {
    const user = userEvent.setup()
    const downloadSvg = vi.fn()
    render(
      <CodeToolButton
        tool={makeTool({
          id: 'download',
          tooltip: 'Download',
          onClick: undefined,
          children: [
            {
              id: 'download-svg',
              type: 'quick',
              order: 1,
              icon: null,
              tooltip: 'SVG',
              onClick: downloadSvg
            }
          ]
        })}
      />
    )

    expect(screen.queryByRole('button', { name: 'SVG' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await user.click(await screen.findByRole('button', { name: 'SVG' }))

    expect(downloadSvg).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'SVG' })).not.toBeInTheDocument())
  })
})
