import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAppSelector } from '@renderer/store'
import { KnowledgeBase } from '@renderer/types'
import { Tooltip } from 'antd'
import { FileSearch, Plus } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface KnowledgeBaseButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<KnowledgeBaseButtonRef | null>
  selectedBases?: KnowledgeBase[]
  onSelect: (bases: KnowledgeBase[]) => void
  disabled?: boolean
  ToolbarButton: any
}

const KnowledgeBaseButton: FC<Props> = ({ ref, selectedBases, onSelect, disabled, ToolbarButton }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanel = useQuickPanel()
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
    const newList: QuickPanelListItem[] = knowledgeState.bases.map((base) => ({
      label: base.name,
      description: `${base.items.length} ${t('files.count')}`,
      icon: <FileSearch />,
      action: () => handleBaseSelect(base),
      isSelected: selectedBases?.some((selected) => selected.id === base.id)
    }))
    newList.push({
      label: t('knowledge.add.title') + '...',
      icon: <Plus />,
      action: () => navigate('/knowledge'),
      isSelected: false
    })
    return newList
  }, [knowledgeState.bases, handleBaseSelect, selectedBases, t, navigate])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('chat.input.knowledge_base'),
      list: baseItems,
      symbol: '#',
      multiple: false,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [baseItems, quickPanel, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === '#') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('chat.input.knowledge_base')} mouseLeaveDelay={0} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel} disabled={disabled}>
        <FileSearch size={18} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(KnowledgeBaseButton)
