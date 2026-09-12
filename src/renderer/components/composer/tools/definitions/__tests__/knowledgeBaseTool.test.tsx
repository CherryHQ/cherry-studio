import { render, waitFor } from '@testing-library/react'
import type * as LucideReact from 'lucide-react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { ComposerSerializedToken } from '../../../tokens'
import knowledgeBaseTool from '../knowledgeBaseTool'

const mocks = vi.hoisted(() => ({
  updateAssistant: vi.fn(),
  quickPanel: {
    isVisible: false,
    symbol: '',
    updateList: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistantMutations: () => ({ updateAssistant: mocks.updateAssistant })
}))

vi.mock('@renderer/utils/assistant', () => ({
  isSupportedToolUse: () => true
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => mocks.quickPanel
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openRoute: vi.fn()
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<typeof LucideReact>()),
  FileSearch: () => <span data-testid="file-search-icon" />
}))

vi.mock('react-i18next', () => ({
  initReacti18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string, options?: Record<string, unknown>) =>
      key === 'library.config.knowledge.doc_count' ? `${options?.count ?? 0} docs` : key
  })
}))

const kb = (id: string, name = id): KnowledgeBase => ({ id, name }) as KnowledgeBase
const kbToken = (id: string): ComposerSerializedToken => ({
  id: `knowledge:${id}`,
  kind: 'knowledge',
  label: id,
  index: 0,
  textOffset: 0
})

function runReconcile(
  draft: ComposerSerializedToken[],
  prev: KnowledgeBase[],
  selectableKnowledgeBases: KnowledgeBase[] = []
): KnowledgeBase[] {
  const reconcile = knowledgeBaseTool.composer?.tokens?.reconcile
  if (!reconcile) throw new Error('knowledgeBaseTool must contribute tokens.reconcile')
  let result = prev
  const context = {
    state: { selectableKnowledgeBases },
    actions: {
      setSelectedKnowledgeBases: (updater: KnowledgeBase[] | ((p: KnowledgeBase[]) => KnowledgeBase[])) => {
        result = typeof updater === 'function' ? updater(prev) : updater
      }
    }
  } as unknown as Parameters<typeof reconcile>[1]
  reconcile(draft, context)
  return result
}

describe('knowledgeBaseTool token reconcile', () => {
  it('prunes a knowledge base when its token is removed', () => {
    expect(runReconcile([], [kb('a')])).toEqual([])
  })

  it('re-adds a pasted knowledge marker from selectableKnowledgeBases', () => {
    const a = kb('a')
    expect(runReconcile([kbToken('a')], [], [a])).toEqual([a])
  })

  it('does not duplicate an already-selected knowledge base', () => {
    const a = kb('a')
    expect(runReconcile([kbToken('a')], [a], [a])).toEqual([a])
  })

  it('ignores a marker with no matching selectable base', () => {
    expect(runReconcile([kbToken('x')], [], [])).toEqual([])
  })
})

describe('KnowledgeBaseComposerRuntime auto-link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.quickPanel.isVisible = false
    mocks.quickPanel.symbol = ''
  })

  /** Renders the tool's runtime with a chat context and returns the opened panel list. */
  const openRuntimePanel = async (bases: KnowledgeBase[], assistantKnowledgeBaseIds: string[]) => {
    const launcher: ToolLauncherApi = { registerLaunchers: vi.fn(() => vi.fn()) }
    const setSelectedKnowledgeBases = vi.fn()
    const quickPanel = { open: vi.fn() }
    const Runtime = knowledgeBaseTool.composer?.runtime
    if (!Runtime) throw new Error('knowledgeBaseTool must contribute composer.runtime')
    type RuntimeContext = ComponentProps<typeof Runtime>['context']

    render(
      <Runtime
        context={
          {
            launcher,
            state: { selectedKnowledgeBases: [], files: [], selectableKnowledgeBases: bases },
            actions: { setSelectedKnowledgeBases },
            assistant: { id: 'assistant-1', knowledgeBaseIds: assistantKnowledgeBaseIds },
            t: (key: string) => key
          } as unknown as RuntimeContext
        }
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    const [knowledgeLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    knowledgeLauncher.action?.({ quickPanel, source: 'root-panel', triggerInfo: { type: 'button' } } as never)
    await waitFor(() => expect(quickPanel.open).toHaveBeenCalled())
    return vi.mocked(quickPanel.open).mock.calls[0][0].list
  }

  it('keeps a first in-flight link when a second base is picked before the PATCH settles', async () => {
    // Regression (#20238 review): both picks read the same pre-PATCH assistant snapshot;
    // the second PATCH must still carry the first link, not replace it.
    let resolveFirstPatch: (assistant: unknown) => void = () => {}
    const firstPatch = new Promise<unknown>((resolve) => {
      resolveFirstPatch = resolve
    })
    mocks.updateAssistant.mockImplementationOnce(() => firstPatch).mockImplementationOnce(async () => ({}))

    const list = await openRuntimePanel([kb('kb-1'), kb('kb-2')], [])

    const firstPick = list[0].action?.({ item: { ...list[0], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(1, 'assistant-1', { knowledgeBaseIds: ['kb-1'] })

    const secondPick = list[1].action?.({ item: { ...list[1], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(2))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(2, 'assistant-1', { knowledgeBaseIds: ['kb-1', 'kb-2'] })

    resolveFirstPatch({})
    await Promise.all([firstPick, secondPick])
  })
})
