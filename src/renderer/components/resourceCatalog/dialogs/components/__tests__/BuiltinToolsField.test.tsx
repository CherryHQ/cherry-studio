import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'

import { BuiltinToolsField } from '../BuiltinToolsField'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))

const INACTIVE = 'library.config.tools.inactive_badge'
const SEARCH = 'agent.tools.builtin.CherryKbSearch.label'
const MANAGE = 'agent.tools.builtin.CherryKbManage.label'
const SEARCH_ID = 'mcp__cherry-tools__kb_search'

function Harness({ initial = [], hasKnowledgeScope = false }: { initial?: string[]; hasKnowledgeScope?: boolean }) {
  const [disabledTools, setDisabledTools] = useState(initial)
  return (
    <>
      <BuiltinToolsField
        agentType="pi-durable"
        disabledTools={disabledTools}
        onDisabledToolsChange={setDisabledTools}
        hasKnowledgeScope={hasKnowledgeScope}
      />
      <output data-testid="disabled-tools">{disabledTools.join(',')}</output>
    </>
  )
}

describe('BuiltinToolsField', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('app.browser.agent_control.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', false)
  })

  it('writes a Pi tool switched off into disabledTools, and removes it when switched back on', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const read = screen.getByRole('switch', { name: 'agent.tools.builtin.read.label' })
    expect(read).toBeChecked()

    await user.click(read)
    expect(screen.getByTestId('disabled-tools')).toHaveTextContent('read')
    expect(read).not.toBeChecked()

    await user.click(read)
    expect(screen.getByTestId('disabled-tools').textContent).toBe('')
  })

  it('persists only the Search switch id when a Pi Durable agent has a knowledge binding', async () => {
    const user = userEvent.setup()
    render(<Harness hasKnowledgeScope />)

    const search = screen.getByRole('switch', { name: SEARCH })
    const manage = screen.getByRole('switch', { name: MANAGE })
    expect(search).toBeChecked()
    expect(manage).toBeChecked()

    await user.click(search)
    expect(screen.getByTestId('disabled-tools').textContent).toBe(SEARCH_ID)
    expect(search).not.toBeChecked()
    expect(manage).toBeChecked()

    await user.click(search)
    expect(screen.getByTestId('disabled-tools')).toBeEmptyDOMElement()
    expect(search).toBeChecked()
  })

  it('shows a saved Search restriction only while a knowledge base is bound', () => {
    const { rerender } = render(<Harness hasKnowledgeScope initial={[SEARCH_ID]} />)
    expect(screen.getByRole('switch', { name: SEARCH })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: MANAGE })).toBeChecked()

    rerender(<Harness initial={[SEARCH_ID]} />)
    expect(screen.queryByRole('switch', { name: SEARCH })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: MANAGE })).not.toBeInTheDocument()
  })

  it('opts browser control out of an Agent through disabledTools while the feature is on globally', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('switch', { name: 'settings.browser.control' }))

    expect(screen.getByTestId('disabled-tools')).toHaveTextContent(BROWSER_TOOL_GROUP)
  })

  it('marks computer use inactive and unswitchable while it is off globally', () => {
    render(<Harness />)

    const computerUse = screen.getByRole('switch', { name: 'settings.computerUse.control' })
    expect(computerUse).not.toBeChecked()
    expect(computerUse).toBeDisabled()
    expect(screen.getAllByText(INACTIVE)).toHaveLength(1)
  })
})
