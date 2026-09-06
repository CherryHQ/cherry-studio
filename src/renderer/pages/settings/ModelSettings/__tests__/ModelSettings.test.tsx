import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
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
  selectorCallbacks: [] as Array<(model: Model | undefined) => void>,
  selectorFilters: [] as Array<((model: Model) => boolean) | undefined>,
  preferenceValues: {} as Record<string, unknown>,
  preferenceSetters: {} as Record<string, ReturnType<typeof vi.fn>>
}))

const setTimeoutTimerMock = vi.hoisted(() => vi.fn())
const matchMediaMock = vi.hoisted(() => vi.fn())

Element.prototype.scrollIntoView = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()

  return {
    ...actual,
    Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
    Divider: () => <hr />,
    InfoTooltip: () => null,
    Input: (props: ComponentProps<'input'>) => <input {...props} />,
    PageSidePanel: () => null,
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: ComponentProps<'button'> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
      <button type="button" aria-pressed={checked} onClick={() => onCheckedChange?.(!checked)} {...props} />
    ),
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
  }
})

vi.mock('@cherrystudio/ui/icons', () => ({
  useIcon: () => undefined
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const setter = (harness.preferenceSetters[key] ??= vi.fn())
    return [harness.preferenceValues[key], setter]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn() })
  }
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  getProviderDisplayName: () => undefined,
  ModelSelector: ({
    onSelect,
    trigger,
    filter
  }: {
    onSelect: (model: Model | undefined) => void
    trigger: ReactNode
    filter?: (model: Model) => boolean
  }) => {
    harness.selectorCallbacks.push(onSelect)
    harness.selectorFilters.push(filter)
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

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: setTimeoutTimerMock })
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

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => {
    throw new Error('useSearch must not be called from ModelSettings')
  }
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
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMediaMock.mockReturnValue({ matches: false })
    })
    harness.defaultModel = undefined
    harness.quickModel = undefined
    harness.translateModel = undefined
    harness.selectorCallbacks = []
    harness.selectorFilters = []
    harness.preferenceValues = {}
    harness.preferenceSetters = {}
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

  it('combines the onboarding provider filter with non-chat model filtering', () => {
    render(
      <ModelSettings
        modelFilter={(model) => model.providerId !== 'cherryai'}
        showPaintingModel={false}
        showSettingsButton={false}
      />
    )

    const filter = harness.selectorFilters[0]!
    expect(filter(createModel('openai', 'gpt-4o'))).toBe(true)
    expect(filter(createModel('cherryai', 'qwen'))).toBe(false)
    expect(
      filter({ ...createModel('openai', 'text-embedding-3-small'), capabilities: [MODEL_CAPABILITY.EMBEDDING] })
    ).toBe(false)
    expect(
      filter({
        ...createModel('new-api', 'opaque-embedding-model'),
        endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]
      })
    ).toBe(false)
    expect(
      filter({
        ...createModel('openai', 'whisper-1'),
        capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION],
        inputModalities: ['audio'],
        outputModalities: ['text']
      })
    ).toBe(false)
  })

  it.each([
    ['default', 'settings.models.default_assistant_model'],
    ['translate', 'settings.models.translate_model']
  ] as const)('points to the %s model selector requested by the route', (focus, expectedTitle) => {
    render(<ModelSettings focus={focus} showPaintingModel={false} showSettingsButton={false} />)

    const scrollTarget = vi.mocked(Element.prototype.scrollIntoView).mock.instances[0]
    expect(scrollTarget).toHaveTextContent(expectedTitle)

    const focusGuide = screen.getByTestId('model-settings-focus-guide')
    expect(focusGuide).toBeInTheDocument()
    expect(focusGuide).toHaveClass('motion-reduce:!animate-none', 'motion-reduce:-translate-y-1/2')
    expect(screen.getAllByTestId('model-settings-focus-guide')).toHaveLength(1)
    expect(setTimeoutTimerMock).toHaveBeenCalledWith('model-settings-focus-guide', expect.any(Function), 1200)

    const timerCallback = setTimeoutTimerMock.mock.calls[0][1]
    act(() => {
      void timerCallback()
    })
    expect(screen.queryByTestId('model-settings-focus-guide')).not.toBeInTheDocument()
  })

  it('avoids smooth scrolling when reduced motion is requested', () => {
    matchMediaMock.mockReturnValue({ matches: true })

    render(<ModelSettings focus="default" showPaintingModel={false} showSettingsButton={false} />)

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest'
    })
  })

  it('renders off-router (onboarding compact) without calling useSearch', () => {
    expect(() => render(<ModelSettings compact showPaintingModel={false} showSettingsButton={false} />)).not.toThrow()
  })
})
