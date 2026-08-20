import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ipcRequest: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) => (
    <button type="button" onClick={() => onOpenChange?.(true)}>
      model selector
    </button>
  )
}))
vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({ trigger }: { trigger: ReactNode }) => trigger,
  WorkspaceSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))

import { AgentConversationControls } from '../AgentConversationControls'

describe('AgentConversationControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcRequest.mockResolvedValue({ modelCount: 1 })
  })

  it('refreshes Cherry Cloud free models when the Work model selector opens', () => {
    render(
      <AgentConversationControls
        workspace={null}
        selectAgentLabel="Select agent"
        selectModelLabel="Select model"
        selectWorkspaceLabel="Select workspace"
        shouldAutoSelectCreatedAgent={false}
        side="bottom"
        agentTriggerMode="selector"
        canChangeModel
        onAgentChange={vi.fn()}
        onModelSelect={vi.fn()}
        onWorkspaceChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'model selector' }))

    expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('cherry_cloud.models.sync')
  })
})
