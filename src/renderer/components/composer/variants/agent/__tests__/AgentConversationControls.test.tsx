import type { ModelSelectorProps } from '@renderer/components/ModelSelector'
import type { Model } from '@shared/data/types/model'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AgentConversationControls } from '../AgentConversationControls'

const mocks = vi.hoisted(() => ({
  availableModel: {
    id: 'cherryai-subscription::available',
    providerId: 'cherryai-subscription',
    name: 'Available cloud model',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } satisfies Model,
  exhaustedModel: {
    id: 'cherryai-subscription::exhausted',
    providerId: 'cherryai-subscription',
    name: 'Exhausted cloud model',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } satisfies Model,
  regularModel: {
    id: 'openai::regular',
    providerId: 'openai',
    name: 'Regular provider model',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } satisfies Model
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({ default: () => null }))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger, getModelDetailDescription, isModelDisabled }: ModelSelectorProps) => (
    <div>
      {trigger}
      {[
        { key: 'available', model: mocks.availableModel },
        { key: 'exhausted', model: mocks.exhaustedModel },
        { key: 'regular', model: mocks.regularModel }
      ].map(({ key, model }) => (
        <button key={key} type="button" disabled={isModelDisabled?.(model)}>
          <span data-testid={`${key}-description`}>{getModelDetailDescription?.(model)}</span>
        </button>
      ))}
    </div>
  )
}))

vi.mock('@renderer/components/OpenTarget', () => ({
  OpenTargetButton: ({ menuTrigger }: { menuTrigger: ReactNode }) => menuTrigger
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({ trigger }: { trigger: ReactNode }) => trigger,
  WorkspaceSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelAvailability: () => ({
    getModelQuotaStatus: (model: Model) => {
      if (model.id === mocks.availableModel.id) return 'available'
      if (model.id === mocks.exhaustedModel.id) return 'exhausted'
      return undefined
    },
    isModelDisabled: (model: Model) => model.id === mocks.exhaustedModel.id
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({ useProviderDisplayName: () => undefined }))
vi.mock('@renderer/utils/naming', () => ({ getProviderDisplayNameById: (providerId: string) => providerId }))
vi.mock('@renderer/utils/style', () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(' ') }))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.session.workspace_selector.no_project': 'No project',
        'models.detail.free_quota_exhausted': '免费额度已用完，待重置',
        'models.detail.limited_time_free': '限时免费，仅限于工作模块内使用'
      })[key] ?? key
  })
}))

describe('AgentConversationControls', () => {
  it('maps Work model quota status to descriptions and disabled state', () => {
    render(
      <AgentConversationControls
        selectAgentLabel="Select agent"
        selectModelLabel="Select model"
        selectWorkspaceLabel="Select project"
        shouldAutoSelectCreatedAgent={false}
        side="bottom"
        agentTriggerMode="selector"
        canChangeModel
        onAgentChange={vi.fn()}
        onModelSelect={vi.fn()}
      />
    )

    expect(screen.getByTestId('available-description')).toHaveTextContent('限时免费，仅限于工作模块内使用')
    expect(screen.getByTestId('exhausted-description')).toHaveTextContent('免费额度已用完，待重置')
    expect(screen.getByTestId('exhausted-description').closest('button')).toBeDisabled()
    expect(screen.getByTestId('regular-description')).toBeEmptyDOMElement()
    expect(screen.getByTestId('regular-description').closest('button')).not.toBeDisabled()
  })
})
