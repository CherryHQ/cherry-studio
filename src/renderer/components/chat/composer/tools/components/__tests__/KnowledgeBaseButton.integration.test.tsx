import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import {
  type QuickPanelContextType,
  QuickPanelProvider,
  QuickPanelView,
  useQuickPanel
} from '@renderer/components/QuickPanel'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeBaseToolRuntime } from '../KnowledgeBaseButton'

const mocks = vi.hoisted(() => ({
  language: 'en',
  knowledgeBases: [] as KnowledgeBase[]
}))

vi.mock('i18next', () => ({
  t: (key: string, fallback?: string) => fallback ?? key
}))

vi.mock('@renderer/utils', () => ({
  classNames: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await import('react')

  return {
    DynamicVirtualList: ({
      children,
      list,
      ref
    }: {
      children: (item: unknown, index: number) => React.ReactNode
      list: unknown[]
      ref?: React.Ref<{ scrollToIndex: (index: number) => void; scrollToOffset: (offset: number) => void }>
    }) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: vi.fn(),
        scrollToOffset: vi.fn()
      }))

      return (
        <div data-testid="quick-panel-virtual-list">
          {list.map((item, index) => (
            <React.Fragment key={(item as { id?: string }).id ?? index}>{children(item, index)}</React.Fragment>
          ))}
        </div>
      )
    }
  }
})

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({ bases: mocks.knowledgeBases })
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
        'library.config.knowledge.doc_count': `${options?.count ?? 0} docs`,
        'settings.quickPanel.multiple': 'Select multiple'
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
    emoji: undefined,
    ...overrides
  }) as KnowledgeBase

function createInputAdapter(initialText = '', initialCursor = initialText.length) {
  let text = initialText
  let cursor = initialCursor
  const listeners = new Set<Parameters<NonNullable<QuickPanelInputAdapter['subscribeInput']>>[0]>()

  const adapter: QuickPanelInputAdapter = {
    getText: () => text,
    getCursorOffset: () => cursor,
    insertText: vi.fn((insertedText: string) => {
      text = `${text.slice(0, cursor)}${insertedText}${text.slice(cursor)}`
      cursor += insertedText.length
      listeners.forEach((listener) => listener())
    }),
    deleteTriggerRange: vi.fn(({ from, to }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursor = cursor <= from ? cursor : Math.max(from, cursor - (to - from))
      listeners.forEach((listener) => listener())
    }),
    focus: vi.fn(),
    subscribeInput: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }

  const syncManagedTokenText = (nextText: string, nextCursor = nextText.length) => {
    text = nextText
    cursor = nextCursor
    listeners.forEach((listener) => listener({ cause: 'state-sync' }))
  }

  return { adapter, syncManagedTokenText }
}

function QuickPanelBridge({
  inputAdapter,
  onContext
}: {
  inputAdapter: QuickPanelInputAdapter
  onContext: (context: QuickPanelContextType) => void
}) {
  const quickPanel = useQuickPanel()

  useEffect(() => {
    onContext(quickPanel)
  }, [onContext, quickPanel])

  return <QuickPanelView inputAdapter={inputAdapter} />
}

function ControlledKnowledgeBaseRuntime({
  launcher,
  onSelect
}: {
  launcher: ToolLauncherApi
  onSelect: (bases: KnowledgeBase[]) => void
}) {
  const [selectedBases, setSelectedBases] = useState<KnowledgeBase[]>([])

  return (
    <KnowledgeBaseToolRuntime
      launcher={launcher}
      configuredKnowledgeBaseIds={['kb-1', 'kb-2']}
      selectedBases={selectedBases}
      onSelect={(bases) => {
        onSelect(bases)
        setSelectedBases(bases)
      }}
    />
  )
}

describe('KnowledgeBaseToolRuntime QuickPanel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.language = 'en'
    mocks.knowledgeBases = [
      createKnowledgeBase({ id: 'kb-1', name: 'Knowledge One', itemCount: 2 }),
      createKnowledgeBase({ id: 'kb-2', name: 'Knowledge Two', itemCount: 5 })
    ]
  })

  it('keeps the multi-select panel open while selecting, then closes it when typing resumes', async () => {
    let quickPanel: QuickPanelContextType | undefined
    const input = createInputAdapter('/knowledge')
    const onSelect = vi.fn()
    let registeredLauncher: Parameters<ToolLauncherApi['registerLaunchers']>[0][number] | undefined
    const launcher: ToolLauncherApi = {
      registerLaunchers: vi.fn((entries) => {
        registeredLauncher = entries[0]
        return vi.fn()
      })
    }

    render(
      <QuickPanelProvider>
        <ControlledKnowledgeBaseRuntime launcher={launcher} onSelect={onSelect} />
        <QuickPanelBridge inputAdapter={input.adapter} onContext={(context) => (quickPanel = context)} />
      </QuickPanelProvider>
    )

    await waitFor(() => expect(registeredLauncher).toBeDefined())
    await waitFor(() => expect(quickPanel).toBeDefined())

    registeredLauncher?.action?.({
      inputAdapter: input.adapter,
      quickPanel: quickPanel!,
      queryAnchor: 0,
      source: 'root-panel',
      triggerInfo: { type: 'input', position: 0, originalText: '/knowledge' }
    })

    await screen.findByText('Knowledge One')
    expect(input.adapter.deleteTriggerRange).toHaveBeenCalledTimes(1)
    expect(input.adapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 10 })
    expect(input.adapter.getText()).toBe('')

    fireEvent.click(screen.getByText('Knowledge One'))

    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith([mocks.knowledgeBases[0]]))
    input.syncManagedTokenText(' ')
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    expect(input.adapter.deleteTriggerRange).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Knowledge Two'))

    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith([mocks.knowledgeBases[0], mocks.knowledgeBases[1]]))
    input.syncManagedTokenText('  ')
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    expect(input.adapter.deleteTriggerRange).toHaveBeenCalledTimes(1)

    input.adapter.insertText(' ')

    await waitFor(() => {
      expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible')
    })
  })
})
