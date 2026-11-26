import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SERVER_TOOL_MODEL_SCOPE } from '@cherrystudio/provider-registry'
import ModelTagsWithLabel from '@renderer/pages/settings/ProviderSettings/components/ModelTagsWithLabel'
import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY, type Model, SERVER_TOOL } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { getModelDisplayTags, ModelTag } from '../ModelTag'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  CustomTag: ({ tooltip, children }: { tooltip?: string; children?: React.ReactNode }) => (
    <span data-testid="model-tag" data-tooltip={tooltip}>
      {children}
    </span>
  )
}))

const createProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'openai',
  presetProviderId: 'openai',
  name: 'OpenAI',
  apiKeys: [],
  authType: 'api-key',
  reportsActualCost: false,
  settings: {},
  isEnabled: true,
  defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
  ...overrides
})

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'openai::test-model',
  providerId: 'openai',
  apiModelId: 'test-model',
  name: 'Test Model',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  ...overrides
})

function collectTooltips(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="model-tag"]'))
    .map((node) => node.getAttribute('data-tooltip'))
    .filter((value): value is string => Boolean(value))
}

describe('Model capability badge consistency', () => {
  it.each([
    {
      name: 'shows reasoning, vision, and web-search badges when declared',
      model: createModel({
        capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.IMAGE_RECOGNITION],
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
      }),
      provider: createProvider({
        serverTools: [
          {
            id: SERVER_TOOL.WEB_SEARCH,
            modelScope: SERVER_TOOL_MODEL_SCOPE.ALL_CHAT_MODELS,
            endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
          }
        ]
      }),
      expectedTooltips: ['models.type.vision', 'models.type.reasoning', 'models.type.websearch']
    },
    {
      name: 'shows vision badge when declared via image input modality only',
      model: createModel({
        capabilities: [],
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
      }),
      provider: createProvider(),
      expectedTooltips: ['models.type.vision']
    },
    {
      name: 'shows nothing when no capability, modality, or server tool is declared',
      model: createModel({
        capabilities: [],
        inputModalities: [MODALITY.TEXT]
      }),
      provider: createProvider(),
      expectedTooltips: []
    },
    {
      name: 'does not invent web-search badge for Cherry Cloud models without serverTools',
      model: createModel({
        id: 'cherryai-subscription::deepseek-r1',
        providerId: 'cherryai-subscription',
        capabilities: [MODEL_CAPABILITY.REASONING],
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      }),
      provider: createProvider({
        id: 'cherryai-subscription',
        presetProviderId: 'cherryai',
        name: 'CherryAI',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      }),
      expectedTooltips: ['models.type.reasoning']
    }
  ])(
    '$name consistently across home selector tags and settings model list tags',
    ({ model, provider, expectedTooltips }) => {
      const selectorTags = getModelDisplayTags(model, undefined, provider)
      const selectorRender = render(
        <div>
          {selectorTags.map((tag) => (
            <ModelTag key={tag} tag={tag} showLabel={false} showTooltip />
          ))}
        </div>
      )
      const settingsRender = render(<ModelTagsWithLabel model={model} provider={provider} showTooltip />)

      expect(collectTooltips(selectorRender.container)).toEqual(expectedTooltips)
      expect(collectTooltips(settingsRender.container)).toEqual(expectedTooltips)
    }
  )
})
