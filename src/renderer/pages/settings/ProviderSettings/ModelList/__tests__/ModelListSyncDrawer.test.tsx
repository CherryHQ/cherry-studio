import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ModelModule from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'

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
    Tooltip: ({ children, content }: any) => <span data-tooltip-content={content}>{children}</span>,
    Spinner: () => <div data-testid="spinner" />,
    EmptyState: ({ title }: any) => <div>{title}</div>
  }
})

vi.mock('@cherrystudio/ui/icons', () => ({
  useIcon: () => ({
    Avatar: () => null
  })
}))

vi.mock('@renderer/utils/model', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelModule>()),
  getModelLogoRef: () => undefined
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
    description: 'GPT 5 model description',
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
    presetModelId: 'legacy-model',
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
    presetModelId: null,
    name: 'Custom Model',
    group: undefined,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
] as Model[]

const localModels = [allModels[2]]

const savedMimoModel: Model = {
  ...allModels[0],
  id: 'mimo::mimo-v2-6-pro',
  providerId: 'mimo',
  apiModelId: 'mimo-v2.6-pro',
  presetModelId: 'mimo-v2-6-pro',
  name: 'MiMo V2.6 Pro'
}
const remoteMimoModel: Model = {
  ...savedMimoModel,
  id: 'mimo::mimo-v2.6-pro',
  presetModelId: null
}

