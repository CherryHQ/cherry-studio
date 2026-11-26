import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from 'i18next'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import type { TerminalBlockSummary } from '@shared/types/terminal'

import { TerminalFindBar } from '../TerminalFindBar'

vi.unmock('@cherrystudio/ui')
afterEach(cleanup)

const block: TerminalBlockSummary = {
  timing: null,
  id: 'command',
  contentRevision: 1,
  command: 'sleep 60',
  cwd: '/project',
  status: 'completed',
  exitCode: 0,
  reliable: true,
  outputEmpty: true,
  prompt: null,
  output: null,
  end: null
}

function FindHarness({
  target = null,
  scope = 'terminal'
}: {
  target?: TerminalBlockSummary | null
  scope?: 'terminal' | 'block'
}) {
  const [open, setOpen] = useState(true)
  const [needle, setNeedle] = useState('needle')
  const [blockScope, setBlockScope] = useState(scope === 'block')
  const [match, setMatch] = useState(1)
  return (
    <>
      {open && (
        <TerminalFindBar
          needle={needle}
          target={{ kind: blockScope ? 'block' : 'terminal', block: target }}
          result={{
            queryRevision: 1,
            resultRevision: 1,
            status: 'caught-up',
            count: 4,
            selected: { index: match, range: null },
            matches: [],
            partial: false,
            highlightsLimited: false
          }}
          onChange={setNeedle}
          onToggleScope={() => setBlockScope((current) => !current)}
          onNavigate={(direction) => setMatch((current) => current + (direction === 'next' ? 1 : -1))}
          onClose={() => setOpen(false)}
        />
      )}
      <output aria-label="Current match">{match}</output>
    </>
  )
}

it('reserves Enter navigation shortcuts for the textbox so buttons perform their own actions', async () => {
  const user = userEvent.setup()
  render(<FindHarness />)
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('2')
  await user.keyboard('{Shift>}{Enter}{/Shift}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('1')
  await user.tab()
  expect(screen.getByRole('button', { name: t('common.previous') })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('0')
  expect(screen.getByRole('textbox')).toHaveFocus()
  await user.tab()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status', { name: 'Current match' })).toHaveTextContent('1')
  expect(screen.getByRole('textbox')).toHaveFocus()
  await user.tab()
  await user.tab()
  await user.tab()
  expect(screen.getByRole('button', { name: t('common.close') })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
})

it('disables navigation after clearing the query and closes from Escape', async () => {
  const user = userEvent.setup()
  render(<FindHarness />)
  await user.clear(screen.getByRole('textbox'))
  expect(screen.getByRole('button', { name: t('common.previous') })).toBeDisabled()
  expect(screen.getByRole('button', { name: t('common.next') })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
})

it('uses a compact scope toggle with an accessible target and preserves the query across toggles and retirement', async () => {
  const user = userEvent.setup()
  const rendered = render(<FindHarness scope="block" target={block} />)
  const toggle = screen.getByRole('button', { name: t('terminal.blocks.find_in_block') })
  await user.type(screen.getByRole('textbox'), 'changed')
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(toggle).toHaveAttribute('aria-description', t('terminal.blocks.search_target', { command: 'sleep 60' }))
  expect(screen.queryByText(t('terminal.blocks.scope_block'))).not.toBeInTheDocument()
  expect(screen.queryByText(t('terminal.blocks.search_target', { command: 'sleep 60' }))).not.toBeInTheDocument()
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('textbox')).toHaveValue('needlechanged')
  await user.click(toggle)
  rendered.rerender(<FindHarness scope="block" target={null} />)
  expect(toggle).toHaveAttribute('aria-description', t('terminal.blocks.unavailable'))
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle).toBeDisabled()
  expect(screen.getByRole('textbox')).toHaveValue('needlechanged')
})
