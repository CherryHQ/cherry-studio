import type * as CherryStudioUi from '@cherrystudio/ui'
import type { Prompt, PromptBindingRelation } from '@shared/data/types/prompt'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type PromptTargetOption, PromptTargetPopover } from '../PromptTargetPopover'

const prompt: Prompt = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Targeted prompt',
  content: 'Available when linked',
  visibility: 'restricted',
  orderKey: 'a0',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z'
}
const assistantId = '22222222-2222-4222-8222-222222222222'
const assistant: PromptTargetOption = {
  value: `assistant:${assistantId}`,
  label: 'Assistant A',
  group: 'Assistants',
  target: { type: 'assistant', id: assistantId }
}
const agentId = '33333333-3333-4333-8333-333333333333'
const agent: PromptTargetOption = {
  value: `agent:${agentId}`,
  label: 'Agent B',
  group: 'Agents',
  target: { type: 'agent', id: agentId }
}
const binding: PromptBindingRelation = {
  promptId: prompt.id,
  targetType: 'assistant',
  targetId: assistantId
}

const mocks = vi.hoisted(() => ({
  bindTarget: vi.fn(),
  unbindTarget: vi.fn()
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  usePromptTargetMutations: () => ({ bindTarget: mocks.bindTarget, unbindTarget: mocks.unbindTarget })
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return importOriginal<typeof CherryStudioUi>()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; title?: string }) => {
      if (key === 'settings.prompts.binding.manageTargets') return `Manage ${options?.title}`
      if (key === 'settings.prompts.binding.searchTargets') return 'Search assistants or agents'
      if (key === 'settings.prompts.binding.noTargets') return 'No targets'
      if (key === 'settings.prompts.binding.unassigned') return 'Not assigned'
      if (key === 'common.no_results') return 'No results'
      if (options?.count !== undefined) return `${key}:${options.count}`
      return key
    }
  })
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.bindTarget.mockResolvedValue(undefined)
  mocks.unbindTarget.mockResolvedValue(undefined)
})

const renderPopover = (bindings: PromptBindingRelation[]) =>
  render(
    <PromptTargetPopover
      bindings={bindings}
      isLoadingBindings={false}
      isLoadingTargets={false}
      onRetry={vi.fn()}
      prompt={prompt}
      targets={[assistant, agent]}
    />
  )

describe('PromptTargetPopover', () => {
  it('groups targets and filters their names', async () => {
    const user = userEvent.setup()
    renderPopover([])

    await user.click(screen.getByRole('combobox', { name: 'Manage Targeted prompt' }))

    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
    expect(
      within(screen.getByRole('group', { name: 'Assistants' })).getByRole('option', { name: 'Assistant A' })
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'Agents' })).getByRole('option', { name: 'Agent B' })
    ).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search assistants or agents'), {
      target: { value: 'Agent B' }
    })

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Assistants' })).not.toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Agents' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Agent B' })).toBeInTheDocument()
    })
  })

  it('binds the prompt to an unselected target', async () => {
    const user = userEvent.setup()
    renderPopover([])

    await user.click(screen.getByRole('combobox', { name: 'Manage Targeted prompt' }))
    await user.click(screen.getByRole('option', { name: 'Assistant A' }))

    await waitFor(() =>
      expect(mocks.bindTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant', id: assistantId }))
    )
    expect(mocks.unbindTarget).not.toHaveBeenCalled()
  })

  it('shows the bound target and unbinds only that relation', async () => {
    const user = userEvent.setup()
    renderPopover([binding])

    const trigger = screen.getByRole('combobox', { name: 'Manage Targeted prompt' })
    expect(trigger).toHaveTextContent('Assistant A')
    await user.click(trigger)

    const selectedTarget = screen.getByRole('option', { name: 'Assistant A' })
    expect(selectedTarget).toHaveAttribute('aria-checked', 'true')
    await user.click(selectedTarget)

    await waitFor(() =>
      expect(mocks.unbindTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant', id: assistantId }))
    )
    expect(mocks.bindTarget).not.toHaveBeenCalled()
  })
})
