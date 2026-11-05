import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { ChatConversationControls } from '../ChatConversationControls'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18nextModule>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  getProviderDisplayName: (provider: Provider) => provider.name,
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AssistantSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))

vi.mock('@renderer/components/composer/variants/SelectedModelsTrigger', () => ({
  SelectedModelsTrigger: () => null
}))

describe('ChatConversationControls', () => {
  it.each([true, false])('keeps provider identity available when showProviderName is %s', (showProviderName) => {
    const provider = {
      id: 'minimax',
      name: 'MiniMax',
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      settings: {} as Provider['settings'],
      isEnabled: true
    } as Provider
    const model = {
      id: 'minimax::MiniMax-M3',
      providerId: provider.id,
      name: 'MiniMax-M3',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model

    render(
      <ChatConversationControls
        showProviderName={showProviderName}
        assistantId="assistant"
        assistantName="Assistant"
        model={model}
        providers={[provider]}
        mentionedModels={[]}
        mentionedModelSelectorValue={[]}
        lockedMentionedModels={[]}
        mentionedModelMultiSelectMode={false}
        selectModelLabel="Select model"
        shouldAutoSelectCreatedAssistant={false}
        side="top"
        onAssistantChange={vi.fn()}
        onModelSelect={vi.fn()}
        onMentionedModelsSelect={vi.fn()}
        onMentionedModelMultiSelectModeChange={vi.fn()}
        onMentionedModelSelectorRestore={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: showProviderName ? 'MiniMax-M3 | MiniMax' : 'MiniMax-M3' })
    ).toBeInTheDocument()
    expect(screen.getByText(showProviderName ? 'MiniMax-M3 | MiniMax' : 'MiniMax-M3')).toHaveAttribute(
      'title',
      'MiniMax-M3 | MiniMax'
    )
  })

  it('keeps the canonical provider name while provider metadata is loading', () => {
    const model = {
      id: 'minimax::MiniMax-M3',
      providerId: 'minimax',
      name: 'MiniMax-M3',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model

    render(
      <ChatConversationControls
        assistantId="assistant"
        assistantName="Assistant"
        model={model}
        providers={[]}
        mentionedModels={[]}
        mentionedModelSelectorValue={[]}
        lockedMentionedModels={[]}
        mentionedModelMultiSelectMode={false}
        selectModelLabel="Select model"
        shouldAutoSelectCreatedAssistant={false}
        side="top"
        onAssistantChange={vi.fn()}
        onModelSelect={vi.fn()}
        onMentionedModelsSelect={vi.fn()}
        onMentionedModelMultiSelectModeChange={vi.fn()}
        onMentionedModelSelectorRestore={vi.fn()}
      />
    )

    expect(screen.getByText('MiniMax-M3 | MiniMax')).toBeInTheDocument()
  })
})
