import '@testing-library/jest-dom/vitest'

import type { Model } from '@shared/data/types/model'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  defaultModel: undefined as Model | undefined,
  quickModel: undefined as Model | undefined,
  translateModel: undefined as Model | undefined,
  setDefaultModel: vi.fn(),
  setQuickModel: vi.fn(),
  setTranslateModel: vi.fn(),
  setPaintingModel: vi.fn(),
  onDefaultModelSelected: vi.fn(),
  selectorCallbacks: [] as Array<(model: Model | undefined) => void>
}))

vi.mock('@cherrystudio/ui', () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Divider: () => <hr />,
  InfoTooltip: () => null,
  PageSidePanel: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  useIcon: () => undefined
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => ['', vi.fn()]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn() })
  }
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  getProviderDisplayName: () => undefined,
  ModelSelector: ({ onSelect, trigger }: { onSelect: (model: Model | undefined) => void; trigger: ReactNode }) => {
    harness.selectorCallbacks.push(onSelect)
    return trigger
  }
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({
    defaultModel: harness.defaultModel,
    quickModel: harness.quickModel,
    translateModel: harness.translateModel,
    paintingModel: undefined,
    setDefaultModel: harness.setDefaultModel,
    setQuickModel: harness.setQuickModel,
    setTranslateModel: harness.setTranslateModel,
    setPaintingModel: harness.setPaintingModel
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/pages/translate/TranslateSettings', () => ({
  TranslateSettingsPanelContent: () => null
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('@renderer/utils/model', () => ({
  getModelLogoRef: () => undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../TopicNamingSettings', () => ({
  TopicNamingSettings: () => null
}))

import ModelSettings from '../ModelSettings'

const createModel = (providerId: string, apiModelId: string): Model =>
  ({
    id: `${providerId}::${apiModelId}`,
    providerId,
    apiModelId,
    name: apiModelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }) as Model

describe('ModelSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.defaultModel = undefined
    harness.quickModel = undefined
    harness.translateModel = undefined
    harness.selectorCallbacks = []
    harness.setDefaultModel.mockResolvedValue(undefined)
    harness.setQuickModel.mockResolvedValue(undefined)
    harness.setTranslateModel.mockResolvedValue(undefined)
    harness.onDefaultModelSelected.mockResolvedValue(undefined)
  })

  it('forces related models to follow the first visible default selection', async () => {
    const hiddenModel = createModel('cherryai', 'built-in')
    const selectedModel = createModel('openai', 'gpt-4o')
    harness.defaultModel = hiddenModel
    harness.quickModel = hiddenModel
    harness.translateModel = hiddenModel

    render(
      <ModelSettings
        autoFillEmptyModels
        modelFilter={(model) => model.providerId !== 'cherryai'}
        onDefaultModelSelected={harness.onDefaultModelSelected}
        showPaintingModel={false}
        showSettingsButton={false}
      />
    )

    act(() => harness.selectorCallbacks[0](selectedModel))

    await waitFor(() => expect(harness.setDefaultModel).toHaveBeenCalledWith(selectedModel, { forceCascade: true }))
    expect(harness.onDefaultModelSelected).toHaveBeenCalledWith(selectedModel)
  })

  it('does not fill the other models when any visible model is already selected', async () => {
    const selectedModel = createModel('openai', 'gpt-4o')
    harness.quickModel = createModel('openai', 'gpt-4o-mini')

    render(
      <ModelSettings
        autoFillEmptyModels
        modelFilter={(model) => model.providerId !== 'cherryai'}
        showPaintingModel={false}
        showSettingsButton={false}
      />
    )

    act(() => harness.selectorCallbacks[0](selectedModel))

    await waitFor(() => expect(harness.setDefaultModel).toHaveBeenCalledWith(selectedModel))
    expect(harness.setQuickModel).not.toHaveBeenCalled()
    expect(harness.setTranslateModel).not.toHaveBeenCalled()
  })
})
