import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelSelectorDetailCard } from '../model/ModelSelectorDetailCard'
import type { ModelSelectorModelItem } from '../model/types'

const { mockGetModelSupportedReasoningEffortOptions } = vi.hoisted(() => ({
  mockGetModelSupportedReasoningEffortOptions: vi.fn()
}))

vi.mock('@renderer/config/models/reasoning', () => ({
  getModelSupportedReasoningEffortOptions: mockGetModelSupportedReasoningEffortOptions
}))

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: (id: string) => id
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'assistants.settings.reasoning_effort.default': 'Default',
        'assistants.settings.reasoning_effort.label': 'Reasoning Effort',
        'assistants.settings.reasoning_effort.xhigh': 'Extra High',
        'models.detail.context_window': 'Context window',
        'models.detail.max_input_tokens': 'Max input tokens',
        'models.detail.max_output_tokens': 'Max output tokens',
        'models.detail.model_id': 'Model ID',
        'models.detail.provider': 'Provider'
      }
      return labels[key] ?? key
    }
  })
}))

vi.mock('@renderer/components/Tags/Model', () => ({
  getModelDisplayTags: () => [],
  ModelTag: () => null
}))

vi.mock('@cherrystudio/ui', () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

const provider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  apiKeys: [],
  authType: 'api-key',
  apiFeatures: {} as Provider['apiFeatures'],
  settings: {} as Provider['settings'],
  isEnabled: true
} as Provider

function makeItem(model: Model): ModelSelectorModelItem {
  return {
    key: model.id,
    type: 'model',
    model,
    provider,
    modelId: model.id,
    modelIdentifier: model.apiModelId ?? model.id.split('::')[1],
    isPinned: false,
    showIdentifier: false
  }
}

describe('ModelSelectorDetailCard', () => {
  beforeEach(() => {
    mockGetModelSupportedReasoningEffortOptions.mockReturnValue([])
  })

  it('renders provider and model id as separate detail rows', () => {
    const model: Model = {
      id: 'openai::gpt-4o-mini' as UniqueModelId,
      providerId: provider.id,
      apiModelId: 'gpt-4o-mini',
      name: 'GPT-4o mini',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider}>
        <button type="button">GPT-4o mini</button>
      </ModelSelectorDetailCard>
    )

    expect(screen.getByText('Provider')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Model ID')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument()
    expect(screen.queryByText('/')).not.toBeInTheDocument()
  })

  it('renders reasoning options from getModelSupportedReasoningEffortOptions', () => {
    const model: Model = {
      id: 'openai::gpt-5-codex-max' as UniqueModelId,
      providerId: provider.id,
      apiModelId: 'gpt-5-codex-max',
      name: 'GPT-5 Codex Max',
      capabilities: [],
      supportsStreaming: true,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['max']
      },
      isEnabled: true,
      isHidden: false
    } as Model

    mockGetModelSupportedReasoningEffortOptions.mockReturnValue(['default', 'xhigh'])

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider}>
        <button type="button">GPT-5 Codex Max</button>
      </ModelSelectorDetailCard>
    )

    expect(mockGetModelSupportedReasoningEffortOptions).toHaveBeenCalledWith(model)
    expect(screen.getByText('Reasoning Effort')).toBeInTheDocument()
    expect(screen.getByText('Default, Extra High')).toBeInTheDocument()
    expect(screen.queryByText('max')).not.toBeInTheDocument()
  })
})
