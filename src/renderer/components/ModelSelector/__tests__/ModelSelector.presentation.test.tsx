import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())
vi.mock('../useModelSelectorData', () => ({
  useModelSelectorData: () => ({
    availableTags: [],
    getModelPresentation: () => ({ tags: [] }),
    isLoading: false,
    isPinActionDisabled: false,
    listItems: [],
    modelItems: [],
    navigableItems: [],
    pinnedIds: [],
    resetTags: () => {},
    resolvedSelectedModelIds: [],
    selectableModelsById: new Map(),
    selectedTags: [],
    sortedProviders: [],
    tagSelection: {},
    togglePin: async () => {},
    toggleTag: () => {},
    visibleSelectedModelIdSet: new Set()
  })
}))

import { ModelSelector } from '../ModelSelector'

describe('ModelSelector presentation', () => {
  beforeEach(async () => {
    MockCacheUtils.resetMocks()
    await i18n.changeLanguage('zh-cn')
  })

  // Container changes must preserve the search and saved mode, while dismissal restores trigger focus.
  it('keeps search and focus through both modes, and remembers dialog mode after remount', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const selector = (
      <ModelSelector
        allowPresentationSwitch
        multiple={false}
        trigger={<button type="button">Choose model</button>}
        onSelect={onSelect}
        noneOptionLabel="No model"
      />
    )
    const view = render(selector)
    await user.click(screen.getByRole('button', { name: 'Choose model' }))
    await user.type(screen.getByRole('textbox'), 'Gemini')
    await user.click(screen.getByRole('button', { name: '切换为弹窗' }))
    expect(await screen.findByRole('dialog', { name: '选择模型' })).toBeVisible()
    expect(screen.getByRole('textbox')).toHaveValue('Gemini')
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())
    await user.click(screen.getByRole('button', { name: '切换为下拉' }))
    expect(screen.getByRole('textbox')).toHaveValue('Gemini')
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())
    await user.click(screen.getByRole('button', { name: '切换为弹窗' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Choose model' })).toHaveFocus()
    view.unmount()
    render(selector)
    await user.click(screen.getByRole('button', { name: 'Choose model' }))
    expect(await screen.findByRole('dialog', { name: '选择模型' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'No model' }))
    expect(onSelect).toHaveBeenCalledWith(undefined)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  // A saved dialog preference from a main entry must not leak into forms or be overwritten by them.
  it('keeps form selectors in dropdown mode without controls and preserves the main-entry preference', async () => {
    MockCacheUtils.setInitialState({ persist: [['ui.model_selector.presentation', 'dialog']] })
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const view = render(
      <ModelSelector
        multiple={false}
        trigger={<button type="button">Form model</button>}
        onSelect={onSelect}
        noneOptionLabel="No model"
      />
    )
    await user.click(screen.getByRole('button', { name: 'Form model' }))
    expect(screen.getByRole('textbox')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: '选择模型' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /切换为弹窗|切换为下拉/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'No model' }))
    expect(onSelect).toHaveBeenCalledWith(undefined)
    view.unmount()
    render(
      <ModelSelector
        allowPresentationSwitch
        multiple={false}
        trigger={<button type="button">Main model</button>}
        onSelect={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Main model' }))
    expect(await screen.findByRole('dialog', { name: '选择模型' })).toBeVisible()
    expect(screen.getByRole('button', { name: '切换为下拉' })).toBeVisible()
  })
})
