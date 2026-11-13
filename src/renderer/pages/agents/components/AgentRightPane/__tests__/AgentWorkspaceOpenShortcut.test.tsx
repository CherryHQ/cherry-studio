import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandContextKeyProvider } from '@renderer/components/command/CommandContextKeyProvider'
import { CommandProvider } from '@renderer/components/command/CommandProvider'

import { AgentWorkspaceOpenShortcut } from '../AgentWorkspaceOpenShortcut'

const state = vi.hoisted(() => ({ active: true, selectedTarget: { id: 'vscode' }, openTarget: vi.fn() }))
vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => state.active }))
vi.mock('@renderer/hooks/useExternalOpenTargets', () => ({ usePreferredExternalOpenTarget: () => state }))

function mount() {
  const tree = () => (
    <CommandContextKeyProvider>
      <CommandProvider>
        <AgentWorkspaceOpenShortcut workspacePath="/workspace" />
      </CommandProvider>
    </CommandContextKeyProvider>
  )
  const view = render(tree())
  return { user: userEvent.setup(), refresh: () => view.rerender(tree()) }
}

describe('AgentWorkspaceOpenShortcut', () => {
  beforeEach(() => {
    state.active = true
    state.selectedTarget = { id: 'vscode' }
    state.openTarget.mockReset()
    MockUsePreferenceUtils.resetMocks()
  })
  afterEach(cleanup)

  it('opens the latest selected default without requiring a visible card', async () => {
    const { user, refresh } = mount()
    await user.keyboard('{Control>}o{/Control}')
    expect(state.openTarget.mock.calls).toEqual([[{ id: 'vscode' }]])
    state.selectedTarget = { id: 'finder' }
    refresh()
    await user.keyboard('{Control>}o{/Control}')
    expect(state.openTarget.mock.calls).toEqual([[{ id: 'vscode' }], [{ id: 'finder' }]])
  })

  it('uses a customized binding instead of the default', async () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.agent.workspace.open', {
      binding: ['CommandOrControl', 'L'],
      enabled: true
    })
    const { user } = mount()
    await user.keyboard('{Control>}o{/Control}')
    expect(state.openTarget).not.toHaveBeenCalled()
    await user.keyboard('{Control>}l{/Control}')
    expect(state.openTarget.mock.calls).toEqual([[{ id: 'vscode' }]])
  })

  it.each(['background', 'disabled'])('does not launch an application when %s', async (mode) => {
    state.active = mode !== 'background'
    if (mode === 'disabled') {
      MockUsePreferenceUtils.setPreferenceValue('shortcut.agent.workspace.open', {
        binding: ['CommandOrControl', 'O'],
        enabled: false
      })
    }
    const { user } = mount()
    await user.keyboard('{Control>}o{/Control}')
    expect(state.openTarget).not.toHaveBeenCalled()
  })
})
