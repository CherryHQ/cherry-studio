import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { TerminalBlockControls } from '../TerminalBlockControls'

vi.unmock('@cherrystudio/ui')
afterEach(cleanup)

it('returns keyboard focus to the block menu trigger after Escape', async () => {
  const user = userEvent.setup()
  render(
    <TerminalBlockControls
      runs={[
        {
          kind: 'controls',
          start: 0,
          count: 2,
          lines: 0,
          block: {
            id: 'command',
            contentRevision: 1,
            command: 'printf done',
            cwd: '/project',
            status: 'completed',
            exitCode: 0,
            reliable: true,
            outputEmpty: true,
            prompt: { x: 0, y: 0 },
            output: { x: 0, y: 1 },
            end: { x: 0, y: 1 }
          }
        }
      ]}
      top={0}
      height={19}
      collapsed={[]}
      canRun={false}
      onToggle={() => {}}
      onAction={() => {}}
    />
  )
  const trigger = screen.getByRole('button')
  await user.tab()
  expect(trigger).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getAllByRole('menuitem')[0]).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
})
