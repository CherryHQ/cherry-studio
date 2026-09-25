import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderModelList from '../ProviderModelList'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      i18n: { language: 'en-US' },
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

const { virtualListPropsRef } = vi.hoisted(() => ({ virtualListPropsRef: { current: null as any } }))

vi.mock('@renderer/components/VirtualList', () => ({
  // The section list is virtualized in production; here every group header,
  // item and footer is rendered inline so ordering and collapse state are
  // observable.
  GroupedSortableVirtualList: (props: any) => {
    virtualListPropsRef.current = props
    const { groups, getGroupId, getItemId, renderGroupHeader, renderItem, renderGroupFooter, className } = props
    return (
      <div className={className}>
        {groups.map((entry: any, groupIndex: number) => {
          const groupId = getGroupId(entry.group, groupIndex)
          return (
            <div key={String(groupId)}>
              {entry.header !== undefined ? renderGroupHeader(entry.header, entry.group, groupIndex) : null}
              {entry.items.map((item: unknown, itemIndex: number) => (
                <div key={String(getItemId(item, itemIndex, entry.group, groupIndex, itemIndex))}>
                  {renderItem(item, itemIndex, entry.group, groupIndex, itemIndex)}
                </div>
              ))}
              {entry.footer !== undefined ? renderGroupFooter(entry.footer, entry.group, groupIndex) : null}
            </div>
          )
        })}
      </div>
    )
  }
}))

const { moveModelMock } = vi.hoisted(() => ({ moveModelMock: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@renderer/data/hooks/useReorder', () => ({
  useReorder: () => ({ move: moveModelMock, isPending: false })
}))

vi.mock('../ModelDrawer', () => ({
  EditModelDrawer: () => null
}))

vi.mock('../modelListHealthContext', () => ({
  useModelListHealthRun: () => ({
    apiKeyEntries: [],
    savingKeyId: null,
    toggleApiKey: vi.fn()
  })
}))

const { modelListGroupMock, modelListStateMock, providerMetaState, searchTextMock } = vi.hoisted(() => ({
  modelListGroupMock: vi.fn(({ groupName }: { groupName: string }) => <div>{groupName}</div>),
  modelListStateMock: { hasNoModels: false, hasVisibleModels: true },
  providerMetaState: {
    isApiKeyFieldVisible: true,
    provider: { id: 'openai', authOptional: false, apiKeys: [] as Array<{ id: string; isEnabled: boolean }> }
  },
  searchTextMock: { value: '' }
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: () => providerMetaState
}))

vi.mock('../ModelListGroup', () => ({
  default: modelListGroupMock
}))

vi.mock('../useProviderModelList', () => ({
  useProviderModelList: () => ({
    header: {
      modelCount: 1,
      hasVisibleModels: modelListStateMock.hasVisibleModels,
      hasNoModels: modelListStateMock.hasNoModels,
      searchText: searchTextMock.value,
      setSearchText: vi.fn()
    },
    sections: {
      isLoading: false,
      hasNoModels: modelListStateMock.hasNoModels,
      hasVisibleModels: modelListStateMock.hasVisibleModels,
      displayEnabledModelCount: 1,
      enabledSections: [{ groupName: 'OpenAI', items: [] }],
      disabled: false,
      pendingModelIds: new Set<string>(),
      defaultModelIds: new Set<string>(),
      onEditModel: vi.fn(),
      onDeleteModel: vi.fn(),
      onDeleteModels: vi.fn()
    },
    editDrawer: {
      open: false,
      model: null,
      onClose: vi.fn()
    }
  })
}))