function renderDrawer(props: Partial<React.ComponentProps<typeof ModelListSyncDrawer>> = {}) {
  return render(
    <ModelListSyncDrawer
      open
      provider={{ id: 'openai', name: 'OpenAI' } as any}
      allModels={[...allModels]}
      localModels={[...localModels]}
      removableModelIds={['openai::legacy-model']}
      defaultModelIds={[]}
      isLoading={false}
      isApplying={false}
      loadErrorMessage={null}
      staleModelCount={0}
      staleModelIds={[]}
      onRetryLoadModels={vi.fn()}
      onAddModels={vi.fn()}
      onRemoveModels={vi.fn()}
      onCleanStaleModels={vi.fn()}
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
    expect(screen.getByText('GPT 5')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet')).toBeInTheDocument()
    expect(screen.getByText('Legacy Model')).toBeInTheDocument()
  })

  it('hides model controls while loading', () => {
    renderDrawer({ isLoading: true })

    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder')).not.toBeVisible()
    expect(screen.getByRole('tablist', { hidden: true })).not.toBeVisible()
  })

  // The raw api id moved out of a visible subtitle line into the title's tooltip, so it must stay
  // reachable without a mouse: a focusable title (which opens the tooltip on focus) described by an
  // off-screen copy of the id. Names can collide — the id is what disambiguates them.
  it('keeps each raw api model id reachable by keyboard and screen reader', () => {
    renderDrawer()

    for (const [name, apiModelId] of [
      ['GPT 5', 'gpt-5'],
      ['Claude Sonnet', 'claude-sonnet'],
      ['Legacy Model', 'legacy-model']
    ]) {
      const title = screen.getByText(name)
      expect(title).toHaveAttribute('tabindex', '0')
      expect(document.getElementById(title.getAttribute('aria-describedby')!)).toHaveTextContent(apiModelId)
    }
  })

  it('renders a fallback group for models without explicit groups', () => {
    renderDrawer()

    expect(screen.getByText('custom')).toBeInTheDocument()
    expect(screen.queryByText('models.group.ungrouped')).not.toBeInTheDocument()
    expect(screen.queryByText('__ungrouped__')).not.toBeInTheDocument()
  })

  it('filters model rows by search text', () => {
    renderDrawer()

    fireEvent.change(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder'), {
      target: { value: 'claude' }
    })

    expect(screen.queryByText('GPT 5')).not.toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet')).toBeInTheDocument()
    expect(screen.queryByText('Legacy Model')).not.toBeInTheDocument()
  })

  it('shows search matches inside collapsed groups and restores the collapsed state after search', () => {
    renderDrawer()

    fireEvent.click(screen.getByText('legacy').closest('button')!)
    expect(screen.queryByText('Legacy Model')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder'), {
      target: { value: 'legacy' }
    })
    expect(screen.getByText('Legacy Model')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))
    expect(screen.queryByText('Legacy Model')).not.toBeInTheDocument()
  })

  it('clears model search', () => {
    renderDrawer()

    fireEvent.change(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder'), {
      target: { value: 'legacy' }
    })
    expect(screen.queryByText('GPT 5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))

    expect(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder')).toHaveValue('')
    expect(screen.getByText('GPT 5')).toBeInTheDocument()
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

  it('renders one added MiMo row and removes its saved persistent id', async () => {
    const user = userEvent.setup()
    const onRemoveModels = vi.fn()
    renderDrawer({
      allModels: [savedMimoModel, remoteMimoModel],
      localModels: [savedMimoModel],
      removableModelIds: [savedMimoModel.id],
      onRemoveModels
    })

    expect(screen.getAllByText('MiMo V2.6 Pro')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'button.add' })).not.toBeInTheDocument()
    const removeButton = screen.getByRole('button', { name: 'settings.models.manage.remove_model' })
    expect(removeButton).toBeEnabled()
    await user.click(removeButton)
    expect(onRemoveModels.mock.calls).toEqual([[[savedMimoModel.id]]])

    onRemoveModels.mockClear()
    await user.click(screen.getByRole('button', { name: 'settings.models.manage.remove_whole_group' }))
    expect(onRemoveModels.mock.calls).toEqual([[[savedMimoModel.id]]])

    onRemoveModels.mockClear()
    const bulkRemove = screen.getByRole('button', { name: 'settings.models.manage.remove_listed' })
    expect(bulkRemove).toHaveTextContent('settings.models.manage.remove_listed')
    await user.click(bulkRemove)
    expect(onRemoveModels.mock.calls).toEqual([[['mimo::mimo-v2-6-pro']]])
  })

  it('bulk-adds the remote MiMo row once and reaches the all-added state', async () => {
    const user = userEvent.setup()
    const onAddModels = vi.fn()
    const props = {
      allModels: [savedMimoModel, remoteMimoModel],
      removableModelIds: [],
      onAddModels
    }
    const { rerender } = renderDrawer({ ...props, localModels: [] })

    expect(screen.getAllByText('MiMo V2.6 Pro')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'button.add' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'settings.models.manage.add_listed.label' }))
    expect(onAddModels.mock.calls).toEqual([[[remoteMimoModel]]])

    rerender(
      <ModelListSyncDrawer
        {...props}
        open
        localModels={[remoteMimoModel]}
        removableModelIds={[remoteMimoModel.id]}
        isLoading={false}
        isApplying={false}
        onRemoveModels={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getAllByText('MiMo V2.6 Pro')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'button.add' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.manage.remove_listed' })).toBeEnabled()
  })

  it('keeps models with empty wire ids separately removable', async () => {
    const user = userEvent.setup()
    const onRemoveModels = vi.fn()
    const customModels: Model[] = ['a', 'b'].map((suffix) => ({
      ...savedMimoModel,
      id: `mimo::custom-${suffix}`,
      apiModelId: '',
      presetModelId: null,
      name: `Custom ${suffix}`
    }))
    renderDrawer({
      allModels: customModels,
      localModels: customModels,
      removableModelIds: customModels.map((model) => model.id),
      onRemoveModels
    })

    expect(screen.getByText('Custom a')).toBeInTheDocument()
    expect(screen.getByText('Custom b')).toBeInTheDocument()
    const removeButtons = screen.getAllByRole('button', { name: 'settings.models.manage.remove_model' })
    expect(removeButtons).toHaveLength(2)
    for (const button of removeButtons) {
      expect(button).toBeEnabled()
      await user.click(button)
    }
    expect(onRemoveModels.mock.calls).toEqual([[['mimo::custom-a']], [['mimo::custom-b']]])
  })

  it('removes locally added remote models even when the remote row has no preset model id', () => {
    const onRemoveModels = vi.fn()
    renderDrawer({
      allModels: [allModels[0]],
      localModels: [allModels[0]],
      removableModelIds: ['openai::gpt-5'],
      onRemoveModels
    })

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.manage.remove_listed' }))

    expect(onRemoveModels).toHaveBeenCalledWith(['openai::gpt-5'])
  })

  it('does not bulk-remove custom local models', () => {
    const onRemoveModels = vi.fn()
    renderDrawer({
      allModels: [allModels[2], allModels[3]],
      localModels: [allModels[2], allModels[3]],
      onRemoveModels
    })

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.manage.remove_listed' }))

    expect(onRemoveModels).toHaveBeenCalledWith(['openai::legacy-model'])
  })

  it('disables bulk remove when only custom local models are listed', () => {
    const onRemoveModels = vi.fn()
    renderDrawer({
      allModels: [allModels[3]],
      localModels: [allModels[3]],
      onRemoveModels
    })

    const bulkRemoveButton = screen.getByRole('button', { name: 'settings.models.manage.remove_listed' })
    expect(bulkRemoveButton).toBeDisabled()

    fireEvent.click(bulkRemoveButton)

    expect(onRemoveModels).not.toHaveBeenCalled()
  })

  it('disables individual removal for a local model that is not removable', () => {
    const onRemoveModels = vi.fn()
    renderDrawer({
      allModels: [allModels[2]],
      localModels: [allModels[2]],
      removableModelIds: [],
      onRemoveModels
    })

    const removeButton = screen.getByRole('button', { name: 'settings.models.manage.remove_model' })
    expect(removeButton).toBeDisabled()

    fireEvent.click(removeButton)

    expect(onRemoveModels).not.toHaveBeenCalled()
  })

  it('explains why a default model cannot be removed', () => {
    renderDrawer({
      allModels: [allModels[2]],
      localModels: [allModels[2]],
      removableModelIds: [],
      defaultModelIds: [allModels[2].id]
    })

    const removeButton = screen.getByRole('button', { name: 'settings.models.manage.remove_model' })
    expect(removeButton).toBeDisabled()
    expect(removeButton.parentElement).toHaveAttribute(
      'data-tooltip-content',
      'settings.models.manage.default_model_cannot_remove'
    )
  })

  it('cleans stale models from the title action', () => {
    const onCleanStaleModels = vi.fn()
    renderDrawer({ staleModelCount: 1, onCleanStaleModels })

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.manage.clean_stale_models' }))

    expect(onCleanStaleModels).toHaveBeenCalled()
  })

  it('hides stale cleanup action when there are no stale models', () => {
    renderDrawer({ staleModelCount: 0 })

    expect(screen.queryByRole('button', { name: 'settings.models.manage.clean_stale_models' })).not.toBeInTheDocument()
  })

  it('marks stale models in the list', () => {
    renderDrawer({ staleModelIds: ['openai::legacy-model'] })

    expect(screen.getByText('settings.models.manage.stale_badge')).toBeInTheDocument()
  })

  it('moves model descriptions into tooltip triggers', () => {
    renderDrawer()

    expect(screen.queryByText('GPT 5 model description')).not.toBeInTheDocument()
    expect(screen.getByLabelText('GPT 5 model description')).toBeInTheDocument()
  })

  it('shows load errors in the drawer with a refresh action', () => {
    const onRetryLoadModels = vi.fn()
    renderDrawer({
      loadErrorMessage: 'settings.models.manage.sync_pull_failed',
      onRetryLoadModels
    })

    expect(screen.queryByText('settings.models.manage.sync_pull_failed')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('settings.models.manage.search_models_placeholder')).toBeInTheDocument()
    expect(screen.getByText('GPT 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.manage.sync_pull_failed' }))

    expect(onRetryLoadModels).toHaveBeenCalled()
  })

  it('keeps bulk actions available when a reload fails but local content is visible', () => {
    renderDrawer({
      loadErrorMessage: 'settings.models.manage.sync_pull_failed'
    })

    expect(screen.getByRole('button', { name: 'settings.models.manage.add_listed.label' })).not.toBeDisabled()
  })

  it('keeps the destructive stale filter clickable immediately after All when horizontally scrolled', async () => {
    const user = userEvent.setup()
    renderDrawer({ staleModelCount: 1, staleModelIds: ['openai::legacy-model'] })

    const tabList = screen.getByRole('tablist')
    const tabs = screen.getAllByRole('tab')
    const staleTab = screen.getByRole('tab', { name: 'settings.models.manage.stale_filter' })

    expect(tabs[0]).toHaveAccessibleName('models.all')
    expect(tabs[1]).toBe(staleTab)

    fireEvent.scroll(tabList, { target: { scrollLeft: 120 } })
    await user.click(staleTab)

    await waitFor(() => {
      expect(screen.queryByText('GPT 5')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Legacy Model')).toBeInTheDocument()
    expect(screen.queryByText('Claude Sonnet')).not.toBeInTheDocument()
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
