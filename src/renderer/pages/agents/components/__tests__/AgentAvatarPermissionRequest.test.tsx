import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { findNextPendingPermissionRequest } from '@renderer/components/composer/variants/PermissionRequestComposer'
import { PI_AGENT_AVATAR_TOOL_ID } from '@shared/ai/agentAvatarTool'

import { AgentAvatarPermissionRequest } from '../AgentAvatarPermissionRequest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string) => (key === 'agent.toolPermission.button.allow' ? 'Allow' : key)
  })
}))

describe('AgentAvatarPermissionRequest', () => {
  it.each(['another Agent', 'the requesting Agent'] as const)(
    'shows the exact target and action for %s outside the raw input',
    async (target) => {
      MockUseDataApiUtils.mockQueryLoading('/agents/:agentId')
      const input =
        target === 'another Agent'
          ? { action: 'generate', prompt: 'A fox with a watercolor background', target_agent_id: 'target-42' }
          : { action: 'restore' }
      const request = findNextPendingPermissionRequest({
        'message-1': [
          {
            type: 'dynamic-tool',
            toolName: PI_AGENT_AVATAR_TOOL_ID,
            toolCallId: 'call-1',
            state: 'approval-requested',
            input,
            approval: { id: 'approval-1' },
            callProviderMetadata: { cherry: { transport: 'pi-agent' } }
          }
        ]
      })
      if (!request) throw new Error('Expected a pending avatar approval')

      const onRespond = vi.fn()
      const user = userEvent.setup()
      const renderComposer = () => (
        <AgentAvatarPermissionRequest
          request={request}
          onRespond={onRespond}
          agentId={target === 'the requesting Agent' ? 'target-42' : 'caller-7'}
        />
      )
      const { rerender } = render(renderComposer())
      expect(screen.getByRole('button', { name: /Allow/ })).toBeDisabled()
      await user.keyboard('{Enter}')
      expect(onRespond).not.toHaveBeenCalled()

      MockUseDataApiUtils.mockQueryData('/agents/:agentId', {
        id: 'target-42',
        name: 'Target Agent',
        type: 'pi',
        model: null,
        modelName: null,
        orderKey: 'a0',
        createdAt: '2026-11-21T00:00:00.000Z',
        updatedAt: '2026-11-21T00:00:00.000Z'
      })
      rerender(renderComposer())
      const targetLabel = screen.getByText('Target Agent (target-42)')
      expect(targetLabel).toBeVisible()
      expect(screen.getByTestId('permission-preview')).not.toContainElement(targetLabel)
      const details = targetLabel.closest('table')
      if (!details) throw new Error('Expected the target and action in the approval summary')
      expect(within(details).getByText(input.action)).toBeVisible()
      await user.click(screen.getByRole('button', { name: /Allow/ }))
      expect(onRespond).toHaveBeenCalledWith({ match: request.match, approved: true })
    }
  )
})
