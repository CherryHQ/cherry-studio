import { render, waitFor } from '@testing-library/react'
import type * as LucideReact from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import { KnowledgeBaseToolRuntime } from '../KnowledgeBaseButton'

const mocks = vi.hoisted(() => ({
  knowledgeBases: [] as KnowledgeBase[],
  language: 'en',
  knowledgeQueryOptions: vi.fn(),
  translationSuffix: '',
  openRoute: vi.fn(),
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
  useKnowledgeBases: (options?: { enabled?: boolean }) => {
    mocks.knowledgeQueryOptions(options)
    return { bases: mocks.knowledgeBases, isLoading: false }
  }
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openRoute: mocks.openRoute
}))

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<typeof LucideReact>()),
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
        'chat.input.knowledge_base_retrieval_label': 'Retrieval',
        'chat.input.knowledge_base_retrieve': 'Retrieve from Knowledge Base',
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
    mocks.knowledgeQueryOptions.mockReset()
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
        title: 'Retrieve from Knowledge Base',
        triggerInfo: { type: 'button' }
      })
    )
    const openedOptions = vi.mocked(quickPanel.open).mock.calls[0][0]
    expect(openedOptions.footerActions).toBeUndefined()
    const registeredFooterActions = vi.mocked(launcher.registerLaunchers).mock.calls[0][1]
    if (!registeredFooterActions) throw new Error('Expected the knowledge-base footer action to be registered')
    expect(registeredFooterActions).toEqual([
      expect.objectContaining({ id: 'knowledge-base:manage', ariaLabel: 'chat.input.knowledge_base_manage' })
    ])
    registeredFooterActions[0].action({} as never)
    expect(mocks.openRoute).toHaveBeenCalledWith('/app/knowledge')

    const panelList = openedOptions.list
    expect(panelList).toEqual([
      expect.objectContaining({
        id: 'knowledge-base:kb-1',
        label: 'Knowledge One',
        suffix: 'Retrieval',
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
      context: { symbol: ComposerPanelSymbol.KnowledgeBase },
      item: { ...panelList[0], isSelected: true }
    })

    expect(onSelect).toHaveBeenLastCalledWith([mocks.knowledgeBases[0], mocks.knowledgeBases[1]])

    panelList[1].action?.({
      context: { symbol: ComposerPanelSymbol.KnowledgeBase },
      item: { ...panelList[1], isSelected: false }
    })

    expect(onSelect).toHaveBeenLastCalledWith([mocks.knowledgeBases[0]])
  })

  it('does not leave an input listener after selecting from root search', async () => {
    const launcher = createLauncherApi()
    const onSelect = vi.fn()
    const subscribeInput = vi.fn(() => vi.fn())
    const focus = vi.fn()

    render(
      <KnowledgeBaseToolRuntime
        launcher={launcher}
        configuredKnowledgeBaseIds={['kb-1', 'kb-2']}
        selectedBases={[]}
        onSelect={onSelect}
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    const [knowledgeLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls.at(-1)![0]
    const rootSearchItem = knowledgeLauncher.rootSearchItems?.[0]
    if (!rootSearchItem) throw new Error('Expected a knowledge-base root search item')

    rootSearchItem.action?.({
      context: { symbol: ComposerPanelSymbol.Root, close: vi.fn() },
      inputAdapter: { getText: () => '', subscribeInput, focus },
      item: rootSearchItem
    } as never)

    expect(onSelect).toHaveBeenCalledWith([mocks.knowledgeBases[0]])
    expect(subscribeInput).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledOnce()
  })
})
