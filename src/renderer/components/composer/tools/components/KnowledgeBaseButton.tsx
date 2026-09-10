import { FileSearch, Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ComposerToolFooterAction } from '@renderer/components/composer/toolLauncher'
import { KNOWLEDGE_BASE_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import {
  type QuickPanelCallBackOptions,
  type QuickPanelInputAdapter,
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  useQuickPanel
} from '@renderer/components/QuickPanel'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

interface Props {
  launcher: ToolLauncherApi
  /** Bases selectable in this scope — the scope hook's output (chat: every base, agent: configured). */
  bases: KnowledgeBase[]
  /** Bases in `bases` not linked to the assistant; selecting one auto-links it (#20238). */
  unconfiguredBaseIds: Set<string>
  /** Links an unconfigured base to the assistant before the pick settles. Absent in agent scope. */
  onLinkBase?: (base: KnowledgeBase) => Promise<boolean>
  selectedBases?: KnowledgeBase[]
  onSelect: (bases: KnowledgeBase[]) => void
  disabled?: boolean
  disabledReason?: string
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
  bases,
  unconfiguredBaseIds,
  onLinkBase,
  selectedBases,
  onSelect,
  disabled,
  disabledReason
}: Props) => {
  const { i18n, t } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const { isVisible: isQuickPanelVisible, symbol: quickPanelSymbol, updateList: updateQuickPanelList } = useQuickPanel()
  const [dataRequested, setDataRequested] = useState(false)
  const panelNeedsData =
    isQuickPanelVisible &&
    (quickPanelSymbol === ComposerPanelSymbol.Root || quickPanelSymbol === ComposerPanelSymbol.KnowledgeBase)
  const knowledgeBasesReady = dataRequested || panelNeedsData || (selectedBases?.length ?? 0) > 0
  const onSelectRef = useRef(onSelect)
  const selectedBasesRef = useRef<KnowledgeBase[]>(selectedBases ?? [])
  const basesRef = useRef<KnowledgeBase[]>(bases)
  const tRef = useRef(t)

  onSelectRef.current = onSelect
  selectedBasesRef.current = selectedBases ?? []
  basesRef.current = bases
  tRef.current = t

  const isEnabled = (selectedBases?.length ?? 0) > 0
  const isDisabled = disabled || (knowledgeBasesReady && bases.length === 0)
  const fallbackDisabledReason = disabled
    ? t('chat.input.knowledge_base_disabled_by_files')
    : t('chat.save.knowledge.empty.no_knowledge_base')
  const resolvedDisabledReason = isDisabled ? (disabledReason ?? fallbackDisabledReason) : undefined
  const selectedBaseIds = useMemo(() => new Set((selectedBases ?? []).map((base) => base.id)), [selectedBases])

  const disposeCloseOnInputAfterSelectionRef = useRef<(() => void) | undefined>(undefined)

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
    void language
    return bases.map((base) => {
      // The scope hook types bases as KnowledgeBase, but the composer feeds it list items
      // carrying itemCount at runtime; read it defensively for the doc-count description.
      const itemCount = (base as { itemCount?: number }).itemCount ?? 0
      return {
        id: `knowledge-base:${base.id}`,
        label: base.name,
        description: unconfiguredBaseIds.has(base.id)
          ? `${tRef.current('library.config.knowledge.doc_count', { count: itemCount })} · ${tRef.current('chat.input.knowledge_base_not_linked')}`
          : tRef.current('library.config.knowledge.doc_count', { count: itemCount }),
        filterText: [base.name, base.id].join(' '),
        icon: <FileSearch />,
        isSelected: selectedBaseIds.has(base.id),
        action: async ({ context, inputAdapter, item }) => {
          // QuickPanel flips isSelected before invoking, so item.isSelected is the post-click state.
          if (item.isSelected && unconfiguredBaseIds.has(base.id)) {
            if (!onLinkBase || !(await onLinkBase(base))) {
              // Roll the panel's selection state back through the provider — `item` here is
              // a copy, so mutating it would leave the panel checked.
              context.updateItemSelection?.(item, false)
              toast.error(tRef.current('chat.input.knowledge_base_link_failed'))
              return
            }
          }
          const nextSelectedIds = new Set(selectedBasesRef.current.map((selectedBase) => selectedBase.id))
          if (item.isSelected) {
            nextSelectedIds.add(base.id)
          } else {
            nextSelectedIds.delete(base.id)
          }
          const nextSelectedBases = basesRef.current.filter((candidate) => nextSelectedIds.has(candidate.id))
          selectedBasesRef.current = nextSelectedBases
          onSelectRef.current(nextSelectedBases)
          closeKnowledgeBasePanelOnNextInput({ context, inputAdapter })
        }
      }
    })
  }, [bases, closeKnowledgeBasePanelOnNextInput, language, onLinkBase, selectedBaseIds, unconfiguredBaseIds])

  const knowledgeBaseItems = useMemo(() => buildKnowledgeBaseItems(), [buildKnowledgeBaseItems])
  const manageKnowledgeBaseAction = useMemo<ComposerToolFooterAction>(() => {
    const label = t('chat.input.knowledge_base_manage')
    return {
      id: 'knowledge-base:manage',
      panelSymbol: ComposerPanelSymbol.KnowledgeBase,
      order: 10,
      label,
      ariaLabel: label,
      tooltip: label,
      icon: <Settings2 />,
      action: () => openRoute('/app/knowledge')
    }
  }, [t])

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
      setDataRequested(true)
      const inputQueryCleared = clearKnowledgeBaseInputQuery(inputAdapter, queryAnchor, triggerInfo)
      actionQuickPanel.open({
        title: t('chat.input.knowledge_base'),
        list: knowledgeBaseItems,
        symbol: ComposerPanelSymbol.KnowledgeBase,
        parentPanel,
        queryAnchor: inputQueryCleared ? undefined : queryAnchor,
        triggerInfo: { type: 'button' },
        trackInputQuery: true,
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
    const disposeLauncher = launcher.registerLaunchers(
      [
        {
          ...KNOWLEDGE_BASE_TOOLBAR_MANIFEST.toolbar,
          sources: ['popover', 'root-panel'],
          label: t('chat.input.knowledge_base'),
          description: resolvedDisabledReason ?? '',
          searchAliases: getQuickPanelSearchAliases(t, 'chat.input.knowledge_base', ['knowledge base']),
          disabledReason: resolvedDisabledReason,
          active: isEnabled,
          showInActiveControls: false,
          disabled: isDisabled,
          // action opens the '#' knowledge-base panel, whose symbol differs from the launcher id.
          panelSymbol: ComposerPanelSymbol.KnowledgeBase,
          action: openKnowledgeBasePanel
        }
      ],
      [manageKnowledgeBaseAction]
    )

    return () => {
      disposeLauncher()
    }
  }, [isDisabled, isEnabled, launcher, manageKnowledgeBaseAction, openKnowledgeBasePanel, resolvedDisabledReason, t])
}

export const KnowledgeBaseToolRuntime: FC<Props> = (props) => {
  useKnowledgeBaseToolController(props)
  return null
}
