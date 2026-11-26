import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next, { t } from 'i18next'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import type { TerminalBlockSummary } from '@shared/types/terminal'

import { TerminalBlockControls } from '../TerminalBlockControls'

vi.unmock('@cherrystudio/ui')
afterEach(cleanup)

it('uses the command start time, then keeps the completed duration fixed and omits unknown timing', async () => {
  const previousLanguage = i18next.language
  await i18next.changeLanguage('en-us')
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(1700000000000)
  const view = (timing: TerminalBlockSummary['timing']) => (
    <TerminalBlockControls
      layout={{
        runs: [
          {
            kind: 'controls',
            start: 0,
            count: 2,
            block: {
              id: 'timed',
              contentRevision: 1,
              command: 'run',
              cwd: '/project',
              status: timing?.kind === 'running' ? 'running' : timing ? 'completed' : 'unknown',
              timing,
              exitCode: 0,
              reliable: true,
              outputEmpty: true,
              prompt: null,
              output: null,
              end: null
            }
          }
        ],
        top: 0,
        rows: 20,
        total: 20
      }}
      height={19}
      canRun={false}
      readOutput={async () => ''}
      onFindFocus={() => {}}
      onAction={() => {}}
    />
  )
  try {
    const rendered = render(view({ kind: 'running', startedAt: Date.now() - 2000 }))
    expect(screen.getByRole('timer', { name: t('terminal.blocks.duration') })).toHaveTextContent('2s')
    await act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('timer')).toHaveTextContent('3s')
    rendered.rerender(view({ kind: 'completed', durationMs: 3725 }))
    expect(screen.getByRole('timer')).toHaveTextContent('3.725s')
    await act(() => vi.advanceTimersByTime(10000))
    expect(screen.getByRole('timer')).toHaveTextContent('3.725s')
    rendered.rerender(view({ kind: 'completed', durationMs: 59999.6 }))
    expect(screen.getByRole('timer')).toHaveTextContent('1m')
    rendered.rerender(view({ kind: 'completed', durationMs: 3723725 }))
    expect(screen.getByRole('timer')).toHaveTextContent('1h 2m 3.725s')
    rendered.rerender(view(null))
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  } finally {
    cleanup()
    vi.useRealTimers()
    await i18next.changeLanguage(previousLanguage)
  }
})

it('returns keyboard focus to the block menu trigger after Escape', async () => {
  const user = userEvent.setup()
  render(
    <TerminalBlockControls
      layout={{
        runs: [
          {
            kind: 'controls',
            start: 0,
            count: 2,
            block: {
              timing: null,
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
        ],
        top: 0,
        rows: 20,
        total: 20
      }}
      height={19}
      canRun={false}
      readOutput={async () => ''}
      onFindFocus={() => {}}
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

it('copies and attaches the targeted block through its quick actions', async () => {
  const user = userEvent.setup()
  function Harness() {
    const [result, setResult] = useState('')
    return (
      <>
        <TerminalBlockControls
          layout={{
            runs: [
              {
                kind: 'controls',
                start: 0,
                count: 2,
                block: {
                  timing: null,
                  id: 'output-command',
                  contentRevision: 3,
                  command: 'printf done',
                  cwd: '/Users/suyao/Documents/ChatGPT/cherry-studio',
                  status: 'completed',
                  exitCode: 0,
                  reliable: true,
                  outputEmpty: false,
                  prompt: { x: 0, y: 0 },
                  output: { x: 0, y: 1 },
                  end: { x: 0, y: 2 }
                }
              }
            ],
            top: 0,
            rows: 20,
            total: 20
          }}
          height={19}
          canRun={false}
          readOutput={async (block) =>
            block.id === 'output-command' && block.contentRevision === 3 ? 'done' : 'Wrong command output'
          }
          onFindFocus={() => {}}
          onAction={(block, action) => setResult(`${action}:${block.id}:${block.contentRevision}`)}
        />
        <output aria-label="Block action">{result}</output>
      </>
    )
  }
  render(<Harness />)
  expect(screen.getByText('/Users/suyao/Documents/ChatGPT/cherry-studio')).toBeVisible()
  await user.click(screen.getByRole('button', { name: t('terminal.blocks.copy_output') }))
  expect(await navigator.clipboard.readText()).toBe('done')
  await user.click(screen.getByRole('button', { name: t('terminal.blocks.attach') }))
  expect(screen.getByRole('status', { name: 'Block action' })).toHaveTextContent('attach:output-command:3')
})
