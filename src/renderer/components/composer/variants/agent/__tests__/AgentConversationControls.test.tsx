import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ipcRequest: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({
    isModelDisabled,
    onOpenChange
  }: {
    isModelDisabled?: (model: { id: string; providerId: string; group?: string }) => boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <>
      <button type="button" onClick={() => onOpenChange?.(true)}>
        open model selector
      </button>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close model selector
      </button>
      <button
        type="button"
        disabled={isModelDisabled?.({
          id: 'cherryai::deepseek-free',
          providerId: 'cherryai',
          group: 'Cherry Cloud'
        })}>
        Cloud Free
      </button>
      <button
        type="button"
        disabled={isModelDisabled?.({
          id: 'cherryai::deepseek-go',
          providerId: 'cherryai',
          group: 'Cherry Cloud'
        })}>
        Cloud Go
      </button>
      <button type="button" disabled={isModelDisabled?.({ id: 'openai::gpt-4', providerId: 'openai' })}>
        OpenAI
      </button>
    </>
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
    mocks.ipcRequest.mockReset()
  })

  it('keeps Cloud models unavailable until the latest model sync succeeds', async () => {
    const user = userEvent.setup()
    const firstSync = deferred<{ modelCount: number; quotaExhaustedModelIds: string[] }>()
    const secondSync = deferred<{ modelCount: number; quotaExhaustedModelIds: string[] }>()
    mocks.ipcRequest.mockReturnValueOnce(firstSync.promise).mockReturnValueOnce(secondSync.promise)
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

    await user.click(screen.getByRole('button', { name: 'open model selector' }))

    expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('cherry_cloud.models.sync')
    expect(screen.getByRole('button', { name: 'Cloud Free' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cloud Go' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'close model selector' }))
    await user.click(screen.getByRole('button', { name: 'open model selector' }))
    expect(mocks.ipcRequest).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondSync.resolve({ modelCount: 2, quotaExhaustedModelIds: ['cherryai::deepseek-go'] })
      await secondSync.promise
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cloud Free' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Cloud Go' })).toBeDisabled()

    await act(async () => {
      firstSync.resolve({ modelCount: 2, quotaExhaustedModelIds: ['cherryai::deepseek-free'] })
      await firstSync.promise
    })
    expect(screen.getByRole('button', { name: 'Cloud Free' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cloud Go' })).toBeDisabled()
  })
})