describe('ProviderModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelListStateMock.hasNoModels = false
    modelListStateMock.hasVisibleModels = true
    providerMetaState.provider = { id: 'openai', authOptional: false, apiKeys: [] }
    searchTextMock.value = ''
  })

  it('turns a same-group drop into an anchored reorder request', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    virtualListPropsRef.current.onDragEnd({
      type: 'item',
      activeId: 'openai::gpt-4',
      activeItem: { id: 'openai::gpt-4' },
      overId: 'openai::gpt-5',
      overItem: { id: 'openai::gpt-5' },
      overType: 'item',
      position: 'after',
      sourceGroup: { groupName: 'OpenAI' },
      sourceGroupId: 'OpenAI',
      targetGroup: { groupName: 'OpenAI' },
      targetGroupId: 'OpenAI',
      sourceIndex: 0,
      targetIndex: 1
    })

    expect(moveModelMock).toHaveBeenCalledWith('openai::gpt-4', { after: 'openai::gpt-5' })
  })

  it('encodes a drop before the target row as a before anchor', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    virtualListPropsRef.current.onDragEnd({
      type: 'item',
      activeId: 'openai::gpt-4',
      activeItem: { id: 'openai::gpt-4' },
      overId: 'openai::gpt-5',
      overItem: { id: 'openai::gpt-5' },
      overType: 'item',
      position: 'before',
      sourceGroup: { groupName: 'OpenAI' },
      sourceGroupId: 'OpenAI',
      targetGroup: { groupName: 'OpenAI' },
      targetGroupId: 'OpenAI',
      sourceIndex: 1,
      targetIndex: 0
    })

    expect(moveModelMock).toHaveBeenCalledWith('openai::gpt-4', { before: 'openai::gpt-5' })
  })

  it('ignores a cross-group drop so no order the grouped view contradicts is persisted', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    virtualListPropsRef.current.onDragEnd({
      type: 'item',
      activeId: 'openai::gpt-4',
      activeItem: { id: 'openai::gpt-4' },
      overId: 'anthropic::claude',
      overItem: { id: 'anthropic::claude' },
      overType: 'item',
      position: 'before',
      sourceGroup: { groupName: 'OpenAI' },
      sourceGroupId: 'OpenAI',
      targetGroup: { groupName: 'Anthropic' },
      targetGroupId: 'Anthropic',
      sourceIndex: 0,
      targetIndex: 0
    })

    expect(moveModelMock).not.toHaveBeenCalled()
  })

  it('ignores a drop that lands on a group header rather than a row', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    virtualListPropsRef.current.onDragEnd({
      type: 'item',
      activeId: 'openai::gpt-4',
      activeItem: { id: 'openai::gpt-4' },
      overType: 'group',
      position: 'before',
      sourceGroup: { groupName: 'OpenAI' },
      sourceGroupId: 'OpenAI',
      targetGroup: { groupName: 'OpenAI' },
      targetGroupId: 'OpenAI',
      sourceIndex: 0,
      targetIndex: 0
    })

    expect(moveModelMock).not.toHaveBeenCalled()
  })

  it('disables item dragging while the list is disabled', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    expect(virtualListPropsRef.current.dragCapabilities).toMatchObject({
      items: true,
      itemSameGroup: true,
      itemCrossGroup: false
    })
    expect(virtualListPropsRef.current.canDragItem({ id: 'openai::gpt-4' })).toBe(true)

    render(<ProviderModelList providerId="openai" disabled />)

    expect(virtualListPropsRef.current.dragCapabilities).toEqual({ items: false })
  })

  it('shows guidance to get models when the provider has no models', () => {
    modelListStateMock.hasNoModels = true
    modelListStateMock.hasVisibleModels = false

    render(<ProviderModelList providerId="openai" disabled={false} />)

    expect(screen.getByText('settings.models.empty')).toBeInTheDocument()
    expect(screen.getByText('settings.models.empty_hint')).toBeInTheDocument()
  })

  it('offers to continue setup when a required provider already has a saved key but no models', () => {
    modelListStateMock.hasNoModels = true
    modelListStateMock.hasVisibleModels = false
    providerMetaState.provider = { id: 'openai', authOptional: false, apiKeys: [{ id: 'key-1', isEnabled: true }] }
    const onContinueApiSetup = vi.fn()

    render(<ProviderModelList providerId="openai" disabled={false} onContinueApiSetup={onContinueApiSetup} />)

    expect(screen.getByText('settings.provider.api_setup.models_empty_hint')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.continue_models' }))
    expect(onContinueApiSetup).toHaveBeenCalledTimes(1)
  })

  it('does not offer model setup when every saved key is disabled', () => {
    modelListStateMock.hasNoModels = true
    modelListStateMock.hasVisibleModels = false
    providerMetaState.provider = { id: 'openai', authOptional: false, apiKeys: [{ id: 'key-1', isEnabled: false }] }

    render(<ProviderModelList providerId="openai" disabled={false} onContinueApiSetup={vi.fn()} />)

    expect(
      screen.queryByRole('button', { name: 'settings.provider.api_setup.continue_models' })
    ).not.toBeInTheDocument()
  })

  it('renders model groups without section action rows', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    expect(screen.getAllByText('OpenAI')).toHaveLength(1)
    expect(screen.queryByText('settings.models.enabled_models')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.more_actions' })).not.toBeInTheDocument()
  })

  it('passes collapsed state to model groups from the header toggle', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.collapse_all' }))

    expect(modelListGroupMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: false
      }),
      undefined
    )
  })

  it('expands model groups when search text is active', () => {
    const { rerender } = render(<ProviderModelList providerId="openai" disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.collapse_all' }))

    expect(modelListGroupMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: false
      }),
      undefined
    )

    searchTextMock.value = 'gpt'
    rerender(<ProviderModelList providerId="openai" disabled={false} />)

    expect(modelListGroupMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true
      }),
      undefined
    )
  })
})
