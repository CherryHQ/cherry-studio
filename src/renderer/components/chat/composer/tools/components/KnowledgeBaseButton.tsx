import {
  type QuickPanelCallBackOptions,
  type QuickPanelInputAdapter,
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  useQuickPanel
} from '@renderer/components/chat/composer/panelEngine'
import { ComposerPanelSymbol } from '@renderer/components/chat/composer/quickPanel/symbols'
import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { FileSearch } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  configuredKnowledgeBaseIds?: string[]
  selectedBases?: KnowledgeBase[]
  onSelect: (bases: KnowledgeBase[]) => void
  disabled?: boolean
  disabledReason?: string
}

const KNOWLEDGE_BASE_IDS_KEY_SEPARATOR = '\u0000'

function getKnowledgeBaseIdsKey(ids: string[] | undefined) {
  return (ids ?? []).join(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR)
}

function clearKnowledgeBaseInputQuery(
  inputAdapter: QuickPanelInputAdapter | undefined,
  queryAnchor: number | undefined,
  triggerInfo: { type: 'input' | 'button' } | undefined
) {
  if (!inputAdapter || triggerInfo?.type !== 'input' || queryAnchor === undefined) return false

  const text = inputAdapter.getText()
  const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
  if (cursorOffset <= queryAnchor) return false

  inputAdapter.deleteTriggerRange({ from: queryAnchor, to: cursorOffset })
  inputAdapter.focus()
  return true
}

