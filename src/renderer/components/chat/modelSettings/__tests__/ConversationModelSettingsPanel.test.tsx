import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import { ConversationModelSettingsPanel } from '../ConversationModelSettingsPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <div data-testid="model-avatar" />
}))

vi.mock('@renderer/components/ModelSpeedControl', () => ({
  ModelSpeedControlFields: () => <div data-testid="model-speed-fields" />,
  modelSpeedControlHasVisibleControls: () => true
}))

const baseModel: Model = {
  id: 'openai::gpt-4',
  name: 'GPT-4',
  providerId: 'openai',
  capabilities: [MODEL_CAPABILITY.REASONING],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  parameterSupport: {
    temperature: { supported: true, range: { min: 0, max: 2 } },
    topP: { supported: false },
    maxTokens: true
  }
}

describe('ConversationModelSettingsPanel', () => {
  it('shows assistant sampling controls gated by model parameter support', () => {
    render(
      <ConversationModelSettingsPanel
        active
        model={baseModel}
        settings={{ ...DEFAULT_ASSISTANT_SETTINGS }}
        reasoningEffort="default"
        serviceTier="standard"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onServiceTierChange={vi.fn()}
        onFastModeChange={vi.fn()}
        onPatchSettings={vi.fn()}
      />
    )

    expect(screen.getByText('library.config.basic.temperature')).toBeInTheDocument()
    expect(screen.queryByText('library.config.basic.top_p')).not.toBeInTheDocument()
    expect(screen.getByText('library.config.basic.max_tokens')).toBeInTheDocument()
    expect(screen.getByTestId('model-speed-fields')).toBeInTheDocument()
  })

  it('prompts for an assistant when the conversation has none', () => {
    render(
      <ConversationModelSettingsPanel
        active
        missingAssistant
        reasoningEffort="default"
        serviceTier="standard"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onServiceTierChange={vi.fn()}
        onFastModeChange={vi.fn()}
        onPatchSettings={vi.fn()}
      />
    )

    expect(screen.getByText('chat.model_settings.no_assistant.title')).toBeInTheDocument()
  })
})
