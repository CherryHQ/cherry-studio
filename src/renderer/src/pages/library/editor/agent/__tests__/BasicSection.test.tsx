import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentFormState } from '../descriptor'
import BasicSection from '../sections/BasicSection'

const models = [
  { id: 'anthropic::claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic::claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'anthropic::claude-opus-4-5', name: 'Claude Opus 4.5' }
]

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: () => ({ models, isLoading: false })
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger, onSelect }: { trigger: ReactNode; onSelect: (modelId: string | undefined) => void }) => (
    <div>
      <div data-testid="model-selector-trigger">{trigger}</div>
      <button type="button" onClick={() => onSelect('anthropic::claude-sonnet-4-5')}>
        select main
      </button>
      <button type="button" onClick={() => onSelect('anthropic::claude-haiku-4-5')}>
        select plan
      </button>
      <button type="button" onClick={() => onSelect('anthropic::claude-opus-4-5')}>
        select small
      </button>
      <button type="button" onClick={() => onSelect(undefined)}>
        clear via selector
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/EmojiPicker', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🧠')}>
      pick emoji
    </button>
  )
}))

function createForm(overrides: Partial<AgentFormState> = {}): AgentFormState {
  return {
    name: 'Agent',
    description: '',
    model: '',
    planModel: '',
    smallModel: '',
    instructions: '',
    accessiblePaths: [],
    mcps: [],
    allowedTools: [],
    avatar: '',
    permissionMode: '',
    maxTurns: 0,
    envVarsText: '',
    soulEnabled: false,
    heartbeatEnabled: false,
    heartbeatInterval: 0,
    tags: [],
    ...overrides
  }
}

describe('BasicSection agent model selectors', () => {
  it('writes selected UniqueModelIds directly into each agent model field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<BasicSection form={createForm()} onChange={onChange} tagColorByName={new Map()} allTagNames={[]} />)

    await user.click(screen.getAllByRole('button', { name: 'select main' })[0])
    await user.click(screen.getAllByRole('button', { name: 'select plan' })[1])
    await user.click(screen.getAllByRole('button', { name: 'select small' })[2])

    expect(onChange).toHaveBeenCalledWith({ model: 'anthropic::claude-sonnet-4-5' })
    expect(onChange).toHaveBeenCalledWith({ planModel: 'anthropic::claude-haiku-4-5' })
    expect(onChange).toHaveBeenCalledWith({ smallModel: 'anthropic::claude-opus-4-5' })
  })

  it('clears optional plan and small model fields to empty strings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <BasicSection
        form={createForm({
          model: 'anthropic::claude-sonnet-4-5',
          planModel: 'anthropic::claude-haiku-4-5',
          smallModel: 'anthropic::claude-opus-4-5'
        })}
        onChange={onChange}
        tagColorByName={new Map()}
        allTagNames={[]}
      />
    )

    await user.click(
      screen.getByRole('button', {
        name: 'library.config.agent.field.plan_model.label library.config.basic.model_clear'
      })
    )
    await user.click(
      screen.getByRole('button', {
        name: 'library.config.agent.field.small_model.label library.config.basic.model_clear'
      })
    )

    expect(onChange).toHaveBeenCalledWith({ planModel: '' })
    expect(onChange).toHaveBeenCalledWith({ smallModel: '' })
  })
})