const useKnowledgeBaseToolController = ({
  launcher,
  configuredKnowledgeBaseIds,
  selectedBases,
  onSelect,
  disabled,
  disabledReason
}: Props) => {
  const { i18n, t } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const { isVisible: isQuickPanelVisible, symbol: quickPanelSymbol, updateList: updateQuickPanelList } = useQuickPanel()
  const { bases: knowledgeBases } = useKnowledgeBases()
  const onSelectRef = useRef(onSelect)
  const selectedBasesRef = useRef<KnowledgeBase[]>(selectedBases ?? [])
  const configuredBasesRef = useRef<KnowledgeBase[]>([])
  const tRef = useRef(t)
  const disposeCloseOnInputAfterSelectionRef = useRef<(() => void) | undefined>(undefined)
  const configuredKnowledgeBaseIdsKey = getKnowledgeBaseIdsKey(configuredKnowledgeBaseIds)

  const configuredBases = useMemo(() => {
    const configuredIds = new Set(
      configuredKnowledgeBaseIdsKey ? configuredKnowledgeBaseIdsKey.split(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR) : []
    )
    if (configuredIds.size === 0) return []
    return knowledgeBases.filter((base) => configuredIds.has(base.id))
  }, [configuredKnowledgeBaseIdsKey, knowledgeBases])
  onSelectRef.current = onSelect
  selectedBasesRef.current = selectedBases ?? []
  configuredBasesRef.current = configuredBases
  tRef.current = t

  const isEnabled = (selectedBases?.length ?? 0) > 0
  const isDisabled = disabled || configuredBases.length === 0
  const fallbackDisabledReason = disabled
    ? t('chat.input.knowledge_base_disabled_by_files')
    : t('chat.save.knowledge.empty.no_knowledge_base')
  const resolvedDisabledReason = isDisabled ? (disabledReason ?? fallbackDisabledReason) : undefined
  const selectedBaseIds = useMemo(() => new Set((selectedBases ?? []).map((base) => base.id)), [selectedBases])

  const disposeCloseOnInputAfterSelection = useCallback(() => {
    disposeCloseOnInputAfterSelectionRef.current?.()
    disposeCloseOnInputAfterSelectionRef.current = undefined
  }, [])

  const closeKnowledgeBasePanelOnNextInput = useCallback(
    ({ context, inputAdapter }: Pick<QuickPanelCallBackOptions, 'context' | 'inputAdapter'>) => {
      disposeCloseOnInputAfterSelection()
      if (!inputAdapter?.subscribeInput) return

      const initialText = inputAdapter.getText()
      const initialCursorOffset = inputAdapter.getCursorOffset?.() ?? initialText.length

      disposeCloseOnInputAfterSelectionRef.current = inputAdapter.subscribeInput((event) => {
        if (event?.isComposing) return
        if (event?.cause === 'state-sync') return

        const nextText = inputAdapter.getText()
        const nextCursorOffset = inputAdapter.getCursorOffset?.() ?? nextText.length
        if (nextText === initialText && nextCursorOffset === initialCursorOffset) return

        disposeCloseOnInputAfterSelection()
        context.close('knowledge_base_input_resumed')
      })
    },
    [disposeCloseOnInputAfterSelection]
  )

  const buildKnowledgeBaseItems = useCallback((): QuickPanelListItem[] => {
    return configuredBases.map((base) => ({
      id: `knowledge-base:${base.id}`,
      label: base.name,
      description: tRef.current('library.config.knowledge.doc_count', { count: base.itemCount ?? 0 }),
      filterText: [base.name, base.id].join(' '),
      icon: <FileSearch />,
      isSelected: selectedBaseIds.has(base.id),
      action: ({ context, inputAdapter, item }) => {
        const nextSelectedIds = new Set(selectedBasesRef.current.map((selectedBase) => selectedBase.id))
        if (item.isSelected) {
          nextSelectedIds.add(base.id)
        } else {
          nextSelectedIds.delete(base.id)
        }
        const nextSelectedBases = configuredBasesRef.current.filter((candidate) => nextSelectedIds.has(candidate.id))
        selectedBasesRef.current = nextSelectedBases
        onSelectRef.current(nextSelectedBases)
        closeKnowledgeBasePanelOnNextInput({ context, inputAdapter })
      }
    }))
  }, [closeKnowledgeBasePanelOnNextInput, configuredBases, language, selectedBaseIds])

  const knowledgeBaseItems = useMemo(() => buildKnowledgeBaseItems(), [buildKnowledgeBaseItems])

  useEffect(() => {
    if (isQuickPanelVisible && quickPanelSymbol === ComposerPanelSymbol.KnowledgeBase) {
      updateQuickPanelList(knowledgeBaseItems)
    }
  }, [isQuickPanelVisible, knowledgeBaseItems, quickPanelSymbol, updateQuickPanelList])

  const openKnowledgeBasePanel = useCallback(
    ({
      inputAdapter,
      parentPanel,
      queryAnchor,
      quickPanel: actionQuickPanel,
      triggerInfo
    }: {
      inputAdapter?: QuickPanelInputAdapter
      parentPanel?: QuickPanelOpenOptions
      queryAnchor?: number
      quickPanel: { open: (options: QuickPanelOpenOptions) => void }
      triggerInfo?: { type: 'input' | 'button' }
    }) => {
      if (isDisabled) return
      disposeCloseOnInputAfterSelection()
      const inputQueryCleared = clearKnowledgeBaseInputQuery(inputAdapter, queryAnchor, triggerInfo)
      actionQuickPanel.open({
        title: t('chat.input.knowledge_base'),
        list: knowledgeBaseItems,
        symbol: ComposerPanelSymbol.KnowledgeBase,
        parentPanel,
        queryAnchor: inputQueryCleared ? undefined : queryAnchor,
        triggerInfo: inputQueryCleared ? { type: 'button' } : (triggerInfo ?? { type: 'button' }),
        multiple: true,
        onClose: disposeCloseOnInputAfterSelection
      })
    },
    [disposeCloseOnInputAfterSelection, isDisabled, knowledgeBaseItems, t]
  )

  useEffect(() => {
    return () => {
      disposeCloseOnInputAfterSelection()
    }
  }, [disposeCloseOnInputAfterSelection])

  useEffect(() => {
    const disposeLauncher = launcher.registerLaunchers([
      {
        id: 'knowledge-base',
        kind: 'panel',
        sources: ['popover', 'root-panel'],
        order: 40,
        label: t('chat.input.knowledge_base'),
        description: resolvedDisabledReason ?? '',
        disabledReason: resolvedDisabledReason,
        icon: <FileSearch />,
        active: isEnabled,
        showInActiveControls: false,
        disabled: isDisabled,
        action: openKnowledgeBasePanel
      }
    ])

    return () => {
      disposeLauncher()
    }
  }, [isDisabled, isEnabled, launcher, openKnowledgeBasePanel, resolvedDisabledReason, t])
}

export const KnowledgeBaseToolRuntime: FC<Props> = (props) => {
  useKnowledgeBaseToolController(props)
  return null
}
