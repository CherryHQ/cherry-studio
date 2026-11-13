import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { toast } from '@renderer/services/toast'
import type { MarketplaceTemplate } from '@renderer/types/marketplace'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  openRoute: vi.fn(),
  wizardProps: undefined as any
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/create', () => ({
  ResourceCreateWizard: (props: any) => {
    mocks.wizardProps = props
    return (
      <div data-testid="create-wizard" data-open={String(props.open)}>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close wizard
        </button>
      </div>
    )
  }
}))
vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAgentMutations: () => ({ createAgent: mocks.createAgent, isCreatingAgent: false })
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openRoute: mocks.openRoute }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } })
}))

import { MarketplaceTemplates } from '../MarketplaceTemplates'

const template: MarketplaceTemplate = {
  id: 'pm',
  name: 'Product manager',
  description: 'Plan products',
  avatar: '👨‍💼',
  prompt: 'You plan products.',
  groups: []
}

function renderTemplates() {
  render(<MarketplaceTemplates items={[template]} query="" loading={false} error={null} retry={vi.fn()} active />)
  fireEvent.click(screen.getByRole('button', { name: 'common.add: Product manager' }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  mocks.wizardProps = undefined
})

describe('MarketplaceTemplates create', () => {
  it('creates from the template and resolves the new agent id for the result page', async () => {
    mocks.createAgent.mockResolvedValue({ id: 'agent-new' })
    renderTemplates()

    expect(mocks.wizardProps.initialValues).toMatchObject({ name: 'Product manager', prompt: 'You plan products.' })
    await expect(
      mocks.wizardProps.onSubmit({ name: 'Product manager', modelId: 'p::m', agentType: 'pi-durable' })
    ).resolves.toBe('agent-new')
    expect(toast.success).toHaveBeenCalledWith('common.add_success')
  })

  it("opens the new agent's conversation from the start action", () => {
    renderTemplates()

    mocks.wizardProps.onStartConversation('agent-new')

    expect(mocks.openRoute).toHaveBeenCalledExactlyOnceWith('/app/agents', { agentId: 'agent-new' })
  })

  it('keeps the wizard mounted after it closes so an edit dialog it opened survives', () => {
    vi.useFakeTimers()
    renderTemplates()

    fireEvent.click(screen.getByRole('button', { name: 'close wizard' }))
    act(() => {
      vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS * 2)
    })

    expect(screen.getByTestId('create-wizard')).toHaveAttribute('data-open', 'false')
  })
})
