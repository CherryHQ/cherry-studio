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

function Harness({ initial = [] }: { initial?: string[] }) {
  const [disabledTools, setDisabledTools] = useState(initial)
  return (
    <>
      <BuiltinToolsField
        agentType="pi-durable"
        disabledTools={disabledTools}
        onDisabledToolsChange={setDisabledTools}
        hasKnowledgeScope={false}
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
