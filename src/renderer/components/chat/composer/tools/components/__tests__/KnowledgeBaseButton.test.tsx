import { ComposerPanelSymbol } from '@renderer/components/chat/composer/quickPanel/symbols'
import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeBaseToolRuntime } from '../KnowledgeBaseButton'

const mocks = vi.hoisted(() => ({
  knowledgeBases: [] as KnowledgeBase[],
  language: 'en',
  translationSuffix: '',
  quickPanel: {
    isVisible: false,
    symbol: '',
    updateList: vi.fn()
  }
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => mocks.quickPanel
}))

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({ bases: mocks.knowledgeBases })
}))

vi.mock('lucide-react', () => ({
  FileSearch: () => <span data-testid="file-search-icon" />
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    i18n: {
      language: mocks.language,
      resolvedLanguage: mocks.language
    },
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'chat.input.knowledge_base': 'Knowledge Base',
        'chat.save.knowledge.empty.no_knowledge_base': 'No knowledge base',
        'common.selectedItems': `${options?.count ?? 0} selected`,
        'library.config.knowledge.doc_count': `${options?.count ?? 0} docs${mocks.translationSuffix}`
      }

      return translations[key] ?? key
    }
  })
}))

const createKnowledgeBase = (
  overrides: Partial<KnowledgeBase> & Pick<KnowledgeBase, 'id' | 'name'> & { itemCount?: number }
): KnowledgeBase =>
  ({
    itemCount: 0,
    ...overrides
  }) as KnowledgeBase

const createLauncherApi = (): ToolLauncherApi => ({
  registerLaunchers: vi.fn(() => vi.fn())
})

describe('KnowledgeBaseToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.quickPanel.isVisible = false
    mocks.quickPanel.symbol = ''
    mocks.quickPanel.updateList.mockReset()
    mocks.language = 'en'
    mocks.translationSuffix = ''
    mocks.knowledgeBases = [
      createKnowledgeBase({ id: 'kb-1', name: 'Knowledge One', itemCount: 2 }),
      createKnowledgeBase({ id: 'kb-2', name: 'Knowledge Two', itemCount: 5 })
    ]
  })

  it('opens a multi-select knowledge panel instead of toggling all configured bases', async () => {
    const launcher = createLauncherApi()
    const onSelect = vi.fn()
    const quickPanel = { open: vi.fn() }
    const inputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 10,
      getText: () => '/knowledge',
      insertText: vi.fn()
    }

    render(
      <KnowledgeBaseToolRuntime
        launcher={launcher}
        configuredKnowledgeBaseIds={['kb-1', 'kb-2']}
        selectedBases={[mocks.knowledgeBases[1]]}
        onSelect={onSelect}
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [knowledgeLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    expect(knowledgeLauncher).toMatchObject({
      id: 'knowledge-base',
      kind: 'panel',
      sources: ['popover', 'root-panel'],
      active: true
    })
    expect(knowledgeLauncher.suffix).toBeUndefined()
    expect(knowledgeLauncher.showInActiveControls).toBe(false)

    knowledgeLauncher.action?.({
      inputAdapter,
      parentPanel: { list: [], symbol: '/' },
      quickPanel,
      queryAnchor: 0,
      source: 'root-panel',
      triggerInfo: { type: 'input', position: 0, originalText: '/knowledge' }
    } as never)

    expect(onSelect).not.toHaveBeenCalled()
    expect(inputAdapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 10 })
    expect(inputAdapter.focus).toHaveBeenCalled()
    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: true,
        parentPanel: { list: [], symbol: '/' },
        symbol: ComposerPanelSymbol.KnowledgeBase,
        title: 'Knowledge Base',
        triggerInfo: { type: 'button' }
      })
    )
    const openedOptions = vi.mocked(quickPanel.open).mock.calls[0][0]
    expect(openedOptions.queryAnchor).toBeUndefined()

    const panelList = openedOptions.list
    expect(panelList).toEqual([
      expect.objectContaining({
        id: 'knowledge-base:kb-1',
        label: 'Knowledge One',
        description: '2 docs',
        isSelected: false
      }),
      expect.objectContaining({
        id: 'knowledge-base:kb-2',
        label: 'Knowledge Two',
        description: '5 docs',
        isSelected: true
      })
    ])

    panelList[0].action?.({
      item: { ...panelList[0], isSelected: true }
    } as never)

    expect(onSelect).toHaveBeenLastCalledWith([mocks.knowledgeBases[0], mocks.knowledgeBases[1]])

    panelList[1].action?.({
      item: { ...panelList[1], isSelected: false }
    } as never)

    expect(onSelect).toHaveBeenLastCalledWith([mocks.knowledgeBases[0]])
  })

  it('refreshes the open knowledge panel when selected bases change', async () => {
    mocks.quickPanel.isVisible = true
    mocks.quickPanel.symbol = ComposerPanelSymbol.KnowledgeBase
    const launcher = createLauncherApi()
    const onSelect = vi.fn()

    const view = render(
      <KnowledgeBaseToolRuntime
        launcher={launcher}
        configuredKnowledgeBaseIds={['kb-1', 'kb-2']}
        selectedBases={[]}
        onSelect={onSelect}
      />
    )

    await waitFor(() =>
      expect(mocks.quickPanel.updateList).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'knowledge-base:kb-1', isSelected: false }),
        expect.objectContaining({ id: 'knowledge-base:kb-2', isSelected: false })
      ])
    )

    mocks.quickPanel.updateList.mockClear()

    view.rerender(
      <KnowledgeBaseToolRuntime
        launcher={launcher}
        configuredKnowledgeBaseIds={['kb-1', 'kb-2']}
        selectedBases={[mocks.knowledgeBases[0]]}
        onSelect={onSelect}
      />
    )

    await waitFor(() =>
      expect(mocks.quickPanel.updateList).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'knowledge-base:kb-1', isSelected: true }),
        expect.objectContaining({ id: 'knowledge-base:kb-2', isSelected: false })
      ])
    )
  })

  it('refreshes the open knowledge panel when translations change', async () => {
    mocks.quickPanel.isVisible = true
    mocks.quickPanel.symbol = ComposerPanelSymbol.KnowledgeBase
    const launcher = createLauncherApi()
    const onSelect = vi.fn()
    const configuredKnowledgeBaseIds = ['kb-1', 'kb-2']
    const selectedBases: KnowledgeBase[] = []

    const view = render(
      <KnowledgeBaseToolRuntime
        launcher={launcher}
        configuredKnowledgeBaseIds={configuredKnowledgeBaseIds}
        selectedBases={selectedBases}
        onSelect={onSelect}
      />
    )

    await waitFor(() =>
      expect(mocks.quickPanel.updateList).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'knowledge-base:kb-1', description: '2 docs' }),
        expect.objectContaining({ id: 'knowledge-base:kb-2', description: '5 docs' })
      ])
    )

    mocks.quickPanel.updateList.mockClear()
    mocks.language = 'zh'
    mocks.translationSuffix = ' translated'

    view.rerender(
      <KnowledgeBaseToolRuntime
        launcher={launcher}
        configuredKnowledgeBaseIds={configuredKnowledgeBaseIds}
        selectedBases={selectedBases}
        onSelect={onSelect}
      />
    )

    await waitFor(() =>
      expect(mocks.quickPanel.updateList).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'knowledge-base:kb-1', description: '2 docs translated' }),
        expect.objectContaining({ id: 'knowledge-base:kb-2', description: '5 docs translated' })
      ])
    )
  })
})
