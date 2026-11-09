import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getDefaultValue } from '@shared/data/preference/preferenceUtils'

import { AgentRunTaskStopsProvider, AgentSessionDetailsSections } from '../AgentSessionDetailsSections'

vi.mock('@cherrystudio/ui', async (original) => original())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

beforeEach(() => MockUsePreferenceUtils.resetMocks())
afterEach(cleanup)

const preferenceKey = 'agent.details.sections'
const defaults = getDefaultValue(preferenceKey)
function mount() {
  return render(
    <AgentRunTaskStopsProvider>
      <AgentSessionDetailsSections
        contextUsage={<div>Context reading</div>}
        status={{
          tasks: [],
          completedTaskCount: 0,
          totalTaskCount: 0,
          artifacts: [],
          runTasks: [
            { id: 'a', title: 'Review', taskType: 'subagent', status: 'pending' },
            { id: 's', title: 'Build', taskType: 'background_shell', status: 'pending' }
          ]
        }}
      />
    </AgentRunTaskStopsProvider>
  )
}

it('restores saved order and visibility while keeping empty sections configurable', () => {
  MockUsePreferenceUtils.setPreferenceValue(preferenceKey, [
    { id: 'context', visible: true },
    { id: 'shells', visible: true },
    { id: 'subagents', visible: false },
    ...defaults.filter(({ id }) => !['context', 'shells', 'subagents'].includes(id))
  ])
  const view = mount()
  expect(screen.queryByRole('button', { name: /agent.right_pane.info.subagents/ })).toBeNull()
  const context = screen.getByText('Context reading')
  const shell = screen.getByRole('button', { name: /agent.right_pane.info.shell_tasks/ })
  expect(context.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.details.customize' }))
  const toggles = screen.getAllByRole('switch')
  expect(toggles).toHaveLength(8)
  expect(toggles[0]).toHaveAccessibleName('agent.right_pane.info.context')
  expect(screen.getByRole('switch', { name: 'agent.right_pane.info.subagents' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('switch', { name: 'agent.right_pane.info.subagents' }))
  view.unmount()
  mount()
  expect(screen.getByRole('button', { name: /agent.right_pane.info.subagents/ })).toBeVisible()
  expect(
    MockUsePreferenceUtils.getPreferenceValue(preferenceKey)
      .map(({ id }: { id: string }) => id)
      .slice(0, 3)
  ).toEqual(['context', 'shells', 'subagents'])
})

it('keeps customization reachable when all sections are hidden and restores the defaults', () => {
  MockUsePreferenceUtils.setPreferenceValue(
    preferenceKey,
    defaults.map((item) => ({ ...item, visible: false }))
  )
  const view = mount()
  expect(screen.queryByText('Context reading')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.details.customize' }))
  const menu = screen.getByRole('dialog')
  expect(
    within(menu)
      .getAllByRole('switch')
      .every((toggle) => toggle.getAttribute('aria-checked') === 'false')
  ).toBe(true)
  fireEvent.click(within(menu).getByRole('button', { name: 'chat.input.toolbar.restore_default' }))
  view.unmount()
  mount()
  expect(screen.getByText('Context reading')).toBeVisible()
  expect(screen.getByRole('button', { name: /agent.right_pane.info.subagents/ })).toBeVisible()
  expect(MockUsePreferenceUtils.getPreferenceValue(preferenceKey)).toEqual(defaults)
})

it('keeps known saved choices and introduces missing sections without duplicate rows', () => {
  MockUsePreferenceUtils.setPreferenceValue(preferenceKey, [
    { id: 'context', visible: false },
    { id: 'retired', visible: true },
    { id: 'context', visible: true }
  ])
  mount()
  expect(screen.queryByText('Context reading')).toBeNull()
  expect(screen.getByRole('button', { name: /agent.right_pane.info.subagents/ })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.details.customize' }))
  expect(screen.getAllByRole('switch')).toHaveLength(8)
  expect(screen.getByRole('switch', { name: 'agent.right_pane.info.context' })).not.toBeChecked()
})
