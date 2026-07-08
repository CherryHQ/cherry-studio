import type * as ModelModule from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelListSyncDrawer from '../ModelListSyncDrawer'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({ children, loading, ...props }: any) => {
      Reflect.deleteProperty(props, 'asChild')
      return (
        <button type="button" data-loading={loading ? 'true' : 'false'} {...props}>
          {children}
        </button>
      )
    },
    Tooltip: ({ children }: any) => children,
    Spinner: () => <div data-testid="spinner" />,
    EmptyState: ({ title }: any) => <div>{title}</div>
  }
})

vi.mock('@renderer/utils/model', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelModule>()),
  getModelLogo: () => null
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({ list, children, className, getItemKey }: any) => (
    <div className={className}>
      {list.map((item: unknown, index: number) => (
        <div key={getItemKey?.(index) ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('../../components/ModelTagsWithLabel', () => ({
  default: () => null
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, titleActions, children, footer, bodyClassName, contentClassName }: any) =>
    open ? (
      <div data-testid="drawer-content" className={contentClassName}>
        <header>
          <h1>{title}</h1>
          {titleActions}
        </header>
        <div data-testid="drawer-body" className={bodyClassName}>
          {children}
        </div>
        <footer>{footer}</footer>
      </div>
    ) : null
}))

const allModels: Model[] = [
  {
    id: 'openai::gpt-5',
    providerId: 'openai',
    apiModelId: 'gpt-5',
    name: 'GPT 5',
    group: 'OpenAI',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  },
  {
    id: 'openai::claude-sonnet',
    providerId: 'openai',
    apiModelId: 'claude-sonnet',
    name: 'Claude Sonnet',
    group: 'Anthropic',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  },
  {
    id: 'openai::legacy-model',
    providerId: 'openai',
    apiModelId: 'legacy-model',
    name: 'Legacy Model',
    group: 'OpenAI',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  },
  {
    id: 'openai::custom-model',
    providerId: 'openai',
    apiModelId: 'custom-model',
    name: 'Custom Model',
    group: undefined,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
] as Model[]

const localModels = [allModels[2]]

function renderDrawer(props: Partial<React.ComponentProps<typeof ModelListSyncDrawer>> = {}) {
  return render(
    <ModelListSyncDrawer
      open
      provider={{ id: 'openai', name: 'OpenAI' } as any}
      allModels={[...allModels]}
      localModels={[...localModels]}
      isLoading={false}
      isApplying={false}
      onAddModels={vi.fn()}
      onRemoveModels={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )
}

describe('ModelListSyncDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the provider model management drawer', () => {
    renderDrawer()

    expect(screen.getByText('OpenAI common.models')).toBeInTheDocument()
    expect(screen.getByTestId('drawer-content')).toHaveClass('w-[min(calc(100vw-24px),620px)]')
    expect(screen.getByTestId('drawer-body')).toHaveClass('pt-0')
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument()
    expect(screen.getByText('legacy-model')).toBeInTheDocument()
  })

  it('renders a fallback group for models without explicit groups', () => {
    renderDrawer()

    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.queryByText('assistants.tags.untagged')).not.toBeInTheDocument()
    expect(screen.queryByText('__ungrouped__')).not.toBeInTheDocument()
  })

  it('filters model rows by search text', () => {
    renderDrawer()

    fireEvent.change(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder'), {
      target: { value: 'claude' }
    })

    expect(screen.queryByText('gpt-5')).not.toBeInTheDocument()
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument()
    expect(screen.queryByText('legacy-model')).not.toBeInTheDocument()
  })

  it('clears model search', () => {
    renderDrawer()

    fireEvent.change(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder'), {
      target: { value: 'legacy' }
    })
    expect(screen.queryByText('gpt-5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))

    expect(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder')).toHaveValue('')
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
  })

  it('adds all filtered models that are not already local', () => {
    const onAddModels = vi.fn()
    renderDrawer({ onAddModels })

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.manage.add_listed.label' }))

    expect(onAddModels).toHaveBeenCalledWith([allModels[0], allModels[1], allModels[3]])
  })

  it('removes all filtered models when every filtered model is local', () => {
    const onRemoveModels = vi.fn()
    renderDrawer({ localModels: [allModels[2]], onRemoveModels })

    fireEvent.change(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder'), {
      target: { value: 'legacy' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.models.manage.remove_listed' }))

    expect(onRemoveModels).toHaveBeenCalledWith(['openai::legacy-model'])
  })

  it('keeps search available and disables bulk action while applying', () => {
    renderDrawer({ isApplying: true })

    expect(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'settings.models.manage.add_listed.label' })).toBeDisabled()
  })

  it('shows no-results copy for unmatched search', () => {
    renderDrawer()

    fireEvent.change(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder'), {
      target: { value: 'no-match' }
    })

    expect(screen.getByText('common.no_results')).toBeInTheDocument()
  })
})
