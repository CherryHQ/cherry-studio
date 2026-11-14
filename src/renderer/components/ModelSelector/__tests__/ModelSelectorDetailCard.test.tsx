import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import type { ReactNode, Ref } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as I18nLabelModule from '@renderer/i18n/label'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { ModelSelectorDetailCard } from '../ModelSelectorDetailCard'
import type { ModelSelectorModelItem } from '../types'

const { mockHoverCardContentProps, mockHoverCardProps, mockHoverCardOpenChange } = vi.hoisted(() => ({
  mockHoverCardContentProps: [] as Array<{
    className?: string
    side?: string
    align?: string
    collisionBoundary?: Element
    collisionPadding?: number
    avoidCollisions?: boolean
    portalContainer?: DocumentFragment | Element | null
  }>,
  mockHoverCardProps: [] as Array<{
    openDelay?: number
    closeDelay?: number
  }>,
  mockHoverCardOpenChange: { current: undefined as ((open: boolean) => void) | undefined }
}))

vi.mock('@renderer/i18n/label', async (importOriginal) => ({
  ...(await importOriginal<typeof I18nLabelModule>()),
  getProviderLabel: (id: string) => id
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'assistants.settings.reasoning_effort.default': 'Default',
        'assistants.settings.reasoning_effort.label': 'Reasoning Effort',
        'assistants.settings.reasoning_effort.max': 'Max',
        'assistants.settings.reasoning_effort.ultra': 'Ultra',
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
  HoverCard: ({
    children,
    openDelay,
    closeDelay,
    onOpenChange
  }: {
    children: ReactNode
    openDelay?: number
    closeDelay?: number
    onOpenChange?: (open: boolean) => void
  }) => {
    mockHoverCardProps.push({ openDelay, closeDelay })
    mockHoverCardOpenChange.current = onOpenChange
    return <>{children}</>
  },
  HoverCardContent: ({
    children,
    className,
    side,
    align,
    collisionBoundary,
    collisionPadding,
    avoidCollisions,
    portalContainer
  }: {
    children: ReactNode
    className?: string
    side?: string
    align?: string
    collisionBoundary?: Element
    collisionPadding?: number
    avoidCollisions?: boolean
    portalContainer?: DocumentFragment | Element | null
  }) => {
    mockHoverCardContentProps.push({
      className,
      side,
      align,
      collisionBoundary,
      collisionPadding,
      avoidCollisions,
      portalContainer
    })
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
  reportsActualCost: false,
  settings: {},
  isEnabled: true
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4o-mini',
    providerId: provider.id,
    apiModelId: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

function makeItem(model: Model): ModelSelectorModelItem {
  return {
    key: model.id,
    type: 'model',
    groupKind: 'provider',
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
    mockHoverCardContentProps.length = 0
    mockHoverCardProps.length = 0
    mockHoverCardOpenChange.current = undefined
  })

  it('renders the Codex account identity in the detail card', () => {
    mockUseQuery.mockImplementation(
      (path, options) =>
        ({
          data:
            path === '/providers/:providerId/auth-config'
              ? {
                  accountId:
                    (options as { params?: { providerId?: string } } | undefined)?.params?.providerId === 'first'
                      ? 'account-a'
                      : 'account-b'
                }
              : null
        }) as never
    )
    const item = makeItem(makeModel())
    const first = { ...provider, id: 'first', name: 'Shared', presetProviderId: 'openai-codex' }
    const second = { ...first, id: 'second' }
    const { rerender } = render(
      <ModelSelectorDetailCard item={{ ...item, provider: first }} provider={first}>
        <span>row</span>
      </ModelSelectorDetailCard>
    )
    expect(screen.getByText('Shared · account-a')).toBeInTheDocument()
    rerender(
      <ModelSelectorDetailCard item={{ ...item, provider: second }} provider={second}>
        <span>row</span>
      </ModelSelectorDetailCard>
    )
    expect(screen.getByText('Shared · account-b')).toBeInTheDocument()
  })

  it('renders a caller-provided model description', () => {
    const model = makeModel()

    render(
      <ModelSelectorDetailCard
        item={makeItem(model)}
        provider={provider}
        description="Limited-time free, available only in the Work module">
        <button type="button">GPT-4o mini</button>
      </ModelSelectorDetailCard>
    )

    expect(screen.getByText('Limited-time free, available only in the Work module')).toBeInTheDocument()
  })

  it('renders numeric zero descriptions', () => {
    const model = makeModel()

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider} description={0}>
        <button type="button">GPT-4o mini</button>
      </ModelSelectorDetailCard>
    )

    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('renders reasoning options derived from the descriptor', () => {
    const model = makeModel({
      id: 'openai::gpt-5-codex-max',
      apiModelId: 'gpt-5-codex-max',
      name: 'GPT-5 Codex Max',
      reasoning: {
        selectableEfforts: ['max']
      }
    })

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider}>
        <button type="button">GPT-5 Codex Max</button>
      </ModelSelectorDetailCard>
    )

    // Derived from the descriptor via deriveThinkingOptions ('default' is
    // filtered out of the display; 'max' renders its i18n label).
    expect(screen.getByText('Reasoning Effort')).toBeInTheDocument()
    expect(screen.getByText('Max')).toBeInTheDocument()
  })

  it('renders the localized Ultra effort for GPT-6 Astra', () => {
    const model = makeModel({
      id: 'openai-codex::gpt-6-astra',
      providerId: 'openai-codex',
      apiModelId: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      reasoning: { selectableEfforts: ['ultra'] }
    })

    render(
      <ModelSelectorDetailCard item={makeItem(model)} provider={provider}>
        <button type="button">GPT-6 Astra</button>
      </ModelSelectorDetailCard>
    )

    expect(screen.getByText('Ultra')).toBeInTheDocument()
  })
})
