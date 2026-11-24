import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { AgentConversationControls } from '@renderer/components/composer/variants/agent/AgentConversationControls'
import i18n from '@renderer/i18n/resolver'
import type { AgentEntity } from '@shared/data/types/agent'

import { type RightPanelCapability, RightPanelProvider, useRightPanelState } from '../../Shell'
import { PROFILE_PANE_ID, useProfilePaneToggle } from '../useProfilePane'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const agent = {
  id: 'agent-1',
  name: 'Code Reviewer',
  type: 'claude-code',
  configuration: { avatar: '🔍' }
} as unknown as AgentEntity

const profileCapability = {
  component: () => <div>profile content</div>,
  widthPreset: 'profile',
  resolve: () => ({
    id: PROFILE_PANE_ID,
    instanceKey: 'profile',
    title: 'Profile',
    readiness: 'ready',
    headerMode: 'content',
    canMaximize: false
  })
} satisfies RightPanelCapability<object>

const scope = {}

function TopBar({
  iconOnly = false,
  agentTriggerMode = 'edit'
}: {
  iconOnly?: boolean
  agentTriggerMode?: 'selector' | 'edit'
}) {
  const profilePane = useProfilePaneToggle()
  const { activePanelId, presentationOpen } = useRightPanelState()
  return (
    <>
      <AgentConversationControls
        agent={agent}
        selectAgentLabel="Select agent"
        selectModelLabel="Select model"
        selectWorkspaceLabel="Select workspace"
        shouldAutoSelectCreatedAgent={false}
        side="bottom"
        agentTriggerMode={agentTriggerMode}
        iconOnly={iconOnly}
        canChangeModel={false}
        onAgentChange={vi.fn()}
        onModelSelect={vi.fn()}
        onAvatarClick={profilePane?.toggle}
        avatarActive={profilePane?.active}
      />
      <output data-testid="presented">{presentationOpen ? activePanelId : 'none'}</output>
    </>
  )
}

function renderTopBar(
  capabilities: readonly RightPanelCapability<object>[],
  topBar: Parameters<typeof TopBar>[0] = {}
) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <RightPanelProvider capabilities={capabilities} scope={scope}>
        <TopBar {...topBar} />
      </RightPanelProvider>
    </SWRConfig>
  )
}

describe('profile pane entry from the top bar', () => {
  beforeEach(async () => {
    MockUseCacheUtils.resetMocks()
    await i18n.changeLanguage('en-US')
  })

  it('opens the profile pane from the avatar and closes it on the second click', async () => {
    const user = userEvent.setup()
    renderTopBar([profileCapability])
    const avatar = screen.getByRole('button', { name: "View Code Reviewer's profile" })

    await user.click(avatar)
    expect(screen.getByTestId('presented')).toHaveTextContent(PROFILE_PANE_ID)
    expect(avatar).toHaveAttribute('aria-pressed', 'true')

    await user.click(avatar)
    expect(screen.getByTestId('presented')).toHaveTextContent('none')
    expect(avatar).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the name as its own control next to the avatar', () => {
    renderTopBar([profileCapability])

    const name = screen.getByText('Code Reviewer').closest('button')
    expect(name).not.toBeNull()
    expect(name).not.toBe(screen.getByRole('button', { name: "View Code Reviewer's profile" }))
  })

  it('leaves the avatar inside the name control when the conversation has no profile pane', () => {
    renderTopBar([])

    expect(screen.queryByRole('button', { name: "View Code Reviewer's profile" })).toBeNull()
  })

  // Icon-only, the name control had nothing visible left beside the avatar.
  it('leaves only the avatar for a running conversation once the top bar is icon-only', () => {
    renderTopBar([profileCapability], { iconOnly: true })

    expect(screen.getByRole('button', { name: "View Code Reviewer's profile" })).toBeInTheDocument()
    expect(screen.queryByText('Code Reviewer')).toBeNull()
  })

  it('keeps the Agent switcher beside the avatar in a new conversation once the top bar is icon-only', () => {
    renderTopBar([profileCapability], { iconOnly: true, agentTriggerMode: 'selector' })

    const switcher = screen.getByText('Code Reviewer').closest('button')
    expect(switcher).not.toBeNull()
    expect(switcher).not.toBe(screen.getByRole('button', { name: "View Code Reviewer's profile" }))
  })
})
