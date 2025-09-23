import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelListItem, QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { useAppSelector } from '@renderer/store'
import { KnowledgeBase } from '@renderer/types'
import { Tooltip } from 'antd'
import { CircleX, FileSearch, Plus } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

interface Props {
  quickPanel: ToolQuickPanelApi
  selectedBases?: KnowledgeBase[]
  onSelect: (bases: KnowledgeBase[]) => void
  disabled?: boolean
}

const KnowledgeBaseButton: FC<Props> = ({ quickPanel, selectedBases, onSelect, disabled }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanelHook = useQuickPanel()
  const knowledgeState = useAppSelector((state) => state.knowledge)
  const selectedBasesRef = useRef(selectedBases)

  useEffect(() => {
    selectedBasesRef.current = selectedBases
  }, [selectedBases])

  const handleBaseSelect = useCallback(
    (base: KnowledgeBase) => {
      const currentSelectedBases = selectedBasesRef.current

      if (currentSelectedBases?.some((selected) => selected.id === base.id)) {
        onSelect(currentSelectedBases.filter((selected) => selected.id !== base.id))
      } else {
        onSelect([...(currentSelectedBases || []), base])
      }
    },
    [onSelect]
  )

  const baseItems = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = knowledgeState.bases.map((base) => ({
      label: base.name,
      description: `${base.items.length} ${t('files.count')}`,
      icon: <FileSearch />,
      action: () => handleBaseSelect(base),
      isSelected: selectedBases?.some((selected) => selected.id === base.id)
    }))

    items.push({
      label: t('knowledge.add.title') + '...',
      icon: <Plus />,
      action: () => navigate('/knowledge'),
      isSelected: false
    })

    items.unshift({
      label: t('settings.input.clear.all'),
      description: t('settings.input.clear.knowledge_base'),
      icon: <CircleX />,
      isSelected: false,
      action: ({ context: ctx }) => {
        onSelect([])
        ctx.close()
      }
    })

    return items
  }, [knowledgeState.bases, t, selectedBases, handleBaseSelect, navigate, onSelect])

  const openQuickPanel = useCallback(() => {
    quickPanelHook.open({
      title: t('chat.input.knowledge_base'),
      list: baseItems,
      symbol: QuickPanelReservedSymbol.KnowledgeBase,
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [baseItems, quickPanelHook, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.KnowledgeBase) {
      quickPanelHook.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanelHook])

  // 监听 selectedBases 变化，动态更新已打开的 QuickPanel 列表状态
  useEffect(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.KnowledgeBase) {
      // 直接使用重新计算的 baseItems，因为它已经包含了最新的 isSelected 状态
      quickPanelHook.updateList(baseItems)
    }
  }, [selectedBases, quickPanelHook, baseItems])

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu([
      {
        label: t('chat.input.knowledge_base'),
        description: '',
        icon: <FileSearch />,
        isMenu: true,
        action: () => openQuickPanel()
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.KnowledgeBase, () => openQuickPanel())

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, quickPanel, t])

  return (
    <Tooltip placement="top" title={t('chat.input.knowledge_base')} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        active={selectedBases && selectedBases.length > 0}
        disabled={disabled}>
        <FileSearch size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(KnowledgeBaseButton)
