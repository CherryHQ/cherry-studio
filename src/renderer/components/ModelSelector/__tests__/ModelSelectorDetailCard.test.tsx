import type * as ModelModule from '@renderer/utils/model'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, render, screen } from '@testing-library/react'
import type { ReactNode, Ref } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelSelectorDetailCard } from '../ModelSelectorDetailCard'
import type { ModelSelectorModelItem } from '../types'

const { mockGetModelSupportedReasoningEffortOptions, mockHoverCardContentProps, mockHoverCardOpenChange } = vi.hoisted(
  () => ({
    mockGetModelSupportedReasoningEffortOptions: vi.fn(),
    mockHoverCardContentProps: [] as Array<{
      className?: string
      side?: string
      align?: string
      collisionPadding?: number
      portalContainer?: HTMLElement | null
    }>,
    mockHoverCardOpenChange: { current: undefined as ((open: boolean) => void) | undefined }
  })
)

vi.mock('@renderer/utils/model', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelModule>()),
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

vi.mock('@renderer/components/tags/Model', () => ({
  getModelDisplayTags: () => [],
  ModelTag: () => null
}))

vi.mock('@cherrystudio/ui', () => ({
  HoverCard: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => {
    mockHoverCardOpenChange.current = onOpenChange
    return <>{children}</>
  },
  HoverCardContent: ({
    children,
    className,
    side,
    align,
    collisionPadding,
    portalContainer
  }: {
    children: ReactNode
    className?: string
    side?: string
    align?: string
    collisionPadding?: number
    portalContainer?: HTMLElement | null
  }) => {
    mockHoverCardContentProps.push({ className, side, align, collisionPadding, portalContainer })
    return <div className={className}>{children}</div>
  },
  HoverCardTrigger: ({ children, ref }: { children: ReactNode; ref?: Ref<HTMLSpanElement> }) => (
    <span ref={ref}>{children}</span>
  )
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

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4o-mini' as UniqueModelId,
    providerId: provider.id,
    apiModelId: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    mockGetModelSupportedReasoningEffortOptions.mockReturnValue([])
    mockHoverCardContentProps.length = 0
    mockHoverCardOpenChange.current = undefined
  })

  it('renders provider and model id as separate detail rows', () => {
    const model = makeModel()

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

  it('constrains the hover card to Radix available space', () => {
    const model = makeModel()

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider}>
        <button type="button">GPT-4o mini</button>
      </ModelSelectorDetailCard>
    )

    expect(mockHoverCardContentProps.at(-1)).toMatchObject({
      side: 'right',
      align: 'start',
      collisionPadding: 12
    })
    expect(mockHoverCardContentProps.at(-1)?.className).toContain('max-w-(--radix-hover-card-content-available-width)')
  })

  it('places the hover card below the row when neither horizontal side fits', () => {
    const model = makeModel()

    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(280)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(700)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      width: 100,
      height: 36,
      top: 100,
      right: 200,
      bottom: 136,
      left: 100,
      toJSON: () => {}
    })

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider}>
        <button type="button">GPT-4o mini</button>
      </ModelSelectorDetailCard>
    )

    act(() => mockHoverCardOpenChange.current?.(true))

    expect(mockHoverCardContentProps.at(-1)).toMatchObject({
      side: 'bottom',
      align: 'center'
    })
  })

  it('uses the portal container bounds when choosing a horizontal side', () => {
    const model = makeModel()
    const portalContainer = document.createElement('div')
    portalContainer.dataset.testPortal = 'true'

    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1200)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(700)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
      if (this.dataset.testPortal === 'true') {
        return {
          x: 180,
          y: 120,
          width: 680,
          height: 420,
          top: 120,
          right: 860,
          bottom: 540,
          left: 180,
          toJSON: () => {}
        } as DOMRect
      }

      return {
        x: 560,
        y: 180,
        width: 280,
        height: 36,
        top: 180,
        right: 840,
        bottom: 216,
        left: 560,
        toJSON: () => {}
      } as DOMRect
    })

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider} portalContainer={portalContainer}>
        <button type="button">GPT-4o mini</button>
      </ModelSelectorDetailCard>
    )

    act(() => mockHoverCardOpenChange.current?.(true))

    expect(mockHoverCardContentProps.at(-1)).toMatchObject({
      side: 'left',
      align: 'start',
      portalContainer
    })
  })

  it('renders reasoning options from getModelSupportedReasoningEffortOptions', () => {
    const model = makeModel({
      id: 'openai::gpt-5-codex-max' as UniqueModelId,
      apiModelId: 'gpt-5-codex-max',
      name: 'GPT-5 Codex Max',
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['max']
      }
    })

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
