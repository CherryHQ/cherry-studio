import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AgentEntity } from '@shared/data/types/agent'

import { AgentProfilePane } from '../AgentProfilePane'
import { recordEditDialogRequests, renderInRightPane, serveQueries } from './profilePaneTestUtils'

function createAgent(configuration: AgentEntity['configuration'] = {}): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Code Reviewer',
    description: 'Reviews changes and points out risks',
    model: null,
    modelName: 'Claude Sonnet 4.5',
    configuration
  } as unknown as AgentEntity
}

describe('AgentProfilePane', () => {
  let dialog: ReturnType<typeof recordEditDialogRequests>
  let agent: AgentEntity

  beforeEach(async () => {
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    await i18n.changeLanguage('en-US')
    agent = createAgent({ permission_mode: 'acceptEdits' })
    serveQueries({ '/agents/:agentId': ({ params }) => (params?.agentId === agent.id ? agent : undefined) })
    dialog = recordEditDialogRequests()
  })

  afterEach(() => dialog.stop())

  it('shows who the Agent is', () => {
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)

    expect(screen.getByRole('heading', { name: 'Code Reviewer' })).toBeInTheDocument()
    expect(screen.getByText('Reviews changes and points out risks')).toBeInTheDocument()
  })

  it('shows the current settings and opens the edit dialog on the page that changes them', async () => {
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)
    const settings = screen.getByRole('region', { name: 'Settings' })

    fireEvent.click(within(settings).getByRole('button', { name: 'All' }))
    fireEvent.click(within(settings).getByRole('button', { name: 'Model: Claude Sonnet 4.5' }))
    fireEvent.click(within(settings).getByRole('button', { name: 'Permissions: Auto-accept Edits' }))
    fireEvent.click(within(settings).getByRole('button', { name: /^Reply language: Follow global/ }))

    await waitFor(() =>
      expect(dialog.requests).toEqual([
        { kind: 'agent', id: agent.id, initialTab: undefined },
        { kind: 'agent', id: agent.id, initialTab: 'basic' },
        { kind: 'agent', id: agent.id, initialTab: 'basic' },
        { kind: 'agent', id: agent.id, initialTab: 'basic' }
      ])
    )
  })

  it.each([
    { language: null, label: 'Reply language: No constraint' },
    { language: 'Svenska', label: 'Reply language: Svenska' }
  ])('names the reply language $label', ({ language, label }) => {
    agent = createAgent({ language })
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })
})
