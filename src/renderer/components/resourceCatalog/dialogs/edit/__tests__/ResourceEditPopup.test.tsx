import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: () => vi.fn(() => true)
}))

vi.mock('../AssistantEditDialog', () => ({
  AssistantEditDialog: ({
    onOpenChange,
    onSaved,
    resource
  }: {
    onOpenChange: (open: boolean) => void
    onSaved: (resource: { id: string; name: string }) => void
    resource: { id: string; name: string }
  }) => (
    <div>
      <span data-testid="assistant-resource-name">{resource.name}</span>
      <button type="button" onClick={() => onSaved({ ...resource, name: 'Updated assistant' })}>
        save assistant
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        close assistant
      </button>
    </div>
  )
}))

vi.mock('../AgentEditDialog', () => ({
  AgentEditDialog: ({
    onOpenChange,
    onSaved,
    resource
  }: {
    onOpenChange: (open: boolean) => void
    onSaved: (resource: { id: string; name: string }) => void
    resource: { id: string; name: string }
  }) => (
    <div>
      <span data-testid="agent-resource-name">{resource.name}</span>
      <button type="button" onClick={() => onSaved({ ...resource, name: 'Updated agent' })}>
        save agent
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        close agent
      </button>
    </div>
  )
}))

import { ResourceEditPopup } from '../ResourceEditPopup'

type ResourceEditPopupParams = Parameters<typeof ResourceEditPopup.show>[0]
type AssistantPopupParams = Extract<ResourceEditPopupParams, { kind: 'assistant' }>
type AgentPopupParams = Extract<ResourceEditPopupParams, { kind: 'agent' }>

describe('ResourceEditPopup', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(async () => {
    for (const entry of popupService.getSnapshot()) {
      popupService.settle(entry.instanceId, undefined)
    }
    await act(async () => vi.advanceTimersByTime(POPUP_EXIT_MS))
    vi.useRealTimers()
  })

  it.each(['assistant', 'agent'] as const)('advances the %s save baseline with the updated resource', async (kind) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<PopupHost />)

    let result: Promise<void>
    act(() => {
      const params: ResourceEditPopupParams =
        kind === 'assistant'
          ? {
              kind,
              resource: { id: `${kind}-1`, name: `Initial ${kind}` } as AssistantPopupParams['resource']
            }
          : {
              kind,
              resource: { id: `${kind}-1`, name: `Initial ${kind}` } as AgentPopupParams['resource']
            }
      result = ResourceEditPopup.show(params)
    })

    expect(await screen.findByTestId(`${kind}-resource-name`)).toHaveTextContent(`Initial ${kind}`)

    await user.click(screen.getByRole('button', { name: `save ${kind}` }))
    await waitFor(() => expect(screen.getByTestId(`${kind}-resource-name`)).toHaveTextContent(`Updated ${kind}`))

    await user.click(screen.getByRole('button', { name: `close ${kind}` }))
    await expect(result!).resolves.toBeUndefined()
  })
})
