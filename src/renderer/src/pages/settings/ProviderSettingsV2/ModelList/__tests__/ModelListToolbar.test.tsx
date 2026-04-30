import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MODEL_LIST_CAPABILITY_FILTERS } from '../modelListDerivedState'
import ModelListToolbar from '../ModelListToolbar'

const renderHeaderMock = vi.fn()

vi.mock('../ModelListHeader', () => ({
  default: (props: any) => {
    renderHeaderMock(props)
    return (
      <div>
        <button type="button" onClick={props.onRefreshModels}>
          refresh-models
        </button>
      </div>
    )
  }
}))

const baseProps = {
  enabledModelCount: 1,
  modelCount: 3,
  hasVisibleModels: true,
  allEnabled: false,
  isBusy: false,
  hasNoModels: false,
  searchText: '',
  setSearchText: vi.fn(),
  selectedCapabilityFilter: 'all' as const,
  setSelectedCapabilityFilter: vi.fn(),
  capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
  capabilityModelCounts: {
    all: 3,
    reasoning: 1,
    vision: 0,
    websearch: 0,
    free: 0,
    embedding: 0,
    rerank: 0,
    function_calling: 0
  },
  showDownloadButton: false,
  onToggleVisibleModels: vi.fn(),
  onRunHealthCheck: vi.fn(),
  onRefreshModels: vi.fn(),
  onAddModel: vi.fn(),
  onOpenManageModels: vi.fn(),
  onDownloadModel: vi.fn()
}

describe('ModelListToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the header surface unchanged', () => {
    render(<ModelListToolbar {...baseProps} />)

    expect(renderHeaderMock).toHaveBeenCalledWith(expect.objectContaining(baseProps))

    fireEvent.click(screen.getByText('refresh-models'))
    expect(baseProps.onRefreshModels).toHaveBeenCalled()
  })
})
