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

  /** Renders the tool's runtime with a chat context and returns the panel list plus a
   *  delivery driver that swaps the assistant object, as React Query deliveries do. */
  const openRuntimePanel = async (bases: KnowledgeBase[], assistantKnowledgeBaseIds: string[]) => {
    const launcher: ToolLauncherApi = { registerLaunchers: vi.fn(() => vi.fn()) }
    const setSelectedKnowledgeBases = vi.fn()
    const quickPanel = { open: vi.fn() }
    const Runtime = knowledgeBaseTool.composer?.runtime
    if (!Runtime) throw new Error('knowledgeBaseTool must contribute composer.runtime')
    type RuntimeContext = ComponentProps<typeof Runtime>['context']
    const baseContext = {
      launcher,
      state: { selectedKnowledgeBases: [], files: [], selectableKnowledgeBases: bases },
      actions: { setSelectedKnowledgeBases },
      assistant: { id: 'assistant-1', knowledgeBaseIds: assistantKnowledgeBaseIds },
      t: (key: string) => key
    } as unknown as RuntimeContext

    const view = render(<Runtime context={baseContext} />)

    const deliver = (assistant: { id: string; knowledgeBaseIds: string[] }) => {
      view.rerender(<Runtime context={{ ...baseContext, assistant } as unknown as RuntimeContext} />)
    }

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    const [knowledgeLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    knowledgeLauncher.action?.({ quickPanel, source: 'root-panel', triggerInfo: { type: 'button' } } as never)
    await waitFor(() => expect(quickPanel.open).toHaveBeenCalled())
    return { list: vi.mocked(quickPanel.open).mock.calls[0][0].list, deliver }
  }

  it('queues a second pick behind the first link and carries the first id into its PATCH', async () => {
    // Regression (#20238 review): both picks read the same pre-PATCH assistant snapshot;
    // the second PATCH must wait for the first outcome and still carry the first link.
    let resolveFirstPatch: (assistant: unknown) => void = () => {}
    const firstPatch = new Promise<unknown>((resolve) => {
      resolveFirstPatch = resolve
    })
    mocks.updateAssistant.mockImplementationOnce(() => firstPatch).mockImplementationOnce(async () => ({}))

    const { list } = await openRuntimePanel([kb('kb-1'), kb('kb-2')], [])

    const firstPick = list[0].action?.({ item: { ...list[0], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(1, 'assistant-1', { knowledgeBaseIds: ['kb-1'] })

    const secondPick = list[1].action?.({ item: { ...list[1], isSelected: true } })
    // The queue holds the second PATCH until the first settles.
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.updateAssistant).toHaveBeenCalledTimes(1)

    resolveFirstPatch({})
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(2))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(2, 'assistant-1', { knowledgeBaseIds: ['kb-1', 'kb-2'] })

    await Promise.all([firstPick as Promise<unknown>, secondPick as Promise<unknown>])
  })

  it('drops a failed link from the next pick instead of persisting it', async () => {
    // A failed PATCH rolled its pick back in the panel; the queued pick must not carry
    // the failed id into its own PATCH, or the server would hold a link the UI denies.
    mocks.updateAssistant
      .mockImplementationOnce(async () => {
        throw new Error('network down')
      })
      .mockImplementationOnce(async () => ({}))

    const { list } = await openRuntimePanel([kb('kb-1'), kb('kb-2')], [])

    const firstPick = list[0].action?.({ item: { ...list[0], isSelected: true } })
    const secondPick = list[1].action?.({ item: { ...list[1], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(2))

    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(2, 'assistant-1', { knowledgeBaseIds: ['kb-2'] })
    await Promise.all([firstPick as Promise<unknown>, secondPick as Promise<unknown>])
  })

  it('drops a queued link when the assistant switches before it runs', async () => {
    // The pick belongs to the assistant it was made on; running it after a switch would
    // silently widen another assistant's retrieval ceiling.
    let resolveFirstPatch: (assistant: unknown) => void = () => {}
    const firstPatch = new Promise<unknown>((resolve) => {
      resolveFirstPatch = resolve
    })
    mocks.updateAssistant.mockImplementationOnce(() => firstPatch).mockImplementationOnce(async () => ({}))

    const { list, deliver } = await openRuntimePanel([kb('kb-1'), kb('kb-2')], [])

    const firstPick = list[0].action?.({ item: { ...list[0], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1))

    const queuedPick = list[1].action?.({ item: { ...list[1], isSelected: true } })
    await Promise.resolve()
    await Promise.resolve()

    deliver({ id: 'assistant-2', knowledgeBaseIds: [] })
    resolveFirstPatch({})
    await Promise.all([firstPick as Promise<unknown>, queuedPick as Promise<unknown>])

    // Only the first link PATCHed; the queued one was dropped at the identity check.
    expect(mocks.updateAssistant).toHaveBeenCalledTimes(1)
  })

  it('does not leak the old assistant ids when a switch lands mid-PATCH', async () => {
    // A PATCH resolving after an assistant switch must not write its old ids into the
    // settled ref — the next pick on the new assistant would inherit them and link the
    // old assistant's bases there.
    let resolveFirstPatch: (assistant: unknown) => void = () => {}
    const firstPatch = new Promise<unknown>((resolve) => {
      resolveFirstPatch = resolve
    })
    mocks.updateAssistant.mockImplementationOnce(() => firstPatch).mockImplementationOnce(async () => ({}))

    const { list, deliver } = await openRuntimePanel([kb('kb-1'), kb('kb-2')], [])

    const firstPick = list[0].action?.({ item: { ...list[0], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1))

    // The switch re-scopes the settled ids to assistant-2 while PATCH-1 is still in flight.
    deliver({ id: 'assistant-2', knowledgeBaseIds: [] })
    resolveFirstPatch({})
    await firstPick

    const secondPick = list[1].action?.({ item: { ...list[1], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(2))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(2, 'assistant-2', { knowledgeBaseIds: ['kb-2'] })
    await secondPick
  })

  it('records the settled ids when a same-id refresh delivery lands mid-PATCH', async () => {
    // Every successful PATCH refresh-delivers a fresh same-id snapshot. While the next
    // PATCH is in flight, that delivery must not read as a switch and skip the
    // write-back, or a later pick would drop the just-persisted id from its PATCH.
    let resolveSecondPatch: (assistant: unknown) => void = () => {}
    const secondPatch = new Promise<unknown>((resolve) => {
      resolveSecondPatch = resolve
    })
    mocks.updateAssistant
      .mockImplementationOnce(async () => ({}))
      .mockImplementationOnce(() => secondPatch)
      .mockImplementationOnce(async () => ({}))

    const { list, deliver } = await openRuntimePanel([kb('kb-1'), kb('kb-2'), kb('kb-3')], [])

    await list[0].action?.({ item: { ...list[0], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1))

    const secondPick = list[1].action?.({ item: { ...list[1], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(2))

    // PATCH-1's refresh delivers a fresh same-id snapshot (post-kb-1 truth) mid-flight.
    deliver({ id: 'assistant-1', knowledgeBaseIds: ['kb-1'] })
    resolveSecondPatch({})
    await secondPick

    const thirdPick = list[2].action?.({ item: { ...list[2], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(3))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(3, 'assistant-1', {
      knowledgeBaseIds: ['kb-1', 'kb-2', 'kb-3']
    })
    await thirdPick
  })

  it('starts fresh after an assistant switch instead of carrying the old ids', async () => {
    // A different assistant's delivery is a new scope, not staleness: the settled ids
    // must reset, or a pick on the new assistant would patch in the old one's bases.
    mocks.updateAssistant.mockImplementation(async () => ({}))

    const { list, deliver } = await openRuntimePanel([kb('kb-1'), kb('kb-2')], [])

    await list[0].action?.({ item: { ...list[0], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(1, 'assistant-1', { knowledgeBaseIds: ['kb-1'] })

    deliver({ id: 'assistant-2', knowledgeBaseIds: [] })

    await list[1].action?.({ item: { ...list[1], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(2))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(2, 'assistant-2', { knowledgeBaseIds: ['kb-2'] })
  })

  it('keeps settled ids when a stale delivery lands while a PATCH is in flight', async () => {
    // A pre-PATCH fetch resolving after the PATCH would reset the settled ids to the
    // stale set; the next pick's PATCH must still carry the just-persisted link.
    let resolveFirstPatch: (assistant: unknown) => void = () => {}
    const firstPatch = new Promise<unknown>((resolve) => {
      resolveFirstPatch = resolve
    })
    mocks.updateAssistant.mockImplementationOnce(() => firstPatch).mockImplementationOnce(async () => ({}))

    const { list, deliver } = await openRuntimePanel([kb('kb-1'), kb('kb-2')], [])

    const firstPick = list[0].action?.({ item: { ...list[0], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1))
    resolveFirstPatch({})
    await firstPick

    // A fetch started before the PATCH now resolves after it: the delivery still
    // reports the pre-PATCH ids, which must not unseat the persisted link.
    deliver({ id: 'assistant-1', knowledgeBaseIds: [] })

    const secondPick = list[1].action?.({ item: { ...list[1], isSelected: true } })
    await vi.waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(2))
    expect(mocks.updateAssistant).toHaveBeenNthCalledWith(2, 'assistant-1', {
      knowledgeBaseIds: ['kb-1', 'kb-2']
    })
    await secondPick
  })
})
