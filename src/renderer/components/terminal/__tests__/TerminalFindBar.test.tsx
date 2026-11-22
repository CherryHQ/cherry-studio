import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from 'i18next'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { TerminalFindBar } from '../TerminalFindBar'

vi.unmock('@cherrystudio/ui')
afterEach(cleanup)

function FindHarness() {
  const [open, setOpen] = useState(true)
  const [needle, setNeedle] = useState('needle')
  const [scope, setScope] = useState<'terminal' | 'block'>('terminal')
  const [match, setMatch] = useState(1)
  return (
    <>
      {open && (
        <TerminalFindBar
          needle={needle}
          scope={scope}
          canBlock
          result={null}
          onChange={(nextNeedle, nextScope) => {
            setNeedle(nextNeedle)
            setScope(nextScope)
          }}
          onNavigate={(direction) => setMatch((current) => current + (direction === 'next' ? 1 : -1))}
          onClose={() => setOpen(false)}
        />
      )}
      <output aria-label="Current match">{match}</output>
    </>
  )
}

it('exposes the current search scope when a keyboard user changes it', async () => {
  const user = userEvent.setup()
  render(<FindHarness />)
  expect(screen.getByRole('button', { name: t('terminal.blocks.scope_terminal') })).toBeInTheDocument()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: t('terminal.blocks.scope_block') })).toHaveFocus()
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('1')
})

it('reserves Enter navigation shortcuts for the textbox so buttons perform their own actions', async () => {
  const user = userEvent.setup()
  render(<FindHarness />)
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('2')
  await user.keyboard('{Shift>}{Enter}{/Shift}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('1')
  await user.tab()
  await user.tab()
  expect(screen.getByRole('button', { name: t('terminal.blocks.previous') })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('0')
  await user.tab()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('1')
  await user.tab()
  expect(screen.getByRole('button', { name: t('common.close') })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
})
